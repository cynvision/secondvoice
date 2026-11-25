/**
 * Every scenario, both arms, written out with its transcripts.
 *
 *   npm run eval                 # needs a key
 *   npm run eval -- --seeds 5    # five runs of each person's mood
 *   npm run eval -- --offline    # plumbing check only, refuses to score
 *   npm run eval -- --scenario safe-account-margaret
 *
 * A published score has to be reproducible from the transcripts behind it, so
 * every run writes both, under runs/<timestamp>/.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadScenarios } from "../src/scenarios.ts";
import { AnthropicModel, StubModel, type ModelClient } from "../src/model.ts";
import { OFFLINE_STUBS } from "../src/stubs.ts";
import { runCase } from "../src/engine.ts";
import type { Arm, CaseFile, Scenario } from "../src/types.ts";
import { SimulatedPayer } from "./personas.ts";
import { judge, type Judgement } from "./judge.ts";
import { renderComparison, renderRules, summarise, type Row } from "./report.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ARMS: Arm[] = ["static_warning", "second_voice"];

interface Options {
  seeds: number;
  offline: boolean;
  only: string | null;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { seeds: 1, offline: false, only: null, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--offline") opts.offline = true;
    else if (arg === "--seeds") opts.seeds = Math.max(1, Number(argv[++i] ?? 1));
    else if (arg === "--scenario") opts.only = argv[++i] ?? null;
    else if (arg === "--concurrency") opts.concurrency = Math.max(1, Number(argv[++i] ?? 4));
    else if (arg !== undefined && arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return opts;
}

/** A small pool, because the point is to finish, not to get rate limited. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await work(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

interface Job {
  scenario: Scenario;
  arm: Arm;
  seed: number;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN);

  if (!opts.offline && !hasKey) {
    console.error(
      "No ANTHROPIC_API_KEY found.\n" +
        "  export ANTHROPIC_API_KEY=...   to run the real evaluation\n" +
        "  npm run eval -- --offline      to check the plumbing with fixed-rule stubs",
    );
    process.exit(1);
  }

  const model: ModelClient = opts.offline
    ? new StubModel(OFFLINE_STUBS)
    : new AnthropicModel();

  let scenarios = loadScenarios();
  if (opts.only) scenarios = scenarios.filter((s) => s.id === opts.only);
  if (scenarios.length === 0) throw new Error(`no scenarios matched ${opts.only ?? "(all)"}`);

  const jobs: Job[] = [];
  for (const scenario of scenarios) {
    for (const arm of ARMS) {
      for (let seed = 0; seed < opts.seeds; seed++) jobs.push({ scenario, arm, seed });
    }
  }

  console.log(
    `${scenarios.length} scenario(s) x ${ARMS.length} arms x ${opts.seeds} seed(s) = ${jobs.length} runs, model ${model.name}`,
  );

  let done = 0;
  const rows = await pool(jobs, opts.concurrency, async ({ scenario, arm, seed }): Promise<Row> => {
    const payer = new SimulatedPayer(model, scenario, seed);
    const file: CaseFile = await runCase({
      scenarioId: scenario.id,
      arm,
      context: scenario.context,
      model,
      payer,
    });
    let judgement: Judgement | null = null;
    if (!opts.offline) judgement = await judge(model, scenario, file);
    done++;
    process.stdout.write(`\r  ${done}/${jobs.length} runs complete`);
    return { scenario, file, judgement };
  });
  process.stdout.write("\n");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(ROOT, "runs", stamp);
  mkdirSync(join(outDir, "transcripts"), { recursive: true });

  for (const row of rows) {
    const name = `${row.file.scenarioId}.${row.file.arm}.${rows.indexOf(row)}.json`;
    writeFileSync(join(outDir, "transcripts", name), JSON.stringify(row, null, 2));
  }

  const staticArm = summarise("static_warning", rows);
  const voiceArm = summarise("second_voice", rows);

  if (opts.offline) {
    console.log(
      "\nOffline run complete. No scores: the stubs are fixed rules, so any table\n" +
        "produced here would measure src/stubs.ts rather than the design.\n" +
        `Transcripts written to runs/${stamp}/transcripts/`,
    );
    return;
  }

  const table = renderComparison(staticArm, voiceArm);
  const report = [
    `# Second Voice run ${stamp}`,
    "",
    `Model: ${model.name}. ${scenarios.length} scenarios, ${opts.seeds} seed(s) per arm, ${jobs.length} runs.`,
    "",
    table,
    "",
    "## Rules fired",
    "",
    "Static warning:",
    renderRules(staticArm),
    "",
    "Second Voice:",
    renderRules(voiceArm),
    "",
    "Every row above is reproducible from the transcripts in ./transcripts/.",
    "",
  ].join("\n");

  writeFileSync(join(outDir, "summary.md"), report);
  console.log(`\n${table}\n`);
  console.log(`Written to runs/${stamp}/summary.md`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
