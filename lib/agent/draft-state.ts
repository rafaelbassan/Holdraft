import { validateCardRules } from "@/lib/agent/card-rules";
import type {
  AgentRunResult,
  CreationDraft,
  DraftIssue,
  SectionDraftJson,
} from "@/lib/agent/types";

export function issuesIncludedInConfirm(draft: CreationDraft | undefined): DraftIssue[] {
  return (draft?.issues ?? []).filter((issue) => issue.include_in_confirm !== false);
}

export function hasCreatedIssuesInDraft(draft: CreationDraft | undefined): boolean {
  return issuesIncludedInConfirm(draft).some((issue) => Boolean(issue.created_key?.trim()));
}

function watcherNeedsLookup(displayName: string | undefined, accountId: string | undefined): boolean {
  const name = displayName?.trim() ?? "";
  const account = accountId?.trim() ?? "";
  return Boolean(name && !account);
}

export function hasUnresolvedPeople(draft: CreationDraft | undefined): boolean {
  for (const issue of draft?.issues ?? []) {
    if (issue.assignee_display_name?.trim() && !issue.assignee_account_id?.trim()) {
      return true;
    }
    for (const watcher of issue.watchers ?? []) {
      if (watcherNeedsLookup(watcher.display_name, watcher.account_id)) {
        return true;
      }
    }
  }
  return false;
}

export function draftConfirmInProgress(state: SectionDraftJson): boolean {
  return Boolean(state.confirm_error) || hasCreatedIssuesInDraft(state.draft);
}

export function canConfirmDraft(state: SectionDraftJson): boolean {
  if (!state.draft?.issues?.length) {
    return false;
  }
  if (state.agent_status === "ready") {
    return true;
  }
  if (!draftConfirmInProgress(state)) {
    return false;
  }
  return validateCardRules(state.draft) === null;
}

function mergeIssueProgress(previous: DraftIssue, next: DraftIssue): DraftIssue {
  if (!previous.created_key?.trim()) {
    return next;
  }
  return {
    ...next,
    created_key: previous.created_key,
    created_url: previous.created_url ?? next.created_url,
  };
}

function mergeDraftIssues(
  previous: CreationDraft | undefined,
  next: CreationDraft | undefined,
): CreationDraft | undefined {
  if (!next?.issues?.length) {
    return previous?.issues?.length ? previous : next;
  }
  if (!previous?.issues?.length) {
    return next;
  }
  const previousByLocalId = new Map(previous.issues.map((issue) => [issue.local_id, issue]));
  return {
    ...next,
    issues: next.issues.map((issue) => {
      const prior = previousByLocalId.get(issue.local_id);
      return prior ? mergeIssueProgress(prior, issue) : issue;
    }),
    issue_links: next.issue_links?.length ? next.issue_links : previous.issue_links,
    projects_to_create: next.projects_to_create?.length
      ? next.projects_to_create
      : previous.projects_to_create,
  };
}

export function mergeAgentResultIntoDraft(
  previous: SectionDraftJson,
  result: AgentRunResult,
): SectionDraftJson {
  const mergedDraft = mergeDraftIssues(previous.draft, result.draft);
  let agent_status = result.status;
  const rulesOk = mergedDraft ? validateCardRules(mergedDraft) === null : false;
  if (
    draftConfirmInProgress(previous) &&
    rulesOk &&
    !result.rules_violation &&
    !hasUnresolvedPeople(mergedDraft)
  ) {
    agent_status = "ready";
  }

  return {
    agent_status,
    jql: result.jql ?? previous.jql,
    result_cards: result.result_cards ?? previous.result_cards,
    duplicates: result.duplicates ?? previous.duplicates,
    draft: mergedDraft,
    rules_violation: result.rules_violation ?? previous.rules_violation,
    confirm_error: previous.confirm_error,
  };
}

export function existingDraftPromptBlock(state: SectionDraftJson): string {
  const draft = state.draft;
  if (!draft?.issues?.length) {
    return "";
  }
  const issueLines = draft.issues.map((issue) => {
    const jira = issue.created_key?.trim()
      ? `already in Jira as ${issue.created_key}`
      : "not in Jira yet";
    return `- ${issue.local_id}: ${issue.project_key} / ${issue.issue_type} — ${jira}`;
  });
  const linkLines = (draft.issue_links ?? []).map(
    (link) => `- ${link.from_local_id} → ${link.to_local_id} (${link.link_type})`,
  );
  const errorLine = state.confirm_error
    ? `\nLast confirm error (user may retry confirm): ${state.confirm_error}`
    : "";
  return `\n\nCurrent section draft (preserve created_key and created_url; never drop issues already in Jira):
${issueLines.join("\n")}
${linkLines.length ? `Issue links:\n${linkLines.join("\n")}` : "Issue links: none"}${errorLine}
If cards already exist in Jira and the user asks to verify or fix links/watchers, keep status ready when card-rules are satisfied. Say what Holdraft verified and tell them to use Confirm or Retry — do not offer manual API scripts or ask to run Jira calls yourself.`;
}
