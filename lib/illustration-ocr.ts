import {
  annualFixedCashFromRows,
  newRowId,
  type IllustrationParseResult,
  type IllustrationRow,
} from "@/lib/illustration";

export interface OcrWord {
  text: string;
  x: number;
}

const AGES = [65, 70, 75, 80, 85, 90, 95, 100];

function parseAmount(text: string): number | null {
  const stripped = text.replace(/[\]\[|().]/g, "").replace(/[,，\s]/g, "");
  if (/^(of|o)$/i.test(stripped)) return 0;
  if (!/^\d+(\.\d+)?$/.test(stripped)) return null;
  const value = Number(stripped);
  return Number.isFinite(value) ? value : null;
}

function coerceAge(token: string, lastAge: number): number {
  const digits = token.replace(/\D/g, "");
  const match = AGES.find((age) => digits.startsWith(String(age)));
  if (match) return match;
  return AGES.find((age) => age > lastAge) ?? lastAge + 5;
}

/** Policy years that OCR drops a digit (11 → 1) are filled from the previous row. Ages follow 65, 70, 75… */
export function repairYearLabels(tokens: string[]): string[] {
  const labels: string[] = [];
  let lastPolicy: number | null = null;
  let inAges = false;
  let lastAge = 60;

  for (const token of tokens) {
    const digits = token.replace(/\D/g, "");
    const n = digits ? Number(digits) : NaN;
    const ageLike =
      /[%歲]/.test(token) ||
      (Number.isFinite(n) && n >= 60 && n < 130) ||
      (digits.length >= 3 && n > 100);

    if (!inAges && lastPolicy !== null && lastPolicy >= 25 && ageLike) {
      inAges = true;
    }

    if (inAges) {
      const age = coerceAge(token, lastAge);
      labels.push(`${age}歲`);
      lastAge = age;
      continue;
    }

    let year = Number.isFinite(n) && n > 0 && n < 60 ? n : null;
    if (lastPolicy !== null && (year === null || year <= lastPolicy)) {
      year = lastPolicy + 1;
    }
    if (year === null) year = 1;
    labels.push(String(year));
    lastPolicy = year;
  }

  return labels;
}

export function rowsFromOcrLines(lines: OcrWord[][]): IllustrationParseResult {
  const parsed: { yearToken: string; amounts: number[] }[] = [];

  for (const line of lines) {
    const words = [...line].sort((a, b) => a.x - b.x);
    if (words.length < 7) continue;
    const amounts = words.slice(1, 7).map((word) => parseAmount(word.text));
    if (amounts.some((amount) => amount === null)) continue;
    if (amounts.every((amount) => amount === 0)) continue;
    parsed.push({
      yearToken: words[0].text,
      amounts: amounts as number[],
    });
  }

  const years = repairYearLabels(parsed.map((row) => row.yearToken));
  const rows: IllustrationRow[] = parsed.map((row, index) => ({
    id: newRowId(),
    policyYearEnd: years[index],
    totalPremiumPaid: row.amounts[0],
    guaranteedCashValueA: row.amounts[1],
    accumulatedGuaranteedCashReserveB: row.amounts[2],
    accumulatedInterestC: row.amounts[3],
    terminalDividendD: row.amounts[4],
    totalAmount: row.amounts[5],
  }));

  return { rows, annualFixedCash: annualFixedCashFromRows(rows) };
}
