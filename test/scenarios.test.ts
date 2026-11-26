import test from "node:test";
import assert from "node:assert/strict";

import { loadScenarios } from "../src/scenarios.ts";
import { scoreSignals } from "../src/signals.ts";
import type { Scenario } from "../src/types.ts";

const scenarios = loadScenarios();

const scams = scenarios.filter((s) => s.truth === "scam");
const legit = scenarios.filter((s) => s.truth === "legitimate");

test("the set has both classes, and legitimate look-alikes are not an afterthought", () => {
  assert.ok(scams.length > 0, "no scam scenarios");
  assert.ok(legit.length > 0, "no legitimate scenarios");
  assert.equal(scams.length + legit.length, scenarios.length);
  // False positives are half the problem. Keep at least a third of the set on that side.
  assert.ok(legit.length * 3 >= scenarios.length, `only ${legit.length} of ${scenarios.length} scenarios are legitimate`);
});

test("scenario ids are unique", () => {
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("scams carry a cover story and legitimate payments carry a real reason", () => {
  for (const s of scenarios) {
    if (s.truth === "scam") {
      assert.ok(s.coverStory, `${s.id} is a scam with nothing coached`);
      assert.equal(s.realReason, null);
    } else {
      assert.ok(s.realReason, `${s.id} is legitimate with no stated reason`);
      assert.equal(s.coverStory, null);
      assert.equal(s.beliefStrength, 1);
    }
  }
});

// The point of the set. If any one observable cleanly separated the two classes,
// the harness would be measuring a lookup table and every score would be a lie.
test("no single observable separates scams from legitimate payments", () => {
  const probes: Array<[string, (s: Scenario) => boolean]> = [
    ["call in progress", (s) => s.context.callInProgress],
    ["call longer than 20 minutes", (s) => (s.context.callStartedMinutesAgo ?? 0) > 20],
    ["remote access", (s) => s.context.remoteAccessDetected],
    ["new payee", (s) => s.context.payeeIsNew],
    ["name check failed", (s) => s.context.nameCheck === "no_match"],
    ["name check not clean", (s) => s.context.nameCheck !== "match"],
    ["moves most of the balance", (s) => s.context.shareOfBalance >= 0.7],
    ["far above history", (s) => s.context.amountVsUsualMax >= 3],
    ["older payer", (s) => ["65-79", "80+"].includes(s.context.payerAgeBand)],
    ["prior intervention", (s) => s.context.priorInterventions > 0],
  ];

  for (const [name, probe] of probes) {
    const scamsWith = scenarios.filter((s) => s.truth === "scam" && probe(s)).length;
    const legitWith = scenarios.filter((s) => s.truth === "legitimate" && probe(s)).length;
    const scamsWithout = scams.length - scamsWith;

    // A probe separates the classes if every scam has it and no legitimate
    // payment does, or the reverse.
    const separates =
      (scamsWith === scams.length && legitWith === 0) || (scamsWith === 0 && legitWith === legit.length);
    assert.ok(
      !separates,
      `"${name}" separates the two classes perfectly (${scamsWith}/${scams.length} scams, ${legitWith}/${legit.length} legitimate). ` +
        "Add a counterexample scenario.",
    );
    assert.ok(
      scamsWithout > 0 || legitWith > 0,
      `"${name}" is present in every scam and needs a legitimate counterexample`,
    );
  }
});

test("at least one legitimate payment reaches elevated caution on signals alone", () => {
  // Otherwise the false-positive side of the test set is not actually testing
  // anything: the rule table would release them all without being asked.
  const hard = scenarios
    .filter((s) => s.truth === "legitimate")
    .map((s) => scoreSignals(s.context))
    .filter((r) => r.level === "elevated" || r.level === "high");
  assert.ok(hard.length > 0, "every legitimate payment looks quiet, so none of them is a real test");
});

test("at least one scam has no call in progress", () => {
  const quiet = scenarios.filter((s) => s.truth === "scam" && !s.context.callInProgress);
  assert.ok(quiet.length > 0, "the set assumes the strongest signal is always available");
});
