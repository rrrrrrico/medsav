import { comparePlans, findPlan, findPremiums, lifetimeCost, plansCoveringAge, series, statusOf } from "@/lib/assistant/data";

/**
 * Evaluation set for the MedSav Assistant.
 *
 * data: expected numbers are computed from the same premium matrix at run time, so the set stays
 *       correct after each monthly data refresh. A case passes when every expected number appears.
 * docs: a case passes when the answer contains every expected phrase (any of the alternatives) and
 *       cites a passage whose title starts with one of `relevant`. Retrieval recall@5 is measured
 *       separately on the raw question.
 * behaviour: clarifying questions, advice requests and out-of-scope questions.
 */

export type Case =
  | { id: string; kind: "data"; lang: "en" | "zh"; question: string; tool: string; expect: () => number[] }
  | { id: string; kind: "docs"; lang: "en" | "zh"; question: string; phrases: string[][]; relevant: string[] }
  | { id: string; kind: "behaviour"; lang: "en" | "zh"; question: string; check: "asks" | "no_advice" | "declines" };

type Ok<T> = Exclude<T, { error: string }>;
const ok = <T,>(v: T) => v as Ok<T>;

const cheapest = (age: number, gender: "male" | "female", smoker: boolean, plan_type: "standard" | "flexi" | "any",
  extra: { insurer?: string; currency?: "HKD" | "USD" } = {}) =>
  ok(findPremiums({ age, gender, smoker, plan_type, ...extra, limit: 1 })).results[0].annual_premium;

const planPremium = (query: string, age: number, gender: "male" | "female", smoker: boolean) => {
  const p = findPlan(query).find((x) => x.k === "s") ?? findPlan(query)[0];
  return series(p, statusOf(gender, smoker))![age]!;
};

export const CASES: Case[] = [
  { id: "d01", kind: "data", lang: "en", tool: "find_premiums",
    question: "Which Standard Plan is cheapest for a 45-year-old woman who doesn't smoke, and what is the annual premium?",
    expect: () => [cheapest(45, "female", false, "standard")] },
  { id: "d02", kind: "data", lang: "zh", tool: "find_premiums",
    question: "60歲男士，有吸煙，最平嘅標準計劃每年保費幾多？",
    expect: () => [cheapest(60, "male", true, "standard")] },
  { id: "d03", kind: "data", lang: "en", tool: "find_premiums",
    question: "What is the most expensive Standard Plan premium for a 30-year-old male non-smoker?",
    expect: () => [ok(findPremiums({ age: 30, gender: "male", smoker: false, plan_type: "standard", sort: "dearest", limit: 1 })).results[0].annual_premium] },
  { id: "d04", kind: "data", lang: "en", tool: "find_premiums",
    question: "What is the median annual premium across Standard Plans for a 65-year-old female non-smoker?",
    expect: () => [ok(findPremiums({ age: 65, gender: "female", smoker: false, plan_type: "standard" })).market!.median] },
  { id: "d05", kind: "data", lang: "en", tool: "lifetime_cost",
    question: "For a male non-smoker, which Flexi Plan has the lowest total premiums from age 40 to 80, and what is the total?",
    expect: () => [ok(lifetimeCost({ from_age: 40, to_age: 80, gender: "male", smoker: false, plan_type: "flexi", limit: 1 })).results[0].total_premium] },
  { id: "d06", kind: "data", lang: "zh", tool: "lifetime_cost",
    question: "不吸煙男士由40歲供到99歲，最平嘅標準計劃總保費係幾多？",
    expect: () => [ok(lifetimeCost({ from_age: 40, to_age: 99, gender: "male", smoker: false, plan_type: "standard", limit: 1 })).results[0].total_premium] },
  { id: "d07", kind: "data", lang: "en", tool: "find_premiums",
    question: "How many Standard Plans have a published premium for a 50-year-old female non-smoker?",
    expect: () => [ok(findPremiums({ age: 50, gender: "female", smoker: false, plan_type: "standard" })).plans_priced_at_this_age] },
  { id: "d08", kind: "data", lang: "zh", tool: "plans_covering_age",
    question: "有幾多個港元計劃嘅保費表去到100歲或以上？",
    expect: () => [plansCoveringAge(100, { plan_type: "any", currency: "HKD" }).plans_priced_at_or_beyond_age] },
  { id: "d09", kind: "data", lang: "en", tool: "plan_details",
    question: "What is the annual premium of the ZA VHIS Standard Plan for a 70-year-old man who doesn't smoke?",
    expect: () => [planPremium("ZA VHIS", 70, "male", false)] },
  { id: "d10", kind: "data", lang: "en", tool: "find_premiums",
    question: "What is AIA's cheapest Flexi Plan premium for a 35-year-old female non-smoker?",
    expect: () => [cheapest(35, "female", false, "flexi", { insurer: "AIA" })] },
  { id: "d11", kind: "data", lang: "zh", tool: "find_premiums",
    question: "保誠嘅標準計劃，50歲女士唔吸煙，每年保費幾多？",
    expect: () => [cheapest(50, "female", false, "standard", { insurer: "保誠" })] },
  { id: "d12", kind: "data", lang: "en", tool: "find_premiums",
    question: "What is the cheapest US dollar Flexi Plan for a 40-year-old male non-smoker?",
    expect: () => [cheapest(40, "male", false, "flexi", { currency: "USD" })] },
  { id: "d13", kind: "data", lang: "en", tool: "compare_plans",
    question: "Compare the total premiums from age 40 to 60 for a male non-smoker between ZA VHIS and Bowtie's Standard Plan.",
    expect: () => {
      const certs = ["ZA VHIS", "Bowtie VHIS Standard"].map((q) => (findPlan(q).find((x) => x.k === "s") ?? findPlan(q)[0]).c);
      return comparePlans(certs, "male", false, 40, 60).plans.map((p) => ("total_premium" in p ? p.total_premium! : 0));
    } },
  { id: "d14", kind: "data", lang: "zh", tool: "find_premiums",
    question: "50歲吸煙女士，最平嘅標準計劃係邊個？保費幾多？",
    expect: () => [cheapest(50, "female", true, "standard")] },

  { id: "r01", kind: "docs", lang: "en", question: "How much VHIS premium can I claim as a tax deduction per insured person?",
    phrases: [["8,000", "8000"]], relevant: ["Q39", "Q40", "Q41", "Q42", "Q43", "Q44", "Q45", "Q46", "Q47", "Q48", "Tax deduction"] },
  { id: "r02", kind: "docs", lang: "zh", question: "自願醫保保費扣稅上限係幾多？",
    phrases: [["8,000", "8000"]], relevant: ["Q39", "Q40", "Q41", "Q42", "Q43", "Q44", "Q45", "Q46", "Q47", "Q48", "扣稅"] },
  { id: "r03", kind: "docs", lang: "en", question: "How are unknown pre-existing conditions covered under a Certified Plan?",
    phrases: [["25%"], ["50%"]], relevant: ["Q17", "Standard Plan policy template"] },
  { id: "r04", kind: "docs", lang: "en", question: "Up to what age is renewal guaranteed for VHIS Certified Plans?",
    phrases: [["100"]], relevant: ["Q4", "Q8", "Standard Plan policy template"] },
  { id: "r05", kind: "docs", lang: "en", question: "What is the annual benefit limit of the Standard Plan?",
    phrases: [["420,000", "420000"]], relevant: ["Standard Plan policy template"] },
  { id: "r06", kind: "docs", lang: "zh", question: "標準計劃每年保障限額係幾多？",
    phrases: [["420,000", "420000", "42萬"]], relevant: ["標準計劃保單範本"] },
  { id: "r07", kind: "docs", lang: "en", question: "Can I cancel my Certified Plan after buying it and get my money back?",
    phrases: [["21"]], relevant: ["Q38", "Standard Plan policy template"] },
  { id: "r08", kind: "docs", lang: "en", question: "Can the insurer increase my premium when I renew?",
    phrases: [["age", "same"]], relevant: ["Q26"] },
  { id: "r09", kind: "docs", lang: "zh", question: "我已經有份住院保險，點樣轉去認可產品？",
    phrases: [["轉移", "續保"]], relevant: ["Q34", "Q35", "Q36", "Q37"] },
  { id: "r10", kind: "docs", lang: "en", question: "Why do some Flexi Plans have a lifetime benefit limit?",
    phrases: [["5 million", "5,000,000", "HK$5"]], relevant: ["Q9"] },
  { id: "r11", kind: "docs", lang: "en", question: "What is the difference between the Standard Plan and Flexi Plans?",
    phrases: [["standard"]], relevant: ["Q21", "Q22"] },
  { id: "r12", kind: "docs", lang: "zh", question: "邊啲親屬嘅自願醫保保費可以扣稅？",
    phrases: [["配偶"], ["父母", "子女"]], relevant: ["Q39", "Q40", "Q41", "Q42", "Q43", "Q44", "Q45", "Q46", "Q47", "Q48", "扣稅"] },

  { id: "b01", kind: "behaviour", lang: "en", question: "What's the cheapest Standard Plan?", check: "asks" },
  { id: "b02", kind: "behaviour", lang: "zh", question: "我應該買邊份計劃？", check: "no_advice" },
  { id: "b03", kind: "behaviour", lang: "en", question: "Which stock should I buy this week?", check: "declines" },
  { id: "b04", kind: "behaviour", lang: "en", question: "How much is a Standard Plan for me? I'm 52.", check: "asks" },
];
