import type { AgentModelOutput, DraftIssue, DraftWatcher } from "@/lib/agent/types";
import {
  resolveJiraClient,
  searchUsersByName,
  type AssignableUser,
  type JiraClientConfig,
} from "@/lib/jira/client";

type ModelMessage = { role: "user" | "assistant" | "system"; content: string };

type Complete = (messages: ModelMessage[], systemPrompt: string) => Promise<string>;

type AssigneeDecision = {
  status?: string;
  account_id?: string | null;
  display_name?: string | null;
  message_markdown?: string;
};

function append(current: string, extra: string): string {
  return `${current.trim()}\n\n${extra.trim()}`.trim();
}

function languageOf(uiLanguage: string): "en" | "es" | "pt" {
  const value = uiLanguage.trim().toLowerCase();
  if (value.startsWith("en")) {
    return "en";
  }
  if (value.startsWith("es")) {
    return "es";
  }
  return "pt";
}

type PersonRole = "assignee" | "watcher";

function assignedLine(uiLanguage: string, displayName: string, role: PersonRole): string {
  const lang = languageOf(uiLanguage);
  if (role === "watcher") {
    if (lang === "en") {
      return `Watcher: ${displayName}.`;
    }
    if (lang === "es") {
      return `Observador: ${displayName}.`;
    }
    return `Observador: ${displayName}.`;
  }
  if (lang === "en") {
    return `Assignee: ${displayName}.`;
  }
  if (lang === "es") {
    return `Responsable: ${displayName}.`;
  }
  return `Responsável: ${displayName}.`;
}

function notFoundLine(uiLanguage: string, name: string, role: PersonRole): string {
  const lang = languageOf(uiLanguage);
  if (role === "watcher") {
    if (lang === "en") {
      return `I could not find "${name}" in Jira to watch the card. Send the full name or the email.`;
    }
    if (lang === "es") {
      return `No encontré "${name}" en Jira para seguir el card. Indica el nombre completo o el correo.`;
    }
    return `Não encontrei "${name}" no Jira para acompanhar o card. Diga o nome completo ou o e-mail.`;
  }
  if (lang === "en") {
    return `I could not find "${name}" in Jira. Send the full name or the email.`;
  }
  if (lang === "es") {
    return `No encontré "${name}" en Jira. Indica el nombre completo o el correo.`;
  }
  return `Não encontrei "${name}" no Jira. Diga o nome completo ou o e-mail.`;
}

function notConnectedLine(uiLanguage: string, role: PersonRole): string {
  const lang = languageOf(uiLanguage);
  if (role === "watcher") {
    if (lang === "en") {
      return "Jira is not connected, so I cannot look up who should watch the card.";
    }
    if (lang === "es") {
      return "Jira no está conectado, así que no puedo buscar quién debe seguir el card.";
    }
    return "O Jira não está conectado, então não dá para buscar quem deve acompanhar o card.";
  }
  if (lang === "en") {
    return "Jira is not connected, so I cannot look up who should be the assignee.";
  }
  if (lang === "es") {
    return "Jira no está conectado, así que no puedo buscar quién debe ser el responsable.";
  }
  return "O Jira não está conectado, então não dá para buscar quem deve ser o responsável.";
}

function candidateList(
  uiLanguage: string,
  name: string,
  users: AssignableUser[],
  role: PersonRole,
): string {
  const lang = languageOf(uiLanguage);
  const intro =
    role === "watcher"
      ? lang === "en"
        ? `More than one Jira user matches "${name}". Who should watch the card?`
        : lang === "es"
          ? `Hay más de un usuario en Jira para "${name}". ¿Quién debe seguir el card?`
          : `Há mais de um usuário no Jira para "${name}". Quem deve acompanhar o card?`
      : lang === "en"
        ? `More than one Jira user matches "${name}". Which one should be the assignee?`
        : lang === "es"
          ? `Hay más de un usuario en Jira para "${name}". ¿Cuál debe ser el responsable?`
          : `Há mais de um usuário no Jira para "${name}". Qual deve ser o responsável?`;
  const lines = users.map((user) => {
    const email = user.emailAddress ? ` — ${user.emailAddress}` : "";
    return `- ${user.displayName}${email}`;
  });
  return `${intro}\n${lines.join("\n")}`;
}

function applyUser(issues: DraftIssue[], user: AssignableUser): void {
  for (const issue of issues) {
    issue.assignee_account_id = user.accountId;
    issue.assignee_display_name = user.displayName;
  }
}

function parseDecision(raw: string): AssigneeDecision | null {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!jsonText.startsWith("{")) {
    return null;
  }
  try {
    return JSON.parse(jsonText) as AssigneeDecision;
  } catch {
    return null;
  }
}

async function chooseAssignee(
  name: string,
  users: AssignableUser[],
  uiLanguage: string,
  conversation: ModelMessage[],
  complete: Complete,
  role: PersonRole,
): Promise<AssigneeDecision | null> {
  const wanted = role === "watcher" ? "a Jira watcher" : "a Jira assignee";
  const instruction = `You match a person the user wants as ${wanted}. Reply ONLY with JSON:
{"status":"resolved"|"ambiguous"|"not_found","account_id":null,"display_name":null,"message_markdown":""}
Write message_markdown in ${uiLanguage}.
resolved only when one account is clearly who they mean, including when a later message names that person.
If more than one account could still be that person, status is ambiguous, account_id is null, and message_markdown asks which one, listing display name and email.
Do not guess between people who share the name.
not_found when none of the accounts are that person.
account_id must be copied from the list.`;

  const payload = {
    requested_name: name,
    users: users.map((user) => ({
      accountId: user.accountId,
      displayName: user.displayName,
      emailAddress: user.emailAddress ?? null,
    })),
    conversation: conversation.slice(-6).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 2000),
    })),
  };

  const raw = await complete(
    [{ role: "user", content: JSON.stringify(payload) }],
    instruction,
  );
  return parseDecision(raw);
}

export async function resolveDraftAssignees(
  output: AgentModelOutput,
  uiLanguage: string,
  conversation: ModelMessage[],
  complete: Complete,
): Promise<void> {
  const draft = output.draft;
  if (output.intent !== "criar" || !draft?.issues?.length) {
    return;
  }

  const groups = new Map<string, { name: string; issues: DraftIssue[] }>();
  for (const issue of draft.issues) {
    issue.assignee_account_id = null;
    const name = issue.assignee_display_name?.trim() ?? "";
    issue.assignee_display_name = name || null;
    if (!name) {
      continue;
    }
    const key = name.toLocaleLowerCase();
    const group = groups.get(key) ?? { name, issues: [] };
    group.issues.push(issue);
    groups.set(key, group);
  }
  if (groups.size === 0) {
    return;
  }

  const client = await resolveJiraClient();
    if (!client) {
    output.status = "need_clarification";
    output.message_markdown = append(
      output.message_markdown,
      notConnectedLine(uiLanguage, "assignee"),
    );
    return;
  }

  const projectKeys = draft.issues
    .map((issue) => issue.project_key?.trim() ?? "")
    .filter(Boolean);

  for (const group of groups.values()) {
    const users = await searchUsersByName(client, group.name, projectKeys);
    if (users.length === 1) {
      applyUser(group.issues, users[0]);
      output.message_markdown = append(
        output.message_markdown,
        assignedLine(uiLanguage, users[0].displayName, "assignee"),
      );
      continue;
    }

    if (users.length === 0) {
      output.message_markdown = append(
        output.message_markdown,
        notFoundLine(uiLanguage, group.name, "assignee"),
      );
      continue;
    }

    const decision = await chooseAssignee(
      group.name,
      users,
      uiLanguage,
      conversation,
      complete,
      "assignee",
    );
    const chosen = users.find((user) => user.accountId === decision?.account_id?.trim());
    if (decision?.status === "resolved" && chosen) {
      applyUser(group.issues, chosen);
      output.message_markdown = append(
        output.message_markdown,
        decision.message_markdown?.trim() ||
          assignedLine(uiLanguage, chosen.displayName, "assignee"),
      );
      continue;
    }

    const question =
      decision?.message_markdown?.trim() ||
      (decision?.status === "not_found"
        ? notFoundLine(uiLanguage, group.name, "assignee")
        : candidateList(uiLanguage, group.name, users, "assignee"));
    output.message_markdown = append(output.message_markdown, question);
  }

  const pending = [...groups.values()].some((group) =>
    group.issues.some((issue) => !issue.assignee_account_id),
  );
  if (pending) {
    output.status = "need_clarification";
  }
}

function looksLikeAccountId(value: string): boolean {
  return value.length >= 20 && /^[A-Za-z0-9:_-]+$/.test(value);
}

export function requestedWatcherName(watcher: DraftWatcher): string {
  const display = watcher.display_name?.trim() ?? "";
  const account = watcher.account_id?.trim() ?? "";
  if (display && !looksLikeAccountId(display)) {
    return display;
  }
  if (account && !looksLikeAccountId(account)) {
    return account;
  }
  return display;
}

function applyWatcher(slots: DraftWatcher[], user: AssignableUser): void {
  for (const watcher of slots) {
    watcher.account_id = user.accountId;
    watcher.display_name = user.displayName;
  }
}

function dedupeWatchers(issue: DraftIssue): void {
  const seen = new Set<string>();
  issue.watchers = (issue.watchers ?? []).filter((watcher) => {
    const key = watcher.account_id || `name:${(watcher.display_name ?? "").toLocaleLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function accountIdForWatcher(
  client: JiraClientConfig,
  watcher: DraftWatcher,
  projectKey: string,
): Promise<string | null> {
  const name = requestedWatcherName(watcher);
  const stored = watcher.account_id?.trim() ?? "";
  if (!name) {
    return looksLikeAccountId(stored) ? stored : null;
  }

  const users = await searchUsersByName(client, name, [projectKey]);
  if (users.length === 1) {
    return users[0].accountId;
  }
  const exactId = users.find((user) => user.accountId === stored);
  if (exactId) {
    return exactId.accountId;
  }
  const sameName = users.filter(
    (user) => user.displayName.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (sameName.length === 1) {
    return sameName[0].accountId;
  }
  if (users.length === 0) {
    throw new Error(`Não encontrei "${name}" no Jira para acompanhar o card.`);
  }
  throw new Error(
    `Há mais de um usuário no Jira para "${name}". Diga qual deve acompanhar o card.`,
  );
}

export async function resolveDraftWatchers(
  output: AgentModelOutput,
  uiLanguage: string,
  conversation: ModelMessage[],
  complete: Complete,
): Promise<void> {
  const draft = output.draft;
  if (output.intent !== "criar" || !draft?.issues?.length) {
    return;
  }

  const groups = new Map<string, { name: string; slots: DraftWatcher[] }>();
  for (const issue of draft.issues) {
    const next: DraftWatcher[] = [];
    for (const watcher of issue.watchers ?? []) {
      const name = requestedWatcherName(watcher);
      if (!name) {
        continue;
      }
      const slot: DraftWatcher = { account_id: "", display_name: name };
      next.push(slot);
      const key = name.toLocaleLowerCase();
      const group = groups.get(key) ?? { name, slots: [] };
      group.slots.push(slot);
      groups.set(key, group);
    }
    issue.watchers = next;
  }
  if (groups.size === 0) {
    return;
  }

  const client = await resolveJiraClient();
  if (!client) {
    output.status = "need_clarification";
    output.message_markdown = append(
      output.message_markdown,
      notConnectedLine(uiLanguage, "watcher"),
    );
    return;
  }

  const projectKeys = draft.issues
    .map((issue) => issue.project_key?.trim() ?? "")
    .filter(Boolean);

  for (const group of groups.values()) {
    const users = await searchUsersByName(client, group.name, projectKeys);
    if (users.length === 1) {
      applyWatcher(group.slots, users[0]);
      output.message_markdown = append(
        output.message_markdown,
        assignedLine(uiLanguage, users[0].displayName, "watcher"),
      );
      continue;
    }

    if (users.length === 0) {
      output.message_markdown = append(
        output.message_markdown,
        notFoundLine(uiLanguage, group.name, "watcher"),
      );
      continue;
    }

    const decision = await chooseAssignee(
      group.name,
      users,
      uiLanguage,
      conversation,
      complete,
      "watcher",
    );
    const chosen = users.find((user) => user.accountId === decision?.account_id?.trim());
    if (decision?.status === "resolved" && chosen) {
      applyWatcher(group.slots, chosen);
      output.message_markdown = append(
        output.message_markdown,
        decision.message_markdown?.trim() ||
          assignedLine(uiLanguage, chosen.displayName, "watcher"),
      );
      continue;
    }

    const question =
      decision?.message_markdown?.trim() ||
      (decision?.status === "not_found"
        ? notFoundLine(uiLanguage, group.name, "watcher")
        : candidateList(uiLanguage, group.name, users, "watcher"));
    output.message_markdown = append(output.message_markdown, question);
  }

  for (const issue of draft.issues) {
    dedupeWatchers(issue);
  }

  const pending = [...groups.values()].some((group) =>
    group.slots.some((watcher) => !watcher.account_id),
  );
  if (pending) {
    output.status = "need_clarification";
  }
}
