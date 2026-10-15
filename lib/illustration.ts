export interface IllustrationRow {
  id: string;
  policyYearEnd: string;
  totalPremiumPaid: number;
  guaranteedCashValueA: number;
  accumulatedGuaranteedCashReserveB: number;
  accumulatedInterestC: number;
  terminalDividendD: number;
  totalAmount: number;
}

export interface IllustrationParseResult {
  rows: IllustrationRow[];
  annualFixedCash: number;
}

export interface FundingYear {
  age: number;
  premium: number;
  cashIn: number;
  available: number;
  surplus: number;
  remaining: number;
  covered: boolean;
}

export interface FundingProjection {
  years: FundingYear[];
  shortfallAge: number | null;
  yearsCovered: number;
  totalPremium: number;
  totalCashDeployed: number;
  premiumsCovered: number;
  leverageRatio: number;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,，\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function newRowId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyIllustrationRow(): IllustrationRow {
  return {
    id: newRowId(),
    policyYearEnd: "",
    totalPremiumPaid: 0,
    guaranteedCashValueA: 0,
    accumulatedGuaranteedCashReserveB: 0,
    accumulatedInterestC: 0,
    terminalDividendD: 0,
    totalAmount: 0,
  };
}

export function normalizeIllustrationRows(raw: unknown): IllustrationRow[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows)
      ? (raw as { rows: unknown[] }).rows
      : [];

  return list
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: newRowId(),
        policyYearEnd: str(
          r.policyYearEnd ?? r.policy_year_end ?? r.year ?? r["保單年度終結"]
        ),
        totalPremiumPaid: num(
          r.totalPremiumPaid ?? r.total_premium_paid ?? r["繳付保費總額"]
        ),
        guaranteedCashValueA: num(
          r.guaranteedCashValueA ?? r.guaranteed_cash_value_a ?? r.A ?? r["保證現金價值"]
        ),
        accumulatedGuaranteedCashReserveB: num(
          r.accumulatedGuaranteedCashReserveB ??
            r.accumulated_guaranteed_cash_reserve_b ??
            r.B ??
            r["累計保證現金儲備"]
        ),
        accumulatedInterestC: num(
          r.accumulatedInterestC ?? r.accumulated_interest_c ?? r.C ?? r["累積利息"]
        ),
        terminalDividendD: num(
          r.terminalDividendD ?? r.terminal_dividend_d ?? r.D ?? r["終期紅利"]
        ),
        totalAmount: num(r.totalAmount ?? r.total_amount ?? r.total ?? r["總額"]),
      };
    })
    .filter((row) => row.policyYearEnd || row.accumulatedGuaranteedCashReserveB || row.totalAmount);
}

export function annualFixedCashFromRows(rows: IllustrationRow[]): number {
  return rows[0]?.accumulatedGuaranteedCashReserveB ?? 0;
}

export function projectFunding(options: {
  currentAge: number;
  maxAge: number;
  annualFixedCash: number;
  premiumAtAge: (age: number) => number;
  carryForward: boolean;
  carryRate: number;
}): FundingProjection {
  const { currentAge, maxAge, annualFixedCash, premiumAtAge, carryForward, carryRate } = options;
  const years: FundingYear[] = [];
  let bank = 0;
  let shortfallAge: number | null = null;
  let totalPremium = 0;
  let totalCashDeployed = 0;
  let premiumsCovered = 0;
  const growth = carryRate / 100;

  const start = Math.max(0, Math.floor(currentAge));
  const end = Math.max(start, Math.floor(maxAge));

  for (let age = start; age <= end; age++) {
    const premium = Math.max(0, premiumAtAge(age));
    const brought = carryForward ? bank : 0;
    const available = brought + annualFixedCash;
    const surplus = available - premium;
    const covered = surplus >= -0.5;
    if (!covered && shortfallAge === null) shortfallAge = age;

    premiumsCovered += Math.min(premium, Math.max(0, available));
    if (covered) {
      bank = carryForward ? surplus * (1 + growth) : 0;
    } else {
      bank = 0;
    }

    totalPremium += premium;
    totalCashDeployed += annualFixedCash;
    years.push({
      age,
      premium,
      cashIn: annualFixedCash,
      available,
      surplus,
      remaining: bank,
      covered,
    });
  }

  const yearsCovered = years.filter((y) => y.covered).length;
  const leverageRatio =
    totalCashDeployed > 0 ? (premiumsCovered / totalCashDeployed) * 100 : 0;

  return {
    years,
    shortfallAge,
    yearsCovered,
    totalPremium,
    totalCashDeployed,
    premiumsCovered,
    leverageRatio,
  };
}
