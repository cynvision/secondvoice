import test from "node:test";
import assert from "node:assert/strict";

import { loadScenarios } from "../src/scenarios.ts";
import { scoreSignals } from "../src/signals.ts";
import type { Scenario } from "../src/types.ts";

const scenarios = loadScenarios();

test("version 0.1 is six impersonation scams and four legitimate look-alikes", () => {
  assert.equal(scenarios.length, 10);
  assert.equal(scenarios.filter((s) => s.truth === "scam").length, 6);
  assert.equal(scenarios.filter((s) => s.truth === "legitimate").length, 4);
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
    ["new payee", (s) => s.context.payeeIsNew],
    ["name check failed", (s) => s.context.nameCheck === "no_match"],
    ["moves most of the balance", (s) => s.context.shareOfBalance >= 0.7],
    ["far above history", (s) => s.context.amountVsUsualMax >= 3],
    ["older payer", (s) => ["65-79", "80+"].includes(s.context.payerAgeBand)],
  ];

  for (const [name, probe] of probes) {
    const scamsWith = scenarios.filter((s) => s.truth === "scam" && probe(s)).length;
    const legitWith = scenarios.filter((s) => s.truth === "legitimate" && probe(s)).length;
    const scamsWithout = 6 - scamsWith;

    // A probe separates the classes if every scam has it and no legitimate
    // payment does, or the reverse.
    const separates = (scamsWith === 6 && legitWith === 0) || (scamsWith === 0 && legitWith === 4);
    assert.ok(
      !separates,
      `"${name}" separates the two classes perfectly (${scamsWith}/6 scams, ${legitWith}/4 legitimate). ` +
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
