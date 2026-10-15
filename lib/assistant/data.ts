import { readFileSync } from "fs";
import path from "path";

export type Kind = "s" | "f" | "r";
export type Status = "SMN" | "SFN" | "SMY" | "SFY";
export type Gender = "male" | "female";
export type PlanType = "standard" | "flexi" | "rider" | "any";
export type Currency = "HKD" | "USD";
type Series = (number | null)[];

export interface MatrixPlan {
  c: string; k: Kind; cur: Currency; i: number; n: [string, string]; t: [string, string]; m: number | null;
  p: Partial<Record<Status, Series | Status>>;
}
interface Matrix { max_age: number; insurers: [string, string][]; plans: MatrixPlan[] }

let cached: Matrix | null = null;

export function matrix(): Matrix {
  if (!cached) {
    const file = path.join(process.cwd(), "public", "data", "insights", "matrix.json");
    cached = JSON.parse(readFileSync(file, "utf-8")) as Matrix;
  }
  return cached;
}

const KIND: Record<Exclude<PlanType, "any">, Kind> = { standard: "s", flexi: "f", rider: "r" };
const KIND_LABEL: Record<Kind, string> = { s: "Standard Plan", f: "Flexi Plan", r: "Rider" };

export const statusOf = (gender: Gender, smoker: boolean): Status =>
  `S${gender === "male" ? "M" : "F"}${smoker ? "Y" : "N"}` as Status;

export function series(plan: MatrixPlan, status: Status): Series | null {
  let v = plan.p[status];
  for (let hops = 0; typeof v === "string" && hops < 4; hops++) v = plan.p[v];
  return Array.isArray(v) ? v : null;
}

export interface PlanFilter {
  plan_type?: PlanType;
  currency?: Currency;
  insurer?: string;
}

export function filterPlans(f: PlanFilter): MatrixPlan[] {
  const m = matrix();
  const needle = f.insurer?.trim().toLowerCase();
  return m.plans.filter((p) =>
    (f.currency ?? "HKD") === p.cur &&
    (!f.plan_type || f.plan_type === "any" || KIND[f.plan_type] === p.k) &&
    (!needle || m.insurers[p.i].some((name) => name.toLowerCase().includes(needle))));
}

export function describe(p: MatrixPlan) {
  const [insurerEn, insurerZh] = matrix().insurers[p.i];
  return {
    certification_no: p.c,
    insurer: insurerEn,
    insurer_zh: insurerZh,
    plan: p.n[0],
    plan_zh: p.n[1],
    level: p.t[0] || undefined,
    plan_type: KIND_LABEL[p.k],
    currency: p.cur,
    highest_priced_age: p.m,
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const round = (n: number) => Math.round(n);

export interface PremiumQuery extends PlanFilter {
  age: number;
  gender: Gender;
  smoker: boolean;
  sort?: "cheapest" | "dearest";
  limit?: number;
}

export function findPremiums(q: PremiumQuery) {
  const status = statusOf(q.gender, q.smoker);
  if (q.age > matrix().max_age) {
    return { error: `Premiums by age are only available up to age ${matrix().max_age}. Use plans_covering_age for older ages.` };
  }
  const rows = filterPlans(q)
    .map((p) => ({ plan: p, premium: series(p, status)?.[q.age] ?? null }))
    .filter((r): r is { plan: MatrixPlan; premium: number } => r.premium != null)
    .sort((a, b) => a.premium - b.premium);
  if (q.sort === "dearest") rows.reverse();
  const values = rows.map((r) => r.premium).sort((a, b) => a - b);
  return {
    query: { ...q, status },
    plans_priced_at_this_age: rows.length,
    market: values.length ? {
      lowest: values[0], p25: round(quantile(values, 0.25)), median: round(quantile(values, 0.5)),
      p75: round(quantile(values, 0.75)), highest: values[values.length - 1],
    } : null,
    results: rows.slice(0, Math.min(q.limit ?? 5, 10)).map((r) => ({ ...describe(r.plan), annual_premium: r.premium })),
  };
}

export interface LifetimeQuery extends PlanFilter {
  from_age: number;
  to_age: number;
  gender: Gender;
  smoker: boolean;
  sort?: "cheapest" | "dearest";
  limit?: number;
}

export function totalPremium(p: MatrixPlan, status: Status, from: number, to: number): number | null {
  const s = series(p, status);
  if (!s) return null;
  let total = 0;
  for (let a = from; a <= to; a++) {
    const v = s[a];
    if (v == null) return null;
    total += v;
  }
  return total;
}

export function lifetimeCost(q: LifetimeQuery) {
  const status = statusOf(q.gender, q.smoker);
  const maxAge = matrix().max_age;
  if (q.from_age > q.to_age || q.to_age > maxAge) {
    return { error: `Use 0 <= from_age <= to_age <= ${maxAge}.` };
  }
  const plans = filterPlans(q);
  const rows = plans
    .map((p) => ({ plan: p, total: totalPremium(p, status, q.from_age, q.to_age) }))
    .filter((r): r is { plan: MatrixPlan; total: number } => r.total != null)
    .sort((a, b) => a.total - b.total);
  if (q.sort === "dearest") rows.reverse();
  const values = rows.map((r) => r.total).sort((a, b) => a - b);
  return {
    query: { ...q, status },
    plans_matching_filters: plans.length,
    plans_priced_for_every_age: rows.length,
    market: values.length ? { lowest: values[0], median: round(quantile(values, 0.5)), highest: values[values.length - 1] } : null,
    results: rows.slice(0, Math.min(q.limit ?? 5, 10)).map((r) => ({ ...describe(r.plan), total_premium: r.total })),
  };
}

export function findPlan(query: string): MatrixPlan[] {
  const needle = query.trim().toLowerCase();
  const m = matrix();
  const exact = m.plans.filter((p) => p.c.toLowerCase() === needle);
  if (exact.length) return exact;
  const words = needle.split(/\s+/).filter(Boolean);
  return m.plans.filter((p) => {
    const hay = [p.c, ...p.n, ...p.t, ...m.insurers[p.i]].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function planDetails(query: string, ages: number[] = [0, 20, 30, 40, 50, 60, 70, 80, 90, 99]) {
  const matches = findPlan(query);
  if (!matches.length) return { error: `No plan matches "${query}". Try a certification number or fewer words.` };
  return {
    matches: matches.length,
    plans: matches.slice(0, 5).map((p) => ({
      ...describe(p),
      premiums_by_age: Object.fromEntries(ages.filter((a) => a <= matrix().max_age).map((a) => [a, {
        male_non_smoker: series(p, "SMN")?.[a] ?? null,
        female_non_smoker: series(p, "SFN")?.[a] ?? null,
        male_smoker: series(p, "SMY")?.[a] ?? null,
        female_smoker: series(p, "SFY")?.[a] ?? null,
      }])),
    })),
  };
}

export function comparePlans(certs: string[], gender: Gender, smoker: boolean, fromAge: number, toAge: number) {
  const status = statusOf(gender, smoker);
  const m = matrix();
  return {
    query: { gender, smoker, from_age: fromAge, to_age: toAge, status },
    plans: certs.map((c) => {
      const p = m.plans.find((x) => x.c.toLowerCase() === c.trim().toLowerCase()) ?? findPlan(c)[0];
      if (!p) return { certification_no: c, error: "not found" };
      const s = series(p, status);
      return {
        ...describe(p),
        premium_at_from_age: s?.[fromAge] ?? null,
        premium_at_to_age: s?.[toAge] ?? null,
        total_premium: totalPremium(p, status, fromAge, toAge),
      };
    }),
  };
}

export function plansCoveringAge(age: number, filter: PlanFilter, limit = 10) {
  const plans = filterPlans(filter).filter((p) => (p.m ?? 0) >= age);
  return {
    query: { age, ...filter },
    plans_priced_at_or_beyond_age: plans.length,
    plans_matching_filters: filterPlans(filter).length,
    note: "Based on the highest age in each plan's published premium table.",
    examples: plans.slice(0, Math.min(limit, 15)).map(describe),
  };
}
