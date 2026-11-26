/**
 * The shapes that cross stage boundaries.
 *
 * One rule governs this file: anything a model produces is advice, and carries
 * no authority of its own. A payment ends with a PolicyOutcome, and by
 * convention the only thing that writes one is the rule table in policy.ts.
 * TypeScript does not enforce that (it is a plain interface), so a test does:
 * test/engine.test.ts checks that nothing outside policy.ts constructs one.
 */

export type ScamType =
  | "bank_impersonation"
  | "police_impersonation"
  | "investment"
  | "romance"
  | "purchase"
  | "none_apparent";

export type CautionLevel = "none" | "low" | "elevated" | "high";

/** Everything the bank can see by itself, before anyone is asked anything. */
export interface PaymentContext {
  payerName: string;
  amount: number;
  currency: string;
  payeeName: string;
  payeeIsNew: boolean;
  /** Confirmation of Payee. */
  nameCheck: "match" | "close_match" | "no_match" | "unavailable";
  /** The handset knows whether a call is up. A strong signal when present. A caller defeats it by having the victim hang up first, which is one of the scenarios. */
  callInProgress: boolean;
  callStartedMinutesAgo: number | null;
  remoteAccessDetected: boolean;
  /** This payment divided by the largest the payer has made before. */
  amountVsUsualMax: number;
  /** Share of the payer's balance this payment moves. 0 to 1. */
  shareOfBalance: number;
  payerAgeBand: "18-29" | "30-49" | "50-64" | "65-79" | "80+";
  /** How many times this payer has been through an intervention before. */
  priorInterventions: number;
}

export interface Signal {
  id: string;
  label: string;
  weight: number;
}

export interface SignalResult {
  score: number;
  level: CautionLevel;
  signals: Signal[];
}

export interface TriageAdvice {
  scamType: ScamType;
  confidence: number;
  rationale: string;
  /** The triage agent may ask for one step more caution. It can never ask for less. */
  raiseCaution: boolean;
}

export type Speaker = "assistant" | "payer";

export interface Turn {
  speaker: Speaker;
  text: string;
}

export interface CoachingAdvice {
  coached: boolean;
  confidence: number;
  /** Things the payer said that conflict with what the bank can see. */
  contradictions: string[];
  /** Things that sound supplied rather than lived. */
  indicators: string[];
}

export type Decision = "release" | "delay" | "hold_for_review" | "cancelled_by_payer";

export interface PolicyOutcome {
  decision: Decision;
  ruleId: string;
  ruleText: string;
  caseNote: string;
}

/** The whole decision, reproducible from logged inputs. */
export interface CaseFile {
  scenarioId: string;
  arm: Arm;
  context: PaymentContext;
  signals: SignalResult;
  triage: TriageAdvice | null;
  conversation: Turn[];
  coaching: CoachingAdvice | null;
  /** Caution after the signal layer and any raise from triage. */
  finalCaution: CautionLevel;
  outcome: PolicyOutcome;
  /** Did the payer ask to stop, in their own words, at any point. */
  payerAskedToStop: boolean;
  /** Did the payer tell us about the third party instructing them. */
  payerDisclosed: boolean;
}

/** The two arms every scenario runs through. */
export type Arm = "static_warning" | "second_voice";

export interface Scenario {
  id: string;
  title: string;
  /** The hidden truth. The judge sees this; nothing in src/ ever does. */
  truth: "scam" | "legitimate";
  scamType: ScamType;
  context: PaymentContext;
  /** How firmly the payer believes the caller at the start. 0 to 1. */
  beliefStrength: number;
  /** What the payer has been coached to say, if anything. */
  coverStory: string | null;
  /** Background the persona needs to answer in character. */
  payerBackground: string;
  /** For legitimate payers: the real reason for the payment. */
  realReason: string | null;
}
