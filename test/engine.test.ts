import test from "node:test";
import assert from "node:assert/strict";

import { runCase, STATIC_WARNING, type Payer } from "../src/engine.ts";
import { StubModel } from "../src/model.ts";
import { OFFLINE_STUBS } from "../src/stubs.ts";
import { scenarioById } from "../src/scenarios.ts";
import type { Turn } from "../src/types.ts";

const margaret = scenarioById("safe-account-margaret");
const amara = scenarioById("house-deposit-amara");

/** A payer that says one thing forever, so the engine is what is under test. */
class FixedPayer implements Payer {
  readonly seen: string[] = [];
  #text: string;
  #stop: boolean;
  #disclose: boolean;

  // Plain assignment, not constructor parameter properties: Node strips types
  // rather than compiling them, and parameter properties emit real code.
  constructor(text: string, stop = false, disclose = false) {
    this.#text = text;
    this.#stop = stop;
    this.#disclose = disclose;
  }

  async reply(message: string, _conversation: Turn[]) {
    this.seen.push(message);
    return { text: this.#text, askedToStop: this.#stop, disclosedThirdParty: this.#disclose };
  }
}

test("the static arm shows one warning and asks nothing else", async () => {
  const payer = new FixedPayer("Yes, I know them.");
  const file = await runCase({
    scenarioId: margaret.id,
    arm: "static_warning",
    context: margaret.context,
    model: new StubModel(OFFLINE_STUBS),
    payer,
  });

  assert.deepEqual(payer.seen, [STATIC_WARNING]);
  assert.equal(file.conversation.length, 2);
  assert.equal(file.triage, null, "the static arm must not run triage");
  assert.equal(file.coaching, null, "the static arm must not run the detector");
});

test("the static arm still applies the signal-only rules", async () => {
  // Margaret's signals alone reach high caution, so even with no conversation
  // the payment is delayed rather than released. This is the floor that any
  // comparison is measured against.
  const file = await runCase({
    scenarioId: margaret.id,
    arm: "static_warning",
    context: margaret.context,
    model: new StubModel(OFFLINE_STUBS),
    payer: new FixedPayer("Yes, I know them."),
  });
  assert.notEqual(file.outcome.decision, "release");
});

test("a payer who stops is recorded as cancelling, not as blocked", async () => {
  const file = await runCase({
    scenarioId: margaret.id,
    arm: "second_voice",
    context: margaret.context,
    model: new StubModel(OFFLINE_STUBS),
    payer: new FixedPayer("Please cancel it.", true),
  });
  assert.equal(file.outcome.decision, "cancelled_by_payer");
  assert.equal(file.outcome.ruleId, "R1");
  assert.equal(file.payerAskedToStop, true);
});

test("the conversation stops as soon as the payer has decided", async () => {
  const payer = new FixedPayer("Please cancel it.", true);
  await runCase({
    scenarioId: margaret.id,
    arm: "second_voice",
    context: margaret.context,
    model: new StubModel(OFFLINE_STUBS),
    payer,
  });
  assert.equal(payer.seen.length, 1, "kept talking after the payer had already stopped");
});

test("the second voice arm never exceeds its message budget", async () => {
  const payer = new FixedPayer("I would rather not say.");
  const file = await runCase({
    scenarioId: margaret.id,
    arm: "second_voice",
    context: margaret.context,
    model: new StubModel(OFFLINE_STUBS),
    payer,
  });
  const fromApp = file.conversation.filter((t) => t.speaker === "assistant");
  assert.ok(fromApp.length <= 6, `sent ${fromApp.length} messages`);
});

test("a genuine payment with an honest answer is released", async () => {
  const file = await runCase({
    scenarioId: amara.id,
    arm: "second_voice",
    context: amara.context,
    model: new StubModel(OFFLINE_STUBS),
    payer: new FixedPayer("It is the deposit for the flat I am buying."),
  });
  assert.equal(file.outcome.decision, "release");
});

test("the case file records everything needed to replay the decision", async () => {
  const file = await runCase({
    scenarioId: margaret.id,
    arm: "second_voice",
    context: margaret.context,
    model: new StubModel(OFFLINE_STUBS),
    payer: new FixedPayer("I am moving savings."),
  });
  assert.ok(file.signals.signals.length > 0);
  assert.ok(file.triage);
  assert.ok(file.coaching);
  assert.ok(file.conversation.length > 0);
  assert.match(file.outcome.ruleId, /^R\d+$/);
  // The round trip a regulator would do: the file alone, no rerun.
  const copy = JSON.parse(JSON.stringify(file));
  assert.deepEqual(copy.outcome, file.outcome);
});
