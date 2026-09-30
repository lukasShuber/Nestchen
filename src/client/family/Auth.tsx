// Login and first-time account setup for the parents.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Lang, User } from "../../shared/types";
import { api, errorText } from "../lib/api";
import { getLang, t } from "../lib/i18n";
import { Link } from "../lib/router";
import { LangSwitch, ThemeToggle } from "../prefs";
import { Button, ErrorBox, Field, Input, Segmented } from "../ui/base";
import { Logo } from "../ui/icons";

export interface AuthState {
  user: User | null;
  hasUsers: boolean;
  setupOpen: boolean;
  setupConfigured: boolean;
}

export function AuthScreen({ children }: { children: ComponentChildren }) {
  return (
    <div class="auth">
      <div class="auth-tools">
        <LangSwitch />
        <ThemeToggle />
      </div>
      <div class="card auth-card">
        <div class="auth-logo">
          <Logo size={60} />
        </div>
        {children}
      </div>
      <Link href="/" class="text-link small">
        ← {t("nav.publicPage")}
      </Link>
    </div>
  );
}

export function Login({ onDone, canSetup, onSetup }: { onDone: (u: User) => void; canSetup: boolean; onSetup: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/login", { body: { username, password } });
      onDone(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="form" onSubmit={submit}>
      <h1 class="auth-title">{t("login.title")}</h1>
      <p class="muted center">{t("login.subtitle")}</p>
      <Field label={t("login.username")}>
        <Input value={username} onValue={setUsername} required autoFocus autoComplete="username" autoCapitalize="none" spellcheck={false} />
      </Field>
      <Field label={t("login.password")}>
        <Input type="password" value={password} onValue={setPassword} required autoComplete="current-password" />
      </Field>
      {!!error && <ErrorBox error={errorText(error)} />}
      <Button type="submit" block busy={busy}>
        {t("login.submit")}
      </Button>
      {canSetup && (
        <button type="button" class="text-btn center" onClick={onSetup}>
          {t("login.setupLink")}
        </button>
      )}
    </form>
  );
}

const suggestUsername = (name: string) =>
  name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);

export function Setup({ state, onDone, onBack }: { state: AuthState; onDone: (u: User) => void; onBack?: () => void }) {
  const [setupCode, setSetupCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [touchedUsername, setTouchedUsername] = useState(false);
  const [password, setPassword] = useState("");
  const [lang, setLang] = useState<Lang>(getLang());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!state.setupConfigured || !state.setupOpen) {
    return (
      <div class="form">
        <h1 class="auth-title">{t("setup.title")}</h1>
        <p class="muted">{state.setupConfigured ? t("err.setup_closed") : t("setup.missing")}</p>
        {onBack && (
          <Button variant="secondary" block onClick={onBack}>
            {t("setup.backToLogin")}
          </Button>
        )}
      </div>
    );
  }

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/setup", { body: { setupCode, displayName, username, password, lang } });
      onDone(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="form" onSubmit={submit}>
      <h1 class="auth-title">{t("setup.title")}</h1>
      <p class="muted">{t("setup.text")}</p>
      <Field label={t("setup.code")}>
        <Input type="password" value={setupCode} onValue={setSetupCode} required autoComplete="off" />
      </Field>
      <Field label={t("setup.displayName")}>
        <Input
          value={displayName}
          onValue={(v) => {
            setDisplayName(v);
            if (!touchedUsername) setUsername(suggestUsername(v));
          }}
          required
          maxLength={40}
          placeholder={t("setup.displayNamePh")}
        />
      </Field>
      <Field label={t("login.username")} hint={t("setup.usernameHint")}>
        <Input
          value={username}
          onValue={(v) => {
            setTouchedUsername(true);
            setUsername(v.toLowerCase());
          }}
          required
          pattern="[a-z0-9._\-]{2,32}"
          autoComplete="username"
          autoCapitalize="none"
          spellcheck={false}
        />
      </Field>
      <Field label={t("login.password")} hint={t("setup.passwordHint")}>
        <Input type="password" value={password} onValue={setPassword} required minLength={8} autoComplete="new-password" />
      </Field>
      {!state.hasUsers && (
        <Field group label={t("setup.lang")}>
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
          />
        </Field>
      )}
      {!!error && <ErrorBox error={errorText(error)} />}
      <Button type="submit" block busy={busy}>
        {t("setup.submit")}
      </Button>
      {onBack && (
        <button type="button" class="text-btn center" onClick={onBack}>
          {t("setup.backToLogin")}
        </button>
      )}
    </form>
  );
}
