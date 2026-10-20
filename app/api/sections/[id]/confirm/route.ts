import { NextRequest, NextResponse } from "next/server";
import { accountIdForWatcher } from "@/lib/agent/assignees";
import { canConfirmDraft } from "@/lib/agent/draft-state";
import { validateCardRules } from "@/lib/agent/card-rules";
import type { CreationDraft, DraftIssue, SectionDraftJson } from "@/lib/agent/types";
import { getSection, parseDraftJson, updateSection } from "@/lib/sections";
import { markdownToAdf } from "@/lib/jira/adf";
import { getValidSession } from "@/lib/jira/session";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";
import {
  addWatcher,
  listWatcherAccountIds,
  createIssue,
  createIssueLink,
  createSoftwareProject,
  listIssueTypeNames,
  listProjects,
  matchIssueType,
  resolveJiraClient,
  userCanCreateProjects,
  verifyIssueExists,
  verifyIssuesLinked,
  verifyProjectExists,
} from "@/lib/jira/client";

type RouteContext = { params: Promise<{ id: string }> };

function descriptionForJira(issue: DraftIssue): string {
  const body = (issue.description_markdown ?? "").trim();
  const source = issue.source_text?.trim();
  if (!source || body.includes(source)) {
    return body;
  }
  const language = getRawSetting(SETTING_KEYS.cardDefaultLanguage).trim().toLowerCase();
  const heading = language.startsWith("en")
    ? "Original report"
    : language.startsWith("es")
      ? "Texto original"
      : "Relato original";
  return `${body}\n\n## ${heading}\n\n${source}`;
}

function issuesToCreate(draft: CreationDraft): DraftIssue[] {
  return (draft.issues ?? []).filter(
    (issue) => issue.include_in_confirm !== false && !issue.created_key,
  );
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const section = getSection(id);
  if (!section) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const draftState = parseDraftJson(section.draft_json);
  const hasCreationDraft = (draftState.draft?.issues?.length ?? 0) > 0;
  if (section.type !== "criacao") {
    if (!hasCreationDraft) {
      return NextResponse.json({ error: "not_creation_section" }, { status: 400 });
    }
    updateSection(id, { type: "criacao" });
  }

  if (!canConfirmDraft(draftState) || !draftState.draft) {
    return NextResponse.json({ error: "draft_not_ready" }, { status: 400 });
  }

  const rulesError = validateCardRules(draftState.draft);
  if (rulesError) {
    const updated: SectionDraftJson = {
      ...draftState,
      rules_violation: rulesError,
      confirm_error: rulesError,
    };
    updateSection(id, { draft_json: JSON.stringify(updated) });
    return NextResponse.json({ error: "rules_violation", message: rulesError }, { status: 400 });
  }

  const client = await resolveJiraClient();
  if (!client) {
    return NextResponse.json({ error: "jira_not_configured" }, { status: 503 });
  }

  let createMissingProjects = false;
  try {
    const body = (await _request.json()) as { create_missing_projects?: boolean };
    createMissingProjects = body.create_missing_projects === true;
  } catch {
    createMissingProjects = false;
  }

  const draft = structuredClone(draftState.draft);
  const toCreate = issuesToCreate(draft);
  const keyByLocalId = new Map<string, string>();
  for (const issue of draft.issues ?? []) {
    if (issue.created_key) {
      keyByLocalId.set(issue.local_id, issue.created_key);
    }
  }

  try {
    const known = new Set((await listProjects(client)).map((project) => project.key.toUpperCase()));
    const missing = [
      ...new Set(
        toCreate
          .map((issue) => issue.project_key.trim().toUpperCase())
          .filter((key) => key && !known.has(key)),
      ),
    ];
    if (missing.length && !createMissingProjects) {
      return NextResponse.json(
        {
          error: "project_missing",
          message: `O projeto ${missing.join(", ")} não existe. Confirme a criação do projeto antes dos cards.`,
          projects: missing,
        },
        { status: 409 },
      );
    }
    if (missing.length) {
      const canCreate = await userCanCreateProjects(client);
      if (!canCreate) {
        return NextResponse.json(
          {
            error: "cannot_create_project",
            message: `O projeto ${missing.join(", ")} não existe e esta conta não pode criar projetos.`,
          },
          { status: 403 },
        );
      }
      const session = await getValidSession();
      if (!session?.atlassian_account_id) {
        return NextResponse.json(
          { error: "jira_not_configured", message: "Entre com o Jira de novo para criar o projeto." },
          { status: 503 },
        );
      }
      for (const key of missing) {
        if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
          throw new Error(`A chave ${key} não serve como projeto no Jira. Use de 2 a 10 letras ou números, começando com letra.`);
        }
        const proposed = draft.projects_to_create?.find((project) => project.key.toUpperCase() === key);
        try {
          await createSoftwareProject(client, {
            key,
            name: proposed?.name?.trim() || key,
            leadAccountId: session.atlassian_account_id,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/already exists|já existe|project with that name/i.test(message)) {
            throw error;
          }
        }
        const found = await verifyProjectExists(client, key);
        if (!found) {
          throw new Error(`A API não confirmou o projeto ${key}. Ele não aparece na consulta ao Jira.`);
        }
      }
    }

    const verifiedProjects: string[] = [];
    for (const key of [
      ...new Set(
        (draft.issues ?? [])
          .filter((issue) => issue.include_in_confirm !== false)
          .map((issue) => issue.project_key.trim().toUpperCase())
          .filter(Boolean),
      ),
    ]) {
      const found = await verifyProjectExists(client, key);
      if (!found) {
        throw new Error(`A consulta ao Jira não encontrou o projeto ${key}.`);
      }
      verifiedProjects.push(key);
    }

    const issueTypesByProject = new Map<string, string[]>();
    for (const issue of toCreate) {
      const projectKey = issue.project_key.trim().toUpperCase();
      issue.project_key = projectKey;
      let names = issueTypesByProject.get(projectKey);
      if (!names) {
        names = await listIssueTypeNames(client, projectKey);
        issueTypesByProject.set(projectKey, names);
      }
      const issueType = matchIssueType(issue.issue_type, names);
      issue.issue_type = issueType;
      const created = await createIssue(client, {
        project_key: projectKey,
        issue_type: issueType,
        summary: issue.summary,
        description_adf: markdownToAdf(descriptionForJira(issue)),
        priority: issue.priority,
        labels: issue.labels,
        assignee_account_id: issue.assignee_account_id,
      });
      const seen = await verifyIssueExists(client, created.key);
      if (!seen) {
        throw new Error(`O Jira devolveu ${created.key}, mas a consulta seguinte não encontrou esse card.`);
      }
      issue.created_key = seen.key;
      issue.created_url = created.url;
      issue.summary = seen.summary || issue.summary;
      keyByLocalId.set(issue.local_id, seen.key);
    }

    for (const issue of draft.issues ?? []) {
      if (issue.include_in_confirm === false || !issue.created_key) {
        continue;
      }
      const watchers = issue.watchers ?? [];
      if (watchers.length === 0) {
        continue;
      }
      const projectKey = issue.project_key.trim().toUpperCase();
      const existing = await listWatcherAccountIds(client, issue.created_key);
      for (const watcher of watchers) {
        const accountId = await accountIdForWatcher(client, watcher, projectKey);
        if (!accountId) {
          continue;
        }
        watcher.account_id = accountId;
        if (existing.has(accountId)) {
          continue;
        }
        await addWatcher(client, issue.created_key, accountId);
        existing.add(accountId);
      }
    }

    const verifiedLinks: { from: string; to: string }[] = [];
    for (const link of draft.issue_links ?? []) {
      const inward = keyByLocalId.get(link.from_local_id);
      const outward = keyByLocalId.get(link.to_local_id);
      if (!inward || !outward) {
        throw new Error("Faltou um card para vincular. A consulta não encontrou as duas chaves.");
      }
      const already = await verifyIssuesLinked(client, inward, outward);
      if (!already) {
        try {
          await createIssueLink(client, inward, outward, link.link_type || "Tests");
        } catch {
          if (link.link_type !== "Relates") {
            await createIssueLink(client, inward, outward, "Relates");
          } else {
            throw new Error(`Não foi possível vincular ${inward} e ${outward}.`);
          }
        }
      }
      const linked = await verifyIssuesLinked(client, inward, outward);
      if (!linked) {
        throw new Error(`A consulta ao Jira não encontrou o vínculo entre ${inward} e ${outward}.`);
      }
      verifiedLinks.push({ from: inward, to: outward });
    }

    const verifiedIssues = [];
    for (const issue of draft.issues ?? []) {
      if (issue.include_in_confirm === false || !issue.created_key) {
        continue;
      }
      const seen = await verifyIssueExists(client, issue.created_key);
      if (!seen) {
        throw new Error(`A consulta final não encontrou o card ${issue.created_key}.`);
      }
      verifiedIssues.push({
        key: seen.key,
        summary: seen.summary,
        url: issue.created_url,
      });
    }

    const updatedDraft: SectionDraftJson = {
      ...draftState,
      agent_status: "ready",
      draft,
      confirm_error: undefined,
      rules_violation: undefined,
    };
    updateSection(id, {
      status: "confirmed",
      draft_json: JSON.stringify(updatedDraft),
    });

    return NextResponse.json({
      section: getSection(id),
      draft: updatedDraft,
      verified: {
        projects: verifiedProjects,
        issues: verifiedIssues,
        links: verifiedLinks,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const updated: SectionDraftJson = {
      ...draftState,
      draft,
      confirm_error: message,
    };
    updateSection(id, { draft_json: JSON.stringify(updated) });
    return NextResponse.json({ error: "jira_failed", message }, { status: 502 });
  }
}
