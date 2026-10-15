import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { chatModel, Provider } from "./model";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompts";
import { passage } from "./search";
import { tools } from "./tools";

export interface ChatTurn { role: "user" | "assistant"; content: string }

export interface ToolStep { tool: string; args: Record<string, unknown>; ok: boolean }
export interface Citation { id: string; title: string; url: string }

export interface AssistantReply {
  answer: string;
  steps: ToolStep[];
  citations: Citation[];
  provider: Provider;
  model: string;
  prompt_version: string;
  ms: number;
}

const MAX_STEPS = 6;

function buildGraph(provider: Provider) {
  const { llm } = chatModel(provider);
  const model = llm.bindTools(tools);

  const agent = async (state: typeof MessagesAnnotation.State) => {
    const toolRounds = state.messages.filter((m) => m instanceof ToolMessage).length;
    const runnable = toolRounds >= MAX_STEPS ? llm : model;
    const response = await runnable.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    return { messages: [response] };
  };

  const route = (state: typeof MessagesAnnotation.State) => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    return last.tool_calls?.length ? "tools" : END;
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("agent", agent)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", route, ["tools", END])
    .addEdge("tools", "agent")
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

function text(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("");
}

export async function ask(history: ChatTurn[], provider: Provider): Promise<AssistantReply> {
  const started = Date.now();
  const messages = history.map((t) => (t.role === "user" ? new HumanMessage(t.content) : new AIMessage(t.content)));
  const result = await graphFor(provider).invoke({ messages }, { recursionLimit: MAX_STEPS * 2 + 4 });
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

  const final = produced[produced.length - 1];
  const answer = final instanceof AIMessage ? text(final.content).trim() : "";
  const cited = Array.from(new Set(answer.match(/c\d{4}/g) ?? []));
  const citations = cited.map((id) => passage(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ id: p.id, title: p.title, url: p.url }));

  return {
    answer, steps, citations, provider, model: chatModel(provider).model, prompt_version: PROMPT_VERSION,
    ms: Date.now() - started,
  };
}
