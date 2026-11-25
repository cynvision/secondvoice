/**
 * Stage 5. Rules only, and the only place a payment is decided.
 *
 * An ordered table, first match wins. Every outcome names the rule that produced
 * it, so a decision can be explained to a customer, an ombudsman or a regulator
 * from the logged inputs alone, without rerunning a model or trusting that it
 * would say the same thing twice.
 *
 * The order is load-bearing. R1 sits above everything because a payer who has
 * asked to stop has already got what the intervention was for, and nothing below
 * should talk them back out of it.
 */

import { atLeast } from "./signals.ts";
import type {
  CautionLevel,
  CoachingAdvice,
  Decision,
  PaymentContext,
  PolicyOutcome,
  TriageAdvice,
} from "./types.ts";

export interface PolicyInput {
  context: PaymentContext;
  caution: CautionLevel;
  triage: TriageAdvice | null;
  coaching: CoachingAdvice | null;
  payerAskedToStop: boolean;
  payerDisclosed: boolean;
}

interface Rule {
  id: string;
  text: string;
  decision: Decision;
  when: (i: PolicyInput) => boolean;
  note: (i: PolicyInput) => string;
}

const IMPERSONATION: string[] = ["bank_impersonation", "police_impersonation"];

export const RULES: Rule[] = [
  {
    id: "R1",
    text: "The payer asked to stop the payment in their own words.",
    decision: "cancelled_by_payer",
    when: (i) => i.payerAskedToStop,
    note: () => "Payer cancelled. No further friction applied, nothing left the account.",
  },
  {
    id: "R2",
    text: "Remote access software is active and the payee is new.",
    decision: "hold_for_review",
    when: (i) => i.context.remoteAccessDetected && i.context.payeeIsNew,
    note: (i) =>
      `Remote access active during a first payment of ${money(i.context)} to ${i.context.payeeName}. ` +
      "Treat the device as under someone else's control. Call the payer on a number from the customer record, not one supplied in this session.",
  },
  {
    id: "R3",
    text: "The payer disclosed that someone instructed them to make this payment.",
    decision: "hold_for_review",
    when: (i) => i.payerDisclosed,
    note: (i) =>
      `Payer disclosed third-party instruction for ${money(i.context)}. ` +
      "Direct evidence for the fraud team. Preserve the conversation and the call metadata.",
  },
  {
    id: "R4",
    text: "Triage reads the pattern as impersonation, the payee is new, and caution is elevated or higher.",
    decision: "hold_for_review",
    when: (i) =>
      i.triage !== null &&
      IMPERSONATION.includes(i.triage.scamType) &&
      i.triage.confidence >= 0.6 &&
      i.context.payeeIsNew &&
      atLeast(i.caution, "elevated"),
    note: (i) =>
      `Pattern resembles ${label(i.triage?.scamType)} (confidence ${pct(i.triage?.confidence)}). ` +
      `First payment to ${i.context.payeeName}. Hold pending a call back on a known number.`,
  },
  {
    id: "R5",
    text: "The payer's answers contradict what the bank can see.",
    decision: "hold_for_review",
    when: (i) => (i.coaching?.contradictions.length ?? 0) > 0,
    note: (i) =>
      `Contradiction between the payer's answers and observed signals: ` +
      `${i.coaching?.contradictions.join("; ")}. ` +
      "A payment held here is held on an observation, not on a model's opinion.",
  },
  {
    id: "R6",
    text: "Caution is high, whatever the conversation produced.",
    decision: "delay",
    when: (i) => atLeast(i.caution, "high"),
    note: (i) =>
      `Signal score alone reached high caution (${describe(i)}). ` +
      "24 hour delay. Payer notified, payment not cancelled.",
  },
  {
    id: "R7",
    text: "The account name does not match and the payee is new.",
    decision: "delay",
    when: (i) => i.context.nameCheck === "no_match" && i.context.payeeIsNew,
    note: (i) =>
      `Confirmation of Payee returned no match for ${i.context.payeeName}. ` +
      "Short delay so the payer can check the details with the person they believe they are paying.",
  },
  {
    id: "R8",
    text: "Nothing above fired.",
    decision: "release",
    when: () => true,
    note: () => "Released. No rule above the release line matched.",
  },
];

function money(c: PaymentContext): string {
  const formatted = c.amount.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return c.currency === "GBP" ? `£${formatted}` : `${formatted} ${c.currency}`;
}

function label(t: string | undefined): string {
  return (t ?? "an unidentified pattern").replace(/_/g, " ");
}

function pct(n: number | undefined): string {
  return n === undefined ? "unknown" : `${Math.round(n * 100)}%`;
}

function describe(i: PolicyInput): string {
  const top = i.coaching?.indicators.slice(0, 2) ?? [];
  return top.length > 0 ? top.join("; ") : "signals only, no conversation evidence";
}

/** First match wins. Always returns, because R8 matches everything. */
export function decide(input: PolicyInput): PolicyOutcome {
  for (const rule of RULES) {
    if (rule.when(input)) {
      return {
        decision: rule.decision,
        ruleId: rule.id,
        ruleText: rule.text,
        caseNote: rule.note(input),
      };
    }
  }
  // Unreachable while R8 exists. Kept so that deleting R8 fails loudly here
  // rather than returning undefined into the audit trail.
  throw new Error("policy: no rule matched and no catch-all is present");
}
