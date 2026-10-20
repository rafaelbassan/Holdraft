import { getSetting, setSetting } from "@/lib/db";
import { coerceUiLocale } from "@/lib/i18n";

export const SETTING_KEYS = {
  jiraOAuthClientId: "jira_oauth_client_id",
  jiraOAuthClientSecret: "jira_oauth_client_secret",
  jiraApiTokenEmail: "jira_api_token_email",
  jiraApiToken: "jira_api_token",
  jiraSiteUrl: "jira_site_url",
  modelBaseUrl: "model_base_url",
  modelApiKey: "model_api_key",
  modelName: "model_name",
  modelFallbacks: "model_fallbacks",
  uiLanguage: "ui_language",
  cardDefaultLanguage: "card_default_language",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const SECRET_KEYS: ReadonlySet<string> = new Set([
  SETTING_KEYS.jiraOAuthClientSecret,
  SETTING_KEYS.jiraApiToken,
  SETTING_KEYS.modelApiKey,
]);

export const MASKED_SECRET = "***";

export type PublicSettings = {
  jira_oauth_client_id: string;
  jira_oauth_client_secret: string;
  jira_api_token_email: string;
  jira_api_token: string;
  jira_site_url: string;
  model_base_url: string;
  model_api_key: string;
  model_name: string;
  model_fallbacks: string;
  ui_language: string;
  card_default_language: string;
};

function maskIfSecret(key: string, value: string): string {
  if (SECRET_KEYS.has(key) && value.length > 0) {
    return MASKED_SECRET;
  }
  return value;
}

export function getPublicSettings(): PublicSettings {
  const keys = Object.values(SETTING_KEYS);
  const out = {} as PublicSettings;
  for (const key of keys) {
    const raw = getSetting(key) ?? "";
    (out as Record<string, string>)[key] = maskIfSecret(key, raw);
  }
  return out;
}

export type SettingsPatch = Partial<Record<SettingKey, string>>;

export function applySettingsPatch(patch: SettingsPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!(Object.values(SETTING_KEYS) as string[]).includes(key)) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (SECRET_KEYS.has(key)) {
      if (value === MASKED_SECRET || value.trim() === "") {
        continue;
      }
    }
    if (key === SETTING_KEYS.uiLanguage) {
      setSetting(key, coerceUiLocale(value));
      continue;
    }
    if (key === SETTING_KEYS.cardDefaultLanguage) {
      const trimmed = value.trim().toLowerCase();
      const cardLanguage =
        trimmed === "en" || trimmed === "es"
          ? trimmed
          : "pt-BR";
      setSetting(key, cardLanguage);
      continue;
    }
    setSetting(key, value);
  }
}

export function getRawSetting(key: SettingKey): string {
  return getSetting(key) ?? "";
}
