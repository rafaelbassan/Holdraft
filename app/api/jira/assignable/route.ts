import { NextRequest, NextResponse } from "next/server";
import { resolveJiraClient, searchAssignableUsers } from "@/lib/jira/client";

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get("project")?.trim();
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!project) {
    return NextResponse.json({ error: "project_required" }, { status: 400 });
  }

  const client = await resolveJiraClient();
  if (!client) {
    return NextResponse.json({ error: "jira_not_configured" }, { status: 503 });
  }

  const result = await searchAssignableUsers(client, project, query || "a");
  return NextResponse.json(result);
}
