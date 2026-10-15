"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Lang = "en" | "zh";
type PlanKind = "standard" | "flexi";

interface CurvePoint { plan_kind: PlanKind; status: string; age: number; p25: number; median: number; p75: number; plans: number }
interface LifetimePlan {
  certification_no: string; plan_kind: PlanKind; company_name_en: string; company_name_zh: string;
  plan_name_en: string; plan_name_zh: string; type_en: string; total: number;
}
interface InsurerPricing {
  company_name_en: string; company_name_zh: string; male_smoker_loading: number | null;
  female_smoker_loading: number | null; female_to_male_ratio: number | null; plans: number;
}
interface Summary {
  generated_at: string;
  plans_by_currency: Record<string, number>;
  insurers: number;
  rows: number;
  cells_by_source: Record<string, number>;
  curve: CurvePoint[];
  lifetime_40_99_male_non_smoker: LifetimePlan[];
  median_yearly_increase_by_age: { age: number; median_increase_pct: number }[];
  insurers_pricing: InsurerPricing[];
}
interface QualityReport { run_at: string; passed: boolean; checks: { check: string; passed: boolean }[] }

const BLUE = "#3b82f6";
const PINK = "#ec4899";
const GREEN = "#22c55e";

const money = (n: number) => `HK$${Math.round(n).toLocaleString("en-HK")}`;
const shorten = (s: string) => s.replace(/\s*(Limited|Company|Co\.,?|Insurance|\(Bermuda\)|\(International\))\s*/gi, " ").replace(/(有限公司|保險)/g, "").trim();

export function InsightsView() {
  const [language, setLanguage] = useState<Lang>("zh");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [kind, setKind] = useState<PlanKind>("standard");
  const [error, setError] = useState(false);
  const { resolvedTheme } = useTheme();
  const t = (en: string, zh: string) => (language === "en" ? en : zh);

  useEffect(() => {
    fetch("/data/insights/summary.json").then((r) => r.json()).then(setSummary).catch(() => setError(true));
    fetch("/data/quality-report.json").then((r) => (r.ok ? r.json() : null)).then(setQuality).catch(() => null);
  }, []);

  const ink = resolvedTheme === "dark" ? "#e5e7eb" : "#1f2937";
  const grid = resolvedTheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const baseLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: ink, family: "inherit" },
    margin: { l: 60, r: 20, t: 10, b: 50 },
    xaxis: { gridcolor: grid },
    yaxis: { gridcolor: grid },
    legend: { orientation: "h" as const, y: -0.2 },
  };

  const findings = useMemo(() => {
    if (!summary) return null;
    const growth = summary.median_yearly_increase_by_age.filter((g) => g.age >= 30 && g.age <= 99);
    const peak = growth.reduce((a, b) => (b.median_increase_pct > a.median_increase_pct ? b : a), growth[0]);
    const life = summary.lifetime_40_99_male_non_smoker.filter((p) => p.plan_kind === "standard");
    const cheapest = life[0];
    const dearest = life[life.length - 1];
    const priced = summary.insurers_pricing.filter((i) => i.female_to_male_ratio != null);
    const femaleHigher = priced.filter((i) => (i.female_to_male_ratio ?? 1) > 1.005).length;
    const smokerLoaded = summary.insurers_pricing.filter(
      (i) => (i.male_smoker_loading ?? 1) > 1.005 || (i.female_smoker_loading ?? 1) > 1.005).length;
    return { peak, cheapest, dearest, standardCount: life.length, femaleHigher, priced: priced.length, smokerLoaded };
  }, [summary]);

  const curve = summary?.curve.filter((c) => c.plan_kind === kind && c.age <= 99) ?? [];
  const series = (status: string) => curve.filter((c) => c.status === status);

  return (
    <div className={cn("flex flex-col w-full min-h-screen", "animate-in fade-in duration-500")}>
      <AppHeader language={language} setLanguage={setLanguage} />
      <div className="container max-w-7xl mx-auto px-4 py-6 flex-1 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("VHIS market insights", "自願醫保市場數據分析")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t(
              "Every certified VHIS plan's premium table, from government open data extended with insurers' premium PDFs. Hong Kong dollar plans only.",
              "所有認可自願醫保計劃的保費表，以政府開放數據為基礎，並以保險公司保費表補充較高年齡。只計港元計劃。"
            )}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{t("Could not load the data.", "未能載入數據。")}</p>}

        {summary && findings && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label={t("Plans (HKD / USD)", "計劃（港元 / 美元）")}
                value={`${summary.plans_by_currency.HKD ?? 0} / ${summary.plans_by_currency.USD ?? 0}`} />
              <Stat label={t("Insurers", "保險公司")} value={String(summary.insurers)} />
              <Stat label={t("Premium cells", "保費數據點")} value={summary.rows.toLocaleString("en-HK")}
                note={t(`${Math.round((summary.cells_by_source.pdf / summary.rows) * 100)}% from insurer PDFs`,
                  `${Math.round((summary.cells_by_source.pdf / summary.rows) * 100)}% 來自保險公司保費表`)} />
              <Stat label={t("Quality checks", "數據質素檢查")}
                value={quality ? `${quality.checks.filter((c) => c.passed).length} / ${quality.checks.length}` : "–"}
                note={quality ? t(`Last run ${quality.run_at.slice(0, 10)}`, `最近一次：${quality.run_at.slice(0, 10)}`) : undefined} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t("Key findings", "主要發現")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 space-y-2 text-sm">
                  <li>{t(
                    `Premiums rise fastest around age ${findings.peak.age}: the median plan goes up ${findings.peak.median_increase_pct}% in that year. The yearly rise slows after that, but by then the premium itself is already large.`,
                    `保費在 ${findings.peak.age} 歲左右升得最快，中位數計劃當年加 ${findings.peak.median_increase_pct}%。之後每年升幅放緩，但保費金額已經很高。`)}</li>
                  <li>{t(
                    `For a non-smoking man from 40 to 99, the cheapest of ${findings.standardCount} Standard Plans costs ${money(findings.cheapest.total)} in total (${findings.cheapest.company_name_en}); the dearest costs ${money(findings.dearest.total)}. Same certified cover, ${(findings.dearest.total / findings.cheapest.total).toFixed(1)} times the price.`,
                    `以不吸煙男士由 40 歲供到 99 歲計，${findings.standardCount} 個標準計劃之中最平的總保費為 ${money(findings.cheapest.total)}（${findings.cheapest.company_name_zh}），最貴的為 ${money(findings.dearest.total)}。同一套認可保障，價錢相差 ${(findings.dearest.total / findings.cheapest.total).toFixed(1)} 倍。`)}</li>
                  <li>{t(
                    `${findings.femaleHigher} of ${findings.priced} insurers charge women more than men at ages 30–60.`,
                    `${findings.priced} 間保險公司之中，有 ${findings.femaleHigher} 間在 30 至 60 歲向女士收較高保費。`)}</li>
                  <li>{findings.smokerLoaded === 0
                    ? t("No insurer charges smokers more at ages 30–60.", "30 至 60 歲期間，沒有保險公司向吸煙人士收較高保費。")
                    : t(`${findings.smokerLoaded} insurers charge smokers more at ages 30–60.`,
                      `有 ${findings.smokerLoaded} 間保險公司在 30 至 60 歲向吸煙人士收較高保費。`)}</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle>{t("Annual premium by age", "各年齡的每年保費")}</CardTitle>
                  <CardDescription>
                    {t("Median across plans, with the middle 50% shaded. Non-smokers.",
                      "各計劃的中位數，陰影為中間 50% 的計劃。不吸煙人士。")}
                  </CardDescription>
                </div>
                <div className="flex rounded-md border text-sm overflow-hidden shrink-0">
                  {(["standard", "flexi"] as PlanKind[]).map((k) => (
                    <button key={k} onClick={() => setKind(k)}
                      className={cn("px-3 py-1", kind === k ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                      {k === "standard" ? t("Standard", "標準計劃") : t("Flexi", "靈活計劃")}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <Plot
                  data={[
                    ...[["SMN", BLUE, t("Male", "男")], ["SFN", PINK, t("Female", "女")]].flatMap(([st, color, name]) => {
                      const s = series(st);
                      return [
                        { x: s.map((p) => p.age), y: s.map((p) => p.p75), mode: "lines", line: { width: 0 },
                          hoverinfo: "skip", showlegend: false, type: "scatter" },
                        { x: s.map((p) => p.age), y: s.map((p) => p.p25), mode: "lines", line: { width: 0 },
                          fill: "tonexty", fillcolor: `${color}22`, hoverinfo: "skip", showlegend: false, type: "scatter" },
                        { x: s.map((p) => p.age), y: s.map((p) => p.median), mode: "lines", name,
                          line: { color, width: 2.5 }, type: "scatter",
                          hovertemplate: `${name} %{x}: HK$%{y:,.0f}<extra></extra>` },
                      ];
                    }),
                  ] as Plotly.Data[]}
                  layout={{
                    ...baseLayout,
                    height: 380,
                    xaxis: { ...baseLayout.xaxis, title: { text: t("Age", "年齡") } },
                    yaxis: { ...baseLayout.yaxis, title: { text: "HK$" }, tickformat: ",.0f" },
                  }}
                  config={{ responsive: true, displayModeBar: false }}
                  className="w-full"
                />
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t("How fast premiums rise each year", "保費每年加幅")}</CardTitle>
                  <CardDescription>
                    {t("Median increase from one age to the next. Male non-smoker.",
                      "由一歲到下一歲的加幅中位數。不吸煙男士。")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Plot
                    data={[{
                      x: summary.median_yearly_increase_by_age.map((g) => g.age),
                      y: summary.median_yearly_increase_by_age.map((g) => g.median_increase_pct),
                      type: "bar", marker: { color: GREEN },
                      hovertemplate: `%{x}: +%{y}%<extra></extra>`,
                    }]}
                    layout={{
                      ...baseLayout,
                      height: 320,
                      xaxis: { ...baseLayout.xaxis, title: { text: t("Age", "年齡") } },
                      yaxis: { ...baseLayout.yaxis, title: { text: "%" }, ticksuffix: "%" },
                    }}
                    config={{ responsive: true, displayModeBar: false }}
                    className="w-full"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("Women vs men, by insurer", "各保險公司的女男保費比率")}</CardTitle>
                  <CardDescription>
                    {t("Female premium ÷ male premium, ages 30–60. Above 1 means women pay more.",
                      "女士保費 ÷ 男士保費，30 至 60 歲。大於 1 代表女士較貴。")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const rows = summary.insurers_pricing
                      .filter((i) => i.female_to_male_ratio != null)
                      .sort((a, b) => (a.female_to_male_ratio ?? 0) - (b.female_to_male_ratio ?? 0));
                    return (
                      <Plot
                        data={[{
                          y: rows.map((i) => (language === "en" ? i.company_name_en : i.company_name_zh)),
                          x: rows.map((i) => i.female_to_male_ratio as number),
                          type: "bar", orientation: "h",
                          marker: { color: rows.map((i) => ((i.female_to_male_ratio ?? 1) > 1 ? PINK : BLUE)) },
                          hovertemplate: `%{y}: %{x:.3f}<extra></extra>`,
                        }]}
                        layout={{
                          ...baseLayout,
                          height: Math.max(320, rows.length * 18),
                          margin: { l: 10, r: 20, t: 10, b: 40 },
                          xaxis: { ...baseLayout.xaxis, range: [0.8, Math.max(1.3, ...rows.map((i) => i.female_to_male_ratio as number))] },
                          yaxis: { ...baseLayout.yaxis, automargin: true, tickfont: { size: 10 } },
                          shapes: [{ type: "line", x0: 1, x1: 1, yref: "paper", y0: 0, y1: 1, line: { color: ink, dash: "dot", width: 1 } }],
                        }}
                        config={{ responsive: true, displayModeBar: false }}
                        className="w-full"
                      />
                    );
                  })()}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t("Lifetime cost, age 40 to 99", "40 至 99 歲總保費")}</CardTitle>
                <CardDescription>
                  {t("Total premiums for a male non-smoker. The 15 cheapest plans of the selected type; plans that do not publish premiums to 99 are left out.",
                    "不吸煙男士的總保費。顯示所選類型最便宜的 15 個計劃；未有公佈至 99 歲保費的計劃不計在內。")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  const rows = summary.lifetime_40_99_male_non_smoker
                    .filter((p) => p.plan_kind === kind).slice(0, 15).reverse();
                  return (
                    <Plot
                      data={[{
                        y: rows.map((p) => p.certification_no),
                        x: rows.map((p) => p.total),
                        customdata: rows.map((p) => (language === "en"
                          ? `${p.company_name_en}<br>${p.plan_name_en}`
                          : `${p.company_name_zh}<br>${p.plan_name_zh}`)),
                        text: rows.map((p) => shorten(language === "en" ? p.company_name_en : p.company_name_zh)),
                        textposition: "inside", insidetextanchor: "start",
                        type: "bar", orientation: "h", marker: { color: BLUE },
                        hovertemplate: `%{customdata}<br>%{y}<br>HK$%{x:,.0f}<extra></extra>`,
                        textfont: { color: "#ffffff", size: 11 },
                      }]}
                      layout={{
                        ...baseLayout,
                        height: 460,
                        margin: { l: 10, r: 20, t: 10, b: 40 },
                        xaxis: { ...baseLayout.xaxis, tickformat: ",.0f", tickprefix: "HK$" },
                        yaxis: { ...baseLayout.yaxis, automargin: true, tickfont: { size: 10 } },
                      }}
                      config={{ responsive: true, displayModeBar: false }}
                      className="w-full"
                    />
                  );
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("How the data is built", "數據如何建立")}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>{t(
                  "Each month a PySpark pipeline downloads the government's VHIS open data and every insurer's premium-table PDF. The government data usually stops around age 80; older ages come from the PDFs, but only where a PDF column matches the government premiums within 1% over the last five government ages.",
                  "每月由 PySpark 數據管道下載政府自願醫保開放數據，以及每間保險公司的保費表 PDF。政府數據通常只到 80 歲左右；較高年齡取自保費表，但只限保費表與政府數據在最後五個年齡相差少於 1% 的欄目。")}</p>
                <p>{t(
                  "A set of quality checks runs before anything is published, and a failed check stops the release. Figures are for comparison only and are not insurance advice; always confirm premiums with the insurer.",
                  "數據發佈前須通過一系列質素檢查，任何一項不合格都不會發佈。數字只供比較，並非保險建議；投保前請向保險公司確認保費。")}</p>
                <p>{t(`Data generated ${summary.generated_at.slice(0, 10)}.`, `數據產生日期：${summary.generated_at.slice(0, 10)}。`)}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <footer className="border-t bg-background/50 backdrop-blur-sm">
        <div className="container max-w-7xl mx-auto px-4 py-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} MedSav
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
      </CardContent>
    </Card>
  );
}
