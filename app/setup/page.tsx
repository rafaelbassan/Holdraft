import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AdminGate } from "@/components/AdminGate";
import { hasAdmin } from "@/lib/admin";
import { getSetting } from "@/lib/db";
import { getMessages, resolveLocale } from "@/lib/i18n";

export default async function SetupPage() {
  if (hasAdmin()) {
    redirect("/settings");
  }
  const headerList = await headers();
  const locale = resolveLocale(
    getSetting("ui_language"),
    headerList.get("accept-language"),
  );
  const t = getMessages(locale);
  return <AdminGate t={t} mode="setup" />;
}
