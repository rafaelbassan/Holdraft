"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/lib/i18n";

type Mode = "setup" | "login";

const fieldClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-3 text-base";

export function AdminGate({ t, mode }: { t: Messages; mode: Mode }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(mode === "setup" ? "/api/admin/setup" : "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const code = data.error;
        if (code === "username_short") setError(t.admin.usernameShort);
        else if (code === "password_short") setError(t.admin.passwordShort);
        else if (code === "already_configured") setError(t.admin.alreadyConfigured);
        else if (code === "invalid_credentials") setError(t.admin.invalidCredentials);
        else setError(t.common.error);
        return;
      }
      router.push("/settings");
      router.refresh();
    } catch {
      setError(t.common.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {mode === "setup" ? t.admin.setupTitle : t.admin.loginTitle}
        </h1>
        {mode === "setup" ? (
          <p className="mt-2 text-sm text-slate-600">{t.admin.setupHint}</p>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="font-medium text-slate-700">{t.admin.username}</span>
        <input
          className={fieldClass}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">{t.admin.password}</span>
        <input
          type="password"
          className={fieldClass}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === "setup" ? 8 : undefined}
        />
        {mode === "setup" ? (
          <span className="mt-1 block text-xs text-slate-500">{t.admin.passwordHint}</span>
        ) : null}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? t.common.loading : mode === "setup" ? t.admin.setupTitle : t.admin.login}
      </button>
    </form>
  );
}
