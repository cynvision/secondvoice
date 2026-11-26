/**
 * The five stages, in order, producing a CaseFile that can be replayed.
 *
 * The payer is an interface rather than a function of the model, because the
 * same engine serves two callers: the harness, where a simulated victim is on
 * the other side, and the demo bank, where a person is typing. Neither one gets
 * to reach past this file into the rule table.
 */

import { detectCoaching, nextMessage, runTriage, MAX_MESSAGES } from "./stages.ts";
import type { ModelClient } from "./model.ts";
import { decide } from "./policy.ts";
import { raise, scoreSignals } from "./signals.ts";
import type { Arm, CaseFile, CautionLevel, PaymentContext, Turn } from "./types.ts";

/** What today's banking app shows: one screen, the same words every time. */
export const STATIC_WARNING =
  "Warning: do you know and trust this payee? Criminals can pose as your bank, the police " +
  "or a company you deal with to trick you into making a payment. If you are being asked to " +
  "move money to keep it safe, stop. Your bank will never ask you to do this.";

export interface PayerReply {
  text: string;
  /** The payer has decided not to send the money. */
  askedToStop: boolean;
  /** The payer has told the bank someone else is instructing them. */
  disclosedThirdParty: boolean;
}

export interface Payer {
  reply(message: string, conversation: Turn[]): Promise<PayerReply>;
}

export interface RunOptions {
  scenarioId: string;
  arm: Arm;
  context: PaymentContext;
  model: ModelClient;
  payer: Payer;
}

export async function runCase(options: RunOptions): Promise<CaseFile> {
  const { scenarioId, arm, context, model, payer } = options;

  // ── Stage 1 ──
  const signals = scoreSignals(context);

  const conversation: Turn[] = [];
  let askedToStop = false;
  let disclosed = false;

  if (arm === "static_warning") {
    // No stages 2, 3 or 4. The warning is shown and the payer decides alone,
    // which is exactly the thing being measured against.
    conversation.push({ speaker: "assistant", text: STATIC_WARNING });
    const reply = await payer.reply(STATIC_WARNING, conversation);
    conversation.push({ speaker: "payer", text: reply.text });
    askedToStop = reply.askedToStop;
    disclosed = reply.disclosedThirdParty;

    const outcome = decide({
      context,
      signalCaution: signals.level,
      caution: signals.level,
      triage: null,
      coaching: null,
      payerAskedToStop: askedToStop,
      payerDisclosed: disclosed,
    });

    return {
      scenarioId,
      arm,
      context,
      signals,
      triage: null,
      conversation,
      coaching: null,
      finalCaution: signals.level,
      outcome,
      payerAskedToStop: askedToStop,
      payerDisclosed: disclosed,
    };
  }

  // ── Stage 2 ──
  const triage = await runTriage(model, context, signals);
  const finalCaution: CautionLevel = triage.raiseCaution ? raise(signals.level) : signals.level;

  // ── Stage 3 ──
  for (let i = 0; i < MAX_MESSAGES; i++) {
    const turn = await nextMessage(model, context, signals, triage, conversation);
    conversation.push({ speaker: "assistant", text: turn.message });

    const reply = await payer.reply(turn.message, conversation);
    conversation.push({ speaker: "payer", text: reply.text });
    askedToStop ||= reply.askedToStop;
    disclosed ||= reply.disclosedThirdParty;

    // A payer who has decided to stop has already got what this was for.
    if (askedToStop || turn.done) break;
  }

  // ── Stage 4 ──
  const coaching = await detectCoaching(model, context, conversation);

  // ── Stage 5 ──
  const outcome = decide({
    context,
    signalCaution: signals.level,
    caution: finalCaution,
    triage,
    coaching,
    payerAskedToStop: askedToStop,
    payerDisclosed: disclosed,
  });

  return {
    scenarioId,
    arm,
    context,
    signals,
    triage,
    conversation,
    coaching,
    finalCaution,
    outcome,
    payerAskedToStop: askedToStop,
    payerDisclosed: disclosed,
  };
}
