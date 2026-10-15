import { ChatOpenAI } from "@langchain/openai";

export type Provider = "deepseek" | "qwen";

interface ProviderConfig { baseURL: string; model: string; keyEnv: string }

/** Both providers expose OpenAI-compatible chat APIs with tool calling. */
const PROVIDERS: Record<Provider, ProviderConfig> = {
  deepseek: {
    baseURL: "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    keyEnv: "DEEPSEEK_API_KEY",
  },
  qwen: {
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: process.env.QWEN_MODEL ?? "qwen-plus",
    keyEnv: "DASHSCOPE_API_KEY",
  },
};

export function availableProviders(): Provider[] {
  return (Object.keys(PROVIDERS) as Provider[]).filter((p) => Boolean(process.env[PROVIDERS[p].keyEnv]));
}

export function defaultProvider(): Provider {
  const preferred = (process.env.ASSISTANT_PROVIDER as Provider | undefined) ?? "qwen";
  const available = availableProviders();
  return available.includes(preferred) ? preferred : available[0] ?? preferred;
}

export function chatModel(provider: Provider) {
  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey) throw new Error(`${cfg.keyEnv} is not set`);
  return {
    model: cfg.model,
    llm: new ChatOpenAI({
      model: cfg.model,
      apiKey,
      temperature: 0,
      maxTokens: 900,
      timeout: 45_000,
      maxRetries: 1,
      configuration: { baseURL: cfg.baseURL },
    }),
  };
}
