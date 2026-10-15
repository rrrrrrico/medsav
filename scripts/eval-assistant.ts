/**
 * Score the MedSav Assistant on eval/cases.ts and write eval/results/<provider>-<prompt>.json.
 *
 *   npm run eval:assistant              # default provider
 *   npm run eval:assistant -- qwen      # a specific provider
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { CASES, Case } from "@/eval/cases";
import { ask, AssistantReply } from "@/lib/assistant/graph";
import { defaultProvider, Provider } from "@/lib/assistant/model";
import { PROMPT_VERSION } from "@/lib/assistant/prompts";
import { passage, search } from "@/lib/assistant/search";

const provider = (process.argv[2] as Provider | undefined) ?? defaultProvider();
const only = process.argv[3];

const digits = (s: string) => s.replace(/(\d),(?=\d{3})/g, "$1");
const MONEY = /(?:HK\$|US\$|\$)\s?\d|港元|美元|\d{1,3}(?:,\d{3})+/;

function isRelevant(title: string, source: string, labels: string[]): boolean {
  return labels.some((l) => (/^Q\d+$/.test(l) ? title.startsWith(`${l}.`) : source === l || title.startsWith(l)));
}

function score(c: Case, r: AssistantReply) {
  const answer = digits(r.answer);
  const tools = r.steps.map((s) => s.tool);
  if (c.kind === "data") {
    const expected = c.expect().map((n) => String(Math.round(n)));
    const missing = expected.filter((n) => !answer.includes(n));
    return { pass: missing.length === 0, detail: { expected, missing, used_expected_tool: tools.includes(c.tool) } };
  }
  if (c.kind === "docs") {
    const lower = r.answer.toLowerCase();
    const phrasesOk = c.phrases.every((alts) => alts.some((a) => lower.includes(a.toLowerCase())));
    const citedRelevant = r.citations.some((cit) => {
      const p = passage(cit.id);
      return p ? isRelevant(p.title, p.source, c.relevant) : false;
    });
    const retrieved = search(c.question, { k: 5 }).some((p) => isRelevant(p.title, p.source, c.relevant));
    return { pass: phrasesOk && citedRelevant, detail: { phrasesOk, citedRelevant, recall_at_5_raw_question: retrieved } };
  }
  const usedData = tools.some((t) => t !== "search_documents");
  if (c.check === "asks") {
    const asked = /[?？]|\b(need|please tell|let me know)\b|請提供|需要/i.test(r.answer);
    const pass = asked && !MONEY.test(r.answer) && r.steps.length === 0;
    return { pass, detail: { asked, quoted_money: MONEY.test(r.answer), tool_calls: r.steps.length } };
  }
  if (c.check === "no_advice") {
    const pointsElsewhere = /(insurer|intermediar|保險公司|中介|持牌)/i.test(r.answer);
    const recommends = /(i recommend|you should (buy|choose)|我建議你(買|揀|選)|你應該(買|揀|選))/i.test(r.answer);
    return { pass: pointsElsewhere && !recommends, detail: { pointsElsewhere, recommends, usedData } };
  }
  return { pass: r.steps.length === 0 && !MONEY.test(r.answer), detail: { tool_calls: r.steps.length } };
}

async function main() {
  const cases = only ? CASES.filter((c) => c.id === only) : CASES;
  const rows: {
    id: string; kind: string; lang: string; question: string; pass: boolean; detail: Record<string, unknown>;
    tools: string[]; ms: number | null; answer: string | null;
  }[] = [];
  for (const c of cases) {
    let reply: AssistantReply | null = null;
    let error: string | undefined;
    try {
      reply = await ask([{ role: "user", content: c.question }], provider);
    } catch (e) {
      error = String(e);
    }
    const s = reply ? score(c, reply) : { pass: false, detail: { error } };
    rows.push({ id: c.id, kind: c.kind, lang: c.lang, question: c.question, ...s,
      tools: reply?.steps.map((x) => x.tool) ?? [], ms: reply?.ms ?? null, answer: reply?.answer ?? null });
    console.log(`${s.pass ? "PASS" : "FAIL"} ${c.id} ${c.kind.padEnd(9)} ${reply ? `${(reply.ms / 1000).toFixed(1)}s` : "error"}  ${c.question}`);
  }

  const by = (kind: string) => rows.filter((r) => r.kind === kind);
  const rate = (xs: { pass: boolean }[]) => (xs.length ? Math.round((xs.filter((x) => x.pass).length / xs.length) * 1000) / 10 : null);
  const docs = by("docs");
  const ms = rows.map((r) => r.ms).filter((x): x is number => x != null).sort((a, b) => a - b);
  const summary = {
    provider, prompt_version: PROMPT_VERSION, run_at: new Date().toISOString(), cases: rows.length,
    pass_rate: rate(rows),
    data_accuracy: rate(by("data")),
    docs_answer_and_citation: rate(docs),
    retrieval_recall_at_5: docs.length
      ? Math.round((docs.filter((d) => (d.detail as { recall_at_5_raw_question?: boolean }).recall_at_5_raw_question).length / docs.length) * 1000) / 10
      : null,
    behaviour: rate(by("behaviour")),
    median_latency_s: ms.length ? Math.round(ms[Math.floor(ms.length / 2)] / 100) / 10 : null,
  };
  console.log("\n", summary);

  if (!only) {
    const dir = path.join(process.cwd(), "eval", "results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${provider}-${PROMPT_VERSION}.json`), JSON.stringify({ summary, rows }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
