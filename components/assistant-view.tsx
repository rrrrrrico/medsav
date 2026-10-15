"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, ChevronDown, Loader2, Send, User, Wrench } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Lang = "en" | "zh";
type Provider = "deepseek" | "qwen";

interface ToolStep { tool: string; args: Record<string, unknown>; ok: boolean }
interface Citation { id: string; title: string; url: string }
interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: ToolStep[];
  citations?: Citation[];
  meta?: string;
  error?: boolean;
}

const EXAMPLES: Record<Lang, string[]> = {
  en: [
    "Cheapest Standard Plan for a 45-year-old female non-smoker?",
    "Total premiums from 40 to 80 for a male smoker: the 5 cheapest Flexi Plans",
    "How much VHIS premium can I deduct from salaries tax?",
    "Does the Standard Plan cover pre-existing conditions?",
  ],
  zh: [
    "45歲女士不吸煙，最平嘅標準計劃係邊個？",
    "有幾多個計劃嘅保費表去到100歲以上？",
    "自願醫保保費可以扣稅嗎？上限係幾多？",
    "標準計劃保唔保投保前已有的病症？",
  ],
};

const TOOL_LABEL: Record<string, [string, string]> = {
  find_premiums: ["Looked up premiums at one age", "查詢某年齡的保費"],
  lifetime_cost: ["Added up premiums over an age range", "計算年齡範圍內的總保費"],
  plan_details: ["Looked up plan details", "查詢計劃資料"],
  compare_plans: ["Compared plans", "比較計劃"],
  plans_covering_age: ["Checked which plans reach an age", "查詢保費表涵蓋的年齡"],
  search_documents: ["Searched official VHIS documents", "搜尋自願醫保官方文件"],
};

function linkCitations(answer: string, citations: Citation[]): string {
  const order = citations.map((c) => c.id);
  return answer.replace(/\[(c\d{4})\]/g, (match, id: string) => {
    const n = order.indexOf(id);
    return n >= 0 ? `[[${n + 1}]](${citations[n].url})` : "";
  });
}

export function AssistantView() {
  const [language, setLanguage] = useState<Lang>("zh");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const t = (en: string, zh: string) => (language === "en" ? en : zh);

  useEffect(() => {
    fetch("/api/assistant").then((r) => r.json()).then((d) => {
      setProviders(d.providers ?? []);
      setProvider(d.default ?? null);
    }).catch(() => null);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history = [...turns.filter((x) => !x.error), { role: "user" as const, content }];
    setTurns([...turns, { role: "user", content }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error === "rate_limited"
          ? t("Too many questions in a short time. Please try again in a few minutes.", "短時間內問題太多，請過幾分鐘再試。")
          : t("Sorry, the assistant could not answer just now. Please try again.", "抱歉，助手暫時未能回答，請再試一次。");
        setTurns((prev) => [...prev, { role: "assistant", content: message, error: true }]);
      } else {
        setTurns((prev) => [...prev, {
          role: "assistant", content: data.answer, steps: data.steps, citations: data.citations,
          meta: `${data.model} · prompt ${data.prompt_version} · ${(data.ms / 1000).toFixed(1)}s`,
        }]);
      }
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", content: t("Network error. Please try again.", "網絡錯誤，請再試一次。"), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <div className="flex flex-col w-full min-h-screen animate-in fade-in duration-500">
      <AppHeader language={language} setLanguage={setLanguage} />
      <div className="container max-w-3xl mx-auto px-4 py-6 flex-1 flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("MedSav Assistant", "醫保助手")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("Ask about VHIS premiums or rules. Numbers come from the premium tables of every certified plan; rules come from the Health Bureau's official documents, with sources linked. Information only, not advice.",
              "查詢自願醫保保費或規則。數字取自所有認可計劃的保費表；規則取自醫務衞生局官方文件，並附來源連結。只供參考，並非保險建議。")}
          </p>
        </div>

        {turns.length === 0 && (
          <div className="grid sm:grid-cols-2 gap-2">
            {EXAMPLES[language].map((q) => (
              <button key={q} type="button" onClick={() => send(q)}
                className="text-left text-sm rounded-lg border px-3 py-2 hover:bg-accent transition-colors">
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {turns.map((turn, i) => (
            <div key={i} className={cn("flex gap-3", turn.role === "user" && "flex-row-reverse")}>
              <div className={cn("size-8 shrink-0 rounded-full flex items-center justify-center",
                turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                {turn.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
              </div>
              {turn.role === "user" ? (
                <div className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap">
                  {turn.content}
                </div>
              ) : (
                <Card className={cn("max-w-[85%] min-w-0", turn.error && "border-destructive/50")}>
                  <CardContent className="p-3 text-sm space-y-2">
                    <div className="assistant-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{children}</a>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-2"><table className="w-full text-xs border-collapse">{children}</table></div>
                          ),
                          th: ({ children }) => <th className="border-b px-2 py-1 text-left font-medium">{children}</th>,
                          td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
                          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                          p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-2">{children}</p>,
                        }}>
                        {linkCitations(turn.content, turn.citations ?? [])}
                      </ReactMarkdown>
                    </div>
                    {!!turn.citations?.length && (
                      <ol className="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
                        {turn.citations.map((c, n) => (
                          <li key={c.id}>
                            [{n + 1}] <a href={c.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{c.title}</a>
                          </li>
                        ))}
                      </ol>
                    )}
                    {!!turn.steps?.length && (
                      <details className="text-xs text-muted-foreground border-t pt-2 group">
                        <summary className="cursor-pointer list-none flex items-center gap-1">
                          <Wrench className="size-3" />
                          {t(`How I answered: ${turn.steps.length} tool call${turn.steps.length > 1 ? "s" : ""}`,
                            `回答方法：調用了 ${turn.steps.length} 次工具`)}
                          <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {turn.steps.map((s, n) => (
                            <li key={n}>
                              <span className="font-medium">{(TOOL_LABEL[s.tool] ?? [s.tool, s.tool])[language === "en" ? 0 : 1]}</span>
                              <code className="ml-1 break-all">{s.tool}({JSON.stringify(s.args)})</code>
                              {!s.ok && <span className="ml-1 text-destructive">{t("(no result)", "（沒有結果）")}</span>}
                            </li>
                          ))}
                        </ul>
                        {turn.meta && <p className="mt-2">{turn.meta}</p>}
                      </details>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex gap-3 items-center text-sm text-muted-foreground">
              <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Loader2 className="size-4 animate-spin" />
              </div>
              {t("Checking the data and documents…", "正在查閱數據及文件…")}
            </div>
          )}
          <div ref={bottom} />
        </div>

        <form onSubmit={onSubmit} className="sticky bottom-0 bg-background/95 backdrop-blur-sm py-3 border-t flex gap-2 items-end">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={800}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={t("Ask about premiums, plans or VHIS rules…", "輸入有關保費、計劃或自願醫保規則的問題…")}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="flex flex-col gap-1 items-stretch">
            {providers.length > 1 && (
              <select value={provider ?? ""} onChange={(e) => setProvider(e.target.value as Provider)}
                aria-label={t("Model", "模型")} className="h-7 rounded-md border bg-background text-xs px-1">
                {providers.map((p) => <option key={p} value={p}>{p === "deepseek" ? "DeepSeek" : "Qwen"}</option>)}
              </select>
            )}
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label={t("Send", "發送")}>
              <Send className="size-4" />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
