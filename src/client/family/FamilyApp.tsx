// The private area: login gate, shared data, navigation and pages.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Settings, User } from "../../shared/types";
import { api, errorText, setUnauthorizedHandler } from "../lib/api";
import { t } from "../lib/i18n";
import { Link, navigate } from "../lib/router";
import { LangSwitch, ThemeToggle, usePrefs } from "../prefs";
import { Avatar, ErrorBox, IconButton, Loading, cls } from "../ui/base";
import { Icon, Logo } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { AuthScreen, Login, Setup } from "./Auth";
import type { AuthState } from "./Auth";
import { CalendarPage } from "./Calendar";
import { FamilyContext, useFamily } from "./context";
import { FeedingPage } from "./Feeding";
import { Home } from "./Home";
import { ListPage, ListsPage } from "./Lists";
import { MorePage } from "./More";
import { PumpingPage } from "./Pumping";
import { SettingsPage } from "./Settings";
import { SleepPage } from "./Sleep";
import { ThanksPage } from "./Thanks";
import { TRACKER_PATHS, babyHref } from "./trackerUi";
import { VisitsPage } from "./Visits";

export function FamilyApp({ path }: { path: string }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [mode, setMode] = useState<"login" | "setup">("login");

  const load = () =>
    api<AuthState>("/auth/state")
      .then((s) => {
        setAuth(s);
        setFailed(null);
      })
      .catch(setFailed);

  useEffect(() => {
    load();
    setUnauthorizedHandler(() => setAuth((a) => (a ? { ...a, user: null } : a)));
    const manifest = document.getElementById("manifest");
    manifest?.setAttribute("href", "/family.webmanifest");
    document.title = "Nestchen";
    return () => {
      setUnauthorizedHandler(null);
      manifest?.setAttribute("href", "/manifest.webmanifest");
    };
  }, []);

  if (failed) return <ErrorBox error={errorText(failed)} onRetry={load} />;
  if (!auth) return <Loading />;
  if (!auth.user) {
    const signedIn = (user: User) => {
      setAuth({ ...auth, user, hasUsers: true });
      setMode("login");
    };
    return (
      <AuthScreen>
        {!auth.hasUsers || mode === "setup" ? (
          <Setup state={auth} onDone={signedIn} onBack={auth.hasUsers ? () => setMode("login") : undefined} />
        ) : (
          <Login onDone={signedIn} canSetup={auth.setupOpen} onSetup={() => setMode("setup")} />
        )}
      </AuthScreen>
    );
  }
  return (
    <FamilyProvider
      me={auth.user}
      onLoggedOut={() => {
        setMode("login");
        load();
      }}
    >
      <Shell path={path} />
    </FamilyProvider>
  );
}

function FamilyProvider({ me: initialMe, onLoggedOut, children }: { me: User; onLoggedOut: () => void; children: ComponentChildren }) {
  const { setDefaultLang } = usePrefs();
  const [data, setData] = useState<{ settings: Settings; users: User[] } | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [me, setMe] = useState(initialMe);
  const [badges, setBadges] = useState({ pending: 0, thanks: 0 });

  const reloadAccounts = async () => {
    const r = await api<{ settings: Settings; users: User[] }>("/admin/settings");
    setData(r);
    setDefaultLang(r.settings.defaultLang);
    const self = r.users.find((u) => u.id === initialMe.id);
    if (self) setMe(self);
  };
  const refreshBadges = () =>
    api<{ pending: number; thanks: number }>("/admin/badges")
      .then(setBadges)
      .catch(() => {});

  useEffect(() => {
    reloadAccounts().catch(setFailed);
    refreshBadges();
  }, []);

  if (failed) return <ErrorBox error={errorText(failed)} onRetry={() => reloadAccounts().catch(setFailed)} />;
  if (!data) return <Loading />;
  return (
    <FamilyContext.Provider
      value={{
        me,
        users: data.users,
        settings: data.settings,
        setSettings: (settings) => setData({ ...data, settings }),
        reloadAccounts,
        badges,
        refreshBadges,
        logout: async () => {
          await api("/auth/logout", { body: {} }).catch(() => {});
          navigate("/family");
          onLoggedOut();
        },
      }}
    >
      {children}
    </FamilyContext.Provider>
  );
}

interface NavItem {
  href: string;
  icon: IconName;
  label: string;
  badge?: number;
  /** Also active on these paths (the "Baby" tab covers all trackers). */
  match?: string[];
}

const isActive = (path: string, n: NavItem) =>
  n.match ? n.match.some((h) => path.startsWith(h)) : n.href === "/family" ? path === "/family" || path === "/family/" : path.startsWith(n.href);

function Shell({ path }: { path: string }) {
  const { me, badges, refreshBadges, logout, settings } = useFamily();
  useEffect(() => {
    refreshBadges();
  }, [path]);

  const home: NavItem = { href: "/family", icon: "home", label: t("nav.home") };
  const trackers: NavItem[] = [
    { href: "/family/feeding", icon: "bottle", label: t("nav.feeding") },
    { href: "/family/pumping", icon: "drop", label: t("nav.pumping") },
    { href: "/family/sleep", icon: "moon", label: t("nav.sleep") },
  ];
  const organize: NavItem[] = [
    { href: "/family/calendar", icon: "calendar", label: t("nav.calendar") },
    { href: "/family/visits", icon: "visits", label: t("nav.visits"), badge: badges.pending },
    { href: "/family/lists", icon: "list", label: t("nav.lists") },
  ];
  // Phones: one "Baby" tab for all trackers (they switch between each other at the top).
  const tabs: NavItem[] = [home, { href: babyHref(), icon: "baby", label: t("nav.baby"), match: TRACKER_PATHS }, ...organize];
  const extra: NavItem[] = [
    { href: "/family/thanks", icon: "gift", label: t("nav.thanks"), badge: badges.thanks },
    { href: "/family/settings", icon: "settings", label: t("nav.settings") },
  ];
  const moreActive = ["/family/more", "/family/thanks", "/family/settings"].some((h) => path.startsWith(h));

  return (
    <div class="shell">
      <aside class="sidebar">
        <Link href="/family" class="brand">
          <Logo size={34} />
          <span>{settings.siteName}</span>
        </Link>
        <nav class="sidebar-nav">
          {[home, ...trackers, ...organize, ...extra].map((n) => (
            <Link key={n.href} href={n.href} class={cls("nav-link", isActive(path, n) && "is-active")}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {!!n.badge && <span class="count">{n.badge}</span>}
            </Link>
          ))}
        </nav>
        <div class="sidebar-foot">
          <a href="/?view=public" target="_blank" rel="noopener" class="nav-link nav-link-small">
            <Icon name="globe" size={18} />
            <span>{t("nav.publicPage")}</span>
          </a>
          <div class="me-row">
            <Avatar user={me} size={30} />
            <span class="me-name">{me.displayName}</span>
            <IconButton icon="logout" label={t("nav.logout")} onClick={logout} />
          </div>
          <div class="row between">
            <LangSwitch />
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main class="main">
        <Route path={path} />
      </main>
      <nav class="tabbar" aria-label="Navigation">
        {tabs.map((n) => (
          <Link key={n.label} href={n.href} class={cls("tab", isActive(path, n) && "is-active")}>
            <span class="tab-icon">
              <Icon name={n.icon} size={22} />
              {!!n.badge && <span class="tab-badge">{n.badge}</span>}
            </span>
            <span>{n.label}</span>
          </Link>
        ))}
        <Link href="/family/more" class={cls("tab", moreActive && "is-active")}>
          <span class="tab-icon">
            <Icon name="more" size={22} />
            {!!badges.thanks && <span class="tab-badge tab-badge-soft">{badges.thanks}</span>}
          </span>
          <span>{t("nav.more")}</span>
        </Link>
      </nav>
    </div>
  );
}

function Route({ path }: { path: string }) {
  const p = path.replace(/\/+$/, "") || "/family";
  const list = p.match(/^\/family\/lists\/(\d+)$/);
  if (list) return <ListPage key={list[1]} id={Number(list[1])} />;
  switch (p) {
    case "/family/feeding":
      return <FeedingPage />;
    case "/family/pumping":
      return <PumpingPage />;
    case "/family/sleep":
      return <SleepPage />;
    case "/family/calendar":
      return <CalendarPage />;
    case "/family/visits":
      return <VisitsPage />;
    case "/family/lists":
      return <ListsPage />;
    case "/family/thanks":
      return <ThanksPage />;
    case "/family/settings":
      return <SettingsPage />;
    case "/family/more":
      return <MorePage />;
    default:
      return <Home />;
  }
}
