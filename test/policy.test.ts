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
    input({ caution: "high" }),
    input({ context: context({ nameCheck: "no_match", payeeIsNew: true }) }),
  ];
  for (const c of cases) {
    const out = decide(c);
    assert.match(out.ruleId, /^R\d+$/);
    assert.ok(out.ruleText.length > 0);
    assert.ok(out.caseNote.length > 0, `rule ${out.ruleId} produced an empty case note`);
  }
});
