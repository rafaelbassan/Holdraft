"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { canConfirmDraft } from "@/lib/agent/draft-state";
import { isStoredLlmFailure, storedFailureLooksBusy } from "@/lib/agent/llm-failure";
import { sectionIsFull, sectionIsGrowing } from "@/lib/section-text";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import type { Messages } from "@/lib/i18n";
import type {
  CreationDraft,
  DraftIssue,
  JiraCardSummary,
  SectionDraftJson,
} from "@/lib/agent/types";

type SectionSummary = {
  id: number;
  type: "consulta" | "criacao";
  title: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type SectionMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
};

type SectionDetail = SectionSummary & {
  draft: SectionDraftJson;
  messages: SectionMessage[];
};

type SessionInfo = {
  user: { displayName: string | null; email: string | null } | null;
  jiraConnected: boolean;
};

type HomeChatProps = {
  t: Messages;
  modelConfigured: boolean;
};

function CardList({
  cards,
  title,
}: {
  cards: JiraCardSummary[];
  title: string;
}) {
  if (!cards.length) {
    return null;
  }
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {cards.map((c) => (
          <li key={c.key} className="text-sm">
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-blue-600 hover:underline"
            >
              {c.key}
            </a>
            <span className="text-slate-700"> — {c.summary}</span>
            <span className="text-slate-500">
              {" "}
              ({c.status}
              {c.priority ? ` · ${c.priority}` : ""})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type UserHit = { accountId: string; displayName: string };
type UserSearch = { users: UserHit[]; projectMissing: boolean };
type ProjectOption = { key: string; name: string };

function DraftEditor({
  draft,
  t,
  projects,
  onChange,
}: {
  draft: CreationDraft;
  t: Messages;
  projects: ProjectOption[];
  onChange: (draft: CreationDraft) => void;
}) {
  const updateIssue = (index: number, patch: Partial<DraftIssue>) => {
    const issues = [...(draft.issues ?? [])];
    issues[index] = { ...issues[index], ...patch };
    onChange({ ...draft, issues });
  };

  const searchUsers = async (projectKey: string, q: string): Promise<UserSearch> => {
    const res = await fetch(
      `/api/jira/assignable?project=${encodeURIComponent(projectKey)}&q=${encodeURIComponent(q)}`,
    );
    if (!res.ok) {
      return { users: [], projectMissing: false };
    }
    const data = (await res.json()) as UserSearch;
    return { users: data.users ?? [], projectMissing: Boolean(data.projectMissing) };
  };

  return (
    <div className="mt-4 space-y-4">
      <h3 className="text-sm font-semibold text-slate-900">{t.home.draftTitle}</h3>
      {(draft.issues ?? []).map((issue, idx) => (
        <div
          key={issue.local_id}
          className="rounded-lg border border-slate-200 bg-white p-3 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              {issue.project_key} · {issue.issue_type}
            </span>
            {issue.created_key && (
              <a
                href={issue.created_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                {issue.created_key}
              </a>
            )}
          </div>
          <label className="block text-xs text-slate-600">{t.home.projectLabel}</label>
          <select
            className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
            value={issue.project_key}
            onChange={(e) => updateIssue(idx, { project_key: e.target.value })}
          >
            {projects.map((project) => (
              <option key={project.key} value={project.key}>
                {project.key} — {project.name}
              </option>
            ))}
            {issue.project_key &&
              !projects.some((project) => project.key === issue.project_key) && (
                <option value={issue.project_key}>
                  {issue.project_key} ({t.home.newProjectOption})
                </option>
              )}
          </select>
          <label className="block text-xs text-slate-600">{t.home.draftSummary}</label>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={issue.summary}
            onChange={(e) => updateIssue(idx, { summary: e.target.value })}
          />
          <label className="block text-xs text-slate-600">{t.home.draftDescription}</label>
          <textarea
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
            rows={8}
            value={issue.description_markdown}
            onChange={(e) =>
              updateIssue(idx, { description_markdown: e.target.value })
            }
          />
          {issue.source_text?.trim() && (
            <div>
              <label className="block text-xs text-slate-600">{t.home.draftSource}</label>
              <pre className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">
                {issue.source_text}
              </pre>
            </div>
          )}
          <AssigneeField
            issue={issue}
            t={t}
            onPick={(accountId, displayName) =>
              updateIssue(idx, {
                assignee_account_id: accountId,
                assignee_display_name: displayName,
              })
            }
            searchUsers={searchUsers}
          />
          <WatchersField
            issue={issue}
            t={t}
            onChange={(watchers) => updateIssue(idx, { watchers })}
            searchUsers={searchUsers}
          />
        </div>
      ))}
    </div>
  );
}

function WatchersField({
  issue,
  t,
  onChange,
  searchUsers,
}: {
  issue: DraftIssue;
  t: Messages;
  onChange: (watchers: DraftIssue["watchers"]) => void;
  searchUsers: (project: string, q: string) => Promise<UserSearch>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [projectMissing, setProjectMissing] = useState(false);
  const watchers = issue.watchers ?? [];

  return (
    <div>
      <label className="block text-xs text-slate-600">{t.home.draftWatchers}</label>
      <ul className="mb-2 space-y-1 text-xs">
        {watchers.map((w, index) => (
          <li
            key={`${w.account_id || w.display_name || "watcher"}-${index}`}
            className="flex items-center justify-between gap-2"
          >
            <span>{w.display_name ?? w.account_id}</span>
            <button
              type="button"
              className="text-red-600 hover:underline"
              onClick={() =>
                onChange(watchers.filter((x) => x.account_id !== w.account_id))
              }
            >
              {t.home.removeWatcher}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-base sm:text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") {
              return;
            }
            e.preventDefault();
            if (!issue.project_key || query.length < 2) {
              return;
            }
            void (async () => {
              const found = await searchUsers(issue.project_key, query);
              setResults(found.users);
              setProjectMissing(found.projectMissing);
              setSearched(true);
            })();
          }}
          placeholder={t.home.draftAssigneePlaceholder}
        />
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          onClick={async () => {
            if (!issue.project_key || query.length < 2) {
              return;
            }
            const found = await searchUsers(issue.project_key, query);
            setResults(found.users);
            setProjectMissing(found.projectMissing);
            setSearched(true);
          }}
        >
          {t.home.searchUsers}
        </button>
      </div>
      {projectMissing && (
        <p className="mt-1 text-xs text-slate-500">{t.home.projectMissingSearch}</p>
      )}
      {searched && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">{t.home.noUsers}</p>
      )}
      {results.length > 0 && (
        <ul className="mt-1 max-h-24 overflow-y-auto rounded border border-slate-200 bg-slate-50 text-xs">
          {results.map((u) => (
            <li key={u.accountId}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left hover:bg-white"
                onClick={() => {
                  if (!watchers.some((w) => w.account_id === u.accountId)) {
                    onChange([
                      ...watchers,
                      { account_id: u.accountId, display_name: u.displayName },
                    ]);
                  }
                  setQuery("");
                  setResults([]);
                }}
              >
                {u.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssigneeField({
  issue,
  t,
  onPick,
  searchUsers,
}: {
  issue: DraftIssue;
  t: Messages;
  onPick: (accountId: string | null, displayName: string | null) => void;
  searchUsers: (project: string, q: string) => Promise<UserSearch>;
}) {
  const [query, setQuery] = useState(issue.assignee_display_name ?? "");
  const [results, setResults] = useState<UserHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [projectMissing, setProjectMissing] = useState(false);

  useEffect(() => {
    setQuery(issue.assignee_display_name ?? "");
  }, [issue.assignee_display_name, issue.local_id]);

  const runSearch = useCallback(async () => {
    if (!issue.project_key || query.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const found = await searchUsers(issue.project_key, query);
    setResults(found.users);
    setProjectMissing(found.projectMissing);
    setSearched(true);
  }, [issue.project_key, query, searchUsers]);

  return (
    <div>
      <label className="block text-xs text-slate-600">{t.home.draftAssignee}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-base sm:text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
          placeholder={t.home.draftAssigneePlaceholder}
        />
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          onClick={() => void runSearch()}
        >
          {t.home.searchUsers}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
          onClick={() => onPick(null, null)}
        >
          {t.home.clearAssignee}
        </button>
      </div>
      {projectMissing && (
        <p className="mt-1 text-xs text-slate-500">{t.home.projectMissingSearch}</p>
      )}
      {searched && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-500">{t.home.noUsers}</p>
      )}
      {results.length > 0 && (
        <ul className="mt-1 max-h-32 overflow-y-auto rounded border border-slate-200 bg-slate-50 text-xs">
          {results.map((u) => (
            <li key={u.accountId}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left hover:bg-white"
                onClick={() => {
                  onPick(u.accountId, u.displayName);
                  setQuery(u.displayName);
                  setResults([]);
                }}
              >
                {u.displayName}{" "}
                <span className="text-slate-400">({u.accountId.slice(0, 8)}…)</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThinkingBubble({
  agentLabel,
  thinking,
}: {
  agentLabel: string;
  thinking: string;
}) {
  return (
    <div className="mb-4 sm:mr-8" aria-live="polite">
      <p className="mb-1 text-xs text-slate-500">{agentLabel}</p>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
        {thinking}
      </div>
    </div>
  );
}

function PendingTurn({
  text,
  loading,
  youLabel,
  agentLabel,
  thinking,
}: {
  text: string;
  loading: boolean;
  youLabel: string;
  agentLabel: string;
  thinking: string;
}) {
  return (
    <>
      <div className="mb-4 sm:ml-8">
        <p className="mb-1 text-xs text-slate-500">{youLabel}</p>
        <div className="rounded-lg bg-slate-100 p-3">
          <MarkdownMessage content={text} />
        </div>
      </div>
      {loading ? <ThinkingBubble agentLabel={agentLabel} thinking={thinking} /> : null}
    </>
  );
}

function AgentNotice({
  notice,
  storedContent,
  loading,
  retryLabel,
  busyText,
  failedText,
  onRetry,
}: {
  notice: { text: string; retryable: boolean; detail?: string } | null;
  storedContent: string | null;
  loading: boolean;
  retryLabel: string;
  busyText: string;
  failedText: string;
  onRetry: () => void;
}) {
  if (loading) {
    return null;
  }
  const text =
    notice?.text ??
    (storedContent
      ? storedFailureLooksBusy(storedContent)
        ? busyText
        : failedText
      : null);
  const detail = notice?.detail?.trim() || (storedContent && !notice ? storedContent : "");
  if (!text && !detail) {
    return null;
  }
  const retryable = notice ? notice.retryable : true;
  return (
    <div
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
      role="status"
    >
      {text ? <p>{text}</p> : null}
      {detail ? (
        <div className="mt-3 max-h-96 overflow-auto rounded-md border border-amber-200 bg-white p-3 text-slate-800">
          <MarkdownMessage content={detail} />
        </div>
      ) : null}
      {retryable ? (
        <button
          type="button"
          className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function SimilarBanner({
  title,
  question,
  openLabel,
  createLabel,
  disabled,
  createDisabled,
  onOpen,
  onCreate,
}: {
  title: string;
  question: string;
  openLabel: string;
  createLabel: string;
  disabled: boolean;
  createDisabled: boolean;
  onOpen: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">
      <p>{question.split("{title}").join(title)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={onOpen}
        >
          {openLabel}
        </button>
        <button
          type="button"
          disabled={createDisabled}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          onClick={onCreate}
        >
          {createLabel}
        </button>
      </div>
    </div>
  );
}

function missingProjectKeys(
  issues: DraftIssue[] | undefined,
  projects: ProjectOption[],
): string[] {
  return [
    ...new Set(
      (issues ?? [])
        .filter((issue) => issue.include_in_confirm !== false)
        .map((issue) => issue.project_key.trim().toUpperCase())
        .filter(
          (key) => key && !projects.some((project) => project.key.toUpperCase() === key),
        ),
    ),
  ];
}

function ProjectConfirm({
  t,
  loading,
  projectsLoaded,
  canCreateProjects,
  missingKeys,
  resume,
  onConfirm,
}: {
  t: Messages;
  loading: boolean;
  projectsLoaded: boolean;
  canCreateProjects: boolean;
  missingKeys: string[];
  resume: boolean;
  onConfirm: (createMissing: boolean) => void;
}) {
  const missing = projectsLoaded ? missingKeys : [];
  const blocked = missing.length > 0 && !canCreateProjects;
  return (
    <div className="mt-4">
      {missing.length > 0 && canCreateProjects && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {missing.join(", ")}: {t.home.projectWillBeCreated}
        </p>
      )}
      {blocked && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {missing.join(", ")}: {t.home.cannotCreateProject}
        </p>
      )}
      <button
        type="button"
        disabled={loading || !projectsLoaded || blocked}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        onClick={() => onConfirm(missing.length > 0)}
      >
        {resume
          ? t.common.retry
          : missing.length > 0
            ? t.home.confirmCreateProject
            : t.home.confirmCreation}
      </button>
    </div>
  );
}

export function HomeChat({ t, modelConfigured }: HomeChatProps) {
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [detail, setDetail] = useState<SectionDetail | null>(null);
  const [composer, setComposer] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [similar, setSimilar] = useState<{ id: number; title: string } | null>(null);
  const [hiddenMatchId, setHiddenMatchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [canCreateProjects, setCanCreateProjects] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [agentNotice, setAgentNotice] = useState<{
    text: string;
    retryable: boolean;
    detail?: string;
  } | null>(null);

  const noticeFor = useCallback(
    (code: string | undefined, retryable: boolean | undefined) => {
      if (code === "model_auth") {
        return { text: t.home.modelAuth, retryable: false };
      }
      if (code === "model_busy") {
        return { text: t.home.modelBusy, retryable: true };
      }
      if (code === "model_not_configured") {
        return { text: t.common.missingModel, retryable: false };
      }
      return { text: t.home.modelFailed, retryable: retryable !== false };
    },
    [t.common.missingModel, t.home.modelAuth, t.home.modelBusy, t.home.modelFailed],
  );

  const loadSections = useCallback(async () => {
    const res = await fetch("/api/sections");
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { sections: SectionSummary[] };
    setSections(data.sections);
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/sections?id=${id}`);
    if (!res.ok) {
      setDetail(null);
      return;
    }
    const data = (await res.json()) as { section: SectionDetail };
    setDetail(data.section);
  }, []);

  useEffect(() => {
    void fetch("/api/jira/projects")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { projects?: ProjectOption[]; canCreateProjects?: boolean } | null) => {
        setProjects(data?.projects ?? []);
        setCanCreateProjects(Boolean(data?.canCreateProjects));
        setProjectsLoaded(true);
      })
      .catch(() => setProjectsLoaded(true));
  }, []);

  useEffect(() => {
    void loadSections();
    void fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setSession(d as SessionInfo))
      .catch(() => setSession(null));
  }, [loadSections]);

  useEffect(() => {
    if (selectedId != null) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const threadStamp = [
    selectedId ?? "",
    detail?.messages.map((message) => `${message.id}\n${message.content}`).join("\n") ?? "",
    pendingText ?? "",
    sending ? "1" : "0",
    error ?? "",
    agentNotice?.text ?? "",
  ].join("\u0000");

  useLayoutEffect(() => {
    const node = threadRef.current;
    if (!node) {
      return;
    }
    const scrollToEnd = () => {
      node.scrollTop = node.scrollHeight;
    };
    scrollToEnd();
    const frame = window.requestAnimationFrame(scrollToEnd);
    const timer = window.setTimeout(scrollToEnd, 300);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [threadStamp]);

  const removeSection = async (id: number) => {
    if (!window.confirm(t.home.deleteSectionConfirm)) {
      return;
    }
    setError(null);
    const res = await fetch(`/api/sections/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(t.common.error);
      return;
    }
    setSimilar((current) => (current?.id === id ? null : current));
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
      setPendingText(null);
      setAgentNotice(null);
      setComposer("");
    }
    await loadSections();
  };

  const firstUserMessage = useMemo(
    () => detail?.messages.find((m) => m.role === "user")?.content ?? "",
    [detail],
  );

  const chatMessages = useMemo(
    () =>
      detail?.messages.filter(
        (m, idx) => !(m.role === "user" && idx === 0) && !isStoredLlmFailure(m.content),
      ) ?? [],
    [detail],
  );

  const storedFailure = useMemo(() => {
    const failed = detail?.messages.filter(
      (m) => m.role === "assistant" && isStoredLlmFailure(m.content),
    );
    return failed?.length ? failed[failed.length - 1] : null;
  }, [detail]);

  const sectionFull = useMemo(
    () => (detail ? sectionIsFull(detail.messages) : false),
    [detail],
  );
  const sectionGrowing = useMemo(
    () => (detail ? sectionIsGrowing(detail.messages) : false),
    [detail],
  );

  const confirmAllowed = useMemo(
    () => (detail ? canConfirmDraft(detail.draft) : false),
    [detail],
  );

  useEffect(() => {
    const draftingNew = (selectedId == null || sectionFull) && !loading && !sending;
    if (!draftingNew) {
      setSimilar(null);
      return;
    }
    const text = composer.trim();
    if (text.length < 12) {
      setSimilar(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/sections/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          exclude_id: sectionFull ? selectedId : null,
        }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { match?: { id: number; title: string } | null } | null) => {
          if (controller.signal.aborted) {
            return;
          }
          const match = data?.match ?? null;
          setSimilar(match && match.id !== hiddenMatchId ? match : null);
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [composer, hiddenMatchId, loading, sectionFull, selectedId, sending]);

  const createSection = async (text: string) => {
    const message = text.trim();
    if (!message) {
      return;
    }
    setLoading(true);
    setSending(true);
    setError(null);
    setAgentNotice(null);
    setSimilar(null);
    setPendingText(message);
    setComposer("");
    setSelectedId(null);
    setDetail(null);
    let placed = false;
    try {
      const res = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as {
        section?: SectionDetail;
        error?: string;
        retryable?: boolean;
        detail?: string;
      };
      if (!res.ok) {
        setAgentNotice({ ...noticeFor(data.error, data.retryable), detail: data.detail });
        if (data.section) {
          placed = true;
          setSelectedId(data.section.id);
          if (window.matchMedia("(max-width: 1023px)").matches) {
            setListOpen(false);
          }
          setDetail(data.section);
        } else {
          setComposer(message);
        }
        return;
      }
      await loadSections();
      if (data.section) {
        placed = true;
        setSelectedId(data.section.id);
        setDetail(data.section);
        if (window.matchMedia("(max-width: 1023px)").matches) {
          setListOpen(false);
        }
      }
    } catch {
      if (!placed) {
        setComposer(message);
      }
      setAgentNotice(noticeFor(undefined, true));
    } finally {
      setPendingText(null);
      setSending(false);
      setLoading(false);
    }
  };

  const applyAgentResponse = async (
    res: Response,
    data: { section?: SectionDetail; error?: string; retryable?: boolean; detail?: string },
  ) => {
    if (data.section) {
      setDetail(data.section);
      await loadSections();
    }
    if (!res.ok) {
      setAgentNotice({ ...noticeFor(data.error, data.retryable), detail: data.detail });
    }
  };

  const sendMessage = async () => {
    if (!selectedId || !composer.trim()) {
      return;
    }
    const text = composer.trim();
    setLoading(true);
    setSending(true);
    setError(null);
    setAgentNotice(null);
    setPendingText(text);
    setComposer("");
    try {
      const res = await fetch(`/api/sections/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = (await res.json()) as {
        section?: SectionDetail;
        error?: string;
        retryable?: boolean;
        detail?: string;
      };
      if (data.error === "section_full") {
        setComposer(text);
        setSelectedId(null);
        setDetail(null);
        setError(t.home.sectionFull);
        return;
      }
      await applyAgentResponse(res, data);
    } finally {
      setPendingText(null);
      setSending(false);
      setLoading(false);
    }
  };

  const submitComposer = () => {
    const text = composer.trim();
    if (!text || loading || !modelConfigured) {
      return;
    }
    if (selectedId != null && !sectionFull) {
      void sendMessage();
      return;
    }
    void createSection(text);
  };

  const startFresh = () => {
    setSelectedId(null);
    setDetail(null);
    setComposer("");
    setSimilar(null);
    setHiddenMatchId(null);
    setPendingText(null);
    setAgentNotice(null);
    setError(null);
    composerRef.current?.focus();
  };

  const openSimilar = () => {
    if (!similar) {
      return;
    }
    setSelectedId(similar.id);
    setSimilar(null);
    setHiddenMatchId(null);
    setAgentNotice(null);
    setPendingText(null);
    setError(null);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setListOpen(false);
    }
  };

  const createDespiteMatch = () => {
    const text = composer.trim();
    if (similar) {
      setHiddenMatchId(similar.id);
    }
    setSimilar(null);
    if (text) {
      void createSection(text);
    }
  };

  const retryLast = async () => {
    if (!selectedId) {
      return;
    }
    setLoading(true);
    setSending(true);
    setError(null);
    setAgentNotice(null);
    try {
      const res = await fetch(`/api/sections/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry: true }),
      });
      const data = (await res.json()) as {
        section?: SectionDetail;
        error?: string;
        retryable?: boolean;
        detail?: string;
      };
      await applyAgentResponse(res, data);
    } finally {
      setSending(false);
      setLoading(false);
    }
  };

  const saveDraft = async (draft: CreationDraft) => {
    if (!selectedId || !detail) {
      return;
    }
    const res = await fetch(`/api/sections/${selectedId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    const data = (await res.json()) as { section?: SectionDetail };
    if (data.section) {
      setDetail(data.section);
    }
  };

  const confirmDraft = async (createMissingProjects: boolean) => {
    if (!selectedId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sections/${selectedId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ create_missing_projects: createMissingProjects }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        draft?: SectionDraftJson;
      };
      await loadDetail(selectedId);
      if (!res.ok) {
        setError(data.message ?? data.error ?? t.common.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const setupHint = !modelConfigured
    ? t.common.missingModel
    : !session?.jiraConnected
      ? t.common.missingJiraLogin
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900">{t.home.title}</h1>
          <p className="truncate text-sm text-slate-500">{t.home.subtitle}</p>
        </div>
        <p className="shrink-0 text-sm text-slate-600">
          {session?.user?.displayName || session?.user?.email ? (
            <>
              {t.home.loggedInAs}{" "}
              <strong>{session.user.displayName ?? session.user.email}</strong>
            </>
          ) : (
            t.home.notLoggedIn
          )}
        </p>
      </div>
      {setupHint ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          {setupHint}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside
        className={`w-full flex-col overflow-hidden border-b border-slate-200 bg-slate-50 lg:flex lg:w-80 lg:min-h-0 lg:max-h-none lg:flex-none lg:border-b-0 lg:border-r ${
          selectedId == null
            ? "flex max-h-44 shrink-0"
            : listOpen
              ? "flex min-h-0 flex-1"
              : "hidden lg:flex"
        }`}
      >
        <div className="p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t.nav.sections}
          </h2>
          {sections.length === 0 ? (
            <p className="mt-2 text-sm leading-5 text-slate-500">{t.home.noSections}</p>
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {sections.map((s) => (
            <li key={s.id} className="flex border-t border-slate-200">
              <button
                type="button"
                className={`min-w-0 flex-1 px-3 py-2 text-left text-sm hover:bg-white ${
                  selectedId === s.id ? "bg-white font-medium" : ""
                }`}
                onClick={() => {
                  setAgentNotice(null);
                  setPendingText(null);
                  setSimilar(null);
                  setHiddenMatchId(null);
                  setComposer("");
                  setSelectedId(s.id);
                  if (window.matchMedia("(max-width: 1023px)").matches) {
                    setListOpen(false);
                  }
                }}
              >
                <span className="text-xs text-slate-500">
                  {t.sectionTypes[s.type]}
                </span>
                <div className="truncate text-slate-900">{s.title}</div>
              </button>
              <button
                type="button"
                className="shrink-0 px-3 text-xs text-red-700 hover:bg-red-50"
                onClick={() => void removeSection(s.id)}
              >
                {t.home.deleteSection}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section
        className={`min-h-0 min-w-0 flex-1 flex-col bg-slate-50/40 lg:flex ${
          selectedId == null || !listOpen ? "flex" : "hidden lg:flex"
        }`}
      >
        {selectedId != null ? (
          <div className="border-b border-slate-200 px-3 py-2 lg:hidden">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              onClick={() => setListOpen(true)}
            >
              {t.admin.sections}
            </button>
          </div>
        ) : null}

        {!detail ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div ref={threadRef} className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
              {pendingText ? (
                <PendingTurn
                  text={pendingText}
                  loading={sending}
                  youLabel={t.home.you}
                  agentLabel={t.home.agent}
                  thinking={t.home.thinking}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <p className="max-w-sm text-center text-sm leading-6 text-slate-500">
                    {t.home.selectSection}
                  </p>
                </div>
              )}
              <AgentNotice
                notice={agentNotice}
                storedContent={null}
                loading={sending}
                retryLabel={t.common.retry}
                busyText={t.home.modelBusy}
                failedText={t.home.modelFailed}
                onRetry={() => void retryLast()}
              />
              {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 py-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                onClick={startFresh}
              >
                {t.home.newSection}
              </button>
              <button
                type="button"
                className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                onClick={() => void removeSection(detail.id)}
              >
                {t.home.deleteSection}
              </button>
            </div>
            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4">
              {firstUserMessage && (
                <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                    {t.home.originalMessage}
                  </p>
                  <MarkdownMessage content={firstUserMessage} />
                </div>
              )}

              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={`mb-4 ${m.role === "user" ? "sm:ml-8" : "sm:mr-8"}`}
                >
                  <p className="mb-1 text-xs text-slate-500">
                    {m.role === "user" ? t.home.you : t.home.agent}
                  </p>
                  <div
                    className={`rounded-lg p-3 ${
                      m.role === "user"
                        ? "bg-slate-100"
                        : "border border-slate-200 bg-white"
                    }`}
                  >
                    <MarkdownMessage content={m.content} />
                  </div>
                </div>
              ))}

              {detail.type === "consulta" && !(detail.draft.draft?.issues?.length) && (
                <CardList
                  cards={detail.draft.result_cards ?? []}
                  title={t.home.resultCards}
                />
              )}

              {(detail.type === "criacao" || (detail.draft.draft?.issues?.length ?? 0) > 0) && (
                <>
                  <CardList
                    cards={detail.draft.duplicates ?? []}
                    title={t.home.duplicates}
                  />
                  {detail.draft.rules_violation && (
                    <p className="mt-3 text-sm text-amber-800">
                      {detail.draft.rules_violation}
                    </p>
                  )}
                  {detail.draft.confirm_error && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-sm text-red-700">{detail.draft.confirm_error}</p>
                      {confirmAllowed && detail.status !== "confirmed" && (
                          <>
                            <p className="mt-2 text-sm text-red-900">
                              {t.home.retryCreationHint}
                            </p>
                            <button
                              type="button"
                              disabled={
                                loading ||
                                !projectsLoaded ||
                                (!canCreateProjects &&
                                  missingProjectKeys(detail.draft.draft?.issues, projects).length > 0)
                              }
                              className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                              onClick={() =>
                                void confirmDraft(
                                  missingProjectKeys(detail.draft.draft?.issues, projects).length > 0,
                                )
                              }
                            >
                              {t.common.retry}
                            </button>
                          </>
                        )}
                    </div>
                  )}
                  {detail.draft.draft && (
                    <DraftEditor
                      draft={detail.draft.draft}
                      t={t}
                      projects={projects}
                      onChange={(d) => void saveDraft(d)}
                    />
                  )}
                  {confirmAllowed && detail.status !== "confirmed" && (
                      <ProjectConfirm
                        t={t}
                        loading={loading}
                        projectsLoaded={projectsLoaded}
                        canCreateProjects={canCreateProjects}
                        resume={Boolean(detail.draft.confirm_error)}
                        missingKeys={missingProjectKeys(detail.draft.draft?.issues, projects)}
                        onConfirm={(createMissing) => void confirmDraft(createMissing)}
                      />
                    )}
                </>
              )}

              {pendingText ? (
                <PendingTurn
                  text={pendingText}
                  loading={sending}
                  youLabel={t.home.you}
                  agentLabel={t.home.agent}
                  thinking={t.home.thinking}
                />
              ) : null}
              {sending && !pendingText ? (
                <ThinkingBubble agentLabel={t.home.agent} thinking={t.home.thinking} />
              ) : null}
              <AgentNotice
                notice={agentNotice}
                storedContent={storedFailure?.content ?? null}
                loading={sending}
                retryLabel={t.common.retry}
                busyText={t.home.modelBusy}
                failedText={t.home.modelFailed}
                onRetry={() => void retryLast()}
              />
              {error && (
                <p className="mt-3 text-sm text-red-600">{error}</p>
              )}
            </div>
          </div>
        )}
        <div className="border-t border-slate-200 bg-white p-4">
          {detail && sectionFull ? (
            <p className="mb-3 text-sm text-amber-900">{t.home.sectionFull}</p>
          ) : null}
          {detail && sectionGrowing ? (
            <p className="mb-3 text-sm text-slate-500">{t.home.sectionGrowing}</p>
          ) : null}
          {similar ? (
            <SimilarBanner
              title={similar.title}
              question={t.home.similarSection}
              openLabel={t.home.openExisting}
              createLabel={t.home.createAnyway}
              disabled={loading}
              createDisabled={loading || !modelConfigured}
              onOpen={openSimilar}
              onCreate={createDespiteMatch}
            />
          ) : null}
          <textarea
            ref={composerRef}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            placeholder={
              selectedId == null || sectionFull
                ? t.home.newSectionPlaceholder
                : t.home.messagePlaceholder
            }
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitComposer();
              }
            }}
            disabled={loading || !modelConfigured}
            autoFocus={selectedId == null}
          />
          <button
            type="button"
            disabled={loading || !composer.trim() || !modelConfigured}
            className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={submitComposer}
          >
            {sending ? t.home.sending : t.home.send}
          </button>
        </div>
      </section>
      </div>
    </div>
  );
}
