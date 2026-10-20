export type AgentIntent = "consultar" | "criar";

export type AgentStatus = "need_clarification" | "ready";

export type JiraCardSummary = {
  key: string;
  summary: string;
  status: string;
  priority?: string;
  due?: string;
  url: string;
};

export type DraftWatcher = {
  account_id: string;
  display_name?: string;
};

export type DraftIssue = {
  local_id: string;
  project_key: string;
  issue_type: string;
  summary: string;
  description_markdown: string;
  source_text?: string;
  priority?: string;
  labels?: string[];
  assignee_account_id?: string | null;
  assignee_display_name?: string | null;
  watchers?: DraftWatcher[];
  include_in_confirm?: boolean;
  created_key?: string;
  created_url?: string;
};

export type DraftIssueLink = {
  from_local_id: string;
  to_local_id: string;
  link_type: string;
};

export type DraftProject = {
  key: string;
  name: string;
};

export type CreationDraft = {
  issues: DraftIssue[];
  issue_links?: DraftIssueLink[];
  projects_to_create?: DraftProject[];
};

export type SectionDraftJson = {
  agent_status?: AgentStatus;
  jql?: string;
  result_cards?: JiraCardSummary[];
  duplicates?: JiraCardSummary[];
  draft?: CreationDraft;
  confirm_error?: string;
  rules_violation?: string;
};

export type AgentRunResult = {
  intent: AgentIntent;
  status: AgentStatus;
  message_markdown: string;
  section_title?: string;
  jql?: string;
  result_cards?: JiraCardSummary[];
  duplicates?: JiraCardSummary[];
  draft?: CreationDraft;
  rules_violation?: string;
};

export type AgentModelOutput = {
  intent: AgentIntent;
  status: AgentStatus;
  message_markdown: string;
  section_title?: string;
  jql?: string;
  search_terms?: string;
  draft?: CreationDraft;
};
