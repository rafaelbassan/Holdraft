import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  applySettingsPatch,
  getPublicSettings,
  SETTING_KEYS,
  type SettingsPatch,
} from "@/lib/settings";
import { getPublicSession } from "@/lib/jira/session";

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdmin();
  if (denied) {
    return denied;
  }
  const settings = getPublicSettings();
  const session = await getPublicSession();
  return NextResponse.json({ settings, session });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const denied = await requireAdmin();
  if (denied) {
    return denied;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const patch: SettingsPatch = {};
  for (const key of Object.values(SETTING_KEYS)) {
    const value = raw[key];
    if (typeof value === "string") {
      patch[key as keyof SettingsPatch] = value;
    }
  }
  applySettingsPatch(patch);
  const settings = getPublicSettings();
  const session = await getPublicSession();
  return NextResponse.json({ settings, session });
}
