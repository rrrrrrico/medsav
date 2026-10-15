"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCalculator } from "@/lib/calculator-context";
import { projectFunding, type FundingProjection } from "@/lib/illustration";

interface IllustrationResultsProps {
  language: "en" | "zh";
  annualFixedCash: number;
  carryForward: boolean;
  carryRate: number;
  inflationRate: number;
  showInflation: boolean;
}

function money(value: number) {
  return new Intl.NumberFormat("en-HK", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function planPremium(
  plan: {
    enabled: boolean;
    statusString: string;
    premium: Record<string, Record<number, number>>;
    additionalPremium: number;
    currency: string;
  },
  age: number
) {
  if (!plan.enabled || !plan.statusString) return 0;
  const base = plan.premium[plan.statusString]?.[age] || 0;
  const loaded = base * (1 + plan.additionalPremium / 100);
  return plan.currency === "USD" ? loaded * 7.8 : loaded;
}

export function IllustrationResults({
  language,
  annualFixedCash,
  carryForward,
  carryRate,
  inflationRate,
  showInflation,
}: IllustrationResultsProps) {
  const { state } = useCalculator();
  const zh = language === "zh";

  const projection: FundingProjection = useMemo(() => {
    const infl = inflationRate / 100;
    return projectFunding({
      currentAge: state.currentAge,
      maxAge: state.maxAge,
      annualFixedCash,
      carryForward,
      carryRate,
      premiumAtAge: (age) => {
        const years = Math.max(0, age - state.currentAge);
        const factor = showInflation ? Math.pow(1 + infl, years) : 1;
        return (planPremium(state.planA, age) + planPremium(state.planB, age)) * factor;
      },
    });
  }, [
    annualFixedCash,
    carryForward,
    carryRate,
    inflationRate,
    showInflation,
    state.currentAge,
    state.maxAge,
    state.planA,
    state.planB,
  ]);

  const maxPremium = Math.max(1, ...projection.years.map((y) => Math.max(y.premium, y.cashIn)));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {zh ? "每年可用保證現金" : "Fixed annual cash"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">HKD {money(annualFixedCash)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {zh ? "可覆蓋年期" : "Years covered"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {projection.yearsCovered}
            <span className="block text-sm font-normal text-muted-foreground">
              {projection.shortfallAge == null
                ? zh
                  ? `至 ${state.maxAge} 歲仍足夠`
                  : `Covers through age ${state.maxAge}`
                : zh
                  ? `${projection.shortfallAge} 歲開始不足`
                  : `Shortfall at age ${projection.shortfallAge}`}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {zh ? "已覆蓋保費 / 投入現金" : "Premiums covered / cash used"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">
            {money(projection.premiumsCovered)}
            <span className="text-muted-foreground font-normal"> / {money(projection.totalCashDeployed)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {zh ? "現金槓桿" : "Cash leverage"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {projection.leverageRatio.toFixed(0)}%
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{zh ? "每年現金與保費" : "Cash vs premium by age"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projection.years
            .filter((_, index) => index % Math.max(1, Math.ceil(projection.years.length / 28)) === 0)
            .map((year) => (
            <div key={year.age} className="grid grid-cols-[3rem_1fr] gap-3 items-center text-xs">
              <span className={year.covered ? "" : "text-destructive font-medium"}>{year.age}</span>
              <div className="space-y-1">
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, (year.premium / maxPremium) * 100)}%` }}
                  />
                </div>
                <div className="h-2 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-600"
                    style={{ width: `${Math.min(100, (year.cashIn / maxPremium) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2">
            {zh ? "上：醫療保費　下：每年保證現金" : "Top: medical premium. Bottom: annual guaranteed cash."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{zh ? "逐年明細" : "Year-by-year"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">{zh ? "年齡" : "Age"}</th>
                <th className="py-2 pr-3">{zh ? "保費" : "Premium"}</th>
                <th className="py-2 pr-3">{zh ? "可用現金" : "Available"}</th>
                <th className="py-2 pr-3">{zh ? "結餘" : "Surplus"}</th>
              </tr>
            </thead>
            <tbody>
              {projection.years.map((year) => (
                <tr key={year.age} className={`border-b last:border-0 ${year.covered ? "" : "bg-destructive/10"}`}>
                  <td className="py-1 pr-3">{year.age}</td>
                  <td className="py-1 pr-3">{money(year.premium)}</td>
                  <td className="py-1 pr-3">{money(year.available)}</td>
                  <td className="py-1 pr-3">{money(year.surplus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
