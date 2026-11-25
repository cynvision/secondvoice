/**
 * The boundary every model call crosses.
 *
 * Two implementations. The live one talks to Claude and is forced through a Zod
 * schema, so a stage either gets a well-formed answer or throws. The offline one
 * answers from fixed rules, which is what lets `npm test` and the demo bank run
 * with no network and no key.
 *
 * Nothing below this interface knows which one it is holding. That is the point:
 * the plumbing, the audit trail and the rule table are all exercised identically
 * either way.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AskArgs<T> {
  /** Names the caller, e.g. "triage". Offline stubs dispatch on it. */
  label: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort?: Effort;
}

export interface ModelClient {
  readonly name: string;
  ask<T>(args: AskArgs<T>): Promise<T>;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export class AnthropicModel implements ModelClient {
  readonly name: string;
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(options: { model?: string; client?: Anthropic } = {}) {
    // The SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an
    // `ant auth login` profile by itself. Never read or print a key here.
    this.#client = options.client ?? new Anthropic();
    this.#model = options.model ?? process.env.SECONDVOICE_MODEL ?? DEFAULT_MODEL;
    this.name = this.#model;
  }

  async ask<T>({ system, prompt, schema, effort = "medium" }: AskArgs<T>): Promise<T> {
    const response = await this.#client.messages.parse({
      model: this.#model,
      // Thinking is always on for this model family and its tokens count here,
      // so leave room. This is a ceiling, not a spend.
      max_tokens: 16000,
      output_config: {
        effort,
        format: zodOutputFormat(schema as z.ZodType<Record<string, unknown>>),
      },
      system,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        `model declined (${response.stop_details?.category ?? "no category"}). ` +
          "Scenario text may read as instructions for running a scam rather than defending against one.",
      );
    }
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(`model returned no parseable output (stop_reason ${response.stop_reason})`);
    }
    return response.parsed_output as T;
  }
}

export type StubHandler = (prompt: string) => unknown;

/**
 * Fixed rules standing in for a model. Each answer still goes through the same
 * Zod schema the live path uses, so a stub that drifts out of shape fails in the
 * same place a bad model response would.
 */
export class StubModel implements ModelClient {
  readonly name = "offline-stub";
  readonly #handlers: Record<string, StubHandler>;

  constructor(handlers: Record<string, StubHandler>) {
    this.#handlers = handlers;
  }

  async ask<T>({ label, prompt, schema }: AskArgs<T>): Promise<T> {
    const handler = this.#handlers[label];
    if (!handler) {
      throw new Error(
        `offline mode has no stub for "${label}". Add one in src/stubs.ts, or run with a key.`,
      );
    }
    const parsed = schema.safeParse(handler(prompt));
    if (!parsed.success) {
      throw new Error(`stub for "${label}" produced the wrong shape: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}
