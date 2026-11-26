/**
 * Offline stand-ins for every model call in the system.
 *
 * These are not a simulation of anything. They are fixed rules that return the
 * right shape, so that `npm test` exercises the engine, the rule table and the
 * audit trail without a key, and so the demo bank can be clicked through. Any
 * number produced in offline mode measures this file, not the design, which is
 * why `npm run eval` refuses to report scores without a model.
 */

import type { StubHandler } from "./model.ts";

/** Said only when the handset reports a call. The app never claims to see one it cannot see. */
const SCRIPT_ON_A_CALL = [
  "I have paused this payment for a moment. In your own words, what is it for?",
  "Thank you. I can see a call is in progress on this phone. Who are you speaking to?",
  "Your bank will never ring and ask you to move money to keep it safe. Neither will the police. Did the person who contacted you tell you what to say if we asked?",
  "Your money is safe where it is. You could end the call and ring the number on the back of your card. Someone genuine will be glad you checked.",
];

const SCRIPT_NO_CALL = [
  "I have paused this payment for a moment. In your own words, what is it for?",
  "Thank you. Is anyone else involved in this payment, or did anyone ask you to make it?",
  "One more question, and it is one we ask on first payments of this size. Did anyone tell you what to say if we asked about it?",
  "Thank you. If you are happy with who you are paying, check the account details with them directly before this goes.",
];

function callIsUp(prompt: string): boolean {
  return /A call is in progress/i.test(prompt);
}

function turnCount(prompt: string): number {
  const matches = prompt.match(/^APP: /gm);
  return matches ? matches.length : 0;
}

export const OFFLINE_STUBS: Record<string, StubHandler> = {
  triage: (prompt) =>
    callIsUp(prompt)
      ? {
          scamType: "bank_impersonation",
          confidence: 0.7,
          rationale: "Offline stub: a call in progress during a payment to a new payee.",
          raiseCaution: true,
        }
      : {
          scamType: "none_apparent",
          confidence: 0.5,
          rationale: "Offline stub: no call in progress.",
          raiseCaution: false,
        },

  intervention: (prompt) => {
    const i = turnCount(prompt);
    const script = callIsUp(prompt) ? SCRIPT_ON_A_CALL : SCRIPT_NO_CALL;
    return {
      message: script[Math.min(i, script.length - 1)] ?? script[0],
      reading: "Offline stub: following a fixed script chosen by whether a call is in progress.",
      done: i >= script.length - 1,
    };
  },

  coaching: (prompt) => {
    // The one check worth having offline, because it is the one the rule table
    // can act on by itself: the payer denies a call while a call is in progress.
    const deniedCompany = /^CUSTOMER:.*\b(nobody|no one|just me|on my own)\b/im.test(prompt);
    const contradiction = callIsUp(prompt) && deniedCompany;
    return {
      coached: contradiction,
      confidence: contradiction ? 0.8 : 0.2,
      contradictions: contradiction
        ? ['Said they were alone while a call was in progress']
        : [],
      indicators: [],
    };
  },

  victim: (prompt) => {
    const asked = /tell you what to say|what to say if we asked/i.test(prompt);
    const aboutCompany = /who are you speaking to|anyone else|on a call/i.test(prompt);
    if (asked) {
      return {
        text: "He said you would ask that. Please cancel it.",
        askedToStop: true,
        disclosedThirdParty: true,
        beliefAfter: 0.2,
      };
    }
    if (aboutCompany) {
      return { text: "Nobody. It is just me.", askedToStop: false, disclosedThirdParty: false, beliefAfter: 0.8 };
    }
    return {
      text: "I am just moving some savings into another account of mine.",
      askedToStop: false,
      disclosedThirdParty: false,
      beliefAfter: 0.9,
    };
  },

  scammer: (prompt) => {
    const cornered = /tell you what to say|what to say if we asked/i.test(prompt);
    return cornered
      ? { instruction: "Tell them your daughter warned you about scams. Do not mention me.", pressure: "urgent" }
      : { instruction: "Say you are moving savings between your own accounts.", pressure: "calm" };
  },

  legit_payer: () => ({
    text: "It is the deposit for the flat I am buying. My solicitor sent the details this morning.",
    askedToStop: false,
    disclosedThirdParty: false,
    beliefAfter: 1,
  }),

  judge: () => ({
    dignity: 3,
    spellBroken: false,
    reasoning: "Offline stub: fixed verdict, not a judgement of anything.",
  }),
};
