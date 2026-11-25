/**
 * Stage 1. Rules only.
 *
 * Scores what the bank can observe without asking the payer anything. No model
 * runs here, so this layer cannot be talked out of its conclusion, and it is the
 * floor that triage is allowed to raise but never lower.
 */

import type { CautionLevel, PaymentContext, Signal, SignalResult } from "./types.ts";

/** Weights are deliberately coarse. A tuned table is the bank's, not the repo's. */
const RULES: Array<{ id: string; label: string; weight: number; when: (c: PaymentContext) => boolean }> = [
  {
    id: "call_in_progress",
    label: "A call is in progress while the payment is being made",
    weight: 30,
    when: (c) => c.callInProgress,
  },
  {
    id: "long_call",
    label: "The call has been running for more than 20 minutes",
    weight: 10,
    when: (c) => (c.callStartedMinutesAgo ?? 0) > 20,
  },
  {
    id: "remote_access",
    label: "Remote access software is active on the device",
    weight: 35,
    when: (c) => c.remoteAccessDetected,
  },
  {
    id: "new_payee",
    label: "First payment to this account",
    weight: 15,
    when: (c) => c.payeeIsNew,
  },
  {
    id: "name_mismatch",
    label: "The account name does not match the one given",
    weight: 20,
    when: (c) => c.nameCheck === "no_match",
  },
  {
    id: "name_close_match",
    label: "The account name is close but not exact",
    weight: 8,
    when: (c) => c.nameCheck === "close_match",
  },
  {
    id: "far_above_history",
    label: "Much larger than anything this payer has sent before",
    weight: 15,
    when: (c) => c.amountVsUsualMax >= 3,
  },
  {
    id: "empties_account",
    label: "Moves most of the available balance",
    weight: 12,
    when: (c) => c.shareOfBalance >= 0.7,
  },
  {
    id: "older_payer",
    label: "Payer is in an age band these scams target hardest",
    weight: 5,
    when: (c) => c.payerAgeBand === "65-79" || c.payerAgeBand === "80+",
  },
];

export function levelFor(score: number): CautionLevel {
  if (score >= 60) return "high";
  if (score >= 35) return "elevated";
  if (score >= 15) return "low";
  return "none";
}

export function scoreSignals(context: PaymentContext): SignalResult {
  const signals: Signal[] = [];
  for (const rule of RULES) {
    if (rule.when(context)) {
      signals.push({ id: rule.id, label: rule.label, weight: rule.weight });
    }
  }
  const score = signals.reduce((total, s) => total + s.weight, 0);
  return { score, level: levelFor(score), signals };
}

const ORDER: CautionLevel[] = ["none", "low", "elevated", "high"];

/** One step up, and never past high. Used only by triage, and only upward. */
export function raise(level: CautionLevel): CautionLevel {
  const next = ORDER[Math.min(ORDER.indexOf(level) + 1, ORDER.length - 1)];
  // indexOf always finds a CautionLevel, so next is defined; the check keeps
  // noUncheckedIndexedAccess happy without a non-null assertion.
  return next ?? level;
}

export function atLeast(level: CautionLevel, floor: CautionLevel): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(floor);
}
