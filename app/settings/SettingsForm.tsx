"use client";

import { useCallback, useEffect, useState } from "react";
import { coerceUiLocale, type Messages } from "@/lib/i18n";
import type { PublicSettings } from "@/lib/settings";

const MASKED_SECRET = "***";
import type { PublicSession } from "@/lib/jira/session";

type ApiResponse = {
  settings: PublicSettings;
  session: PublicSession | null;
};

type Props = {
  t: Messages;
  initialLocale: string;
  oauthStatus?: "connected" | "error" | null;
  oauthError?: string | null;
};

const CARD_LANGUAGES = ["pt-BR", "en", "es"] as const;

function coerceCardLanguage(value: string): (typeof CARD_LANGUAGES)[number] {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "en" || trimmed === "es") {
    return trimmed;
  }
  return "pt-BR";
}

function withLanguageDefaults(settings: PublicSettings): PublicSettings {
  return {
    ...settings,
    ui_language: coerceUiLocale(settings.ui_language),
    card_default_language: coerceCardLanguage(settings.card_default_language),
  };
}

export function SettingsForm({
  t,
  initialLocale,
  oauthStatus,
  oauthError,
}: Props) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [cardRules, setCardRules] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) {
        throw new Error("load failed");
      }
      const data = (await res.json()) as ApiResponse;
      setSettings(withLanguageDefaults(data.settings));
      setSession(data.session);
      const rulesRes = await fetch("/api/card-rules");
      if (rulesRes.ok) {
        const rules = (await rulesRes.json()) as { content?: string };
        setCardRules(rules.content ?? "");
      }
    } catch {
      setMessage(t.common.error);
    } finally {
      setLoading(false);
    }
  }, [t.common.error]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (oauthStatus === "connected") {
      setMessage(t.settings.oauthConnected);
    } else if (oauthStatus === "error") {
      setMessage(
        oauthError
          ? `${t.settings.oauthError} ${oauthError}`
          : t.settings.oauthError,
      );
    }
  }, [oauthStatus, oauthError, t.settings.oauthConnected, t.settings.oauthError]);

  function updateField(key: keyof PublicSettings, value: string) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withLanguageDefaults(settings)),
      });
      if (!res.ok) {
        throw new Error("save failed");
      }
      const data = (await res.json()) as ApiResponse;
      const rulesRes = await fetch("/api/card-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: cardRules }),
      });
      if (!rulesRes.ok) {
        throw new Error("rules failed");
      }
      setSettings(withLanguageDefaults(data.settings));
      setSession(data.session);
      setMessage(t.settings.saved);
      if (data.settings.ui_language !== initialLocale) {
        window.location.reload();
      }
    } catch {
      setMessage(t.common.error);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestMessage(null);
    try {
      const res = await fetch("/api/jira/test", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (data.ok) {
        setTestMessage(t.settings.connectionOk);
      } else {
        setTestMessage(
          data.message
            ? `${t.settings.connectionFail} ${data.message}`
            : t.settings.connectionFail,
        );
      }
    } catch {
      setTestMessage(t.settings.connectionFail);
    } finally {
      setTesting(false);
    }
  }

  if (loading || !settings) {
    return <p className="text-sm text-slate-600">{t.common.loading}</p>;
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {message ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          {message}
        </p>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.settings.jira}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              {t.settings.jiraClientId}
            </span>
            <input
              type="text"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={settings.jira_oauth_client_id}
              onChange={(e) =>
                updateField("jira_oauth_client_id", e.target.value)
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              {t.settings.jiraClientSecret}
            </span>
            <input
              type="password"
              autoComplete="off"
              placeholder={MASKED_SECRET}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={
                settings.jira_oauth_client_secret === MASKED_SECRET
                  ? ""
                  : settings.jira_oauth_client_secret
              }
              onChange={(e) =>
                updateField("jira_oauth_client_secret", e.target.value)
              }
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          {session ? (
            <p className="text-sm text-slate-700">
              {t.settings.loggedInAs}{" "}
              <span className="font-medium">
                {session.displayName ?? session.email ?? session.accountId}
              </span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">{t.settings.notLoggedIn}</p>
          )}
          <a
            href="/api/jira/login"
            className="inline-flex rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t.settings.jiraLogin}
          </a>
          <a
            href="/api/jira/logout"
            className="inline-flex rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t.settings.jiraLogout}
          </a>
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testing}
            className="inline-flex rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? t.common.loading : t.settings.jiraTestConnection}
          </button>
        </div>
        {testMessage ? (
          <p className="text-sm text-slate-700">{testMessage}</p>
        ) : null}

        <div className="space-y-4 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">{t.settings.jiraApiToken}</p>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              {t.settings.jiraApiEmail}
            </span>
            <input
              type="email"
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={settings.jira_api_token_email}
              onChange={(e) =>
                updateField("jira_api_token_email", e.target.value)
              }
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              {t.settings.jiraApiToken}
            </span>
            <input
              type="password"
              autoComplete="off"
              placeholder={MASKED_SECRET}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={
                settings.jira_api_token === MASKED_SECRET
                  ? ""
                  : settings.jira_api_token
              }
              onChange={(e) => updateField("jira_api_token", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">
              {t.settings.jiraSiteUrl}
            </span>
            <input
              type="url"
              autoComplete="off"
              placeholder="https://your-domain.atlassian.net"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={settings.jira_site_url}
              onChange={(e) => updateField("jira_site_url", e.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.settings.model}
        </h2>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t.settings.modelBaseUrl}
          </span>
          <input
            type="url"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={settings.model_base_url}
            onChange={(e) => updateField("model_base_url", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t.settings.modelApiKey}
          </span>
          <input
            type="password"
            autoComplete="off"
            placeholder={MASKED_SECRET}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={
              settings.model_api_key === MASKED_SECRET
                ? ""
                : settings.model_api_key
            }
            onChange={(e) => updateField("model_api_key", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t.settings.modelName}
          </span>
          <input
            type="text"
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={settings.model_name}
            onChange={(e) => updateField("model_name", e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t.settings.modelFallbacks}
          </span>
          <textarea
            rows={3}
            autoComplete="off"
            placeholder={"gemini-2.5-flash\ngemini-2.5-flash-lite"}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={settings.model_fallbacks}
            onChange={(e) => updateField("model_fallbacks", e.target.value)}
          />
          <span className="mt-1 block text-xs text-slate-500">
            {t.settings.modelFallbacksHint}
          </span>
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t.settings.uiLanguage}
          </span>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={settings.ui_language}
            onChange={(e) => updateField("ui_language", e.target.value)}
          >
            <option value="pt-BR">pt-BR</option>
            <option value="en">en</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t.settings.cardLanguage}
          </span>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={settings.card_default_language}
            onChange={(e) =>
              updateField("card_default_language", e.target.value)
            }
          >
            {CARD_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t.settings.cardRulesPath}
        </h2>
        <p className="text-sm text-slate-600">{t.settings.cardRulesHint}</p>
        <textarea
          className="min-h-64 w-full rounded-md border border-slate-300 px-3 py-3 font-mono text-base leading-relaxed"
          value={cardRules}
          onChange={(e) => setCardRules(e.target.value)}
          spellCheck
        />
      </section>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
      >
        {saving ? t.common.loading : t.settings.save}
      </button>
    </form>
  );
}
