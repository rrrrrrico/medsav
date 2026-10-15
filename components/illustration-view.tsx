"use client";

import { useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { IllustrationResults } from "@/components/illustration-results";
import { PlanCalculator } from "@/components/plan-calculator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { CalculatorContext, calculateAge, defaultCalculatorState } from "@/lib/calculator-context";
import { annualFixedCashFromRows, emptyIllustrationRow, type IllustrationRow } from "@/lib/illustration";
import { cn } from "@/lib/utils";

const COLUMNS: { key: keyof Omit<IllustrationRow, "id">; zh: string; en: string; numeric: boolean }[] = [
  { key: "policyYearEnd", zh: "保單年度", en: "Year", numeric: false },
  { key: "totalPremiumPaid", zh: "繳付保費總額", en: "Premiums paid", numeric: true },
  { key: "guaranteedCashValueA", zh: "保證現金價值 (A)", en: "GCV (A)", numeric: true },
  { key: "accumulatedGuaranteedCashReserveB", zh: "累計保證現金儲備 (B)", en: "Reserve (B)", numeric: true },
  { key: "accumulatedInterestC", zh: "累積利息 (C)", en: "Interest (C)", numeric: true },
  { key: "terminalDividendD", zh: "終期紅利 (D)", en: "Terminal (D)", numeric: true },
  { key: "totalAmount", zh: "總額", en: "Total", numeric: true },
];

export function IllustrationView() {
  const [language, setLanguage] = useState<"en" | "zh">("zh");
  const [state, setState] = useState(defaultCalculatorState);
  const [rows, setRows] = useState<IllustrationRow[]>(() => [emptyIllustrationRow()]);
  const [annualFixedCash, setAnnualFixedCash] = useState(0);
  const [cashCurrency, setCashCurrency] = useState<"HKD" | "USD">("HKD");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [carryForward, setCarryForward] = useState(false);
  const [carryRate, setCarryRate] = useState(0);
  const [showInflation, setShowInflation] = useState(true);
  const [inflationRate, setInflationRate] = useState(2);
  const zh = language === "zh";

  const contextValue = useMemo(() => ({ state, setState }), [state]);
  const annualFixedCashHkd = cashCurrency === "USD" ? annualFixedCash * 7.8 : annualFixedCash;

  async function readImage(image: File | string) {
    setReading(true);
    setError(null);
    setProgress(0);
    try {
      const { recognizeIllustration } = await import("@/lib/recognize-illustration");
      const result = await recognizeIllustration(image, setProgress);
      setRows(result.rows);
      setAnnualFixedCash(result.annualFixedCash ?? annualFixedCashFromRows(result.rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : zh ? "無法讀取表格" : "Could not read the table");
    } finally {
      setReading(false);
    }
  }

  function onFile(next: File | null) {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!next) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!next.type.startsWith("image/")) {
      setFile(null);
      setPreviewUrl(null);
      setError(zh ? "請上傳圖片" : "Please upload an image");
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    void readImage(next);
  }

  function updateCell(id: string, key: keyof Omit<IllustrationRow, "id">, value: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const next = {
          ...row,
          [key]: key === "policyYearEnd" ? value : Number(value) || 0,
        };
        if (key === "accumulatedGuaranteedCashReserveB" && current[0]?.id === id) {
          setAnnualFixedCash(Number(value) || 0);
        }
        return next;
      })
    );
  }

  return (
    <CalculatorContext.Provider value={contextValue}>
      <div className={cn("flex flex-col w-full min-h-screen")}>
        <AppHeader language={language} setLanguage={setLanguage} />
        <div className="container max-w-7xl mx-auto px-4 py-6 flex-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{zh ? "上載儲蓄計劃建議書" : "Upload savings illustration"}</CardTitle>
              <CardDescription>
                {zh
                  ? "上載後會在瀏覽器內用 OCR 讀取表格，不會送到外部服務。第一行「累計保證現金儲備 (B)」是每年固定保證現金。"
                  : "OCR runs in your browser and does not call an external service. Year-1 accumulated guaranteed cash reserve (B) is the fixed cash available every year."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => onFile(event.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" disabled={!file || reading} onClick={() => file && readImage(file)}>
                  {reading ? (zh ? `讀取中 ${Math.round(progress * 100)}%` : `Reading ${Math.round(progress * 100)}%`) : zh ? "重新讀取" : "Read again"}
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              {previewUrl && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{zh ? "你的建議書" : "Your illustration"}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="" className="max-h-80 rounded border object-contain" />
                </div>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">{zh ? "例子：請上載這種退保價值表" : "Example: upload a table like this"}</p>
                <p className="text-sm text-muted-foreground">
                  {zh
                    ? "表內要有「累計保證現金儲備 (B)」。此例子第一行 B 是 2,746，就是每年固定保證現金。"
                    : "The table should include accumulated guaranteed cash reserve (B). In this example, year-1 B is 2,746 — that is the fixed annual cash."}
                </p>
                <Button type="button" variant="outline" disabled={reading} onClick={() => readImage("/examples/illustration-example.png")}>
                  {zh ? "用例子試一次" : "Try the example"}
                </Button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/examples/illustration-example.png"
                  alt={zh ? "儲蓄計劃退保價值表示例，第一行累計保證現金儲備為 2,746" : "Example surrender-value table. Year-1 accumulated guaranteed cash reserve is 2,746."}
                  className="max-h-52 w-auto max-w-full rounded border bg-white object-contain"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-600/40">
            <CardHeader>
              <CardTitle>{zh ? "每年固定保證現金" : "Fixed annual guaranteed cash"}</CardTitle>
              <CardDescription>
                {zh ? "取自建議書第一行的累計保證現金儲備 (B)。" : "Taken from the first row of column B."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex max-w-sm gap-2">
                <Select value={cashCurrency} onValueChange={(value: "HKD" | "USD") => setCashCurrency(value)}>
                  <SelectTrigger className="w-24" aria-label={zh ? "貨幣" : "Currency"}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HKD">HKD</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={annualFixedCash}
                  onChange={(event) => setAnnualFixedCash(Number(event.target.value) || 0)}
                />
              </div>
              {cashCurrency === "USD" && (
                <p className="text-sm text-muted-foreground">
                  ≈ HKD {new Intl.NumberFormat("en-HK", { maximumFractionDigits: 0 }).format(Math.round(annualFixedCashHkd))}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{zh ? "建議書明細（可修改）" : "Illustration (editable)"}</CardTitle>
                  <CardDescription>
                    {zh ? "總額欄是參考；計算使用上方的每年固定現金。" : "The total column is reference only. Funding uses the fixed annual cash above."}
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" onClick={() => setRows((current) => [...current, emptyIllustrationRow()])}>
                  {zh ? "加一行" : "Add row"}
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {COLUMNS.map((column) => (
                        <th key={column.key} className="p-1 text-left font-medium">
                          {zh ? column.zh : column.en}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {COLUMNS.map((column) => (
                          <td key={column.key} className="p-1">
                            <Input
                              className="h-8 min-w-[5.5rem]"
                              type={column.numeric ? "number" : "text"}
                              value={row[column.key]}
                              onChange={(event) => updateCell(row.id, column.key, event.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{zh ? "個人資料" : "Personal information"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{zh ? "性別" : "Gender"}</Label>
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={state.gender === "male"}
                        onChange={() => setState({ ...state, gender: "male" })}
                      />
                      {zh ? "男" : "Male"}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={state.gender === "female"}
                        onChange={() => setState({ ...state, gender: "female" })}
                      />
                      {zh ? "女" : "Female"}
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={state.isSmoker}
                    onCheckedChange={(checked) => setState({ ...state, isSmoker: checked })}
                  />
                  <Label>{zh ? "吸煙" : "Smoker"}</Label>
                </div>
                <div className="space-y-2">
                  <Label>{zh ? "出生日期" : "Date of birth"}</Label>
                  <Input
                    type="date"
                    value={state.birthDate}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(event) => {
                      const birthDate = event.target.value;
                      const currentAge = calculateAge(birthDate);
                      setState({ ...state, birthDate, currentAge });
                    }}
                  />
                  <p className="text-sm text-muted-foreground">
                    {zh ? "現時年齡：" : "Current age: "}
                    {state.currentAge}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>{zh ? "預期壽命" : "Maximum age"}</Label>
                    <span className="text-sm">{state.maxAge}</span>
                  </div>
                  <Slider
                    min={Math.max(state.currentAge, 50)}
                    max={100}
                    step={1}
                    value={[state.maxAge]}
                    onValueChange={(value) => setState({ ...state, maxAge: value[0] })}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{zh ? "現金運用" : "How cash is applied"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Switch checked={carryForward} onCheckedChange={setCarryForward} />
                  <Label>{zh ? "未用現金結轉" : "Carry unused cash forward"}</Label>
                </div>
                {carryForward && (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>{zh ? "結轉回報 %" : "Carry return %"}</Label>
                      <span className="text-sm">{carryRate.toFixed(1)}%</span>
                    </div>
                    <Slider min={0} max={10} step={0.1} value={[carryRate]} onValueChange={(value) => setCarryRate(value[0])} />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Switch checked={showInflation} onCheckedChange={setShowInflation} />
                  <Label>{zh ? "醫療保費通脹" : "Inflate medical premiums"}</Label>
                </div>
                {showInflation && (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>{zh ? "通脹率 %" : "Inflation %"}</Label>
                      <span className="text-sm">{inflationRate.toFixed(1)}%</span>
                    </div>
                    <Slider min={0} max={10} step={0.1} value={[inflationRate]} onValueChange={(value) => setInflationRate(value[0])} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PlanCalculator plan="A" language={language} />
            <PlanCalculator plan="B" language={language} />
          </div>

          <IllustrationResults
            language={language}
            annualFixedCash={annualFixedCashHkd}
            carryForward={carryForward}
            carryRate={carryRate}
            inflationRate={inflationRate}
            showInflation={showInflation}
          />
        </div>
      </div>
    </CalculatorContext.Provider>
  );
}
