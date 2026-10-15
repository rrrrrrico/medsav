"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { RotateCcw } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Lang = "en" | "zh";
type Kind = "s" | "f" | "r";
type Gender = "M" | "F";
type Smoker = "N" | "Y";
type Currency = "HKD" | "USD";
type Status = "SMN" | "SFN" | "SMY" | "SFY";
type Series = (number | null)[];

interface MatrixPlan {
  c: string; k: Kind; cur: Currency; i: number; n: [string, string]; t: [string, string];
  p: Partial<Record<Status, Series | Status>>;
}
interface Matrix { max_age: number; insurers: [string, string][]; plans: MatrixPlan[] }
interface Summary { generated_at: string; rows: number; cells_by_source: Record<string, number> }
interface QualityReport { run_at: string; checks: { check: string; passed: boolean }[] }
interface Profile { gender: Gender; smoker: Smoker; status: Status }

const COLORS: Record<Status, string> = { SMN: "#3b82f6", SFN: "#ec4899", SMY: "#1e3a8a", SFY: "#9d174d" };
const DASH: Record<Smoker, string> = { N: "solid", Y: "dash" };
const MIN_PLANS = 3;
const DEFAULTS = {
  currency: "HKD" as Currency,
  kinds: ["s", "f"] as Kind[],
  genders: ["M", "F"] as Gender[],
  smokers: ["N"] as Smoker[],
  insurer: "all",
  ages: [40, 99] as [number, number],
};

function series(plan: MatrixPlan, status: Status): Series | null {
  let v = plan.p[status];
  for (let hops = 0; typeof v === "string" && hops < 4; hops++) v = plan.p[v];
  return Array.isArray(v) ? v : null;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

function lifetime(s: Series | null, from: number, to: number): number | null {
  if (!s) return null;
  let total = 0;
  for (let a = from; a <= to; a++) {
    const v = s[a];
    if (v == null) return null;
    total += v;
  }
  return total;
}

const shorten = (s: string) =>
  s.replace(/\s*(Limited|Company|Co\.,?|Insurance|\(Bermuda\)|\(International\))\s*/gi, " ").replace(/(有限公司|保險)/g, "").trim();

export function InsightsView() {
  const [language, setLanguage] = useState<Lang>("zh");
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [error, setError] = useState(false);

  const [currency, setCurrency] = useState<Currency>(DEFAULTS.currency);
  const [kinds, setKinds] = useState<Kind[]>(DEFAULTS.kinds);
  const [genders, setGenders] = useState<Gender[]>(DEFAULTS.genders);
  const [smokers, setSmokers] = useState<Smoker[]>(DEFAULTS.smokers);
  const [insurer, setInsurer] = useState<string>(DEFAULTS.insurer);
  const [ages, setAges] = useState<[number, number]>(DEFAULTS.ages);
  const [ranking, setRanking] = useState<"cheapest" | "dearest">("cheapest");
  const [comparison, setComparison] = useState<"gender" | "smoker">("gender");

  const { resolvedTheme } = useTheme();
  const t = (en: string, zh: string) => (language === "en" ? en : zh);
  const zh = language === "zh";

  useEffect(() => {
    fetch("/data/insights/matrix.json").then((r) => r.json()).then(setMatrix).catch(() => setError(true));
    fetch("/data/insights/summary.json").then((r) => r.json()).then(setSummary).catch(() => null);
    fetch("/data/quality-report.json").then((r) => (r.ok ? r.json() : null)).then(setQuality).catch(() => null);
  }, []);

  const reset = () => {
    setCurrency(DEFAULTS.currency); setKinds(DEFAULTS.kinds); setGenders(DEFAULTS.genders);
    setSmokers(DEFAULTS.smokers); setInsurer(DEFAULTS.insurer); setAges(DEFAULTS.ages);
  };

  const [from, to] = ages;
  const money = (n: number) => `${currency === "HKD" ? "HK$" : "US$"}${Math.round(n).toLocaleString("en-HK")}`;
  const insurerName = (i: number) => (matrix ? matrix.insurers[i][zh ? 1 : 0] : "");

  const profiles: Profile[] = useMemo(
    () => genders.flatMap((gender) => smokers.map((smoker) => ({ gender, smoker, status: `S${gender}${smoker}` as Status }))),
    [genders, smokers]);
  const primary = profiles[0];
  const profileLabel = (p: Profile) =>
    `${p.gender === "M" ? t("Male", "男") : t("Female", "女")} · ${p.smoker === "N" ? t("non-smoker", "不吸煙") : t("smoker", "吸煙")}`;

  const insurerOptions = useMemo(() => {
    if (!matrix) return [];
    const used = new Set(matrix.plans.filter((p) => p.cur === currency && kinds.includes(p.k)).map((p) => p.i));
    return Array.from(used).map((i) => ({ i, label: matrix.insurers[i][zh ? 1 : 0] })).sort((a, b) => a.label.localeCompare(b.label));
  }, [matrix, currency, kinds, zh]);

  const plans = useMemo(() => {
    if (!matrix) return [];
    return matrix.plans.filter((p) =>
      p.cur === currency && kinds.includes(p.k) && (insurer === "all" || String(p.i) === insurer));
  }, [matrix, currency, kinds, insurer]);

  const curves = useMemo(() => profiles.map((profile) => {
    const points: { age: number; p25: number; median: number; p75: number; n: number }[] = [];
    for (let age = from; age <= to; age++) {
      const values = plans.map((p) => series(p, profile.status)?.[age]).filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      if (values.length >= Math.min(MIN_PLANS, plans.length) && values.length > 0) {
        points.push({ age, p25: quantile(values, 0.25), median: quantile(values, 0.5), p75: quantile(values, 0.75), n: values.length });
      }
    }
    return { profile, points };
  }), [plans, profiles, from, to]);

  const growth = useMemo(() => profiles.map((profile) => {
    const points: { age: number; pct: number }[] = [];
    for (let age = Math.max(from, 1); age <= to; age++) {
      const changes = plans.map((p) => {
        const s = series(p, profile.status);
        const prev = s?.[age - 1];
        const cur = s?.[age];
        return prev && cur ? (cur / prev - 1) * 100 : null;
      }).filter((v): v is number => v != null);
      if (changes.length >= Math.min(MIN_PLANS, plans.length) && changes.length > 0) {
        points.push({ age, pct: Math.round(median(changes) * 100) / 100 });
      }
    }
    return { profile, points };
  }), [plans, profiles, from, to]);

  const totals = useMemo(() => {
    if (!primary) return [];
    return plans.map((p) => ({ plan: p, total: lifetime(series(p, primary.status), from, to) }))
      .filter((r): r is { plan: MatrixPlan; total: number } => r.total != null)
      .sort((a, b) => a.total - b.total);
  }, [plans, primary, from, to]);

  const ratios = useMemo(() => {
    if (!matrix || !primary) return [];
    const [num, den]: [Status, Status] = comparison === "gender"
      ? [`SF${primary.smoker}` as Status, `SM${primary.smoker}` as Status]
      : [`S${primary.gender}Y` as Status, `S${primary.gender}N` as Status];
    const byInsurer = new Map<number, number[]>();
    for (const p of plans) {
      const a = series(p, num);
      const b = series(p, den);
      if (!a || !b) continue;
      const r: number[] = [];
      for (let age = from; age <= to; age++) {
        if (a[age] != null && b[age]) r.push((a[age] as number) / (b[age] as number));
      }
      if (r.length) byInsurer.set(p.i, [...(byInsurer.get(p.i) ?? []), r.reduce((x, y) => x + y, 0) / r.length]);
    }
    return Array.from(byInsurer.entries())
      .map(([i, xs]) => ({ i, ratio: Math.round(median(xs) * 1000) / 1000, plans: xs.length }))
      .sort((a, b) => a.ratio - b.ratio);
  }, [matrix, plans, primary, comparison, from, to]);

  const findings = useMemo(() => {
    const g = growth[0]?.points ?? [];
    const peak = g.length ? g.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const cheapest = totals[0];
    const dearest = totals[totals.length - 1];
    const higher = ratios.filter((r) => r.ratio > 1.005).length;
    return { peak, cheapest, dearest, higher };
  }, [growth, totals, ratios]);

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
  const plotConfig = { responsive: true, displayModeBar: false };
  const curSymbol = currency === "HKD" ? "HK$" : "US$";

  const ranked = ranking === "cheapest" ? totals.slice(0, 15) : totals.slice(-15).reverse();
  const insurerCount = new Set(plans.map((p) => p.i)).size;

  return (
    <div className={cn("flex flex-col w-full min-h-screen", "animate-in fade-in duration-500")}>
      <AppHeader language={language} setLanguage={setLanguage} />
      <div className="container max-w-7xl mx-auto px-4 py-6 flex-1 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("VHIS market insights", "自願醫保市場數據分析")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("Every certified VHIS plan's premium table, from government open data extended with insurers' premium PDFs. Use the filters; every chart updates.",
              "所有認可自願醫保計劃的保費表，以政府開放數據為基礎，並以保險公司保費表補充較高年齡。使用篩選條件，所有圖表會即時更新。")}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{t("Could not load the data.", "未能載入數據。")}</p>}

        {matrix && (
          <>
            <Card className="lg:sticky lg:top-20 z-40 bg-background/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[auto_auto_auto_auto_minmax(180px,1fr)_minmax(200px,1fr)_auto] xl:items-end">
                  <Filter label={t("Currency", "貨幣")}>
                    <Chips<Currency> options={[["HKD", t("HKD", "港元")], ["USD", t("USD", "美元")]]}
                      selected={[currency]} onToggle={(v) => { setCurrency(v); setInsurer("all"); }} />
                  </Filter>
                  <Filter label={t("Plan type", "計劃類型")}>
                    <Chips<Kind> multiple options={[["s", t("Standard", "標準")], ["f", t("Flexi", "靈活")], ["r", t("Rider", "附加")]]}
                      selected={kinds} onToggle={(v) => { setKinds(toggle(kinds, v)); setInsurer("all"); }} />
                  </Filter>
                  <Filter label={t("Gender", "性別")}>
                    <Chips<Gender> multiple options={[["M", t("Male", "男")], ["F", t("Female", "女")]]}
                      selected={genders} onToggle={(v) => setGenders(toggle(genders, v))} />
                  </Filter>
                  <Filter label={t("Smoker", "吸煙")}>
                    <Chips<Smoker> multiple options={[["N", t("Non-smoker", "不吸煙")], ["Y", t("Smoker", "吸煙")]]}
                      selected={smokers} onToggle={(v) => setSmokers(toggle(smokers, v))} />
                  </Filter>
                  <Filter label={t("Insurer", "保險公司")}>
                    <Select value={insurer} onValueChange={setInsurer}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("All insurers", "所有保險公司")}</SelectItem>
                        {insurerOptions.map((o) => <SelectItem key={o.i} value={String(o.i)}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Filter>
                  <Filter label={`${t("Age range", "年齡範圍")}: ${from}–${to}`}>
                    <Slider min={0} max={matrix.max_age} step={1} minStepsBetweenThumbs={1} value={ages}
                      onValueChange={(v) => setAges([v[0], v[1]] as [number, number])} className="py-2" />
                  </Filter>
                  <Button variant="ghost" size="sm" onClick={reset} className="justify-self-start">
                    <RotateCcw className="size-4 mr-1" />{t("Reset", "重設")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label={t("Plans matching", "符合條件的計劃")} value={String(plans.length)}
                note={t(`${insurerCount} insurers`, `${insurerCount} 間保險公司`)} />
              <Stat label={t(`Cheapest, ages ${from}–${to}`, `${from}–${to} 歲最低總保費`)}
                value={findings.cheapest ? money(findings.cheapest.total) : "–"}
                note={primary ? profileLabel(primary) : undefined} />
              <Stat label={t(`Median, ages ${from}–${to}`, `${from}–${to} 歲總保費中位數`)}
                value={totals.length ? money(median(totals.map((r) => r.total))) : "–"}
                note={t(`${totals.length} plans priced for every age`, `${totals.length} 個計劃有齊每歲保費`)} />
              <Stat label={t("Quality checks", "數據質素檢查")}
                value={quality ? `${quality.checks.filter((c) => c.passed).length} / ${quality.checks.length}` : "–"}
                note={summary ? t(`${summary.rows.toLocaleString("en-HK")} premium cells`, `${summary.rows.toLocaleString("en-HK")} 個保費數據點`) : undefined} />
            </div>

            {plans.length === 0 ? (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">
                {t("No plans match these filters.", "沒有計劃符合這些篩選條件。")}
              </CardContent></Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{t("Key findings for this selection", "此篩選條件下的主要發現")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc pl-5 space-y-2 text-sm">
                      {findings.peak && primary && (
                        <li>{t(
                          `For a ${primary.smoker === "N" ? "non-smoking" : "smoking"} ${primary.gender === "M" ? "man" : "woman"}, premiums rise fastest at age ${findings.peak.age}: the median plan goes up ${findings.peak.pct}% that year.`,
                          `以${profileLabel(primary)}計，保費在 ${findings.peak.age} 歲升得最快，中位數計劃當年加 ${findings.peak.pct}%。`)}</li>
                      )}
                      {findings.cheapest && findings.dearest && totals.length > 1 && (
                        <li>{t(
                          `Paying from ${from} to ${to}, the cheapest of ${totals.length} plans costs ${money(findings.cheapest.total)} (${insurerName(findings.cheapest.plan.i)}) and the dearest ${money(findings.dearest.total)}, ${(findings.dearest.total / findings.cheapest.total).toFixed(1)} times as much.`,
                          `由 ${from} 歲供到 ${to} 歲，${totals.length} 個計劃之中最平的總保費為 ${money(findings.cheapest.total)}（${insurerName(findings.cheapest.plan.i)}），最貴的為 ${money(findings.dearest.total)}，相差 ${(findings.dearest.total / findings.cheapest.total).toFixed(1)} 倍。`)}</li>
                      )}
                      {ratios.length > 0 && (
                        <li>{comparison === "gender"
                          ? t(`${findings.higher} of ${ratios.length} insurers charge women more than men at ages ${from}–${to}.`,
                            `${ratios.length} 間保險公司之中，有 ${findings.higher} 間在 ${from}–${to} 歲向女士收較高保費。`)
                          : t(`${findings.higher} of ${ratios.length} insurers charge smokers more at ages ${from}–${to}.`,
                            `${ratios.length} 間保險公司之中，有 ${findings.higher} 間在 ${from}–${to} 歲向吸煙人士收較高保費。`)}</li>
                      )}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t("Annual premium by age", "各年齡的每年保費")}</CardTitle>
                    <CardDescription>
                      {t("Median across matching plans, with the middle 50% shaded. One line per gender and smoker choice.",
                        "符合條件計劃的中位數，陰影為中間 50% 的計劃。每個性別及吸煙組合一條線。")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Plot
                      data={curves.flatMap(({ profile, points }) => {
                        const color = COLORS[profile.status];
                        const name = profileLabel(profile);
                        return [
                          { x: points.map((p) => p.age), y: points.map((p) => p.p75), mode: "lines", line: { width: 0 },
                            hoverinfo: "skip", showlegend: false, type: "scatter" },
                          { x: points.map((p) => p.age), y: points.map((p) => p.p25), mode: "lines", line: { width: 0 },
                            fill: "tonexty", fillcolor: `${color}1f`, hoverinfo: "skip", showlegend: false, type: "scatter" },
                          { x: points.map((p) => p.age), y: points.map((p) => p.median), customdata: points.map((p) => p.n),
                            mode: "lines", name, type: "scatter", line: { color, width: 2.5, dash: DASH[profile.smoker] },
                            hovertemplate: `${name}, %{x}: ${curSymbol}%{y:,.0f} (%{customdata} ${t("plans", "個計劃")})<extra></extra>` },
                        ];
                      }) as Plotly.Data[]}
                      layout={{
                        ...baseLayout,
                        height: 380,
                        showlegend: true,
                        xaxis: { ...baseLayout.xaxis, title: { text: t("Age", "年齡") } },
                        yaxis: { ...baseLayout.yaxis, title: { text: curSymbol }, tickformat: ",.0f" },
                      }}
                      config={plotConfig}
                      className="w-full"
                    />
                  </CardContent>
                </Card>

                <div className="grid lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("How fast premiums rise each year", "保費每年加幅")}</CardTitle>
                      <CardDescription>
                        {t("Median increase from one age to the next.", "由一歲到下一歲的加幅中位數。")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Plot
                        data={growth.map(({ profile, points }) => (growth.length === 1
                          ? { x: points.map((p) => p.age), y: points.map((p) => p.pct), type: "bar", name: profileLabel(profile),
                              marker: { color: COLORS[profile.status] }, hovertemplate: `%{x}: %{y}%<extra></extra>` }
                          : { x: points.map((p) => p.age), y: points.map((p) => p.pct), type: "scatter", mode: "lines",
                              name: profileLabel(profile), line: { color: COLORS[profile.status], dash: DASH[profile.smoker] },
                              hovertemplate: `${profileLabel(profile)}, %{x}: %{y}%<extra></extra>` })) as Plotly.Data[]}
                        layout={{
                          ...baseLayout,
                          height: 340,
                          showlegend: growth.length > 1,
                          xaxis: { ...baseLayout.xaxis, title: { text: t("Age", "年齡") } },
                          yaxis: { ...baseLayout.yaxis, ticksuffix: "%" },
                        }}
                        config={plotConfig}
                        className="w-full"
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                      <div>
                        <CardTitle>{t("Pricing by insurer", "各保險公司定價比較")}</CardTitle>
                        <CardDescription>
                          {comparison === "gender"
                            ? t(`Women's premium ÷ men's, ${primary?.smoker === "Y" ? "smokers" : "non-smokers"}, ages ${from}–${to}. Above 1 means women pay more.`,
                              `女士保費 ÷ 男士保費（${primary?.smoker === "Y" ? "吸煙" : "不吸煙"}），${from}–${to} 歲。大於 1 代表女士較貴。`)
                            : t(`Smoker premium ÷ non-smoker, ${primary?.gender === "F" ? "women" : "men"}, ages ${from}–${to}. Above 1 means smokers pay more.`,
                              `吸煙保費 ÷ 不吸煙保費（${primary?.gender === "F" ? "女士" : "男士"}），${from}–${to} 歲。大於 1 代表吸煙人士較貴。`)}
                        </CardDescription>
                      </div>
                      <Chips<"gender" | "smoker"> options={[["gender", t("Women ÷ men", "女 ÷ 男")], ["smoker", t("Smoker ÷ non", "吸煙 ÷ 不吸煙")]]}
                        selected={[comparison]} onToggle={setComparison} />
                    </CardHeader>
                    <CardContent>
                      <Plot
                        data={[{
                          y: ratios.map((r) => shorten(insurerName(r.i))),
                          x: ratios.map((r) => r.ratio),
                          customdata: ratios.map((r) => r.plans),
                          type: "bar", orientation: "h",
                          marker: { color: ratios.map((r) => (r.ratio > 1.005 ? "#ec4899" : r.ratio < 0.995 ? "#3b82f6" : "#9ca3af")) },
                          hovertemplate: `%{y}: %{x:.3f} (%{customdata} ${t("plans", "個計劃")})<extra></extra>`,
                        }]}
                        layout={{
                          ...baseLayout,
                          height: Math.max(300, ratios.length * 18 + 60),
                          margin: { l: 10, r: 20, t: 10, b: 40 },
                          xaxis: { ...baseLayout.xaxis, range: [
                            Math.min(0.8, ...ratios.map((r) => r.ratio - 0.05)),
                            Math.max(1.3, ...ratios.map((r) => r.ratio + 0.05))] },
                          yaxis: { ...baseLayout.yaxis, automargin: true, tickfont: { size: 10 } },
                          shapes: [{ type: "line", x0: 1, x1: 1, yref: "paper", y0: 0, y1: 1, line: { color: ink, dash: "dot", width: 1 } }],
                        }}
                        config={plotConfig}
                        className="w-full"
                      />
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                      <CardTitle>{t(`Total premiums, age ${from} to ${to}`, `${from} 至 ${to} 歲總保費`)}</CardTitle>
                      <CardDescription>
                        {t(`${primary ? profileLabel(primary) : ""}. Plans that do not publish a premium for every age in the range are left out.`,
                          `${primary ? profileLabel(primary) : ""}。未有公佈範圍內每一歲保費的計劃不計在內。`)}
                      </CardDescription>
                    </div>
                    <Chips<"cheapest" | "dearest"> options={[["cheapest", t("Cheapest 15", "最便宜 15 個")], ["dearest", t("Dearest 15", "最貴 15 個")]]}
                      selected={[ranking]} onToggle={setRanking} />
                  </CardHeader>
                  <CardContent>
                    {ranked.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("No plan has a premium for every age in this range.", "沒有計劃有齊此範圍內每一歲的保費。")}</p>
                    ) : (
                      <Plot
                        data={[{
                          y: [...ranked].reverse().map((r) => r.plan.c),
                          x: [...ranked].reverse().map((r) => r.total),
                          text: [...ranked].reverse().map((r) => shorten(insurerName(r.plan.i))),
                          customdata: [...ranked].reverse().map((r) =>
                            `${insurerName(r.plan.i)}<br>${r.plan.n[zh ? 1 : 0]}<br>${r.plan.t[zh ? 1 : 0]}`),
                          textposition: "inside", insidetextanchor: "start", textfont: { color: "#ffffff", size: 11 },
                          type: "bar", orientation: "h", marker: { color: primary ? COLORS[primary.status] : "#3b82f6" },
                          hovertemplate: `%{customdata}<br>%{y}<br>${curSymbol}%{x:,.0f}<extra></extra>`,
                        }]}
                        layout={{
                          ...baseLayout,
                          height: Math.max(260, ranked.length * 28 + 60),
                          margin: { l: 10, r: 20, t: 10, b: 40 },
                          xaxis: { ...baseLayout.xaxis, tickformat: ",.0f", tickprefix: curSymbol },
                          yaxis: { ...baseLayout.yaxis, automargin: true, tickfont: { size: 10 } },
                        }}
                        config={plotConfig}
                        className="w-full"
                      />
                    )}
                  </CardContent>
                </Card>
              </>
            )}

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
                {summary && <p>{t(`Data generated ${summary.generated_at.slice(0, 10)}.`, `數據產生日期：${summary.generated_at.slice(0, 10)}。`)}</p>}
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

function toggle<T>(list: T[], value: T): T[] {
  if (list.includes(value)) return list.length > 1 ? list.filter((v) => v !== value) : list;
  return [...list, value];
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Chips<T extends string>({ options, selected, onToggle, multiple = false }: {
  options: [T, string][]; selected: T[]; onToggle: (value: T) => void; multiple?: boolean;
}) {
  return (
    <div className="flex rounded-md border text-sm overflow-hidden shrink-0 w-fit" role={multiple ? "group" : "radiogroup"}>
      {options.map(([value, label]) => {
        const on = selected.includes(value);
        return (
          <button key={value} type="button" onClick={() => onToggle(value)}
            role={multiple ? "checkbox" : "radio"} aria-checked={on}
            className={cn("px-3 h-8 whitespace-nowrap border-l first:border-l-0",
              on ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
            {label}
          </button>
        );
      })}
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
