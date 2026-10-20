import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminGate } from "@/components/AdminGate";
import { SettingsForm } from "@/app/settings/SettingsForm";
import { getAdminSession, hasAdmin } from "@/lib/admin";
import { getSetting } from "@/lib/db";
import { getMessages, resolveLocale } from "@/lib/i18n";

type PageProps = {
  searchParams: Promise<{ jira?: string; error?: string }>;
};

export default async function SettingsPage({ searchParams }: PageProps) {
  if (!hasAdmin()) {
    redirect("/setup");
  }
  const headerList = await headers();
  const locale = resolveLocale(
    getSetting("ui_language"),
    headerList.get("accept-language"),
  );
  const t = getMessages(locale);
  const admin = await getAdminSession();
  if (!admin) {
    return <AdminGate t={t} mode="login" />;
  }

  const params = await searchParams;
  let oauthStatus: "connected" | "error" | null = null;
  let oauthError: string | null = null;
  if (params.jira === "connected") {
    oauthStatus = "connected";
  } else if (params.error) {
    oauthStatus = "error";
    oauthError = params.error;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t.settings.title}</h1>
        <p className="text-sm text-slate-600">
          {t.settings.loggedInAs} <strong>{admin.username}</strong>
        </p>
      </div>
      <SettingsForm
        t={t}
        initialLocale={locale}
        oauthStatus={oauthStatus}
        oauthError={oauthError}
      />
    </div>
  );
}
