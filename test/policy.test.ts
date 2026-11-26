import test from "node:test";
import assert from "node:assert/strict";

import { RULES, decide, type PolicyInput } from "../src/policy.ts";
import type { PaymentContext } from "../src/types.ts";

function context(over: Partial<PaymentContext> = {}): PaymentContext {
  return {
    payerName: "Test Payer",
    amount: 1000,
    currency: "GBP",
    payeeName: "A Payee",
    payeeIsNew: false,
    nameCheck: "match",
    callInProgress: false,
    callStartedMinutesAgo: null,
    remoteAccessDetected: false,
    amountVsUsualMax: 1,
    shareOfBalance: 0.1,
    payerAgeBand: "30-49",
    priorInterventions: 0,
    ...over,
  };
}

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    context: context(),
    signalCaution: "none",
    caution: "none",
    triage: null,
    coaching: null,
    payerAskedToStop: false,
    payerDisclosed: false,
    ...over,
  };
}

test("a quiet payment is released", () => {
  const out = decide(input());
  assert.equal(out.decision, "release");
  assert.equal(out.ruleId, "R8");
});

test("the payer asking to stop beats every other rule", () => {
  // Deliberately stacked: remote access, disclosure, high caution, a
  // contradiction. R1 must still win, because a payer who has decided to stop
  // should not then be told the bank is holding their payment for review.
  const out = decide(
    input({
      context: context({ remoteAccessDetected: true, payeeIsNew: true }),
      signalCaution: "high",
      caution: "high",
      payerAskedToStop: true,
      payerDisclosed: true,
      coaching: { coached: true, confidence: 0.9, contradictions: ["said alone"], indicators: [] },
    }),
  );
  assert.equal(out.decision, "cancelled_by_payer");
  assert.equal(out.ruleId, "R1");
});

test("remote access on a first payment is held", () => {
  const out = decide(input({ context: context({ remoteAccessDetected: true, payeeIsNew: true }) }));
  assert.equal(out.ruleId, "R2");
  assert.equal(out.decision, "hold_for_review");
});

test("remote access to an established payee does not trigger R2", () => {
  const out = decide(input({ context: context({ remoteAccessDetected: true, payeeIsNew: false }) }));
  assert.notEqual(out.ruleId, "R2");
});

test("R5 holds on a contradiction, which is the rule the published example cites", () => {
  const out = decide(
    input({
      context: context({ callInProgress: true, callStartedMinutesAgo: 26 }),
      signalCaution: "low",
      caution: "low",
      coaching: {
        coached: true,
        confidence: 0.8,
        contradictions: ["Said they were alone while a call was in progress"],
        indicators: [],
      },
    }),
  );
  assert.equal(out.ruleId, "R5");
  assert.equal(out.decision, "hold_for_review");
});

test("soft indicators alone never hold a payment", () => {
  // Impressions are not evidence. Without a contradiction or a signal score,
  // a payment must not be held on the strength of a model's unease.
  const out = decide(
    input({
      signalCaution: "low",
      caution: "low",
      coaching: {
        coached: true,
        confidence: 0.95,
        contradictions: [],
        indicators: ["answer arrived very fast", "wording felt scripted"],
      },
    }),
  );
  assert.equal(out.decision, "release");
});

test("triage alone cannot hold a payment when caution is low", () => {
  const out = decide(
    input({
      context: context({ payeeIsNew: true }),
      signalCaution: "low",
      caution: "low",
      triage: {
        scamType: "bank_impersonation",
        confidence: 0.99,
        rationale: "very sure",
        raiseCaution: true,
      },
    }),
  );
  assert.notEqual(out.ruleId, "R4");
});

test("triage cannot raise caution and then satisfy its own rule", () => {
  // The quiet case a model could otherwise hold by itself: the only thing
  // observed is a new payee, triage is certain, and triage has raised caution
  // from low to elevated. R4 reads the signal-layer level, so it stays shut.
  const out = decide(
    input({
      context: context({ payeeIsNew: true }),
      signalCaution: "low",
      caution: "elevated",
      triage: {
        scamType: "bank_impersonation",
        confidence: 0.99,
        rationale: "very sure",
        raiseCaution: true,
      },
    }),
  );
  assert.equal(out.decision, "release");
  assert.equal(out.ruleId, "R8");
});

test("R4 holds when the signals themselves reached elevated", () => {
  const out = decide(
    input({
      context: context({ payeeIsNew: true, callInProgress: true }),
      signalCaution: "elevated",
      caution: "elevated",
      triage: {
        scamType: "police_impersonation",
        confidence: 0.7,
        rationale: "caller claims to be an officer",
        raiseCaution: false,
      },
    }),
  );
  assert.equal(out.ruleId, "R4");
  assert.equal(out.decision, "hold_for_review");
});

test("the R6 note says so when triage, not the signals, reached high", () => {
  const raised = decide(input({ signalCaution: "elevated", caution: "high" }));
  assert.equal(raised.ruleId, "R6");
  assert.match(raised.caseNote, /signals alone read elevated/);
  const alone = decide(input({ signalCaution: "high", caution: "high" }));
  assert.match(alone.caseNote, /Signal score alone/);
});

test("every rule has a unique id and the table ends in a catch-all", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate rule id");
  const last = RULES.at(-1);
  assert.ok(last, "rule table is empty");
  assert.equal(last.decision, "release");
  assert.equal(last.when(input()), true, "the last rule must match everything");
});

test("every outcome names the rule that produced it", () => {
  const cases: PolicyInput[] = [
    input(),
    input({ payerAskedToStop: true }),
    input({ payerDisclosed: true }),
    input({ signalCaution: "high", caution: "high" }),
    input({ context: context({ nameCheck: "no_match", payeeIsNew: true }) }),
  ];
  for (const c of cases) {
    const out = decide(c);
    assert.match(out.ruleId, /^R\d+$/);
    assert.ok(out.ruleText.length > 0);
    assert.ok(out.caseNote.length > 0, `rule ${out.ruleId} produced an empty case note`);
  }
});
