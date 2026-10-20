import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getAdminSession, hasAdmin } from "@/lib/admin";
import { getSetting } from "@/lib/db";
import { getMessages, resolveLocale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Holdraft",
  description: "Local chat that prepares Jira cards",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const acceptLanguage = headerList.get("accept-language");
  const storedLocale = getSetting("ui_language");
  const locale = resolveLocale(storedLocale, acceptLanguage);
  const t = getMessages(locale);
  const adminReady = hasAdmin();
  const admin = adminReady ? await getAdminSession() : null;

  return (
    <html lang={locale}>
      <body className="antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              {t.home.title}
            </Link>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <Link href="/" className="py-2 text-slate-600 hover:text-slate-900">
                {t.nav.home}
              </Link>
              {admin ? (
                <>
                  <Link
                    href="/settings"
                    className="py-2 text-slate-600 hover:text-slate-900"
                  >
                    {t.nav.settings}
                  </Link>
                  <form action="/api/admin/logout" method="post">
                    <button
                      type="submit"
                      className="py-2 text-slate-600 hover:text-slate-900"
                    >
                      {t.admin.logout}
                    </button>
                  </form>
                </>
              ) : adminReady ? null : (
                <Link
                  href="/setup"
                  className="py-2 text-slate-600 hover:text-slate-900"
                >
                  {t.admin.setupTitle}
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
