import { NextRequest, NextResponse } from "next/server";
import { openApiSpec } from "@/lib/assistant/http-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(openApiSpec(req.nextUrl.origin));
}
