import { NextResponse } from "next/server";
import {
  listProjects,
  resolveJiraClient,
  userCanCreateProjects,
} from "@/lib/jira/client";

export async function GET() {
  const client = await resolveJiraClient();
  if (!client) {
    return NextResponse.json({ error: "jira_not_configured" }, { status: 503 });
  }

  const [projects, canCreateProjects] = await Promise.all([
    listProjects(client),
    userCanCreateProjects(client),
  ]);

  return NextResponse.json({ projects, canCreateProjects });
}
