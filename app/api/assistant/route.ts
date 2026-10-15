import { NextRequest, NextResponse } from "next/server";
import { ask, ChatTurn } from "@/lib/assistant/graph";
import { availableProviders, defaultProvider, Provider } from "@/lib/assistant/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TURNS = 10;
const MAX_CHARS = 800;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

export async function GET() {
  return NextResponse.json({ providers: availableProviders(), default: defaultProvider() });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { messages?: ChatTurn[]; provider?: Provider };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, m.role === "user" ? MAX_CHARS : 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "last_message_must_be_user" }, { status: 400 });
  }

  const providers = availableProviders();
  const provider = body.provider && providers.includes(body.provider) ? body.provider : defaultProvider();
  if (!providers.includes(provider)) {
    return NextResponse.json({ error: "assistant_not_configured" }, { status: 503 });
  }

  const order = [provider, ...providers.filter((p) => p !== provider)];
  for (let attempt = 0; attempt < order.length; attempt++) {
    const p = order[attempt];
    try {
      const reply = await ask(messages, p);
      return NextResponse.json(attempt ? { ...reply, fallback_from: order[0] } : reply);
    } catch (err) {
      console.error(`[assistant] ${p} failed`, err);
    }
  }
  return NextResponse.json({ error: "assistant_failed" }, { status: 502 });
}
