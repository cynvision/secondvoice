/**
 * The other side of the conversation.
 *
 * Half the difficulty of this problem is that the scammer does not go away when
 * the app starts talking. They are on the line, they hear the questions through
 * the victim, and they answer back. So the victim here is not a static profile:
 * before each reply, the coach gets a turn.
 *
 * The legitimate payer exists for the same reason. A design that stops every
 * scam by stopping every payment is not a design, and without honest payers in
 * the set there is no way to see that happening.
 */

import { z } from "zod";
import type { ModelClient } from "../src/model.ts";
import type { Payer, PayerReply } from "../src/engine.ts";
import { renderTurns } from "../src/stages.ts";
import type { Scenario, Turn } from "../src/types.ts";

const ReplySchema = z.object({
  text: z.string().max(300),
  askedToStop: z.boolean(),
  disclosedThirdParty: z.boolean(),
  beliefAfter: z.number().min(0).max(1),
});

const CoachSchema = z.object({
  instruction: z.string().max(300),
  /** The coach can feel the call slipping away and change tactic. */
  pressure: z.enum(["calm", "urgent", "angry"]),
});

const VICTIM_SYSTEM = `You are playing a bank customer in a simulation used to test fraud prevention designs. You are not a helpful assistant here; you answer only as this person would.

This person has been contacted by someone claiming to be from their bank or the police, and believes them. They think they are protecting their money. They are not stupid, and they are not reckless. They are frightened, and they have been given an explanation that covers every objection they have thought of so far.

Rules for playing them:
- Answer the app's question as this person would, in one or two sentences. Plain speech, not prose.
- If you have been given an instruction from the caller, follow it, in your own words rather than reciting it.
- Your belief can move during the conversation, in either direction, the way this person's would. Nothing here tells you what should move it.
- Set askedToStop to true only when you have genuinely decided not to send the money.
- Set disclosedThirdParty to true when you have admitted someone else is instructing you.
- beliefAfter is how much you still believe the caller, from 0 to 1, after this exchange.

Do not break character and do not explain yourself.`;

const COACH_SYSTEM = `You are playing the criminal running a bank impersonation scam, in a simulation used to test whether a banking app can interrupt one. You are on the phone with the victim while they use the app.

Your job in each turn is to tell them how to answer the question the app just asked. Keep them on the line and keep the payment moving.

Reply with a single short instruction, as you would say it down the phone. You have done this many times; you know the app will ask about the purpose of the payment and whether anyone has told them what to say, and you have an answer ready for both. Escalate pressure only when you feel the victim hesitating, because pushing too hard is what makes them hang up.

This is a defensive test. The transcripts exist so the defence can be measured against a realistic opponent rather than a cooperative one.`;

const LEGIT_SYSTEM = `You are playing a real bank customer making a perfectly ordinary large payment, in a simulation used to test fraud prevention designs.

Nobody is instructing you. Your reason is genuine and you can explain it. You are in a hurry and mildly irritated at being interrupted, the way anyone is.

- Answer in one or two sentences, plainly.
- Your patience is finite. If the app keeps pressing after you have given a clear and true answer, you get shorter, and you may give up on the payment and go to a branch or phone up instead; set askedToStop to true if you abandon it.
- Never invent a scam. You are not being scammed.
- disclosedThirdParty is false: there is no third party.
- beliefAfter is always 1.`;

export class SimulatedPayer implements Payer {
  readonly #model: ModelClient;
  readonly #scenario: Scenario;
  readonly #seed: number;
  #belief: number;
  #coachLine: string | null = null;

  constructor(model: ModelClient, scenario: Scenario, seed: number) {
    this.#model = model;
    this.#scenario = scenario;
    this.#seed = seed;
    this.#belief = scenario.beliefStrength;
  }

  get belief(): number {
    return this.#belief;
  }

  async reply(message: string, conversation: Turn[]): Promise<PayerReply> {
    const s = this.#scenario;

    if (s.truth === "legitimate") {
      const r = await this.#model.ask({
        label: "legit_payer",
        system: LEGIT_SYSTEM,
        schema: ReplySchema,
        effort: "low",
        prompt: `You are ${s.context.payerName}. ${s.payerBackground}
The real reason for this payment: ${s.realReason ?? "not stated"}.
${variation(this.#seed)}

Conversation so far:
${renderTurns(conversation)}

The app just said: "${message}"

Your reply.`,
      });
      return { text: r.text, askedToStop: r.askedToStop, disclosedThirdParty: r.disclosedThirdParty };
    }

    // The scammer is still on the line, and gets to answer first.
    if (s.context.callInProgress) {
      const coach = await this.#model.ask({
        label: "scammer",
        system: COACH_SYSTEM,
        schema: CoachSchema,
        effort: "low",
        prompt: `The victim is ${s.context.payerName}, paying ${s.context.amount} to an account you control.
Cover story you gave them: ${s.coverStory ?? "none yet"}.
How firmly they still believe you, 0 to 1: ${this.#belief.toFixed(2)}.

The app just asked them: "${message}"

What do you tell them to say?`,
      });
      this.#coachLine = `${coach.instruction} (said ${coach.pressure}ly)`;
    }

    const r = await this.#model.ask({
      label: "victim",
      system: VICTIM_SYSTEM,
      schema: ReplySchema,
      effort: "medium",
      prompt: `You are ${s.context.payerName}. ${s.payerBackground}
What you have been told to say if asked: ${s.coverStory ?? "nothing specific"}.
How firmly you believe the caller right now, 0 to 1: ${this.#belief.toFixed(2)}.
${variation(this.#seed)}

Conversation so far:
${renderTurns(conversation)}

The app just said: "${message}"
${this.#coachLine ? `\nThe caller, in your ear, right now: "${this.#coachLine}"` : ""}

Your reply.`,
    });

    this.#belief = r.beliefAfter;
    return { text: r.text, askedToStop: r.askedToStop, disclosedThirdParty: r.disclosedThirdParty };
  }
}

/** Seeds vary the person, not a sampling parameter, since temperature is gone. */
function variation(seed: number): string {
  const moods = [
    "Today you are calm and a little formal.",
    "Today you are flustered and keep losing your thread.",
    "Today you are brisk and want this finished.",
    "Today you are anxious and apologetic.",
    "Today you are stubborn and dislike being questioned.",
  ];
  return moods[seed % moods.length] ?? "Today you are calm and a little formal.";
}
