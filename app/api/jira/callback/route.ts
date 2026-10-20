import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  exchangeAuthorizationCode,
  fetchAccessibleResources,
  fetchAtlassianProfile,
  upsertSession,
} from "@/lib/jira/session";

const STATE_COOKIE = "holdraft_oauth_state";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const error = searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url),
    );
  }
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.redirect(
      new URL("/?error=invalid_oauth_state", request.url),
    );
  }
  const redirectUri = `${request.nextUrl.origin}/api/jira/callback`;
  try {
    const tokens = await exchangeAuthorizationCode(code, redirectUri);
    const resources = await fetchAccessibleResources(tokens.access_token);
    const jiraResource = resources.find((r) =>
      r.scopes.some((s) => s.includes("jira") || s === "read:jira-work"),
    ) ?? resources[0];
    if (!jiraResource) {
      return NextResponse.redirect(
        new URL("/?error=no_jira_site", request.url),
      );
    }
    const profile = await fetchAtlassianProfile(tokens.access_token);
    const expiresAt =
      Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600) - 60;
    const session = upsertSession({
      atlassian_account_id: profile.account_id,
      atlassian_display_name: profile.name ?? null,
      atlassian_email: profile.email ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? "",
      token_expires_at: expiresAt,
      cloud_id: jiraResource.id,
    });
    const response = NextResponse.redirect(
      new URL("/?jira=connected", request.url),
    );
    response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(SESSION_COOKIE_NAME, String(session.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (e) {
    const message = e instanceof Error ? e.message : "oauth_failed";
    return NextResponse.redirect(
      new URL(
        `/?error=${encodeURIComponent(message.slice(0, 120))}`,
        request.url,
      ),
    );
  }
}
