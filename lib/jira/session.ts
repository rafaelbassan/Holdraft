import { cookies } from "next/headers";
import {
  getDb,
  type SessionRow,
  getSetting,
} from "@/lib/db";
import {
  SETTING_KEYS,
  getRawSetting,
} from "@/lib/settings";
import { JiraClient } from "@/lib/jira/client";

export const SESSION_COOKIE_NAME = "holdraft_session_id";

const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";

const OAUTH_SCOPES = [
  "read:me",
  "offline_access",
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  "manage:jira-project",
  "manage:jira-configuration",
  "read:issue:jira",
  "write:issue:jira",
  "read:issue-details:jira",
  "read:issue-meta:jira",
  "read:issue-type:jira",
  "read:issue-status:jira",
  "read:priority:jira",
  "read:jql:jira",
  "read:project:jira",
  "write:project:jira",
  "read:project-type:jira",
  "read:user:jira",
  "read:permission:jira",
  "read:issue.watcher:jira",
  "write:issue.watcher:jira",
  "read:issue-link:jira",
  "write:issue-link:jira",
  "read:issue-link-type:jira",
  "read:group:jira",
  "write:group:jira",
].join(" ");

export function getOAuthScopes(): string {
  return OAUTH_SCOPES;
}

export function getSessionById(id: number): SessionRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as SessionRow | undefined;
  return row ?? null;
}

export function getSessionByAccountId(
  accountId: string,
): SessionRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM sessions WHERE atlassian_account_id = ?")
    .get(accountId) as SessionRow | undefined;
  return row ?? null;
}

export function upsertSession(data: {
  atlassian_account_id: string;
  atlassian_display_name?: string | null;
  atlassian_email?: string | null;
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
  cloud_id: string;
}): SessionRow {
  const db = getDb();
  const existing = getSessionByAccountId(data.atlassian_account_id);
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    db.prepare(
      `UPDATE sessions SET
        atlassian_display_name = ?,
        atlassian_email = ?,
        access_token = ?,
        refresh_token = ?,
        token_expires_at = ?,
        cloud_id = ?,
        updated_at = ?
      WHERE id = ?`,
    ).run(
      data.atlassian_display_name ?? existing.atlassian_display_name,
      data.atlassian_email ?? existing.atlassian_email,
      data.access_token,
      data.refresh_token,
      data.token_expires_at,
      data.cloud_id,
      now,
      existing.id,
    );
    return getSessionById(existing.id)!;
  }
  const result = db
    .prepare(
      `INSERT INTO sessions (
        atlassian_account_id,
        atlassian_display_name,
        atlassian_email,
        access_token,
        refresh_token,
        token_expires_at,
        cloud_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.atlassian_account_id,
      data.atlassian_display_name ?? null,
      data.atlassian_email ?? null,
      data.access_token,
      data.refresh_token,
      data.token_expires_at,
      data.cloud_id,
      now,
      now,
    );
  return getSessionById(Number(result.lastInsertRowid))!;
}

export function deleteSession(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export async function getSessionFromCookie(): Promise<SessionRow | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    return null;
  }
  return getSessionById(id);
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const clientId = getRawSetting(SETTING_KEYS.jiraOAuthClientId);
  const clientSecret = getRawSetting(SETTING_KEYS.jiraOAuthClientSecret);
  if (!clientId || !clientSecret) {
    throw new Error("OAuth client credentials not configured");
  }
  const res = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

function persistRefreshedTokens(
  sessionId: number,
  tokens: TokenResponse,
  previousRefresh: string,
): SessionRow {
  const expiresAt =
    Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600) - 60;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE sessions SET
      access_token = ?,
      refresh_token = ?,
      token_expires_at = ?,
      updated_at = ?
    WHERE id = ?`,
  ).run(
    tokens.access_token,
    tokens.refresh_token ?? previousRefresh,
    expiresAt,
    now,
    sessionId,
  );
  return getSessionById(sessionId)!;
}

export async function getValidSession(): Promise<SessionRow | null> {
  const session = await getSessionFromCookie();
  if (!session?.access_token || !session.cloud_id) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = session.token_expires_at ?? 0;
  if (expiresAt > now) {
    return session;
  }
  if (!session.refresh_token) {
    return null;
  }
  try {
    const tokens = await refreshAccessToken(session.refresh_token);
    return persistRefreshedTokens(session.id, tokens, session.refresh_token);
  } catch {
    return null;
  }
}

export async function getJiraClientForRequest(): Promise<JiraClient | null> {
  const { resolveJiraClient } = await import("@/lib/jira/client");
  const config = await resolveJiraClient();
  if (!config) {
    return null;
  }
  return JiraClient.fromConfig(config);
}

export type PublicSession = {
  id: number;
  displayName: string | null;
  email: string | null;
  accountId: string;
  cloudId: string | null;
};

export async function getPublicSession(): Promise<PublicSession | null> {
  const session = await getValidSession();
  if (!session) {
    return null;
  }
  return {
    id: session.id,
    displayName: session.atlassian_display_name,
    email: session.atlassian_email,
    accountId: session.atlassian_account_id,
    cloudId: session.cloud_id,
  };
}

export async function exchangeAuthorizationCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const clientId = getRawSetting(SETTING_KEYS.jiraOAuthClientId);
  const clientSecret = getRawSetting(SETTING_KEYS.jiraOAuthClientSecret);
  if (!clientId || !clientSecret) {
    throw new Error("OAuth client credentials not configured");
  }
  const res = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export type AccessibleResource = {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl?: string;
};

export async function fetchAccessibleResources(
  accessToken: string,
): Promise<AccessibleResource[]> {
  const res = await fetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Accessible resources failed: ${res.status} ${text}`);
  }
  return (await res.json()) as AccessibleResource[];
}

export async function fetchAtlassianProfile(accessToken: string): Promise<{
  account_id: string;
  name?: string;
  email?: string;
}> {
  const res = await fetch("https://api.atlassian.com/me", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Profile fetch failed: ${res.status} ${text}`);
  }
  return (await res.json()) as {
    account_id: string;
    name?: string;
    email?: string;
  };
}
