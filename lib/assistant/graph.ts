import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { chatModel, Provider } from "./model";
import { GROUNDING_CORRECTION, PROMPT_VERSION, SYSTEM_PROMPT } from "./prompts";
import { passage } from "./search";
import { tools } from "./tools";

export interface ChatTurn { role: "user" | "assistant"; content: string }

export interface ToolStep { tool: string; args: Record<string, unknown>; ok: boolean }
export interface Citation { id: string; title: string; url: string }

export interface AssistantReply {
  answer: string;
  steps: ToolStep[];
  citations: Citation[];
  grounding_retries: number;
  provider: Provider;
  model: string;
  prompt_version: string;
  ms: number;
}

const MAX_STEPS = 6;
const MAX_CORRECTIONS = 1;
const CHECK = "grounding_check";
const CITED = /\[([a-z]{1,2}\d{2,5})\]/gi;
const FIGURE = /HK\$|US\$|港幣|港元|美元|\d+(?:\.\d+)?\s?%|\d{1,3}(?:,\d{3})+|\d+\s?(?:days?|日|天|萬)/i;

function text(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("");
}

const isCorrection = (m: BaseMessage) => m instanceof HumanMessage && m.name === CHECK;

/** Messages since the user's latest question (corrections included). */
function currentTurn(messages: BaseMessage[]): BaseMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage && !isCorrection(messages[i])) return messages.slice(i + 1);
  }
  return messages;
}

/** Returns why the latest answer is not supported by this turn's tool results, or null. */
export function groundingProblem(messages: BaseMessage[]): string | null {
  const turn = currentTurn(messages);
  const answer = text(turn[turn.length - 1]?.content ?? "");
  const toolMessages = turn.filter((m): m is ToolMessage => m instanceof ToolMessage);
  const retrieved = new Set<string>();
  for (const m of toolMessages) {
    if (m.name !== "search_documents") continue;
    try {
      for (const p of JSON.parse(text(m.content)) as { id: string }[]) retrieved.add(p.id);
    } catch {
      /* not a passage list */
    }
  }
  const unknown = Array.from(answer.matchAll(CITED), (x) => x[1]).filter((id) => !retrieved.has(id));
  if (unknown.length) return `it cites passage ids that no search returned (${Array.from(new Set(unknown)).join(", ")}).`;
  if (!toolMessages.length && FIGURE.test(answer)) return "it states figures or rules without calling any tool.";
  return null;
}

function buildGraph(provider: Provider) {
  const { llm } = chatModel(provider);
  const model = llm.bindTools(tools);

  const agent = async (state: typeof MessagesAnnotation.State) => {
    const toolRounds = state.messages.filter((m) => m instanceof ToolMessage).length;
    const runnable = toolRounds >= MAX_STEPS ? llm : model;
    const response = await runnable.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    return { messages: [response] };
  };

  const afterAgent = (state: typeof MessagesAnnotation.State) => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    return last.tool_calls?.length ? "tools" : "check";
  };

  const check = async (state: typeof MessagesAnnotation.State) => {
    const corrections = currentTurn(state.messages).filter(isCorrection).length;
    const problem = corrections < MAX_CORRECTIONS ? groundingProblem(state.messages) : null;
    if (!problem) return { messages: [] };
    return { messages: [new HumanMessage({ content: GROUNDING_CORRECTION.replace("{problem}", problem), name: CHECK })] };
  };

  const afterCheck = (state: typeof MessagesAnnotation.State) =>
    isCorrection(state.messages[state.messages.length - 1]) ? "agent" : END;

  return new StateGraph(MessagesAnnotation)
    .addNode("agent", agent)
    .addNode("tools", new ToolNode(tools))
    .addNode("check", check)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", afterAgent, ["tools", "check"])
    .addEdge("tools", "agent")
    .addConditionalEdges("check", afterCheck, ["agent", END])
    .compile();
}

const graphs = new Map<Provider, ReturnType<typeof buildGraph>>();

function graphFor(provider: Provider) {
  let g = graphs.get(provider);
  if (!g) {
    g = buildGraph(provider);
    graphs.set(provider, g);
  }
  return g;
}

export async function ask(history: ChatTurn[], provider: Provider): Promise<AssistantReply> {
  const started = Date.now();
  const messages = history.map((t) => (t.role === "user" ? new HumanMessage(t.content) : new AIMessage(t.content)));
  const result = await graphFor(provider).invoke({ messages }, { recursionLimit: MAX_STEPS * 2 + 10 });
  const produced = result.messages.slice(messages.length);

  const steps: ToolStep[] = [];
  const toolResults = new Map<string, string>();
  for (const m of produced) {
    if (m instanceof ToolMessage) toolResults.set(m.tool_call_id, text(m.content));
  }
  for (const m of produced) {
    if (m instanceof AIMessage) {
      for (const call of m.tool_calls ?? []) {
        const out = toolResults.get(call.id ?? "") ?? "";
        steps.push({ tool: call.name, args: call.args, ok: !out.includes('"error"') });
      }
    }
  }

  const finalAi = [...produced].reverse().find((m) => m instanceof AIMessage);
  const answer = finalAi ? text(finalAi.content).trim() : "";
  const cited = Array.from(new Set(answer.match(/c\d{4}/g) ?? []));
  const citations = cited.map((id) => passage(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ id: p.id, title: p.title, url: p.url }));

  return {
    answer, steps, citations, grounding_retries: produced.filter(isCorrection).length,
    provider, model: chatModel(provider).model, prompt_version: PROMPT_VERSION, ms: Date.now() - started,
  };
}
