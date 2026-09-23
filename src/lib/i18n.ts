/**
 * i18n.ts — translation infrastructure (i18next + react-i18next).
 *
 * No device-locale auto-detection yet — that needs expo-localization, a new
 * native module, which is out of scope while this build stays OTA-only
 * (see CLAUDE.md's 2026-08-31 policy). Defaults to English; the user picks
 * explicitly in Settings (appStore's `language` field, persisted).
 *
 * Translated surfaces so far: just the Settings language picker itself, as
 * infrastructure proof — the actual popup/screen translation pass (the
 * reason this exists) comes next.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

export type SupportedLanguage = "en" | "es";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    compatibilityJSON: "v4",
  });

export default i18n;
