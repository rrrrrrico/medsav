import type { AssistantReply, ChatTurn } from "@/lib/assistant/graph";
import { passage } from "@/lib/assistant/search";

const BASE = (process.env.DIFY_API_URL ?? "https://api.dify.ai/v1").replace(/\/$/, "");

interface DifyEvent {
  event: string; answer?: string; tool?: string; tool_input?: string; message?: string;
}

/** Asks the Dify agent app (streaming is the only mode Dify agent apps support) and maps the reply to AssistantReply. */
export async function askDify(history: ChatTurn[]): Promise<AssistantReply> {
  const key = process.env.DIFY_API_KEY;
  if (!key) throw new Error("DIFY_API_KEY is not set");
  const started = Date.now();
  const question = history[history.length - 1].content;
  const res = await fetch(`${BASE}/chat-messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: {}, query: question, response_mode: "streaming", user: "medsav-eval" }),
  });
  if (!res.ok || !res.body) throw new Error(`dify ${res.status}: ${await res.text()}`);

  let answer = "";
  const steps: AssistantReply["steps"] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const e = JSON.parse(line.slice(5)) as DifyEvent;
      if (e.event === "agent_message" || e.event === "message") answer += e.answer ?? "";
      if (e.event === "agent_thought" && e.tool) {
        for (const name of e.tool.split(";").filter(Boolean)) {
          steps.push({ tool: name.startsWith("dataset_") ? "search_documents" : name, args: {}, ok: true });
        }
      }
      if (e.event === "error") throw new Error(`dify error: ${e.message}`);
    }
  }

  const ids = Array.from(new Set(answer.match(/c\d{4}/g) ?? []));
  const citations = ids.flatMap((id) => {
    const p = passage(id);
    return p ? [{ id: p.id, title: p.title, url: p.url }] : [];
  });
  return {
    answer: answer.trim(), steps: dedupe(steps), citations, grounding_retries: 0,
    provider: "dify" as AssistantReply["provider"], model: process.env.DIFY_MODEL_LABEL ?? "dify-agent",
    prompt_version: "dify", ms: Date.now() - started,
  };
}

/** Dify repeats a thought event as it streams; keep one entry per consecutive tool. */
function dedupe(steps: AssistantReply["steps"]) {
  return steps.filter((s, i) => i === 0 || s.tool !== steps[i - 1].tool);
}
