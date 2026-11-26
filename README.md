# Second Voice

**A second voice at the moment of payment.**

In a safe-account scam the caller stays on the line and tells the victim what to say to their bank. Second Voice is an assistant inside the banking app that opens a short conversation before the money moves, and a rules engine that decides what happens next.

It comes with a test harness: simulated victims who have been coached to lie, and a simulated scammer who keeps coaching them.

> **Version 0.1. First live results pending.** The scores in this README are blank on purpose. They will be filled in from a published run, with every transcript, and not before.

```
npm install
npm test                 # unit tests, no network
npm run dev              # demo bank on localhost:4310
npm run eval -- --offline  # whole pipeline, fixed-rule stubs, no key

export ANTHROPIC_API_KEY=...
npm run eval -- --seeds 5
```

---

## Why this scam needs one more layer

Banks have moved a long way past a single pop-up. Purpose questions, warnings tailored to the answer, call-status screens and scam checkers a customer can consult before paying are all in production. Each of them works when the customer is answering for themselves. In a safe-account scam someone else is answering.

> *"Ignore the pop-up. That's the system we're investigating."*

The caller reads the warning first. By the time the victim sees it, it has already been explained away.

> *"If they ask, it's for building work."*

The bank's questions are answered by the scammer, through the victim. A fixed list of purposes is easy to coach.

> *"Don't hang up. We need to finish this now."*

A scam checker works when someone stops to ask. The caller's job is to make sure they don't. Second Voice is for that moment, and the best thing it can do is get the customer to stop and check.

### Where this sits

Second Voice looks only at the payer's side: what the bank can observe about the session, and what the conversation produces. It does no investigation of the recipient. Recipient intelligence, such as checks on the payee account and data shared across institutions, is a separate layer. This would sit beside it, and a real deployment would feed its findings into the signal layer.

---

## How a payment flows

Five stages sit between the send button and the money. Two of them never call a model.

| # | Stage | What it does | |
|---|---|---|---|
| 1 | **Signal layer** (`src/signals.ts`) | Scores what the bank can observe: a call in progress, a first payment to a new account, the amount against history, the name check, remote access. | rules only |
| 2 | **Triage** (`src/stages.ts`) | Names the scam type the pattern resembles. It can raise the level of caution by one step. It cannot lower it. | model |
| 3 | **Intervention** (`src/stages.ts`) | Runs the conversation from a playbook. Asks before it tells, says only what the bank can see, offers a way to check that costs nothing. Six messages at most. | model |
| 4 | **Coaching detector** (`src/stages.ts`) | Reports two lists: *contradictions* (answers that conflict with something observed) and *indicators* (answers that merely sound supplied). A contradiction fires a rule. No rule reads an indicator. | model |
| 5 | **Policy engine** (`src/policy.ts`) | An ordered rule table decides: release, delay, hold for review, or cancelled by the payer. The rule that fired goes in the audit trail with a case note for the fraud analyst. | rules only |

### Models advise. Rules decide.

This is the whole design. A payment is decided in one place, `decide()` in `src/policy.ts`, and whatever it reads from a model is one input to a rule a person can read. Three tests pin the boundary. A coaching detector that is 95% sure, with no contradiction and low caution, cannot hold a payment. A triage model that is certain and has raised caution cannot hold one either, because the rule it feeds reads the caution level the signals set. And no code outside `policy.ts` may construct an outcome.

Models do reach the decision, through three doors, and they are worth stating plainly:

- A contradiction reported by the coaching detector fires R5. In version 0.1 that report is taken as given. Checking it in code against the logged signals and the payer's own words is the next change to the rule table.
- A triage reading of impersonation counts in R4, and only when the signals alone already put caution at elevated or higher.
- Triage can raise caution by one step, which can move a payment from elevated to high and into the delay of R6.

Every decision can be recomputed from the logged inputs and explained to a customer, an ombudsman or a regulator.

The rule table, in order. First match wins.

| | Rule | Outcome |
|---|---|---|
| R1 | The payer asked to stop the payment in their own words. | cancelled by payer |
| R2 | Remote access software is active and the payee is new. | hold for review |
| R3 | The payer disclosed that someone instructed them to make this payment. | hold for review |
| R4 | Triage reads impersonation, the payee is new, and the signals alone put caution at elevated or higher. | hold for review |
| R5 | The payer's answers contradict what the bank can see. | hold for review |
| R6 | Caution is high, whatever the conversation produced. | delay |
| R7 | The account name does not match and the payee is new. | delay |
| R8 | Nothing above fired. | release |

R1 sits at the top because a payer who has decided to stop has already got what the intervention was for, and nothing below should talk them back out of it.

---

## Tested against victims who have been told to lie

The harness runs every scenario through two arms.

The **control arm** shows one generic warning and then applies the same signal layer and the signal-only rules (R1, R2, R3, R6 and R7). It is a warning plus rules, with no conversation. That is a simpler baseline than the tailored warnings and purpose questions many banks already run, and a tailored-warning arm is the first thing to add.

The **Second Voice arm** adds triage, the conversation and the coaching detector. So the comparison isolates one thing: what the conversation adds on top of the rules.

Half the difficulty is on the other side, so legitimate payments that look risky are in the test set too.

- **Victim** believes the caller to a set strength and may have a cover story. The persona describes the person and says nothing about what should change their mind.
- **Scammer coach** stays on the line and tells the victim how to answer each message from the app. While a call is up, it gets a turn before every reply.
- **Legitimate payer** has a house deposit, a builder, savings moved for a better rate. Honest answers, limited patience.
- **Judge** rates dignity and whether the spell actually broke. The commercial outcomes are arithmetic, computed from the rule that fired. In version 0.1 one model plays every role, the judge included, so the two judged measures are the weakest rows in the table.

### The test set

Ten scenarios in version 0.1: six impersonation scams and four legitimate look-alikes. The set is built so that **no single observable separates the two groups**, and a test fails the build if one ever does.

- A scam where the caller had the victim hang up first, so there is no call in progress.
- A scam where the payee account is genuinely in the payer's own name, so the name check passes cleanly.
- A scam against someone the same app already interrupted four days ago, now coached on the exact question that stopped her.
- A legitimate car purchase made on the phone to the seller, with a name mismatch, so every signal that usually means coaching is present and all of them are innocent.
- A legitimate 72 year old moving her own savings for a better rate, which is word for word the cover story the scammers use.

### Measures

| Measure | What it tells you | Control arm | Second Voice |
|---|---|---|---|
| Not released | Scam payments held, delayed or cancelled. A sum of the three rows below | pending | pending |
| Held for review | Scam payments stopped until a person looks | pending | pending |
| Delayed only | Scam payments that leave after the delay unless someone acts | pending | pending |
| Payer chose to cancel | The payer stopped it themselves | pending | pending |
| Payer disclosed | The fraud team has something to act on | pending | pending |
| Spell broken (judged) | They stopped believing the caller, so they will not try again elsewhere | pending | pending |
| Legitimate released | Real payments that went through without delay | pending | pending |
| Legitimate abandoned | Customers who gave up | pending | pending |
| Dignity, 1 to 5 (judged) | Treated as a capable adult, or accused and lectured | pending | pending |

Percentages never travel without the fraction they came from. Ten scenarios at a handful of seeds is a small sample and the report prints it that way.

---

## What this does and does not show

**Open.** The runtime and the policy rules. The simulators, judge and scenarios. A generic playbook. Every transcript behind a published score.

**Not built.** Playbooks tuned to a scam type, and tuned detector rules. If they are built they will stay private, because a published script is one a scammer can coach a victim against.

**Not claimed.** That simulated victims behave like frightened people. That a score here predicts results in a bank. A model playing a victim gives way to a good argument more easily than a person does, and how easily is a property of the model. The harness compares designs. Real efficacy needs a bank pilot.

Four limits worth stating plainly:

- **Intent and disclosure are declared.** In the harness the payer's decision to stop, and any admission that someone is instructing them, are flags set by the simulator. The demo bank has a cancel button and no disclosure detection. Reading either from a payer's words is still to be built, so these numbers do not measure it.
- **The conversation can add caution and cannot remove it.** A legitimate payment that scores high on signals is delayed whatever the payer says. The car purchase in the test set is one. A tested rule that lets a good conversation release a payment is the obvious next step, and the hardest one to get right.
- **Only the payer's side is scored.** There is no recipient intelligence here. See *Where this sits*.
- **This is one scam type of several.** Bank and police impersonation came first because the coaching is explicit and easy to simulate. Investment, romance and purchase scams are larger categories and are next.

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
