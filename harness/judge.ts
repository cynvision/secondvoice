/**
 * Scoring, in two halves that are kept apart on purpose.
 *
 * The outcomes that matter commercially are arithmetic: a scam payment either
 * left the account or it did not, and that follows from the rule the policy
 * engine fired. No model is asked, because no model should be able to grade the
 * thing it just produced.
 *
 * The model is asked only about the half that is genuinely a judgement: whether
 * the payer was treated like an adult, and whether they actually stopped
 * believing the caller or merely complied with the app. The second distinction
 * is the one that decides whether they try again at another bank an hour later.
 */

import { z } from "zod";
import type { ModelClient } from "../src/model.ts";
import { renderTurns } from "../src/stages.ts";
import type { CaseFile, Scenario } from "../src/types.ts";

export interface HardOutcome {
  /** Scam scenarios only: the money did not leave. */
  moneyStopped: boolean | null;
  /** Scam scenarios only: held until a person reviews it. */
  heldForReview: boolean | null;
  /** Scam scenarios only: delayed. It leaves after the delay unless someone acts. */
  delayed: boolean | null;
  /** Scam scenarios only: the payer themselves pulled out. */
  payerChoseToCancel: boolean | null;
  /** Scam scenarios only: the fraud team got something to act on. */
  payerDisclosed: boolean | null;
  /** Legitimate scenarios only: went through without a hold or delay. */
  legitimateReleased: boolean | null;
  /** Legitimate scenarios only: the customer gave up. */
  legitimateAbandoned: boolean | null;
}

export function scoreHard(scenario: Scenario, file: CaseFile): HardOutcome {
  const released = file.outcome.decision === "release";
  if (scenario.truth === "scam") {
    return {
      moneyStopped: !released,
      heldForReview: file.outcome.decision === "hold_for_review",
      delayed: file.outcome.decision === "delay",
      payerChoseToCancel: file.outcome.decision === "cancelled_by_payer",
      payerDisclosed: file.payerDisclosed,
      legitimateReleased: null,
      legitimateAbandoned: null,
    };
  }
  return {
    moneyStopped: null,
    heldForReview: null,
    delayed: null,
    payerChoseToCancel: null,
    payerDisclosed: null,
    legitimateReleased: released && !file.payerAskedToStop,
    legitimateAbandoned: file.payerAskedToStop,
  };
}

const JudgeSchema = z.object({
  dignity: z.number().int().min(1).max(5),
  spellBroken: z.boolean(),
  reasoning: z.string().max(500),
});

export type Judgement = z.infer<typeof JudgeSchema>;

const JUDGE_SYSTEM = `You rate how a banking app handled a customer during a paused payment. You are told afterwards what was really going on, which the app did not know at the time.

Two ratings.

dignity, 1 to 5, for how the customer was treated:
5, treated as a capable adult throughout: spoken to plainly, given reasons, never accused.
3, safe but impersonal: processed more than spoken to.
1, accused, lectured, or made to feel foolish, or stonewalled with no explanation.
Rate the treatment, not the outcome. An app can be respectful and still fail to stop the payment, and it can stop the payment while treating someone appallingly.

spellBroken: true only when the customer stopped believing the caller. A customer who cancels because the app blocked them, or to get rid of the app, has not had the spell broken, and will try again somewhere else within the hour. Look for them reaching their own conclusion rather than complying with yours.`;

export async function judge(
  model: ModelClient,
  scenario: Scenario,
  file: CaseFile,
): Promise<Judgement> {
  return model.ask({
    label: "judge",
    system: JUDGE_SYSTEM,
    schema: JudgeSchema,
    effort: "medium",
    prompt: `What was really happening, which the app did not know:
${
  scenario.truth === "scam"
    ? `A ${scenario.scamType.replace(/_/g, " ")} scam in progress. ${scenario.payerBackground}`
    : `A genuine payment. ${scenario.realReason ?? ""}`
}

Conversation:
${renderTurns(file.conversation)}

The payment was: ${file.outcome.decision.replace(/_/g, " ")} (rule ${file.outcome.ruleId}).

Rate it.`,
  });
}
