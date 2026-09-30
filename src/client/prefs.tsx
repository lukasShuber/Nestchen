// Language and light/dark preferences (remembered per browser).
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { Lang } from "../shared/types";
import { detectLang, setLangValue, t } from "./lib/i18n";
import { store } from "./lib/storage";
import { IconButton, Segmented } from "./ui/base";

export type Theme = "auto" | "light" | "dark";

interface Prefs {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Use the site's default language unless the visitor chose one or their browser says de/en. */
  setDefaultLang: (lang: Lang) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const PrefsContext = createContext<Prefs>(null as unknown as Prefs);
export const usePrefs = () => useContext(PrefsContext);

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "auto" && prefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#17161b" : "#fbf7f1");
}

export function PrefsProvider({ children }: { children: ComponentChildren }) {
  const [detected] = useState(detectLang);
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = detected ?? "de";
    setLangValue(initial);
    return initial;
  });
  const [theme, setThemeState] = useState<Theme>(() => store.get<Theme>("nest.theme", "auto"));

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme("auto");
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);

  const value: Prefs = {
    lang,
    setLang: (l) => {
      setLangValue(l);
      store.set("nest.lang", l);
      setLangState(l);
    },
    setDefaultLang: (l) => {
      if (detected || l === lang) return;
      setLangValue(l);
      setLangState(l);
    },
    theme,
    setTheme: (th) => {
      store.set("nest.theme", th);
      setThemeState(th);
    },
  };
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function LangSwitch() {
  const { lang, setLang } = usePrefs();
  return (
    <div class="lang-switch" role="group" aria-label={t("common.language")}>
      {(["de", "en"] as const).map((l) => (
        <button type="button" key={l} class={l === lang ? "is-active" : ""} aria-pressed={l === lang} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const { setTheme } = usePrefs();
  const dark = document.documentElement.dataset.theme === "dark";
  return <IconButton icon={dark ? "sun" : "moon"} label={t("theme.toggle")} onClick={() => setTheme(dark ? "light" : "dark")} />;
}

export function ThemeSelect() {
  const { theme, setTheme } = usePrefs();
  return (
    <Segmented
      value={theme}
      onChange={setTheme}
      label={t("common.theme")}
      options={[
        { value: "auto", label: t("theme.auto") },
        { value: "light", label: t("theme.light") },
        { value: "dark", label: t("theme.dark") },
      ]}
    />
  );
}
