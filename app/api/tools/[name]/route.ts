import { NextRequest, NextResponse } from "next/server";
import { authorised, httpTools } from "@/lib/assistant/http-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  if (!authorised(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const t = httpTools.find((x) => x.name === params.name);
  if (!t) return NextResponse.json({ error: "unknown_tool" }, { status: 404 });

  let args: unknown;
  try {
    args = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const out = await (t as { invoke: (a: unknown) => Promise<unknown> }).invoke(args);
    return new NextResponse(typeof out === "string" ? out : JSON.stringify(out), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: "invalid_arguments", detail: String(err).slice(0, 500) }, { status: 400 });
  }
}
