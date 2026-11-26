/**
 * The demo bank. A fictional bank called Fernhill, one payment screen, and the
 * real engine behind it.
 *
 *   npm run dev                    # offline, fixed-rule stubs, no key needed
 *   ANTHROPIC_API_KEY=... npm run dev
 *
 * The engine is a loop that awaits the payer, and HTTP is request and response,
 * so each session parks the running case on a pair of channels: the engine
 * blocks on the payer's answer, the request blocks on the next message. Nothing
 * here reaches past the engine into the rule table, which is the point of the
 * demo: what you click through is the same code the harness scores.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { runCase, type Payer, type PayerReply } from "../src/engine.ts";
import { AnthropicModel, StubModel, type ModelClient } from "../src/model.ts";
import { OFFLINE_STUBS } from "../src/stubs.ts";
import { loadScenarios } from "../src/scenarios.ts";
import type { CaseFile } from "../src/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4310);

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);
const model: ModelClient = hasKey ? new AnthropicModel() : new StubModel(OFFLINE_STUBS);

function channel<T>() {
  const queue: T[] = [];
  const waiters: Array<(value: T) => void> = [];
  return {
    push(value: T): void {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    },
    take(): Promise<T> {
      if (queue.length > 0) return Promise.resolve(queue.shift() as T);
      return new Promise<T>((resolve) => waiters.push(resolve));
    },
  };
}

type FromEngine =
  | { kind: "message"; text: string }
  | { kind: "done"; file: CaseFile }
  /** The engine failed. No decision was made, and none is invented here. */
  | { kind: "error"; message: string };

interface Session {
  toPayer: ReturnType<typeof channel<FromEngine>>;
  toEngine: ReturnType<typeof channel<PayerReply>>;
}

const sessions = new Map<string, Session>();

class HumanPayer implements Payer {
  #session: Session;
  constructor(session: Session) {
    this.#session = session;
  }
  async reply(message: string): Promise<PayerReply> {
    this.#session.toPayer.push({ kind: "message", text: message });
    return this.#session.toEngine.take();
  }
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = readFileSync(join(HERE, "public", "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && req.url === "/api/scenarios") {
      json(res, 200, {
        offline: !hasKey,
        model: model.name,
        scenarios: loadScenarios().map((s) => ({
          id: s.id,
          title: s.title,
          amount: s.context.amount,
          currency: s.context.currency,
          payeeName: s.context.payeeName,
          payerName: s.context.payerName,
          callInProgress: s.context.callInProgress,
          // The hidden truth stays hidden: the page is the payer's view.
        })),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/start") {
      const body = await readBody(req);
      const scenario = loadScenarios().find((s) => s.id === body["scenarioId"]);
      if (!scenario) return json(res, 404, { error: "no such scenario" });

      const session: Session = { toPayer: channel<FromEngine>(), toEngine: channel<PayerReply>() };
      const id = randomUUID();
      sessions.set(id, session);

      void runCase({
        scenarioId: scenario.id,
        arm: "second_voice",
        context: scenario.context,
        model,
        payer: new HumanPayer(session),
      })
        .then((file) => session.toPayer.push({ kind: "done", file }))
        .catch((error: unknown) => {
          console.error(error);
          session.toPayer.push({
            kind: "error",
            message: "Something went wrong and no decision was made. In a bank this would fall back to the signal-only rules.",
          });
        });

      const first = await session.toPayer.take();
      return json(res, 200, { sessionId: id, ...first });
    }

    if (req.method === "POST" && req.url === "/api/say") {
      const body = await readBody(req);
      const session = sessions.get(String(body["sessionId"]));
      if (!session) return json(res, 404, { error: "no such session" });

      session.toEngine.push({
        text: String(body["text"] ?? ""),
        askedToStop: body["askedToStop"] === true,
        disclosedThirdParty: false,
      });
      const next = await session.toPayer.take();
      if (next.kind !== "message") sessions.delete(String(body["sessionId"]));
      return json(res, 200, next);
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fernhill demo bank on http://localhost:${PORT}`);
  console.log(
    hasKey
      ? `  model: ${model.name}`
      : "  offline: fixed-rule stubs, no key needed. Set ANTHROPIC_API_KEY for the real thing.",
  );
});
