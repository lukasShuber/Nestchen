// Private settings: public page texts, privacy, calendar, notifications, accounts, data.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { TEXT_KEYS, USER_COLORS } from "../../shared/types";
import type { Lang, Settings, Texts, User, UserColor } from "../../shared/types";
import { api, errorText } from "../lib/api";
import { getLang, t } from "../lib/i18n";
import { LangSwitch, ThemeSelect } from "../prefs";
import { Avatar, Button, CopyField, ErrorBox, Field, IconButton, Input, LinkButton, Segmented, Switch, Textarea, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { SubscribeFeeds } from "./Calendar";
import { Page } from "./common";
import { useFamily } from "./context";

const TIMEZONES = ["Europe/Berlin", "Europe/Vienna", "Europe/Zurich", "Europe/Amsterdam", "Europe/Paris", "Europe/London", "Europe/Lisbon", "America/New_York", "America/Los_Angeles"];

/** Saves a partial settings object and updates the shared state. */
function useSave() {
  const { setSettings } = useFamily();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<Settings> | { texts: Texts }, quiet = false) => {
    setBusy(true);
    try {
      const r = await api<{ settings: Settings }>("/admin/settings", { method: "PUT", body: patch });
      setSettings(r.settings);
      if (!quiet) toast(t("common.saved"));
      return true;
    } catch (err) {
      toast(errorText(err), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

function Section({ icon, title, children, extra }: { icon: IconName; title: string; children: ComponentChildren; extra?: ComponentChildren }) {
  return (
    <section class="card settings-section">
      <div class="settings-head">
        <h2 class="card-title">
          <Icon name={icon} /> {title}
        </h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  return (
    <Page title={t("set.title")}>
      <div class="settings">
        <PublicSettings />
        <PrivacySettings />
        <CalendarSettings />
        <NotifySettings />
        <FamilySettings />
        <AccountSettings />
        <Section icon="sun" title={t("set.appearance")}>
          <div class="row between wrap">
            <span>{t("common.language")}</span>
            <LangSwitch />
          </div>
          <div class="row between wrap">
            <span>{t("common.theme")}</span>
            <ThemeSelect />
          </div>
        </Section>
        <Section icon="download" title={t("set.data")}>
          <p class="muted">{t("set.exportHint")}</p>
          <div>
            <LinkButton href="/api/admin/export" icon="download" download>
              {t("set.export")}
            </LinkButton>
          </div>
        </Section>
      </div>
    </Page>
  );
}

function PublicSettings() {
  const { settings } = useFamily();
  const { save, busy } = useSave();
  const [siteName, setSiteName] = useState(settings.siteName);
  const [texts, setTexts] = useState<Texts>(settings.texts);
  const [lang, setLang] = useState<Lang>(getLang());
  const setText = (key: keyof Texts, value: string) => setTexts({ ...texts, [key]: { ...texts[key], [lang]: value } });

  return (
    <Section
      icon="globe"
      title={t("set.public")}
      extra={
        <LinkButton href="/?view=public" external size="sm" variant="ghost" icon="external">
          {t("set.viewPublic")}
        </LinkButton>
      }
    >
      <div class="field-label">{t("set.features")}</div>
      <div class="switches">
        <Switch checked={settings.showVisits} onChange={(v) => save({ showVisits: v })} label={`☕ ${t("set.showVisits")}`} />
        <Switch checked={settings.showMeals} onChange={(v) => save({ showMeals: v })} label={`🍲 ${t("set.showMeals")}`} />
        <Switch checked={settings.showWishlist} onChange={(v) => save({ showWishlist: v })} label={`🎁 ${t("set.showWishlist")}`} />
        <Switch checked={settings.autoConfirm} onChange={(v) => save({ autoConfirm: v })} label={t("set.autoConfirm")} />
      </div>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ siteName, texts });
        }}
      >
        <Field label={t("set.siteName")} hint={t("set.siteNameHint")}>
          <Input value={siteName} onValue={setSiteName} required maxLength={40} />
        </Field>
        <div class="texts-head">
          <span class="field-label">{t("set.texts")}</span>
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
          />
        </div>
        <p class="field-hint">{t("set.textsHint")}</p>
        {TEXT_KEYS.map((key) => (
          <Field key={`${key}-${lang}`} label={t(`text.${key}`)}>
            {key === "title" ? (
              <Input value={texts[key][lang]} onValue={(v) => setText(key, v)} maxLength={120} />
            ) : (
              <Textarea value={texts[key][lang]} onValue={(v) => setText(key, v)} rows={key === "visitRules" ? 5 : 3} maxLength={3000} />
            )}
          </Field>
        ))}
        <div class="row end">
          <Button type="submit" busy={busy} icon="check">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PrivacySettings() {
  const { settings } = useFamily();
  const { save, busy } = useSave();
  const [code, setCode] = useState(settings.guestCode);
  return (
    <Section icon="lock" title={t("set.privacy")}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ guestCode: code.trim() });
        }}
      >
        <Field label={t("set.guestCode")} hint={t("set.guestCodeHint")}>
          <div class="inline-add">
            <Input value={code} onValue={setCode} maxLength={40} autoComplete="off" placeholder={t("set.guestCodePh")} />
            <Button type="submit" variant="secondary" busy={busy}>
              {t("common.save")}
            </Button>
          </div>
        </Field>
      </form>
      {settings.guestCode && (
        <Field group label={t("set.shareLink")}>
          <CopyField value={`${location.origin}/#code=${encodeURIComponent(settings.guestCode)}`} />
        </Field>
      )}
    </Section>
  );
}

function CalendarSettings() {
  const { settings } = useFamily();
  const { save, busy } = useSave();
  const [timezone, setTimezone] = useState(settings.timezone);
  const [gcal, setGcal] = useState(settings.gcalEmbed);

  const rotate = async () => {
    if (!(await confirmDialog(t("set.rotateConfirm"), { ok: t("set.rotate") }))) return;
    try {
      await api("/admin/settings/rotate-ics", { body: {} });
      await save({}, true);
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  return (
    <Section icon="calendar" title={t("set.calendar")}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ timezone, gcalEmbed: gcal.trim() }).then((ok) => ok && setGcal((g) => g.trim()));
        }}
      >
        <Field label={t("set.timezone")}>
          <Input value={timezone} onValue={setTimezone} list="tz-list" required maxLength={64} />
        </Field>
        <datalist id="tz-list">
          {TIMEZONES.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <Field label={t("set.gcal")} hint={t("set.gcalHint")}>
          <Input value={gcal} onValue={setGcal} maxLength={3000} placeholder="…@group.calendar.google.com" />
        </Field>
        <div class="row end">
          <Button type="submit" busy={busy} icon="check">
            {t("common.save")}
          </Button>
        </div>
      </form>
      <div class="field-label">{t("set.feeds")}</div>
      <SubscribeFeeds />
      <div>
        <Button variant="ghost" size="sm" icon="refresh" onClick={rotate}>
          {t("set.rotate")}
        </Button>
      </div>
    </Section>
  );
}

function NotifySettings() {
  const { settings } = useFamily();
  const { save, busy } = useSave();
  const [url, setUrl] = useState(settings.ntfyUrl);
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    try {
      if (url.trim() !== settings.ntfyUrl && !(await save({ ntfyUrl: url.trim() }, true))) return;
      await api("/admin/settings/test-ntfy", { body: {} });
      toast(t("set.ntfySent"));
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setTesting(false);
    }
  };
  return (
    <Section icon="bell" title={t("set.notifications")}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ ntfyUrl: url.trim() });
        }}
      >
        <Field label={t("set.ntfy")} hint={t("set.ntfyHint")}>
          <Input type="url" value={url} onValue={setUrl} maxLength={300} placeholder="https://ntfy.sh/…" />
        </Field>
        <div class="row end">
          <Button variant="secondary" icon="bell" busy={testing} disabled={!url.trim()} onClick={test}>
            {t("set.ntfyTest")}
          </Button>
          <Button type="submit" busy={busy} icon="check">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function FamilySettings() {
  const { settings } = useFamily();
  const { save, busy } = useSave();
  const [birthDate, setBirthDate] = useState(settings.birthDate);
  const [phoneCc, setPhoneCc] = useState(settings.phoneCc);
  const [defaultLang, setDefaultLang] = useState<Lang>(settings.defaultLang);
  return (
    <Section icon="heart" title={t("set.family")}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ birthDate, phoneCc, defaultLang });
        }}
      >
        <div class="grid-2">
          <Field label={t("set.birthDate")} hint={t("set.birthDateHint")}>
            <Input type="date" value={birthDate} onValue={setBirthDate} />
          </Field>
          <Field label={t("set.phoneCc")}>
            <Input value={phoneCc} onValue={setPhoneCc} maxLength={5} inputMode="numeric" placeholder="49" />
          </Field>
        </div>
        <Field group label={t("set.defaultLang")}>
          <Segmented
            value={defaultLang}
            onChange={setDefaultLang}
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
          />
        </Field>
        <div class="row end">
          <Button type="submit" busy={busy} icon="check">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function AccountSettings() {
  const { me, users, reloadAccounts } = useFamily();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [color, setColor] = useState<UserColor>(me.color);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [newUser, setNewUser] = useState({ displayName: "", username: "", password: "" });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ where: string; err: unknown } | null>(null);

  const run = async (where: string, fn: () => Promise<void>) => {
    setBusy(where);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError({ where, err });
    } finally {
      setBusy(null);
    }
  };

  const saveProfile = (e: Event) => {
    e.preventDefault();
    run("profile", async () => {
      await api("/admin/users/me", { method: "PATCH", body: { displayName, color } });
      await reloadAccounts();
      toast(t("common.saved"));
    });
  };
  const changePassword = (e: Event) => {
    e.preventDefault();
    run("password", async () => {
      await api("/admin/users/me/password", { body: { current, next } });
      setCurrent("");
      setNext("");
      toast(t("set.pwChanged"));
    });
  };
  const addAccount = (e: Event) => {
    e.preventDefault();
    run("add", async () => {
      await api("/admin/users", { body: newUser });
      await reloadAccounts();
      setNewUser({ displayName: "", username: "", password: "" });
      setAdding(false);
      toast(t("set.accountAdded"));
    });
  };
  const removeUser = async (u: User) => {
    if (!(await confirmDialog(t("set.removeAccountConfirm", { name: u.displayName }), { danger: true, ok: t("set.removeAccount") }))) return;
    run("remove", async () => {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      await reloadAccounts();
    });
  };
  const logoutOthers = () =>
    run("sessions", async () => {
      await api("/admin/users/me/logout-others", { body: {} });
      toast(t("set.loggedOutOthers"));
    });
  const errorFor = (where: string) => (error?.where === where ? <ErrorBox error={errorText(error.err)} /> : null);

  return (
    <Section icon="user" title={t("set.accounts")}>
      <div class="stack">
        {users.map((u) => (
          <div class="account-row" key={u.id}>
            <Avatar user={u} size={32} />
            <span class="account-name">
              {u.displayName} <span class="muted small">@{u.username}</span>
              {u.id === me.id && <span class="pill">{t("set.you")}</span>}
            </span>
            {u.id !== me.id && <IconButton icon="trash" label={t("set.removeAccount")} onClick={() => removeUser(u)} />}
          </div>
        ))}
      </div>
      {errorFor("remove")}

      {adding ? (
        <form class="form subform" onSubmit={addAccount}>
          <Field label={t("setup.displayName")}>
            <Input value={newUser.displayName} onValue={(v) => setNewUser({ ...newUser, displayName: v })} required maxLength={40} />
          </Field>
          <div class="grid-2">
            <Field label={t("login.username")} hint={t("setup.usernameHint")}>
              <Input
                value={newUser.username}
                onValue={(v) => setNewUser({ ...newUser, username: v.toLowerCase() })}
                required
                autoCapitalize="none"
                pattern="[a-z0-9._\-]{2,32}"
              />
            </Field>
            <Field label={t("login.password")} hint={t("setup.passwordHint")}>
              <Input type="password" value={newUser.password} onValue={(v) => setNewUser({ ...newUser, password: v })} required minLength={8} autoComplete="new-password" />
            </Field>
          </div>
          {errorFor("add")}
          <div class="row end">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" busy={busy === "add"} icon="check">
              {t("common.create")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setAdding(true)}>
            {t("set.addAccount")}
          </Button>
        </div>
      )}

      <form class="form subform" onSubmit={saveProfile}>
        <Field label={t("set.myName")}>
          <Input value={displayName} onValue={setDisplayName} required maxLength={40} />
        </Field>
        <Field group label={t("set.color")}>
          <div class="color-picker">
            {USER_COLORS.map((c) => (
              <button type="button" key={c} class={cls("color-dot", `u-${c}`, color === c && "is-active")} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} />
            ))}
          </div>
        </Field>
        {errorFor("profile")}
        <div class="row end">
          <Button type="submit" busy={busy === "profile"} icon="check">
            {t("common.save")}
          </Button>
        </div>
      </form>

      <form class="form subform" onSubmit={changePassword}>
        <div class="field-label">{t("set.password")}</div>
        <div class="grid-2">
          <Field label={t("set.currentPw")}>
            <Input type="password" value={current} onValue={setCurrent} required autoComplete="current-password" />
          </Field>
          <Field label={t("set.newPw")} hint={t("setup.passwordHint")}>
            <Input type="password" value={next} onValue={setNext} required minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        {errorFor("password")}
        <div class="row end wrap">
          <Button variant="ghost" size="sm" icon="logout" busy={busy === "sessions"} onClick={logoutOthers}>
            {t("set.logoutOthers")}
          </Button>
          <Button type="submit" busy={busy === "password"} icon="lock">
            {t("set.password")}
          </Button>
        </div>
      </form>
    </Section>
  );
}
