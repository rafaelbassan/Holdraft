import { en } from "./en";
import { ptBR, type Messages } from "./pt-BR";

export type Locale = "pt-BR" | "en";

export const DEFAULT_LOCALE: Locale = "pt-BR";

export const LOCALES: Locale[] = ["pt-BR", "en"];

const catalogs: Record<Locale, Messages> = {
  "pt-BR": ptBR,
  en,
};

export function isLocale(value: string): value is Locale {
  return value === "pt-BR" || value === "en";
}

export function getMessages(locale: Locale): Messages {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

function localeFromTag(tag: string): Locale | null {
  const normalized = tag.trim().toLowerCase();
  if (normalized === "pt-br" || normalized === "pt") {
    return "pt-BR";
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  return null;
}

function matchAcceptLanguage(header: string): Locale | null {
  const ranked = header
    .split(",")
    .map((part) => {
      const [tagPart, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const [key, raw] = param.trim().split("=");
        if (key?.trim().toLowerCase() === "q") {
          const parsed = Number(raw);
          if (!Number.isNaN(parsed)) {
            q = parsed;
          }
        }
      }
      return { tag: tagPart?.trim() ?? "", q };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const entry of ranked) {
    const locale = localeFromTag(entry.tag);
    if (locale) {
      return locale;
    }
  }
  return null;
}

export function coerceUiLocale(value: string | null | undefined): Locale {
  return localeFromTag(value ?? "") ?? DEFAULT_LOCALE;
}

export function resolveLocale(
  stored: string | null | undefined,
  acceptLanguage?: string | null,
): Locale {
  const explicit = localeFromTag(stored ?? "");
  if (explicit) {
    return explicit;
  }
  // A blank row is what Settings shows as pt-BR. Only a missing row follows the browser.
  if (stored != null) {
    return DEFAULT_LOCALE;
  }
  if (acceptLanguage) {
    return matchAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
  }
  return DEFAULT_LOCALE;
}

export { ptBR, en };
export type { Messages };
