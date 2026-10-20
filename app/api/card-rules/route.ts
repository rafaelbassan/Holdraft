import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { readCardRulesFile, writeCardRulesFile } from "@/lib/card-rules-file";

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdmin();
  if (denied) {
    return denied;
  }
  return NextResponse.json({ content: readCardRulesFile() });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const denied = await requireAdmin();
  if (denied) {
    return denied;
  }
  let body: { content?: string };
  try {
    body = (await request.json()) as { content?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content_required" }, { status: 400 });
  }
  writeCardRulesFile(body.content);
  return NextResponse.json({ content: body.content });
}
