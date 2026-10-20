import type { AgentTrace } from "@/lib/agent/debug-trace";
import type { AgentModelOutput } from "@/lib/agent/types";
import {
  searchDirectoryUsers,
  type AssignableUser,
  type JiraClientConfig,
} from "@/lib/jira/client";

const NAME_CLAUSE =
  /\b(assignee|reporter)\s*(?:~|=)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-zÀ-ÿ][\wÀ-ÿ.-]*))/gi;

function looksLikeAccountId(value: string): boolean {
  return value.includes(":") || /^[0-9a-f]{24}$/i.test(value);
}

function skipName(value: string): boolean {
  return /^(currentuser\(\)|empty|null)$/i.test(value.trim()) || looksLikeAccountId(value);
}

function jqlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function highestPriorityFirst(jql: string): { jql: string; changed: boolean } {
  const next = jql.replace(/\border\s+by\s+priority\s+asc\b/i, "ORDER BY priority DESC");
  return { jql: next, changed: next !== jql };
}

function narrowUsers(name: string, users: AssignableUser[]): AssignableUser[] {
  const wanted = name.trim().toLocaleLowerCase();
  const exact = users.filter((user) => user.displayName.trim().toLocaleLowerCase() === wanted);
  if (exact.length) {
    return exact;
  }
  const starts = users.filter((user) => user.displayName.toLocaleLowerCase().startsWith(wanted));
  if (starts.length) {
    return starts;
  }
  return users;
}

function personLines(users: AssignableUser[]): string {
  return users
    .map((user) => {
      const email = user.emailAddress ? ` — ${user.emailAddress}` : "";
      return `- ${user.displayName}${email}`;
    })
    .join("\n");
}

function askWhich(uiLanguage: string, name: string, users: AssignableUser[]): string {
  const list = personLines(users);
  if (uiLanguage.startsWith("en")) {
    return `More than one Jira user matches "${name}". Which one should the query use?\n${list}`;
  }
  if (uiLanguage.startsWith("es")) {
    return `Hay más de un usuario en Jira para "${name}". ¿Cuál debe usar la consulta?\n${list}`;
  }
  return `Há mais de um usuário no Jira para "${name}". Qual a consulta deve usar?\n${list}`;
}

function notFound(uiLanguage: string, name: string): string {
  if (uiLanguage.startsWith("en")) {
    return `I could not find "${name}" in Jira. Send the full name or the email.`;
  }
  if (uiLanguage.startsWith("es")) {
    return `No encontré "${name}" en Jira. Indica el nombre completo o el correo.`;
  }
  return `Não encontrei "${name}" no Jira. Diga o nome completo ou o e-mail.`;
}

type NameClause = { field: string; name: string; raw: string };

function nameClauses(jql: string): NameClause[] {
  const found: NameClause[] = [];
  for (const match of jql.matchAll(NAME_CLAUSE)) {
    const name = (match[2] || match[3] || match[4] || "").trim();
    if (!name || skipName(name) || !match[0]) {
      continue;
    }
    found.push({ field: match[1], name, raw: match[0] });
  }
  return found;
}

export async function prepareConsultaJql(
  output: AgentModelOutput,
  client: JiraClientConfig,
  trace: AgentTrace,
  uiLanguage: string,
): Promise<boolean> {
  let jql = output.jql?.trim() || "";
  const priority = highestPriorityFirst(jql);
  if (priority.changed) {
    trace.step(
      "Neste Jira, ORDER BY priority ASC lista a prioridade mais baixa primeiro. A consulta passou a usar DESC.",
    );
    jql = priority.jql;
  }

  const clauses = nameClauses(jql);
  for (const clause of clauses) {
    const found = await searchDirectoryUsers(client, clause.name);
    if (found.error) {
      trace.step(found.error);
    }
    const users = narrowUsers(clause.name, found.users);
    trace.step(`Busca de usuário "${clause.name}": ${users.length} conta(s).`);
    if (users.length === 0) {
      output.status = "need_clarification";
      output.jql = jql;
      const note = found.error?.trim() || notFound(uiLanguage, clause.name);
      output.message_markdown = `${output.message_markdown.trim()}\n\n${note}`.trim();
      return false;
    }
    if (users.length > 1) {
      output.status = "need_clarification";
      output.jql = jql;
      output.message_markdown = `${output.message_markdown.trim()}\n\n${askWhich(uiLanguage, clause.name, users)}`.trim();
      return false;
    }
    const user = users[0];
    const replacement = `${clause.field} = ${jqlQuote(user.accountId)}`;
    jql = jql.replace(clause.raw, () => replacement);
    trace.step(`${clause.field} "${clause.name}" virou a conta ${user.displayName}.`);
  }

  output.jql = jql;
  return true;
}
