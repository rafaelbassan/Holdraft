import { NextRequest, NextResponse } from "next/server";
import { createAdmin, startAdminSession } from "@/lib/admin";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const error = createAdmin(body.username ?? "", body.password ?? "");
  if (error) {
    const status = error === "already_configured" ? 409 : 400;
    return NextResponse.json({ error }, { status });
  }
  await startAdminSession();
  return NextResponse.json({ ok: true });
}
