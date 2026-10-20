import { getRawSetting, SETTING_KEYS } from "@/lib/settings";
import type { JiraCardSummary } from "@/lib/agent/types";
import { getDb, type SessionRow } from "@/lib/db";
import {
  ALL_TRACKED_PERMISSIONS,
  parseMyPermissionsResponse,
  type ParsedPermissions,
} from "@/lib/jira/permissions";

export type JiraAuthMode = "oauth" | "api_token" | "none";

export type JiraClientConfig = {
  mode: JiraAuthMode;
  baseUrl: string;
  headers: Record<string, string>;
  siteBrowseUrl: string;
};

function basicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

export function getLatestSession(): SessionRow | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM sessions ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    .get() as SessionRow | undefined;
  return row ?? null;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export class JiraClient {
  constructor(private readonly config: JiraClientConfig) {}

  static fromOAuth(accessToken: string, cloudId: string): JiraClient {
    return new JiraClient({
      mode: "oauth",
      baseUrl: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      siteBrowseUrl: getRawSetting(SETTING_KEYS.jiraSiteUrl).replace(/\/$/, ""),
    });
  }

  static fromConfig(config: JiraClientConfig): JiraClient {
    return new JiraClient(config);
  }

  static fromApiToken(
    email: string,
    apiToken: string,
    siteUrl: string,
  ): JiraClient {
    const normalized = siteUrl.replace(/\/$/, "");
    return new JiraClient({
      mode: "api_token",
      baseUrl: `${normalized}/rest/api/3`,
      headers: {
        Authorization: basicAuthHeader(email, apiToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      siteBrowseUrl: normalized,
    });
  }

  toConfig(): JiraClientConfig {
    return this.config;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const init: RequestInit = {
      method,
      headers: this.config.headers,
    };
    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new JiraApiError(
        `Jira API ${method} ${path} failed`,
        res.status,
        text,
      );
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as T;
  }

  async searchJql(params: {
    jql: string;
    maxResults?: number;
    fields?: string[];
    nextPageToken?: string;
  }): Promise<unknown> {
    return this.request("POST", "/search/jql", {
      jql: params.jql,
      maxResults: params.maxResults ?? 15,
      fields: params.fields ?? [
        "summary",
        "status",
        "priority",
        "assignee",
        "duedate",
      ],
      nextPageToken: params.nextPageToken,
    });
  }

  async getMyPermissions(
    permissions: string[] = [...ALL_TRACKED_PERMISSIONS],
  ): Promise<ParsedPermissions> {
    const query = `permissions=${encodeURIComponent(permissions.join(","))}`;
    const data = await this.request<{
      permissions?: Record<
        string,
        { havePermission?: boolean; key?: string; id?: string; name?: string }
      >;
    }>("GET", `/mypermissions?${query}`);
    return parseMyPermissionsResponse(data);
  }

  async assignableUsers(params: {
    projectKey: string;
    query?: string;
    maxResults?: number;
  }): Promise<unknown> {
    const search = new URLSearchParams({
      project: params.projectKey,
      maxResults: String(params.maxResults ?? 50),
    });
    if (params.query) {
      search.set("query", params.query);
    }
    return this.request("GET", `/user/assignable/search?${search.toString()}`);
  }

  async createIssue(fields: Record<string, unknown>): Promise<{
    id: string;
    key: string;
    self: string;
  }> {
    return this.request("POST", "/issue", { fields });
  }

  async addWatcher(issueKey: string, accountId: string): Promise<void> {
    await addWatcher(this.config, issueKey, accountId);
  }

  async createProject(payload: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/project", payload);
  }

  async createGroup(name: string): Promise<unknown> {
    return this.request("POST", "/group", { name });
  }

  async linkIssues(payload: {
    type: { name: string };
    inwardIssue: { key: string };
    outwardIssue: { key: string };
  }): Promise<void> {
    await this.request("POST", "/issueLink", payload);
  }

  async getProjects(params?: {
    startAt?: number;
    maxResults?: number;
  }): Promise<unknown> {
    const search = new URLSearchParams();
    if (params?.startAt !== undefined) {
      search.set("startAt", String(params.startAt));
    }
    if (params?.maxResults !== undefined) {
      search.set("maxResults", String(params.maxResults));
    }
    const qs = search.toString();
    return this.request("GET", qs ? `/project/search?${qs}` : "/project/search");
  }

  async createMetaForProject(projectKey: string): Promise<unknown> {
    const search = new URLSearchParams({
      projectKeys: projectKey,
      expand: "projects.issuetypes.fields",
    });
    return this.request("GET", `/issue/createmeta?${search.toString()}`);
  }

  async testConnection(): Promise<ParsedPermissions> {
    return this.getMyPermissions(["BROWSE_PROJECTS"]);
  }
}

export async function resolveJiraClient(): Promise<JiraClientConfig | null> {
  const { getValidSession } = await import("@/lib/jira/session");
  const session = await getValidSession();
  if (session?.access_token && session.cloud_id) {
    return {
      mode: "oauth",
      baseUrl: `https://api.atlassian.com/ex/jira/${session.cloud_id}/rest/api/3`,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      siteBrowseUrl: getRawSetting(SETTING_KEYS.jiraSiteUrl).replace(/\/$/, ""),
    };
  }

  const email = getRawSetting(SETTING_KEYS.jiraApiTokenEmail);
  const token = getRawSetting(SETTING_KEYS.jiraApiToken);
  const siteUrl = getRawSetting(SETTING_KEYS.jiraSiteUrl).replace(/\/$/, "");
  if (email && token && siteUrl) {
    return {
      mode: "api_token",
      baseUrl: `${siteUrl}/rest/api/3`,
      headers: {
        Authorization: basicAuthHeader(email, token),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      siteBrowseUrl: siteUrl,
    };
  }

  return null;
}

function issueBrowseUrl(siteBrowseUrl: string, key: string): string {
  if (!siteBrowseUrl) {
    return key;
  }
  return `${siteBrowseUrl}/browse/${key}`;
}

type JiraIssueFields = {
  summary?: string;
  status?: { name?: string };
  priority?: { name?: string };
  duedate?: string;
};

type JiraSearchIssue = { key: string; fields?: JiraIssueFields };

export async function searchJql(
  client: JiraClientConfig,
  jql: string,
  maxResults = 15,
): Promise<JiraCardSummary[]> {
  const res = await fetch(`${client.baseUrl}/search/jql`, {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({
      jql,
      maxResults,
      fields: ["summary", "status", "priority", "duedate"],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira search failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { issues?: JiraSearchIssue[] };
  return (data.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary ?? "",
    status: issue.fields?.status?.name ?? "",
    priority: issue.fields?.priority?.name,
    due: issue.fields?.duedate,
    url: issueBrowseUrl(client.siteBrowseUrl, issue.key),
  }));
}

export type CreateIssueInput = {
  project_key: string;
  issue_type: string;
  summary: string;
  description_adf: ReturnType<typeof import("@/lib/jira/adf").markdownToAdf>;
  priority?: string;
  labels?: string[];
  assignee_account_id?: string | null;
};

export async function createIssue(
  client: JiraClientConfig,
  input: CreateIssueInput,
): Promise<{ key: string; url: string }> {
  const fields: Record<string, unknown> = {
    project: { key: input.project_key },
    issuetype: { name: input.issue_type },
    summary: input.summary,
    description: input.description_adf,
  };
  if (input.priority) {
    fields.priority = { name: input.priority };
  }
  if (input.labels?.length) {
    fields.labels = input.labels;
  }
  if (input.assignee_account_id) {
    fields.assignee = { accountId: input.assignee_account_id };
  }

  const res = await fetch(`${client.baseUrl}/issue`, {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira create issue failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { key: string };
  return {
    key: data.key,
    url: issueBrowseUrl(client.siteBrowseUrl, data.key),
  };
}

export async function addWatcher(
  client: JiraClientConfig,
  issueKey: string,
  accountId: string,
): Promise<void> {
  const res = await fetch(`${client.baseUrl}/issue/${encodeURIComponent(issueKey)}/watchers`, {
    method: "POST",
    headers: {
      ...client.headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(accountId),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira add watcher failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export async function listWatcherAccountIds(
  client: JiraClientConfig,
  issueKey: string,
): Promise<Set<string>> {
  const res = await fetch(`${client.baseUrl}/issue/${encodeURIComponent(issueKey)}/watchers`, {
    headers: client.headers,
  });
  if (!res.ok) {
    return new Set();
  }
  const data = (await res.json()) as { watchers?: { accountId?: string }[] };
  return new Set(
    (data.watchers ?? [])
      .map((watcher) => watcher.accountId)
      .filter((accountId): accountId is string => Boolean(accountId)),
  );
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyProjectExists(
  client: JiraClientConfig,
  projectKey: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(
      `${client.baseUrl}/project/${encodeURIComponent(projectKey)}`,
      { headers: client.headers },
    );
    if (res.ok) {
      const data = (await res.json()) as { key?: string };
      if (data.key?.toUpperCase() === projectKey.toUpperCase()) {
        return true;
      }
    }
    if (attempt < 2) {
      await pause(400);
    }
  }
  return false;
}

export async function verifyIssueExists(
  client: JiraClientConfig,
  issueKey: string,
): Promise<{ key: string; summary: string } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(
      `${client.baseUrl}/issue/${encodeURIComponent(issueKey)}?fields=summary`,
      { headers: client.headers },
    );
    if (res.ok) {
      const data = (await res.json()) as { key?: string; fields?: { summary?: string } };
      if (data.key) {
        return { key: data.key, summary: data.fields?.summary ?? "" };
      }
    }
    if (attempt < 2) {
      await pause(400);
    }
  }
  return null;
}

function issuelinkConnects(
  link: { inwardIssue?: { key?: string }; outwardIssue?: { key?: string } },
  issueKey: string,
  otherKey: string,
): boolean {
  const inward = link.inwardIssue?.key?.toUpperCase();
  const outward = link.outwardIssue?.key?.toUpperCase();
  const ends = [inward, outward].filter((key): key is string => Boolean(key));
  if (!ends.length) {
    return false;
  }
  const self = issueKey.toUpperCase();
  const other = otherKey.toUpperCase();
  if (inward && outward) {
    return ends.includes(self) && ends.includes(other);
  }
  return ends[0] === other;
}

export async function verifyIssuesLinked(
  client: JiraClientConfig,
  fromKey: string,
  toKey: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (const issueKey of [fromKey, toKey]) {
      const otherKey = issueKey.toUpperCase() === fromKey.toUpperCase() ? toKey : fromKey;
      const res = await fetch(
        `${client.baseUrl}/issue/${encodeURIComponent(issueKey)}?fields=issuelinks`,
        { headers: client.headers },
      );
      if (!res.ok) {
        continue;
      }
      const data = (await res.json()) as {
        fields?: {
          issuelinks?: {
            inwardIssue?: { key?: string };
            outwardIssue?: { key?: string };
          }[];
        };
      };
      const linked = (data.fields?.issuelinks ?? []).some((link) =>
        issuelinkConnects(link, issueKey, otherKey),
      );
      if (linked) {
        return true;
      }
    }
    if (attempt < 4) {
      await pause(700);
    }
  }
  return false;
}

export async function createIssueLink(
  client: JiraClientConfig,
  inwardKey: string,
  outwardKey: string,
  linkType: string,
): Promise<void> {
  const res = await fetch(`${client.baseUrl}/issueLink`, {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({
      type: { name: linkType },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira issue link failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export type AssignableUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
};

export type UserSearchResult = {
  users: AssignableUser[];
  projectMissing: boolean;
};

export async function searchAssignableUsers(
  client: JiraClientConfig,
  projectKey: string,
  query: string,
  maxResults = 20,
): Promise<UserSearchResult> {
  const params = new URLSearchParams({
    project: projectKey,
    query,
    maxResults: String(maxResults),
  });
  const res = await fetch(
    `${client.baseUrl}/user/assignable/search?${params.toString()}`,
    { headers: client.headers },
  );
  if (res.ok) {
    const data = (await res.json()) as AssignableUser[];
    return { users: data ?? [], projectMissing: false };
  }

  if (res.status === 400 || res.status === 404) {
    const picker = await fetch(
      `${client.baseUrl}/user/picker?${new URLSearchParams({ query, maxResults: String(maxResults) })}`,
      { headers: client.headers },
    );
    if (!picker.ok) {
      return { users: [], projectMissing: true };
    }
    const data = (await picker.json()) as {
      users?: { accountId?: string; displayName?: string }[];
    };
    return {
      users: (data.users ?? [])
        .filter((user) => user.accountId && user.displayName)
        .map((user) => ({
          accountId: user.accountId as string,
          displayName: user.displayName as string,
        })),
      projectMissing: true,
    };
  }

  return { users: [], projectMissing: false };
}

export async function searchUsersByName(
  client: JiraClientConfig,
  query: string,
  projectKeys: string[],
): Promise<AssignableUser[]> {
  const merged = new Map<string, AssignableUser>();
  const keys = [...new Set(projectKeys.map((key) => key.trim()).filter(Boolean))];
  for (const key of keys) {
    const found = await searchAssignableUsers(client, key, query, 30);
    for (const user of found.users) {
      if (user.accountId && user.displayName) {
        merged.set(user.accountId, user);
      }
    }
  }
  return [...merged.values()];
}

export async function searchDirectoryUsers(
  client: JiraClientConfig,
  query: string,
): Promise<{ users: AssignableUser[]; error?: string }> {
  const params = new URLSearchParams({ query, maxResults: "20" });
  const res = await fetch(`${client.baseUrl}/user/search?${params.toString()}`, {
    headers: client.headers,
  });
  if (res.ok) {
    const data = (await res.json()) as Array<{
      accountId?: string;
      displayName?: string;
      emailAddress?: string;
      active?: boolean;
    }>;
    return {
      users: (data ?? [])
        .filter((user) => user.accountId && user.displayName && user.active !== false)
        .map((user) => ({
          accountId: user.accountId as string,
          displayName: user.displayName as string,
          emailAddress: user.emailAddress,
        })),
    };
  }

  const picker = await fetch(
    `${client.baseUrl}/user/picker?${new URLSearchParams({ query, maxResults: "20" })}`,
    { headers: client.headers },
  );
  if (!picker.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { users: [], error: `Busca de usuário falhou (${res.status}). ${detail}`.trim() };
  }
  const data = (await picker.json()) as {
    users?: { accountId?: string; displayName?: string }[];
  };
  return {
    users: (data.users ?? [])
      .filter((user) => user.accountId && user.displayName)
      .map((user) => ({
        accountId: user.accountId as string,
        displayName: user.displayName as string,
      })),
  };
}

export async function listProjects(
  client: JiraClientConfig,
): Promise<{ key: string; name: string }[]> {
  const projects: { key: string; name: string }[] = [];
  let startAt = 0;
  for (let page = 0; page < 4; page += 1) {
    const res = await fetch(
      `${client.baseUrl}/project/search?${new URLSearchParams({
        startAt: String(startAt),
        maxResults: "50",
      })}`,
      { headers: client.headers },
    );
    if (!res.ok) {
      break;
    }
    const data = (await res.json()) as {
      values?: { key?: string; name?: string }[];
      isLast?: boolean;
    };
    for (const project of data.values ?? []) {
      if (project.key) {
        projects.push({ key: project.key, name: project.name ?? project.key });
      }
    }
    if (data.isLast !== false || (data.values ?? []).length === 0) {
      break;
    }
    startAt += 50;
  }
  return projects;
}

export async function userCanCreateProjects(
  client: JiraClientConfig,
): Promise<boolean> {
  const res = await fetch(
    `${client.baseUrl}/mypermissions?permissions=ADMINISTER`,
    { headers: client.headers },
  );
  if (!res.ok) {
    return false;
  }
  const data = (await res.json()) as {
    permissions?: { ADMINISTER?: { havePermission?: boolean } };
  };
  return data.permissions?.ADMINISTER?.havePermission === true;
}

export async function createSoftwareProject(
  client: JiraClientConfig,
  input: { key: string; name: string; leadAccountId: string },
): Promise<void> {
  const res = await fetch(`${client.baseUrl}/project`, {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({
      key: input.key,
      name: input.name,
      projectTypeKey: "software",
      projectTemplateKey: "com.pyxis.greenhopper.jira:gh-simplified-agility-kanban",
      leadAccountId: input.leadAccountId,
      assigneeType: "UNASSIGNED",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira create project failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

type IssueTypeMeta = {
  name?: string;
  subtask?: boolean;
  hierarchyLevel?: number;
};

export function isSubtaskIssueTypeName(name: string): boolean {
  const compact = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!compact.startsWith("sub")) {
    return false;
  }
  const rest = compact.slice(3);
  return /^(task|tarefa|bug|story|historia)/.test(rest);
}

function isStandaloneIssueType(type: IssueTypeMeta): boolean {
  if (type.subtask === true) {
    return false;
  }
  if (typeof type.hierarchyLevel === "number" && type.hierarchyLevel < 0) {
    return false;
  }
  return !isSubtaskIssueTypeName(type.name ?? "");
}

export async function listIssueTypeNames(
  client: JiraClientConfig,
  projectKey: string,
): Promise<string[]> {
  const res = await fetch(
    `${client.baseUrl}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
    { headers: client.headers },
  );
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as {
    issueTypes?: IssueTypeMeta[];
    values?: IssueTypeMeta[];
  };
  return (data.issueTypes ?? data.values ?? [])
    .filter((type) => isStandaloneIssueType(type))
    .map((type) => type.name)
    .filter((name): name is string => Boolean(name));
}

export function matchIssueType(wanted: string, available: string[]): string {
  const names = available.filter((name) => !isSubtaskIssueTypeName(name));
  if (!names.length) {
    return isSubtaskIssueTypeName(wanted) ? "Tarefa" : wanted;
  }
  const exact = names.find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (exact) {
    return exact;
  }
  const pattern = /test|teste/i.test(wanted)
    ? /test|teste/i
    : /bug|erro|defeito/i.test(wanted)
      ? /bug|erro|defeito/i
      : null;
  if (pattern) {
    const match = names.find((name) => pattern.test(name));
    if (match) {
      return match;
    }
  }
  if (/test|teste/i.test(wanted) || isSubtaskIssueTypeName(wanted)) {
    return (
      names.find((name) => /^(task|tarefa)$/i.test(name.trim())) ??
      names.find((name) => /\b(task|tarefa)\b/i.test(name)) ??
      names[0]
    );
  }
  return wanted;
}
