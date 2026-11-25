# Second Voice

**A second voice at the moment of payment.**

In a safe-account scam the caller stays on the line and tells the victim what to say to their bank. Second Voice is an assistant inside the banking app that opens a short conversation before the money moves, and a rules engine that decides what happens next.

It comes with a test harness: simulated victims who have been coached to lie, and a simulated scammer who keeps coaching them.

> **Version 0.1. First live results pending.** The scores in this README are blank on purpose. They will be filled in from a published run, with every transcript, and not before.

```
npm install
npm test                 # 28 tests, no network
npm run dev              # demo bank on localhost:4310
npm run eval -- --offline  # whole pipeline, fixed-rule stubs, no key

export ANTHROPIC_API_KEY=...
npm run eval -- --seeds 5
```

---

## Why a warning is not enough

A warning is one more line in a conversation the scammer controls. The victim has been told the warning is coming and what to click. Three things make the usual defences weak against this scam.

> *"Ignore the pop-up. That's the system we're investigating."*

Static warnings are read by the caller first. By the time the victim sees one, it has already been explained away.

> *"If they ask, it's for building work."*

The bank's questions are answered by the scammer, through the victim. A form with a dropdown is easy to coach.

> *"Don't hang up. We need to finish this now."*

A scam checker helps people who suspect something. This victim believes they are being careful.

---

## How a payment flows

Five stages sit between the send button and the money. Two of them never call a model.

| # | Stage | What it does | |
|---|---|---|---|
| 1 | **Signal layer** (`src/signals.ts`) | Scores what the bank can observe: a call in progress, a first payment to a new account, the amount against history, the name check, remote access. | rules only |
| 2 | **Triage** (`src/stages.ts`) | Names the scam type the pattern resembles. It can raise the level of caution by one step. It cannot lower it. | model |
| 3 | **Intervention** (`src/stages.ts`) | Runs the conversation from a playbook. Asks before it tells, says only what the bank can see, offers a way to check that costs nothing. Six messages at most. | model |
| 4 | **Coaching detector** (`src/stages.ts`) | Separates *contradictions* (answers that conflict with something observed) from *indicators* (answers that merely sound supplied). The rule table can act on the first on its own and weighs the second far more cautiously. | rules + model |
| 5 | **Policy engine** (`src/policy.ts`) | An ordered rule table decides: release, delay, hold for review, or cancelled by the payer. The rule that fired goes in the audit trail with a case note for the fraud analyst. | rules only |

### Models advise. Rules decide.

This is the whole design, and it is enforced by the type system: the only function that can end a payment is `decide()` in `src/policy.ts`, and the only thing it reads from a model is advisory. A test asserts that a model's unease alone, with no contradiction and no signal score, never holds a payment.

Every decision can be reproduced from logged inputs and explained to a customer, an ombudsman or a regulator.

The rule table, in order. First match wins.

| | Rule | Outcome |
|---|---|---|
| R1 | The payer asked to stop the payment in their own words. | cancelled by payer |
| R2 | Remote access software is active and the payee is new. | hold for review |
| R3 | The payer disclosed that someone instructed them to make this payment. | hold for review |
| R4 | Triage reads impersonation, the payee is new, and caution is elevated or higher. | hold for review |
| R5 | The payer's answers contradict what the bank can see. | hold for review |
| R6 | Caution is high, whatever the conversation produced. | delay |
| R7 | The account name does not match and the payee is new. | delay |
| R8 | Nothing above fired. | release |

R1 sits at the top because a payer who has decided to stop has already got what the intervention was for, and nothing below should talk them back out of it.

---

## Tested against victims who have been told to lie

The harness runs every scenario twice: once with the static warning most banking apps show today, and once with Second Voice. Half the difficulty is on the other side, so legitimate payments that look risky are in the test set too.

- **Victim** believes the caller to a set strength and may have a cover story. Belief moves when a message describes their exact situation.
- **Scammer coach** stays on the line and tells the victim how to answer each message from the app. It gets a turn before every single reply.
- **Legitimate payer** has a house deposit, a builder, savings moved for a better rate. Honest answers, limited patience.
- **Judge** rates dignity and whether the spell actually broke. The commercial outcomes are arithmetic, computed from the rule that fired, because no model should grade the thing it just produced.

### The test set

Ten scenarios in version 0.1: six impersonation scams and four legitimate look-alikes. The set is built so that **no single observable separates the two groups**, and a test fails the build if one ever does.

- A scam where the caller had the victim hang up first, so there is no call in progress.
- A scam where the payee account is genuinely in the payer's own name, so the name check passes cleanly.
- A scam against someone the same app already interrupted four days ago, now coached on the exact question that stopped her.
- A legitimate car purchase made on the phone to the seller, with a name mismatch, so every signal that usually means coaching is present and all of them are innocent.
- A legitimate 72 year old moving her own savings for a better rate, which is word for word the cover story the scammers use.

### Measures

| Measure | What it tells you | Static warning | Second Voice |
|---|---|---|---|
| Money stopped | Scam payments that did not leave | pending | pending |
| Payer chose to cancel | The spell broke, so they will not try again elsewhere | pending | pending |
| Payer disclosed | The fraud team has something to act on | pending | pending |
| Spell broken | They reached their own conclusion rather than complying | pending | pending |
| Legitimate released | Real payments that went through without delay | pending | pending |
| Legitimate abandoned | Customers who gave up | pending | pending |
| Dignity, 1 to 5 | Asked and respected, or accused and lectured | pending | pending |

Percentages never travel without the fraction they came from. Ten scenarios at a handful of seeds is a small sample and the report prints it that way.

---

## What this does and does not show

**Open.** The runtime and the policy rules. The simulators, judge and scenarios. A generic playbook. Every transcript behind a published score.

**Held back.** Playbooks tuned to a scam type. Tuned detector rules. A published script is one a scammer can coach a victim against.

**Not claimed.** That simulated victims behave like frightened people. That a score here predicts results in a bank. A model playing a victim gives way to a good argument more easily than a person does. The harness compares designs. Real efficacy needs a bank pilot.

One more limit worth stating plainly: in the harness, the payer's intent to stop is declared by the simulator rather than inferred from their words, so these numbers do not measure intent detection. A real deployment needs that, and the demo bank uses an explicit button for it.

---

## Running it

TypeScript, two dependencies, Node 22.18 or later. Node runs the `.ts` files directly by stripping types, so there is no build step.

```bash
npm install
npm test                      # unit tests, no network, no key
npm run typecheck
npm run dev                   # demo bank, offline unless a key is set
npm run eval -- --offline     # every scenario end to end, fixed-rule stubs
```

Offline mode swaps the model for fixed rules (`src/stubs.ts`) so the plumbing, the rule table and the audit trail are all exercised without a key. `npm run eval -- --offline` deliberately **refuses to print scores**, because any table it produced would measure the stubs rather than the design.

With a key:

```bash
export ANTHROPIC_API_KEY=...
npm run eval -- --seeds 5
npm run eval -- --scenario safe-account-margaret
```

Runs write to `runs/<timestamp>/` with a `summary.md` and every transcript. `SECONDVOICE_MODEL` overrides the model, which defaults to `claude-opus-5-5`.

---

## Contributing

The most useful thing anyone can add is a scenario, above all a **legitimate** payment that looks like fraud. False positives are the half of this problem that does not make the news, and the test set is still thin there.

Scenario files live in `scenarios/` and are plain JSON. `npm test` will tell you if a new one makes some single signal separate the two classes, which would quietly invalidate every score in the table.

Next scam types: investment, romance and purchase. First scam type covered is bank and police impersonation.

---

## Credits

Built by Cynthia Wandia (product and engineering) and Laurisha (conversation design).

Fernhill is a fictional bank used for the demo. MIT licensed.
