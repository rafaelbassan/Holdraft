import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";
import { getOAuthScopes } from "@/lib/jira/session";

const STATE_COOKIE = "holdraft_oauth_state";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const clientId = getRawSetting(SETTING_KEYS.jiraOAuthClientId);
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/?error=missing_oauth_client", request.url),
    );
  }
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/jira/callback`;
  const state = randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: getOAuthScopes(),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  });
  const authorizeUrl = `https://auth.atlassian.com/authorize?${params.toString()}`;
  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
