/**
 * Stages 2, 3 and 4. These are the three that call a model, and none of them
 * decides anything: triage names a pattern, the intervention runs a
 * conversation, the detector reports what it noticed. policy.ts decides.
 */

import { z } from "zod";
import type { ModelClient } from "./model.ts";
import type { CoachingAdvice, PaymentContext, SignalResult, TriageAdvice, Turn } from "./types.ts";

// ── Stage 2: triage ────────────────────────────────────────────────────────

const TriageSchema = z.object({
  scamType: z.enum([
    "bank_impersonation",
    "police_impersonation",
    "investment",
    "romance",
    "purchase",
    "none_apparent",
  ]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
  raiseCaution: z.boolean(),
});

const TRIAGE_SYSTEM = `You classify the pattern a pending bank payment resembles, for a fraud prevention system.

You see only what the bank can observe. You have not spoken to the payer.

Name the scam type the pattern most resembles, or "none_apparent" when nothing stands out. Set raiseCaution to true only when the combination of signals is more alarming than any single signal, for example a long call in progress together with a first payment that empties an account.

You cannot lower caution and you cannot release a payment. Your answer is advice to a rule engine that decides. Being wrong in the cautious direction costs a customer a few minutes. Being wrong in the other direction costs them their savings, so say so when you are unsure rather than reaching for "none_apparent".`;

export async function runTriage(
  model: ModelClient,
  context: PaymentContext,
  signals: SignalResult,
): Promise<TriageAdvice> {
  return model.ask({
    label: "triage",
    system: TRIAGE_SYSTEM,
    schema: TriageSchema,
    effort: "medium",
    prompt: `Pending payment:
${describeContext(context)}

Signals that fired (score ${signals.score}, caution ${signals.level}):
${signals.signals.map((s) => `- ${s.label}`).join("\n") || "- none"}

Which scam type does this resemble?`,
  });
}

// ── Stage 3: intervention ──────────────────────────────────────────────────

const MessageSchema = z.object({
  message: z.string().max(400),
  /** The agent's read of where the conversation is, for the next turn's prompt. */
  reading: z.string().max(200),
  /** True when the agent has nothing useful left to ask. */
  done: z.boolean(),
});

export const MAX_MESSAGES = 6;

const INTERVENTION_SYSTEM = `You are an assistant inside a banking app, speaking to a customer who is part-way through a payment the bank has paused.

Someone may be on the phone with them right now, telling them what to type. That person may have told them a warning was coming. Assume the customer believes they are being careful.

How to speak:
- Ask before you tell. An open question in their own words is worth more than any warning, because a coached answer is easier to spot than a coached click.
- Say only what the bank can actually see. "I can see you have been on a call for 26 minutes" lands. "This looks like a scam" does not, and it is the sentence the caller has prepared them for.
- Offer a way to check that costs them nothing and that the caller cannot intercept: ending the call and ringing the number on the back of their card.
- Never accuse them. Never lecture. They are about to lose money and they are frightened. A person who feels respected stays in the conversation; a person who feels accused finishes the payment somewhere else.
- One idea per message. Short sentences. No jargon, no policy language, no hedging.
- Never claim the payment has been stopped or released. You do not decide that.

You have at most ${MAX_MESSAGES} messages. Set done to true when you have nothing useful left to ask, or when the customer has clearly decided either way.`;

export async function nextMessage(
  model: ModelClient,
  context: PaymentContext,
  signals: SignalResult,
  triage: TriageAdvice | null,
  conversation: Turn[],
): Promise<z.infer<typeof MessageSchema>> {
  return model.ask({
    label: "intervention",
    system: INTERVENTION_SYSTEM,
    schema: MessageSchema,
    effort: "high",
    prompt: `What the bank can see:
${describeContext(context)}

Observable signals:
${signals.signals.map((s) => `- ${s.label}`).join("\n") || "- none"}
${triage ? `\nPattern this resembles: ${triage.scamType.replace(/_/g, " ")} (${Math.round(triage.confidence * 100)}% confidence). ${triage.rationale}` : ""}

Conversation so far:
${conversation.length === 0 ? "(nothing yet, this is your opening message)" : renderTurns(conversation)}

Write your next message to ${context.payerName.split(" ")[0]}.`,
  });
}

// ── Stage 4: coaching detector ─────────────────────────────────────────────

const CoachingSchema = z.object({
  coached: z.boolean(),
  confidence: z.number().min(0).max(1),
  contradictions: z.array(z.string().max(200)).max(5),
  indicators: z.array(z.string().max(200)).max(5),
});

const COACHING_SYSTEM = `You review a short conversation between a banking app and a customer who is making a payment, and report what you noticed. You do not decide anything.

Two different things to report, and keeping them apart matters:

contradictions: statements that conflict with something the bank directly observed. "Nobody, it is just me" while a call is in progress is a contradiction. These are facts, and the rule engine can act on them on their own.

indicators: answers that sound supplied rather than lived, for example wording that mirrors a script, a reason that arrives too fast and too complete, or an explanation that does not fit the amount. These are impressions, and the rule engine weighs them far more cautiously.

An honest customer can be vague, flustered or annoyed. None of that is evidence of coaching. Report an empty list when you notice nothing; a false positive here delays someone's house deposit.`;

export async function detectCoaching(
  model: ModelClient,
  context: PaymentContext,
  conversation: Turn[],
): Promise<CoachingAdvice> {
  return model.ask({
    label: "coaching",
    system: COACHING_SYSTEM,
    schema: CoachingSchema,
    effort: "medium",
    prompt: `What the bank directly observed:
${describeContext(context)}

Conversation:
${renderTurns(conversation)}

What did you notice?`,
  });
}

// ── shared rendering ───────────────────────────────────────────────────────

export function describeContext(c: PaymentContext): string {
  const amount =
    c.currency === "GBP"
      ? `£${c.amount.toLocaleString("en-GB")}`
      : `${c.amount.toLocaleString("en-GB")} ${c.currency}`;
  const lines = [
    `- Payer: ${c.payerName}, age band ${c.payerAgeBand}`,
    `- Amount: ${amount} to ${c.payeeName}`,
    `- Payee is ${c.payeeIsNew ? "new, first payment to this account" : "an existing payee"}`,
    `- Account name check: ${c.nameCheck.replace(/_/g, " ")}`,
    c.callInProgress
      ? `- A call is in progress, started ${c.callStartedMinutesAgo ?? "an unknown number of"} minutes ago`
      : "- No call in progress",
    c.remoteAccessDetected ? "- Remote access software is active on the device" : null,
    `- ${c.amountVsUsualMax.toFixed(1)}x the payer's largest previous payment`,
    `- Moves ${Math.round(c.shareOfBalance * 100)}% of the available balance`,
    c.priorInterventions > 0 ? `- Has been through ${c.priorInterventions} previous intervention(s)` : null,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function renderTurns(turns: Turn[]): string {
  return turns
    .map((t) => `${t.speaker === "assistant" ? "APP" : "CUSTOMER"}: ${t.text}`)
    .join("\n");
}
