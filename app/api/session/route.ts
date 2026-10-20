import { NextResponse } from "next/server";
import { getPublicSession } from "@/lib/jira/session";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";

export async function GET() {
  const session = await getPublicSession();
  const hasApiToken = Boolean(
    getRawSetting(SETTING_KEYS.jiraApiToken) &&
      getRawSetting(SETTING_KEYS.jiraSiteUrl),
  );
  return NextResponse.json({
    user: session
      ? {
          displayName: session.displayName,
          email: session.email,
          accountId: session.accountId,
        }
      : null,
    jiraConnected: Boolean(session) || hasApiToken,
  });
}
