import { validateCardRules } from "@/lib/agent/card-rules";
import { AgentRunError, AgentTrace, clipText, failureLead, textFromModelContent, withDebugBlock } from "@/lib/agent/debug-trace";
import { readCardRulesFile } from "@/lib/card-rules-file";
import type {
  AgentModelOutput,
  AgentRunResult,
  CreationDraft,
  JiraCardSummary,
} from "@/lib/agent/types";
import { cleanSectionTitle } from "@/lib/section-text";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";
import { resolveDraftAssignees, resolveDraftWatchers } from "@/lib/agent/assignees";
import { prepareConsultaJql } from "@/lib/agent/consulta-jql";
import { issueIsDone, orderConsultaCards, priorityRank } from "@/lib/agent/priority-order";
import { existingDraftPromptBlock, hasCreatedIssuesInDraft } from "@/lib/agent/draft-state";
import type { SectionDraftJson } from "@/lib/agent/types";
import {
  listProjects,
  resolveJiraClient,
  searchJql,
  userCanCreateProjects,
  verifyIssueExists,
  verifyIssuesLinked,
} from "@/lib/jira/client";

const MAX_JSON_RETRIES = 2;
const LLM_TIMEOUT_MS = 45_000;
const SWITCH_MODEL_STATUS = new Set([400, 404, 408, 409, 429, 500, 502, 503, 529]);

export class LlmCallError extends Error {
  readonly code: "model_busy" | "model_auth" | "model_failed";
  readonly retryable: boolean;
  readonly tryNextModel: boolean;
  readonly detail: string;

  constructor(
    code: "model_busy" | "model_auth" | "model_failed",
    retryable: boolean,
    tryNextModel: boolean,
    detail = "",
  ) {
    super(detail || code);
    this.name = "LlmCallError";
    this.code = code;
    this.retryable = retryable;
    this.tryNextModel = tryNextModel;
    this.detail = detail;
  }
}

export function agentErrorPayload(error: unknown): {
  error: string;
  retryable: boolean;
  detail?: string;
} {
  if (error instanceof AgentRunError) {
    const inner = agentErrorPayload(error.source);
    return { ...inner, detail: error.debugMarkdown };
  }
  if (error instanceof LlmCallError) {
    return {
      error: error.code,
      retryable: error.retryable,
      detail: error.detail || undefined,
    };
  }
  if (error instanceof Error && error.message === "MODEL_NOT_CONFIGURED") {
    return { error: "model_not_configured", retryable: false };
  }
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { error: "agent_failed", retryable: true, detail };
}

function modelSequence(): string[] {
  const primary = getRawSetting(SETTING_KEYS.modelName).trim();
  const extra = getRawSetting(SETTING_KEYS.modelFallbacks)
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const models: string[] = [];
  for (const name of [primary, ...extra]) {
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    models.push(name);
  }
  return models;
}

function readCardRules(): string {
  return readCardRulesFile();
}

function buildSystemPrompt(
  uiLanguage: string,
  cardLanguage: string,
  cardRules: string,
  sectionType: "consulta" | "criacao" | "unknown",
  projectCatalog: string,
  existingDraftBlock: string,
): string {
  const rulesBlock =
    sectionType === "criacao" || sectionType === "unknown"
      ? `\n\nRegras de criação (obrigatório quando intent=criar):\n${cardRules}`
      : "";

  return `You are Holdraft, a Jira assistant. Reply ONLY with a single JSON object (no markdown fence).

UI language for message_markdown: ${uiLanguage}
Card text language (summary and description_markdown): ${cardLanguageLabel(cardLanguage)}.
Write those fields only in that language. Do not copy the pasted message and do not translate it sentence by sentence.
Read the report and write the work: what is wrong, the impact, the expected result, and the change when the report supports it.
Keep UI strings, error codes, and product names in quotes, exactly as reported.
Put the untouched source excerpt in source_text. The description is the work, not the report.
A test card says how to verify: what to do, what passes, and what fails.
If the report does not say what must be done, set status to need_clarification and ask. Do not invent the fix.

JSON schema:
{
  "intent": "consultar" | "criar",
  "status": "need_clarification" | "ready",
  "message_markdown": "markdown shown in chat; may use GFM and \`\`\`mermaid blocks",
  "section_title": "2 to 5 words in the UI language naming this chat",
  "jql": "optional JQL when intent=consultar and status=ready",
  "search_terms": "optional short text to find duplicate issues when intent=criar",
  "draft": {
    "issues": [{
      "local_id": "unique string",
      "project_key": "PROJ",
      "issue_type": "Bug|Task|Test|...",
      "summary": "work title in the card language",
      "description_markdown": "work specification in the card language, not a literal translation",
      "source_text": "untouched excerpt from the pasted report",
      "priority": "optional",
      "labels": ["optional"],
      "assignee_account_id": null,
      "assignee_display_name": null or "name the user said",
      "watchers": [{ "account_id": "", "display_name": "name the user said" }],
      "include_in_confirm": true
    }],
    "issue_links": [{ "from_local_id": "...", "to_local_id": "...", "link_type": "Tests" }],
    "projects_to_create": [{ "key": "NEW", "name": "Name shown to the user" }]
  }
}

Rules:
- intent consultar: no draft, no Jira writes. When status is ready, set jql to the exact query. message_markdown must answer in complete sentences in the UI language. Never stop after a colon or after "here is the query" with nothing following. The app appends the JQL and the issues found as text; still write the answer.
- For a person in JQL, write assignee = "the name the user said" or reporter = "name". Do not use ~ on assignee or reporter and do not invent an accountId. The app looks the name up and rewrites the clause to the account id. On this Jira, ORDER BY priority ASC lists the lowest priority first. Highest priority first is ORDER BY priority DESC. Do not tell the user that ASC lists the highest priority first. Do not name a specific issue key as the winner. The app ranks the open issues after the search.
- intent criar: apply card-rules; status ready only if draft complete and rules satisfied.
- Never mark ready if a bug fix lacks a companion test issue per card-rules.
- Section locked to consulta must stay consultar; criacao stays criar.
- project_key must be one of the real projects below, or a new key only when the user can create projects.
- Never create a project yourself. If the named project is missing and creation is allowed, put it in draft.projects_to_create and say that confirmation will create the project and then the cards.
- message_markdown must never say the project, cards, or links were created, saved, or configured successfully. Nothing is written to Jira until the user presses confirm. Describe the draft and say it is not in Jira yet.
- section_title is a short sidebar label, not a sentence. Name the topic. No period.
- If creation is not allowed, ask the user to pick an existing project and do not mark ready with an unknown key.
- When the user says who should own the cards, put that name in assignee_display_name on each affected issue. Instructions such as assigning everyone ("atribua todos ao Henrique", "assign all to Henrique") apply to every issue in the draft. Leave assignee_account_id null. Never invent an accountId. A later step searches Jira for that name and either fills the account or asks which person they mean. Do not set need_clarification only because the account id is unknown.
- When the user names other people who should follow the cards, put each name in watchers[].display_name on each affected issue. Leave account_id as an empty string. Never invent an accountId. A later step searches Jira for that name and either fills the account or asks which person they mean. Do not set need_clarification only because the watcher account id is unknown. Do not copy the assignee into watchers unless the user also asked that person to watch.
${projectCatalog}
${existingDraftBlock}
${rulesBlock}`;
}

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type ModelReply = {
  model: string;
  content: string;
  reasoning: string;
};

function reasoningFromMessage(message: {
  reasoning?: unknown;
  reasoning_content?: unknown;
  thinking?: unknown;
}): string {
  return [message.reasoning, message.reasoning_content, message.thinking]
    .map((value) => textFromModelContent(value))
    .filter(Boolean)
    .join("\n\n");
}

async function callModel(
  model: string,
  messages: ChatMessage[],
  systemPrompt: string,
  baseUrl: string,
  apiKey: string,
  jsonMode: boolean,
): Promise<ModelReply> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new LlmCallError("model_busy", true, true, `Rede ao chamar \`${model}\`: ${message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const auth = res.status === 401 || res.status === 403;
    const busy = res.status === 429 || res.status === 503 || res.status === 529;
    const code = auth ? "model_auth" : busy || res.status >= 500 ? "model_busy" : "model_failed";
    throw new LlmCallError(
      code,
      !auth,
      SWITCH_MODEL_STATUS.has(res.status),
      `HTTP ${res.status} em \`${model}\`: ${clipText(body, 1200)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: {
      finish_reason?: string;
      message?: {
        content?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
        thinking?: unknown;
      };
    }[];
  };
  const message = data.choices?.[0]?.message ?? {};
  const content = textFromModelContent(message.content);
  const reasoning = reasoningFromMessage(message);
  if (!content.trim() && !reasoning.trim()) {
    const preview = clipText(JSON.stringify(message), 1500);
    const finish = data.choices?.[0]?.finish_reason;
    throw new LlmCallError(
      "model_failed",
      true,
      true,
      `Modelo \`${model}\` devolveu texto vazio${finish ? ` (${finish})` : ""}. ${preview}`,
    );
  }
  return { model, content, reasoning };
}

async function callLlm(
  messages: ChatMessage[],
  systemPrompt: string,
  trace: AgentTrace,
): Promise<ModelReply> {
  const baseUrl = getRawSetting(SETTING_KEYS.modelBaseUrl).replace(/\/$/, "");
  const apiKey = getRawSetting(SETTING_KEYS.modelApiKey);
  const models = modelSequence();

  if (!baseUrl || !apiKey || models.length === 0) {
    throw new Error("MODEL_NOT_CONFIGURED");
  }

  let last: LlmCallError | null = null;
  for (const model of models) {
    trace.step(`Chamando modelo \`${model}\`.`);
    try {
      const reply = await callModel(model, messages, systemPrompt, baseUrl, apiKey, true);
      trace.noteModelText(reply.content, reply.reasoning);
      trace.step(
        `Modelo \`${model}\` respondeu: ${reply.content.length} caracteres de texto, ${reply.reasoning.length} de pensamento.`,
      );
      return reply;
    } catch (error) {
      if (!(error instanceof LlmCallError)) {
        throw error;
      }
      trace.step(`Modelo \`${model}\` falhou (${error.code}). ${error.detail}`.trim());
      const rejectedJson =
        error.code === "model_failed" && /400|response_format|json_object|json mode/i.test(error.detail);
      if (rejectedJson) {
        trace.step(`Nova tentativa de \`${model}\` sem response_format.`);
        try {
          const reply = await callModel(model, messages, systemPrompt, baseUrl, apiKey, false);
          trace.noteModelText(reply.content, reply.reasoning);
          trace.step(
            `Modelo \`${model}\` respondeu sem JSON mode: ${reply.content.length} caracteres de texto, ${reply.reasoning.length} de pensamento.`,
          );
          return reply;
        } catch (retryError) {
          if (!(retryError instanceof LlmCallError)) {
            throw retryError;
          }
          trace.step(
            `Segunda tentativa de \`${model}\` falhou (${retryError.code}). ${retryError.detail}`.trim(),
          );
          last = retryError;
          if (!retryError.tryNextModel) {
            throw retryError;
          }
          continue;
        }
      }
      last = error;
      if (!error.tryNextModel) {
        throw error;
      }
    }
  }

  throw last ?? new LlmCallError("model_failed", true, false, "Nenhum modelo respondeu.");
}

function parseModelJson(raw: string): AgentModelOutput {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText) as AgentModelOutput;
  if (parsed.intent !== "consultar" && parsed.intent !== "criar") {
    throw new Error("Invalid intent");
  }
  if (parsed.status !== "need_clarification" && parsed.status !== "ready") {
    throw new Error("Invalid status");
  }
  if (typeof parsed.message_markdown !== "string") {
    throw new Error("Missing message_markdown");
  }
  parsed.section_title = cleanSectionTitle(parsed.section_title);
  return parsed;
}

function normalizeDraft(draft: CreationDraft | undefined): CreationDraft | undefined {
  if (!draft?.issues?.length) {
    return draft;
  }
  return {
    ...draft,
    issues: draft.issues.map((issue, idx) => ({
      ...issue,
      local_id: issue.local_id || `issue-${idx + 1}`,
      include_in_confirm: issue.include_in_confirm !== false,
    })),
  };
}

function cardLanguageLabel(code: string): string {
  const value = code.trim().toLowerCase();
  if (value === "pt-br" || value === "pt") {
    return "Brazilian Portuguese (português do Brasil)";
  }
  if (value === "en" || value === "en-us") {
    return "English";
  }
  if (value === "es" || value === "es-es" || value === "es-419") {
    return "Spanish (español)";
  }
  return code;
}

function pastedOutsideCardLanguage(text: string, cardLanguage: string): boolean {
  const prose = text
    .replace(/"[^"]*"/g, " ")
    .replace(/“[^”]*”/g, " ")
    .replace(/«[^»]*»/g, " ");
  const lang = cardLanguage.trim().toLowerCase();
  if (lang.startsWith("pt")) {
    return /\b(el contenido|no es correcto|se envió|debe ser|aun cuando|sin red|no se pudo|después de|las transacciones|mensaje de|debe de aparecer|desencript|cuando no)\b/i.test(
      prose,
    );
  }
  if (lang.startsWith("en")) {
    return /\b(não |conteúdo|el contenido|mensagem|deve ser|o que precisa)\b/i.test(text);
  }
  if (lang.startsWith("es")) {
    return /\b(não |conteúdo|o que precisa|resultado esperado)\b/i.test(text);
  }
  return false;
}

function descriptionTooThin(text: string): boolean {
  return text.trim().length < 220;
}

function cardsNeedRewrite(draft: CreationDraft, cardLanguage: string): boolean {
  return draft.issues.some((issue) => {
    const text = `${issue.summary}\n${issue.description_markdown}`;
    return pastedOutsideCardLanguage(text, cardLanguage) || descriptionTooThin(issue.description_markdown ?? "");
  });
}

type RewrittenIssue = {
  local_id: string;
  summary: string;
  description_markdown: string;
  source_text?: string;
};

async function rewriteCardsIfNeeded(
  output: AgentModelOutput,
  messages: ChatMessage[],
  cardLanguage: string,
  trace: AgentTrace,
): Promise<void> {
  if (output.intent !== "criar" || !output.draft?.issues.length) {
    return;
  }
  if (!cardsNeedRewrite(output.draft, cardLanguage)) {
    return;
  }

  const language = cardLanguageLabel(cardLanguage);
  const payload = {
    issues: output.draft.issues.map((issue) => ({
      local_id: issue.local_id,
      issue_type: issue.issue_type,
      summary: issue.summary,
      description_markdown: issue.description_markdown,
    })),
    conversation: messages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    })),
  };
  const instruction = `Rewrite this Jira draft. Reply ONLY with JSON:
{"status":"need_clarification"|"ready","message_markdown":"","issues":[{"local_id":"","summary":"","description_markdown":"","source_text":""}]}
Write summary and description_markdown only in ${language}. Do not translate sentence by sentence. State the problem, the impact, the expected result, and the change when the report supports it. Keep UI strings, error codes, and product names in quotes exactly as reported. A test card says what to do, what passes, and what fails. source_text is the untouched excerpt. If the report does not say what must be done, set status to need_clarification, ask in message_markdown, and still describe what is known. Return every local_id. Do not add or drop cards.`;

  let rewritten: { status?: string; message_markdown?: string; issues?: RewrittenIssue[] };
  try {
    const reply = await callLlm(
      [{ role: "user", content: JSON.stringify(payload) }],
      instruction,
      trace,
    );
    const raw = reply.content.trim() || reply.reasoning.trim();
    const trimmed = raw.trim();
    const jsonText = trimmed.startsWith("{")
      ? trimmed
      : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    rewritten = JSON.parse(jsonText) as typeof rewritten;
  } catch (error) {
    if (error instanceof LlmCallError && !error.retryable) {
      throw error;
    }
    output.status = "need_clarification";
    output.message_markdown +=
      "\n\nOs cards ainda não estão no idioma configurado. Tente de novo antes de confirmar.";
    return;
  }

  const next = rewritten.issues ?? [];
  const byId = new Map(next.map((issue) => [issue.local_id, issue]));
  const complete = output.draft.issues.every((issue) => {
    const item = byId.get(issue.local_id);
    return Boolean(item?.summary?.trim() && item.description_markdown?.trim());
  });
  if (!complete) {
    output.status = "need_clarification";
    output.message_markdown +=
      "\n\nOs cards ainda não estão no idioma configurado. Tente de novo antes de confirmar.";
    return;
  }

  output.draft.issues = output.draft.issues.map((issue) => {
    const item = byId.get(issue.local_id)!;
    return {
      ...issue,
      summary: item.summary.trim(),
      description_markdown: item.description_markdown.trim(),
      source_text: item.source_text?.trim() || issue.source_text,
    };
  });
  if (rewritten.message_markdown?.trim()) {
    output.message_markdown = `${output.message_markdown}\n\n${rewritten.message_markdown.trim()}`;
  }
  if (rewritten.status === "need_clarification" || cardsNeedRewrite(output.draft, cardLanguage)) {
    output.status = "need_clarification";
  }
}

function defaultConsultaJql(): string {
  return "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
}

function consultaLabels(uiLanguage: string): {
  query: string;
  empty: string;
  disconnected: string;
  failed: string;
} {
  if (uiLanguage.startsWith("en")) {
    return {
      query: "Query",
      empty: "No issues matched this query.",
      disconnected: "Jira is not connected, so the query was not run.",
      failed: "The query did not run.",
    };
  }
  if (uiLanguage.startsWith("es")) {
    return {
      query: "Consulta",
      empty: "Ningún card coincide con esta consulta.",
      disconnected: "Jira no está conectado, así que la consulta no se ejecutó.",
      failed: "La consulta no se ejecutó.",
    };
  }
  return {
    query: "Consulta",
    empty: "Nenhum card corresponde a esta consulta.",
    disconnected: "O Jira não está conectado, então a consulta não foi executada.",
    failed: "A consulta não foi executada.",
  };
}

function formatConsultaCard(card: JiraCardSummary): string {
  const meta = [card.status, card.priority].filter(Boolean).join(" · ");
  const summary = card.summary.trim() || card.key;
  return meta ? `- ${card.key} — ${summary} (${meta})` : `- ${card.key} — ${summary}`;
}

function immediateConsultaLine(cards: JiraCardSummary[], uiLanguage: string): string {
  const open = cards.filter((card) => !issueIsDone(card.status));
  if (!open.length) {
    if (uiLanguage.startsWith("en")) {
      return "Nothing in this result is still open.";
    }
    if (uiLanguage.startsWith("es")) {
      return "Nada en este resultado sigue abierto.";
    }
    return "Nada neste resultado continua aberto.";
  }
  const best = priorityRank(open[0]?.priority);
  const top = open.filter((card) => priorityRank(card.priority) === best);
  const item = (card: JiraCardSummary) =>
    `**${card.key}** — ${card.summary.trim() || card.key} (${[card.priority, card.status].filter(Boolean).join(" · ")})`;
  if (top.length === 1) {
    const card = top[0];
    if (uiLanguage.startsWith("en")) {
      return `Do this now: ${item(card)}.`;
    }
    if (uiLanguage.startsWith("es")) {
      return `Haz esto ahora: ${item(card)}.`;
    }
    return `Faça agora: ${item(card)}.`;
  }
  const lines = top.map((card) => `- ${item(card)}`).join("\n");
  if (uiLanguage.startsWith("en")) {
    return `Do these now. They tie at the highest priority still open:\n${lines}`;
  }
  if (uiLanguage.startsWith("es")) {
    return `Haz estas ahora. Empatan en la prioridad más alta que sigue abierta:\n${lines}`;
  }
  return `Faça agora. Estas empatam na prioridade mais alta que ainda está aberta:\n${lines}`;
}

function appendConsultaText(
  output: AgentModelOutput,
  cards: JiraCardSummary[] | undefined,
  failure: "disconnected" | "failed" | null,
  detail: string | undefined,
): void {
  if (output.intent !== "consultar") {
    return;
  }
  const jql = output.jql?.trim();
  if (output.status !== "ready" && !jql) {
    return;
  }

  const executed = jql || defaultConsultaJql();
  output.jql = executed;
  const uiLanguage = getRawSetting(SETTING_KEYS.uiLanguage) || "pt-BR";
  const labels = consultaLabels(uiLanguage);
  const ranked = orderConsultaCards(cards ?? []);
  const lead =
    !failure && output.status === "ready" && ranked.length
      ? immediateConsultaLine(ranked, uiLanguage)
      : "";
  const message = output.message_markdown ?? "";
  const parts: string[] = [];
  if (lead && !message.includes(lead)) {
    parts.push(lead);
  }
  if (!message.includes(executed)) {
    parts.push(`**${labels.query}**\n\n\`\`\`\n${executed}\n\`\`\``);
  }
  if (failure === "disconnected") {
    parts.push(labels.disconnected);
  } else if (failure === "failed") {
    const reason = detail?.trim();
    parts.push(reason ? `${labels.failed} ${reason}` : labels.failed);
  } else if (output.status === "ready") {
    const found = ranked;
    if (!found.length) {
      parts.push(labels.empty);
    } else {
      parts.push(found.map(formatConsultaCard).join("\n"));
    }
  }
  if (!parts.length && !lead) {
    return;
  }
  const rest = parts.filter((part) => part !== lead);
  const body = [message.trim(), ...rest].filter(Boolean).join("\n\n");
  output.message_markdown = [lead, body].filter(Boolean).join("\n\n");
}

async function enrichWithJira(
  output: AgentModelOutput,
  trace: AgentTrace,
): Promise<{
  result_cards?: JiraCardSummary[];
  duplicates?: JiraCardSummary[];
  consulta_failure?: "disconnected" | "failed";
  consulta_detail?: string;
}> {
  const client = await resolveJiraClient();
  if (!client) {
    if (output.intent === "consultar" && output.status === "ready") {
      output.jql = output.jql?.trim() || defaultConsultaJql();
      trace.step("Jira não está conectado. A consulta não foi executada.");
      return { result_cards: [], consulta_failure: "disconnected" };
    }
    trace.step("Jira não está conectado.");
    return {};
  }

  if (output.intent === "consultar" && output.status === "ready") {
    output.jql = output.jql?.trim() || defaultConsultaJql();
    const uiLanguage = getRawSetting(SETTING_KEYS.uiLanguage) || "pt-BR";
    const ready = await prepareConsultaJql(output, client, trace, uiLanguage);
    if (!ready) {
      trace.step("A consulta não foi executada até o usuário da JQL ficar definido.");
      return { result_cards: [] };
    }
    const jql = output.jql?.trim() || defaultConsultaJql();
    output.jql = jql;
    trace.step(`Executando JQL: ${jql}`);
    try {
      const result_cards = orderConsultaCards(await searchJql(client, jql));
      const first = result_cards[0];
      trace.step(
        `Jira devolveu ${result_cards.length} card(s). Ordem exibida: ${
          first ? `${first.key} (${first.priority || "sem prioridade"}) primeiro` : "vazia"
        }.`,
      );
      return { result_cards };
    } catch (error) {
      const consulta_detail = error instanceof Error ? error.message : String(error);
      trace.step(`A busca no Jira falhou. ${clipText(consulta_detail, 1500)}`);
      return { result_cards: [], consulta_failure: "failed", consulta_detail };
    }
  }

  if (output.intent === "criar" && output.search_terms?.trim()) {
    const terms = output.search_terms.replace(/"/g, '\\"');
    const jql = `text ~ "${terms}" ORDER BY updated DESC`;
    trace.step(`Buscando duplicados: ${jql}`);
    try {
      const duplicates = await searchJql(client, jql, 10);
      trace.step(`Duplicados encontrados: ${duplicates.length}.`);
      return { duplicates };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace.step(`Busca de duplicados falhou. ${clipText(message, 800)}`);
      return {};
    }
  }

  return {};
}

async function appendCreatedIssueVerification(
  output: AgentModelOutput,
): Promise<void> {
  const draft = output.draft;
  if (!draft?.issues?.some((issue) => issue.created_key?.trim())) {
    return;
  }
  const client = await resolveJiraClient();
  if (!client) {
    return;
  }

  const lines: string[] = [];
  for (const issue of draft.issues ?? []) {
    const key = issue.created_key?.trim();
    if (!key) {
      continue;
    }
    const seen = await verifyIssueExists(client, key);
    lines.push(
      seen
        ? `- ${seen.key} (${seen.summary || issue.summary}) — encontrado na API`
        : `- ${key} — a API não encontrou este card`,
    );
  }

  const keyByLocalId = new Map(
    (draft.issues ?? [])
      .filter((issue) => issue.created_key?.trim())
      .map((issue) => [issue.local_id, issue.created_key!.trim()]),
  );
  for (const link of draft.issue_links ?? []) {
    const from = keyByLocalId.get(link.from_local_id);
    const to = keyByLocalId.get(link.to_local_id);
    if (!from || !to) {
      continue;
    }
    const linked = await verifyIssuesLinked(client, from, to);
    lines.push(
      linked
        ? `- Vínculo ${from} ↔ ${to} — presente na API`
        : `- Vínculo ${from} ↔ ${to} — ausente na API`,
    );
  }

  if (!lines.length) {
    return;
  }

  const uiLanguage = getRawSetting(SETTING_KEYS.uiLanguage) || "pt-BR";
  const heading = uiLanguage.startsWith("en")
    ? "API check (cards already in Jira)"
    : uiLanguage.startsWith("es")
      ? "Consulta en la API (cards ya en Jira)"
      : "Consulta na API (cards já no Jira)";
  const footer = uiLanguage.startsWith("en")
    ? "Use **Retry** to finish watchers or links that are still missing."
    : uiLanguage.startsWith("es")
      ? "Use **Reintentar** para completar observadores o vínculos que falten."
      : "Use **Tentar novamente** para completar observadores ou vínculos que ainda faltem.";
  output.message_markdown = `${output.message_markdown.trim()}\n\n**${heading}**\n${lines.join("\n")}\n\n${footer}`.trim();
}

export type RunAgentInput = {
  sectionType: "consulta" | "criacao" | "unknown";
  messages: ChatMessage[];
  existingDraft?: SectionDraftJson;
};

const UNVERIFIED_CLAIM =
  /sucesso|foi criado|foram criados|criei o projeto|configurad[oa]s? com sucesso|already created|successfully/i;

function presentAsDraft(message: string): string {
  const notice =
    "Ainda não há nada no Jira. Isto é só o rascunho. A confirmação grava, e o Holdraft só diz que concluiu depois de consultar de novo o projeto, os cards e os vínculos na API.";
  const cleaned = message
    .split("\n")
    .filter((line) => !UNVERIFIED_CLAIM.test(line))
    .join("\n")
    .trim();
  return `${notice}\n\n${cleaned}`.trim();
}

function applyProjectCatalog(
  output: AgentModelOutput,
  projects: { key: string; name: string }[],
  canCreateProjects: boolean,
): void {
  if (output.intent !== "criar" || !output.draft?.issues?.length) {
    return;
  }
  const known = new Set(projects.map((project) => project.key.toUpperCase()));
  const missing: string[] = [];
  for (const issue of output.draft.issues) {
    const key = (issue.project_key ?? "").trim().toUpperCase();
    issue.project_key = key;
    if (key && !known.has(key) && !missing.includes(key)) {
      missing.push(key);
    }
  }
  if (!missing.length) {
    output.draft.projects_to_create = [];
    return;
  }
  const listed = projects.map((project) => `${project.key} (${project.name})`).join(", ");
  if (!canCreateProjects) {
    output.status = "need_clarification";
    output.draft.projects_to_create = [];
    output.message_markdown += `\n\nO projeto ${missing.join(", ")} não existe, e esta conta não pode criar projetos. Escolha um destes: ${listed || "nenhum projeto visível"}.`;
    return;
  }
  output.draft.projects_to_create = missing.map((key) => ({ key, name: key }));
  output.message_markdown += `\n\nO projeto ${missing.join(", ")} ainda não existe. Nada é criado agora. Na confirmação, o Holdraft cria o projeto e só então os cards.`;
}

export async function runAgent(input: RunAgentInput): Promise<AgentRunResult> {
  const trace = new AgentTrace();
  const uiLanguage = getRawSetting(SETTING_KEYS.uiLanguage) || "pt-BR";
  try {
    return await runAgentTurn(input, trace, uiLanguage);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    trace.step(`Interrompido: ${clipText(message, 1500)}`);
    throw new AgentRunError(error, withDebugBlock(failureLead(uiLanguage), trace.toMarkdown(uiLanguage)));
  }
}

async function runAgentTurn(
  input: RunAgentInput,
  trace: AgentTrace,
  uiLanguage: string,
): Promise<AgentRunResult> {
  const cardLanguage =
    getRawSetting(SETTING_KEYS.cardDefaultLanguage) || "pt-BR";
  const cardRules = readCardRules();
  const jira = await resolveJiraClient();
  const projects = jira ? await listProjects(jira) : [];
  const canCreateProjects = jira ? await userCanCreateProjects(jira) : false;
  const projectCatalog = projects.length
    ? `\n\nProjetos visíveis: ${projects.map((project) => `${project.key} (${project.name})`).join(", ")}.\nPode criar projeto: ${canCreateProjects ? "sim" : "não"}.`
    : "\n\nProjetos visíveis: nenhum.\nPode criar projeto: não.";

  let lockedType = input.sectionType;
  if (lockedType === "unknown") {
    lockedType = "unknown";
  }

  const systemPrompt = buildSystemPrompt(
    uiLanguage,
    cardLanguage,
    cardRules,
    lockedType === "unknown" ? "unknown" : lockedType,
    projectCatalog,
    existingDraftPromptBlock(input.existingDraft ?? {}),
  );

  let lastError: Error | null = null;
  let parsed: AgentModelOutput | null = null;

  for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt += 1) {
    try {
      const extra =
        attempt > 0
          ? "\n\nYour previous reply was not valid JSON. Return only the JSON object."
          : "";
      const reply = await callLlm(input.messages, systemPrompt + extra, trace);
      const raw = reply.content.trim() || reply.reasoning.trim();
      parsed = parseModelJson(raw);
      trace.step(
        `JSON válido: intent=${parsed.intent}, status=${parsed.status}, jql=${parsed.jql?.trim() || "(vazio)"}, mensagem=${parsed.message_markdown.length} caracteres.`,
      );
      break;
    } catch (e) {
      if (e instanceof LlmCallError) {
        throw e;
      }
      const message = e instanceof Error ? e.message : String(e);
      trace.step(`JSON inválido: ${clipText(message, 800)}`);
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  if (!parsed) {
    throw lastError ?? new Error("Failed to parse agent JSON");
  }

  if (lockedType === "consulta") {
    parsed.intent = "consultar";
  } else if (lockedType === "criacao") {
    parsed.intent = "criar";
  }

  parsed.draft = normalizeDraft(parsed.draft);
  if ((parsed.draft?.issues?.length ?? 0) > 0) {
    parsed.intent = "criar";
  }
  applyProjectCatalog(parsed, projects, canCreateProjects);
  await rewriteCardsIfNeeded(parsed, input.messages, cardLanguage, trace);
  if (parsed.intent === "criar" && !hasCreatedIssuesInDraft(parsed.draft)) {
    parsed.message_markdown = presentAsDraft(parsed.message_markdown);
  }
  const askModel = async (messages: ChatMessage[], prompt: string) => {
    const reply = await callLlm(messages, prompt, trace);
    return reply.content.trim() || reply.reasoning.trim();
  };
  await resolveDraftAssignees(parsed, uiLanguage, input.messages, askModel);
  await resolveDraftWatchers(parsed, uiLanguage, input.messages, askModel);
  await appendCreatedIssueVerification(parsed);

  let rules_violation: string | null = null;
  if (parsed.intent === "criar" && parsed.status === "ready") {
    rules_violation = validateCardRules(parsed.draft);
    if (rules_violation) {
      parsed.status = "need_clarification";
    }
  }

  const jiraExtra = await enrichWithJira(parsed, trace);
  appendConsultaText(
    parsed,
    jiraExtra.result_cards,
    jiraExtra.consulta_failure ?? null,
    jiraExtra.consulta_detail,
  );
  const debug = trace.toMarkdown(uiLanguage);
  parsed.message_markdown = withDebugBlock(parsed.message_markdown, debug);

  return {
    intent: parsed.intent,
    status: parsed.status,
    message_markdown: parsed.message_markdown,
    section_title: parsed.section_title,
    jql: parsed.jql,
    result_cards: jiraExtra.result_cards,
    duplicates: jiraExtra.duplicates,
    draft: parsed.draft,
    rules_violation: rules_violation ?? undefined,
  };
}

export function agentResultToDraftJson(result: AgentRunResult): string {
  return JSON.stringify({
    agent_status: result.status,
    jql: result.jql,
    result_cards: result.result_cards,
    duplicates: result.duplicates,
    draft: result.draft,
    rules_violation: result.rules_violation,
  });
}
