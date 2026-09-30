// Tiny translation helper: t("key", { n: 3 }) with German and English dictionaries.
import type { Lang } from "../../shared/types";
import { de } from "../i18n/de";
import { en } from "../i18n/en";
import { store } from "./storage";

export type Key = keyof typeof de;
type PluralBase = { [K in Key]: K extends `${infer B}.one` ? B : never }[Key];

const dicts: Record<Lang, Record<Key, string>> = { de, en };
let current: Lang = "de";

export const getLang = () => current;
export const otherLang = (l: Lang = current): Lang => (l === "de" ? "en" : "de");

export function setLangValue(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
}

export function t(key: Key, vars?: Record<string, string | number>, lang: Lang = current): string {
  let s: string = dicts[lang][key] ?? dicts.de[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Plural helper: tn("common.persons", 2) → "2 Personen". */
export function tn(base: PluralBase, n: number, lang: Lang = current): string {
  return t(`${base}.${n === 1 ? "one" : "other"}` as Key, { n }, lang);
}

export const hasKey = (key: string): key is Key => key in dicts.de;

/** Saved choice, else the browser language, else null (then the site default applies). */
export function detectLang(): Lang | null {
  const saved = store.get<string | null>("nest.lang", null);
  if (saved === "de" || saved === "en") return saved;
  for (const l of navigator.languages ?? [navigator.language]) {
    if (l?.toLowerCase().startsWith("de")) return "de";
    if (l?.toLowerCase().startsWith("en")) return "en";
  }
  return null;
}
