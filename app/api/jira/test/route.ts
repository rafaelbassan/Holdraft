import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getJiraClientForRequest } from "@/lib/jira/session";
import { JiraApiError } from "@/lib/jira/client";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";

export async function POST(): Promise<NextResponse> {
  const denied = await requireAdmin();
  if (denied) {
    return denied;
  }
  const client = await getJiraClientForRequest();
  if (!client) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_jira_auth",
        message:
          getRawSetting(SETTING_KEYS.jiraOAuthClientId) &&
          getRawSetting(SETTING_KEYS.jiraOAuthClientSecret)
            ? "OAuth app is saved. Sign in with Jira on the home page, then test again."
            : "Configure OAuth login or API token in settings.",
      },
      { status: 400 },
    );
  }
  try {
    const permissions = await client.testConnection();
    const projects = await client.getProjects({ maxResults: 1 });
    return NextResponse.json({
      ok: true,
      permissions,
      projectSample: projects,
    });
  } catch (e) {
    if (e instanceof JiraApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: "jira_api_error",
          status: e.status,
          message: e.message,
          detail: e.body?.slice(0, 500),
        },
        { status: 502 },
      );
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "connection_failed", message },
      { status: 500 },
    );
  }
}
