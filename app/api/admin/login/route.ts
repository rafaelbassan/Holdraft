import { NextRequest, NextResponse } from "next/server";
import { startAdminSession, verifyAdmin } from "@/lib/admin";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!verifyAdmin(body.username ?? "", body.password ?? "")) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  await startAdminSession();
  return NextResponse.json({ ok: true });
}
