/**
 * Turning a pile of case files into the table on the website.
 *
 * Every number here is a count over a named denominator, printed with its own n.
 * Ten scenarios at a handful of seeds is a sample small enough that a percentage
 * on its own would flatter it, so the percentage never travels without the
 * fraction it came from.
 */

import type { Arm, CaseFile, Scenario } from "../src/types.ts";
import { scoreHard, type Judgement } from "./judge.ts";

export interface Row {
  scenario: Scenario;
  file: CaseFile;
  judgement: Judgement | null;
}

export interface ArmSummary {
  arm: Arm;
  scamRuns: number;
  legitimateRuns: number;
  moneyStopped: number;
  payerChoseToCancel: number;
  payerDisclosed: number;
  spellBroken: number;
  legitimateReleased: number;
  legitimateAbandoned: number;
  dignityMean: number | null;
  rulesFired: Record<string, number>;
}

export function summarise(arm: Arm, rows: Row[]): ArmSummary {
  const mine = rows.filter((r) => r.file.arm === arm);
  const scam = mine.filter((r) => r.scenario.truth === "scam");
  const legit = mine.filter((r) => r.scenario.truth === "legitimate");

  const dignities = mine.map((r) => r.judgement?.dignity).filter((d): d is number => d !== undefined);
  const rulesFired: Record<string, number> = {};
  for (const r of mine) {
    rulesFired[r.file.outcome.ruleId] = (rulesFired[r.file.outcome.ruleId] ?? 0) + 1;
  }

  const count = (rs: Row[], pick: (r: Row) => boolean | null) =>
    rs.filter((r) => pick(r) === true).length;

  return {
    arm,
    scamRuns: scam.length,
    legitimateRuns: legit.length,
    moneyStopped: count(scam, (r) => scoreHard(r.scenario, r.file).moneyStopped),
    payerChoseToCancel: count(scam, (r) => scoreHard(r.scenario, r.file).payerChoseToCancel),
    payerDisclosed: count(scam, (r) => scoreHard(r.scenario, r.file).payerDisclosed),
    spellBroken: count(scam, (r) => r.judgement?.spellBroken ?? null),
    legitimateReleased: count(legit, (r) => scoreHard(r.scenario, r.file).legitimateReleased),
    legitimateAbandoned: count(legit, (r) => scoreHard(r.scenario, r.file).legitimateAbandoned),
    dignityMean:
      dignities.length > 0 ? dignities.reduce((a, b) => a + b, 0) / dignities.length : null,
  rulesFired,
  };
}

function frac(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${n}/${d} (${Math.round((n / d) * 100)}%)`;
}

export function renderComparison(a: ArmSummary, b: ArmSummary): string {
  const rows: Array<[string, string, string]> = [
    ["Money stopped", frac(a.moneyStopped, a.scamRuns), frac(b.moneyStopped, b.scamRuns)],
    ["Payer chose to cancel", frac(a.payerChoseToCancel, a.scamRuns), frac(b.payerChoseToCancel, b.scamRuns)],
    ["Payer disclosed", frac(a.payerDisclosed, a.scamRuns), frac(b.payerDisclosed, b.scamRuns)],
    ["Spell broken", frac(a.spellBroken, a.scamRuns), frac(b.spellBroken, b.scamRuns)],
    ["Legitimate released", frac(a.legitimateReleased, a.legitimateRuns), frac(b.legitimateReleased, b.legitimateRuns)],
    ["Legitimate abandoned", frac(a.legitimateAbandoned, a.legitimateRuns), frac(b.legitimateAbandoned, b.legitimateRuns)],
    [
      "Dignity, 1 to 5",
      a.dignityMean === null ? "n/a" : a.dignityMean.toFixed(2),
      b.dignityMean === null ? "n/a" : b.dignityMean.toFixed(2),
    ],
  ];

  const w0 = Math.max(...rows.map((r) => r[0].length), "Measure".length);
  const w1 = Math.max(...rows.map((r) => r[1].length), "Static warning".length);
  const w2 = Math.max(...rows.map((r) => r[2].length), "Second Voice".length);
  const line = (c0: string, c1: string, c2: string) =>
    `| ${c0.padEnd(w0)} | ${c1.padEnd(w1)} | ${c2.padEnd(w2)} |`;

  return [
    line("Measure", "Static warning", "Second Voice"),
    `|${"-".repeat(w0 + 2)}|${"-".repeat(w1 + 2)}|${"-".repeat(w2 + 2)}|`,
    ...rows.map((r) => line(r[0], r[1], r[2])),
  ].join("\n");
}

export function renderRules(s: ArmSummary): string {
  const entries = Object.entries(s.rulesFired).sort(([x], [y]) => x.localeCompare(y));
  if (entries.length === 0) return "  (none)";
  return entries.map(([id, n]) => `  ${id}  ${n} run(s)`).join("\n");
}
