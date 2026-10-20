import { headers } from "next/headers";
import { HomeChat } from "@/components/HomeChat";
import { getSetting } from "@/lib/db";
import { getMessages, resolveLocale } from "@/lib/i18n";
import { getPublicSession } from "@/lib/jira/session";
import { getRawSetting, SETTING_KEYS } from "@/lib/settings";

type PageProps = {
  searchParams: Promise<{ jira?: string; error?: string }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const headerList = await headers();
  const acceptLanguage = headerList.get("accept-language");
  const storedLocale = getSetting("ui_language");
  const locale = resolveLocale(storedLocale, acceptLanguage);
  const t = getMessages(locale);

  const modelConfigured = Boolean(
    getRawSetting(SETTING_KEYS.modelBaseUrl) &&
      getRawSetting(SETTING_KEYS.modelApiKey) &&
      getRawSetting(SETTING_KEYS.modelName),
  );

  const params = await searchParams;
  const notice =
    params.jira === "connected"
      ? t.settings.oauthConnected
      : params.error
        ? `${t.settings.oauthError} ${params.error}`
        : null;
  const jiraUser = await getPublicSession();

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[28rem] flex-col gap-3">
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}
      {jiraUser ? (
        <HomeChat t={t} modelConfigured={modelConfigured} />
      ) : (
        <div className="flex min-h-[50vh] items-center justify-center">
          <a
            href="/api/jira/login"
            className="w-full max-w-sm rounded-md bg-slate-900 px-4 py-3 text-center text-base font-medium text-white hover:bg-slate-800"
          >
            {t.settings.jiraLogin}
          </a>
        </div>
      )}
    </div>
  );
}
