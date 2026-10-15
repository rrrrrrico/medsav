import Papa from "papaparse";

export interface InsurancePlan {
  "certification-no": string;
  certification_no: string;
  company_name_zh: string;
  company_name_en: string;
  plan_name_zh: string;
  plan_name_en: string;
  type_zh: string;
  type_en: string;
  premium_pdf_url?: string;
}

export interface PlanPremium {
  "certification-no": string;
  certification_no: string;
  "prem-date": string;
  currency: string;
  "age-counting-method": string;
  max_age?: number;
  premium: Record<string, Record<number, number>>;
}

let plansCache: InsurancePlan[] | null = null;
let plansPromise: Promise<InsurancePlan[]> | null = null;
const premiumCache = new Map<string, PlanPremium>();
const premiumPromises = new Map<string, Promise<PlanPremium>>();

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.text();
}

function parsePlans(csv: string): InsurancePlan[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    console.warn("plans.csv parse warnings", parsed.errors.slice(0, 3));
  }

  return parsed.data
    .filter((row) => row.certification_no)
    .map((row) => ({
      "certification-no": row.certification_no,
      certification_no: row.certification_no,
      company_name_en: row.company_name_en ?? "",
      company_name_zh: row.company_name_zh ?? "",
      plan_name_en: row.plan_name_en ?? "",
      plan_name_zh: row.plan_name_zh ?? "",
      type_en: row.type_en ?? "",
      type_zh: row.type_zh ?? "",
      premium_pdf_url: row.premium_pdf_url,
    }));
}

function parsePlanPremiumCsv(csv: string, certificationNo: string): PlanPremium {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    console.warn(`premiums/${certificationNo}.csv parse warnings`, parsed.errors.slice(0, 3));
  }

  const premium: Record<string, Record<number, number>> = {};
  let premDate = "";
  let currency = "HKD";
  let ageCounting = "";
  let maxAge = 0;

  for (const row of parsed.data) {
    const status = row.status;
    const age = Number(row.age);
    const amount = Number(row.annual_premium);
    if (!status || Number.isNaN(age) || Number.isNaN(amount)) continue;

    if (!premium[status]) premium[status] = {};
    premium[status][age] = amount;
    if (age > maxAge) maxAge = age;

    if (!premDate && row.prem_date) premDate = row.prem_date;
    if (row.currency) currency = row.currency;
    if (row.age_counting_method) ageCounting = row.age_counting_method;
    if (row.max_age) {
      const declared = Number(row.max_age);
      if (!Number.isNaN(declared) && declared > maxAge) maxAge = declared;
    }
  }

  return {
    "certification-no": certificationNo,
    certification_no: certificationNo,
    "prem-date": premDate,
    currency,
    "age-counting-method": ageCounting,
    max_age: maxAge,
    premium,
  };
}

export async function getInsurancePlans(): Promise<InsurancePlan[]> {
  if (plansCache) return plansCache;
  if (!plansPromise) {
    plansPromise = fetchText("/data/plans.csv")
      .then((csv) => {
        plansCache = parsePlans(csv);
        return plansCache;
      })
      .catch((error) => {
        plansPromise = null;
        throw error;
      });
  }
  return plansPromise;
}

export async function getPlanPremium(certificationNo: string): Promise<PlanPremium> {
  const cached = premiumCache.get(certificationNo);
  if (cached) return cached;

  const inflight = premiumPromises.get(certificationNo);
  if (inflight) return inflight;

  const promise = fetchText(`/data/premiums/${encodeURIComponent(certificationNo)}.csv`)
    .then((csv) => {
      const parsed = parsePlanPremiumCsv(csv, certificationNo);
      premiumCache.set(certificationNo, parsed);
      premiumPromises.delete(certificationNo);
      return parsed;
    })
    .catch((error) => {
      premiumPromises.delete(certificationNo);
      throw error;
    });

  premiumPromises.set(certificationNo, promise);
  return promise;
}

/** @deprecated Prefer getPlanPremium(cert) — kept for call sites that expect a list. */
export async function getPlanPremiums(): Promise<PlanPremium[]> {
  return Array.from(premiumCache.values());
}
