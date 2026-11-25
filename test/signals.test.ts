import test from "node:test";
import assert from "node:assert/strict";

import { atLeast, levelFor, raise, scoreSignals } from "../src/signals.ts";
import type { PaymentContext } from "../src/types.ts";

const quiet: PaymentContext = {
  payerName: "Test Payer",
  amount: 100,
  currency: "GBP",
  payeeName: "Known Payee",
  payeeIsNew: false,
  nameCheck: "match",
  callInProgress: false,
  callStartedMinutesAgo: null,
  remoteAccessDetected: false,
  amountVsUsualMax: 1,
  shareOfBalance: 0.05,
  payerAgeBand: "30-49",
  priorInterventions: 0,
};

test("a quiet payment fires nothing", () => {
  const r = scoreSignals(quiet);
  assert.equal(r.score, 0);
  assert.equal(r.level, "none");
  assert.deepEqual(r.signals, []);
});

test("the Margaret pattern reaches high caution on signals alone", () => {
  const r = scoreSignals({
    ...quiet,
    payeeIsNew: true,
    nameCheck: "no_match",
    callInProgress: true,
    callStartedMinutesAgo: 26,
    amountVsUsualMax: 9.2,
    shareOfBalance: 0.81,
    payerAgeBand: "80+",
  });
  assert.equal(r.level, "high");
  assert.ok(r.signals.some((s) => s.id === "call_in_progress"));
});

test("raise moves one step and stops at high", () => {
  assert.equal(raise("none"), "low");
  assert.equal(raise("low"), "elevated");
  assert.equal(raise("elevated"), "high");
  assert.equal(raise("high"), "high");
});

test("atLeast orders the levels", () => {
  assert.ok(atLeast("high", "elevated"));
  assert.ok(atLeast("elevated", "elevated"));
  assert.ok(!atLeast("low", "elevated"));
});

test("thresholds line up with levelFor", () => {
  assert.equal(levelFor(0), "none");
  assert.equal(levelFor(14), "none");
  assert.equal(levelFor(15), "low");
  assert.equal(levelFor(35), "elevated");
  assert.equal(levelFor(60), "high");
});

test("scoring is a pure function of its input", () => {
  const a = scoreSignals({ ...quiet, callInProgress: true });
  const b = scoreSignals({ ...quiet, callInProgress: true });
  assert.deepEqual(a, b);
});
