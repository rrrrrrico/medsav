import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { comparePlans, findPremiums, lifetimeCost, planDetails, plansCoveringAge } from "./data";
import { search } from "./search";

const gender = z.enum(["male", "female"]);
const smoker = z.boolean().describe("true for smokers, false for non-smokers");
const planType = z.enum(["standard", "flexi", "rider", "any"]).default("any")
  .describe("standard = Standard Plan, flexi = Flexi Plan, rider = add-on rider; any = all");
const currency = z.enum(["HKD", "USD"]).default("HKD");
const insurer = z.string().optional().describe("Part of the insurer's English or Chinese name, e.g. 'AIA' or '保誠'");
const sort = z.enum(["cheapest", "dearest"]).default("cheapest");
const limit = z.number().int().min(1).max(10).default(5);
const age = z.number().int().min(0).max(130);

const json = (value: unknown) => JSON.stringify(value);

export const findPremiumsTool = tool(
  async (args) => json(findPremiums(args)),
  {
    name: "find_premiums",
    description: "Annual premiums at one age for a given sex and smoking status, ranked cheapest or dearest, plus market lowest, quartiles, median and highest across all matching plans.",
    schema: z.object({ age, gender, smoker, plan_type: planType, currency, insurer, sort, limit }),
  },
);

export const lifetimeCostTool = tool(
  async (args) => json(lifetimeCost(args)),
  {
    name: "lifetime_cost",
    description: "Total premiums paid from from_age to to_age inclusive (ages up to 99), ranked cheapest or dearest. Only plans priced for every age in the range are included.",
    schema: z.object({ from_age: age, to_age: age, gender, smoker, plan_type: planType, currency, insurer, sort, limit }),
  },
);

export const planDetailsTool = tool(
  async ({ query, ages }) => json(planDetails(query, ages)),
  {
    name: "plan_details",
    description: "Look up plans by certification number, plan name or insurer words, returning plan type, level, highest priced age and premiums at selected ages for all four sex/smoking statuses.",
    schema: z.object({
      query: z.string().min(2),
      ages: z.array(z.number().int().min(0).max(99)).max(12).optional(),
    }),
  },
);

export const comparePlansTool = tool(
  async ({ certification_nos, gender, smoker, from_age, to_age }) =>
    json(comparePlans(certification_nos, gender, smoker, from_age, to_age)),
  {
    name: "compare_plans",
    description: "Compare 2-6 plans: premium at from_age, premium at to_age and total from from_age to to_age. Prefer certification numbers (from plan_details); a plan name also works and takes the first match.",
    schema: z.object({
      certification_nos: z.array(z.string()).min(2).max(6).describe("Certification numbers or plan names"),
      gender, smoker, from_age: age, to_age: age,
    }),
  },
);

export const plansCoveringAgeTool = tool(
  async ({ age, plan_type, currency, insurer, limit }) =>
    json(plansCoveringAge(age, { plan_type, currency, insurer }, limit)),
  {
    name: "plans_covering_age",
    description: "Count and list plans whose published premium table reaches a given age (e.g. 100 or above).",
    schema: z.object({ age, plan_type: planType, currency, insurer, limit }),
  },
);

export const searchDocumentsTool = tool(
  async ({ query, lang, k }) => json(search(query, { lang, k }).map((p) => ({
    id: p.id, title: p.title, source: p.source, lang: p.lang, url: p.url,
    text: p.text.length > 900 ? `${p.text.slice(0, 900)}…` : p.text,
  }))),
  {
    name: "search_documents",
    description: "Search official VHIS documents (FAQs, Standard Plan policy template, tax deduction) and return passages with ids to cite. Write the query in the language of the documents you want; use lang 'any' to search both.",
    schema: z.object({
      query: z.string().min(2),
      lang: z.enum(["en", "zh", "any"]).optional().describe("Defaults to the language of the query"),
      k: z.number().int().min(1).max(8).default(5),
    }),
  },
);

export const tools = [
  findPremiumsTool, lifetimeCostTool, planDetailsTool, comparePlansTool, plansCoveringAgeTool, searchDocumentsTool,
];
