// The public page for family & friends.
import { useCallback, useEffect, useState } from "preact/hooks";
import type { Lang, PublicInfo, PublicVisit, SlotKind } from "../../shared/types";
import { api, errorText } from "../lib/api";
import { dayShort, timeRange } from "../lib/format";
import { getLang, otherLang, t } from "../lib/i18n";
import { Link, navigate } from "../lib/router";
import { store } from "../lib/storage";
import { LangSwitch, ThemeToggle, usePrefs } from "../prefs";
import { Button, ErrorBox, Field, Input, Lines, Loading, StatusBadge } from "../ui/base";
import { Icon, Logo } from "../ui/icons";
import { StatusPage } from "./Status";
import { VisitSection } from "./Visits";
import { WishlistSection } from "./Wishlist";

/** A text in the visitor's language, falling back to the other language. */
export const pickText = (text: Record<Lang, string> | undefined) => (text ? text[getLang()] || text[otherLang()] : "").trim();

export interface SavedRequest {
  token: string;
  kind: SlotKind;
  createdAt: number;
}

export function saveRequest(entry: SavedRequest) {
  const list = store.get<SavedRequest[]>("nest.requests", []).filter((r) => r.token !== entry.token);
  list.push(entry);
  store.set("nest.requests", list.slice(-10));
}

export function PublicApp({ path }: { path: string }) {
  const { setDefaultLang } = usePrefs();
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [failed, setFailed] = useState<unknown>(null);

  const load = useCallback(async (first = false) => {
    setFailed(null);
    try {
      const data = await api<PublicInfo>("/public/info");
      // Logged-in parents go straight to their private area ("/?view=public" shows them the guests' page).
      if (first && data.parent && location.pathname === "/" && !new URLSearchParams(location.search).has("view")) {
        navigate("/family", true);
        return;
      }
      setInfo(data);
      setDefaultLang(data.defaultLang);
      document.title = data.siteName;
    } catch (err) {
      setFailed(err);
    }
  }, []);

  useEffect(() => {
    // Share links can carry the family code: https://…/#code=XYZ
    const unlockFromHash = () => {
      const m = location.hash.match(/^#(?:code|c)=(.+)$/);
      if (!m) return false;
      history.replaceState(null, "", location.pathname + location.search);
      api("/public/unlock", { body: { code: decodeURIComponent(m[1]) } })
        .catch(() => {})
        .finally(() => load());
      return true;
    };
    if (!unlockFromHash()) load(true);
    window.addEventListener("hashchange", unlockFromHash);
    return () => window.removeEventListener("hashchange", unlockFromHash);
  }, []);

  const status = path.match(/^\/r\/([A-Za-z0-9_-]{16,64})\/?$/);
  let content;
  if (failed) content = <ErrorBox error={errorText(failed)} onRetry={() => load(true)} />;
  else if (!info) content = <Loading />;
  else if (status) content = <StatusPage token={status[1]} />;
  else if (info.locked) content = <GuestLock onUnlocked={load} />;
  else content = <PublicHome info={info} />;

  return (
    <div class="pub">
      <header class="pub-header">
        <div class="container pub-header-inner">
          <Link href="/" class="brand">
            <Logo size={34} />
            <span>{info?.siteName ?? ""}</span>
          </Link>
          <div class="header-tools">
            <LangSwitch />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main class="container pub-main">{content}</main>
      <footer class="container pub-footer">
        <span>{t("pub.footer.made")}</span>
        <Link href="/family" class="text-link">
          <Icon name="lock" size={14} /> {t("pub.footer.parents")}
        </Link>
      </footer>
    </div>
  );
}

function PublicHome({ info }: { info: PublicInfo }) {
  const f = info.features!;
  const [requestsVersion, setRequestsVersion] = useState(0);
  const title = pickText(info.texts?.title);
  const intro = pickText(info.texts?.intro);
  return (
    <>
      <section class="hero">
        <HeroArt />
        <h1 class="hero-title">{title || info.siteName}</h1>
        {intro && <Lines text={intro} class="hero-intro" />}
        <nav class="hero-nav" aria-label="Sections">
          {f.visits && (
            <a href="#besuch" class="hero-chip">
              ☕ {t("pub.nav.visit")}
            </a>
          )}
          {f.meals && (
            <a href="#besuch" class="hero-chip">
              🍲 {t("pub.nav.meal")}
            </a>
          )}
          {f.wishlist && (
            <a href="#wuensche" class="hero-chip">
              🎁 {t("pub.nav.wishlist")}
            </a>
          )}
        </nav>
      </section>
      <MyRequests version={requestsVersion} />
      {(f.visits || f.meals) && <VisitSection info={info} onRequested={() => setRequestsVersion((v) => v + 1)} />}
      {f.wishlist && <WishlistSection info={info} />}
    </>
  );
}

function HeroArt() {
  return (
    <svg class="hero-art" viewBox="0 0 220 160" aria-hidden="true">
      <defs>
        <mask id="hero-cut">
          <rect width="220" height="160" fill="#fff" />
          <circle cx="166" cy="44" r="27" fill="#000" />
        </mask>
      </defs>
      <circle cx="146" cy="62" r="34" class="art-moon" mask="url(#hero-cut)" />
      <path class="art-star" transform="translate(186 88) scale(1.2)" d="M0-6.2 1.6-2.2 5.9-1.9 2.6.9 3.6 5 0 2.8-3.6 5-2.6.9-5.9-1.9-1.6-2.2Z" />
      <path class="art-star art-star-2" transform="translate(98 30) scale(.8)" d="M0-6.2 1.6-2.2 5.9-1.9 2.6.9 3.6 5 0 2.8-3.6 5-2.6.9-5.9-1.9-1.6-2.2Z" />
      <circle cx="118" cy="110" r="2.5" class="art-dot" />
      <circle cx="200" cy="34" r="2" class="art-dot" />
      <path class="art-cloud" d="M104 146a17 17 0 0 1 4-33 25 25 0 0 1 47-6 19 19 0 0 1 31 12 14 14 0 0 1 1 27z" />
    </svg>
  );
}

function GuestLock({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/public/unlock", { body: { code } });
      onUnlocked();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card narrow lock">
      <Logo size={64} />
      <h1>{t("pub.lock.title")}</h1>
      <p class="muted">{t("pub.lock.text")}</p>
      <form class="form" onSubmit={submit}>
        <Field label={t("pub.lock.code")} error={error}>
          <Input value={code} onValue={setCode} required autoFocus autoComplete="off" autoCapitalize="none" />
        </Field>
        <Button type="submit" block busy={busy} icon="lock">
          {t("pub.lock.submit")}
        </Button>
      </form>
    </div>
  );
}

/** Requests sent from this browser, with their live status. */
function MyRequests({ version }: { version: number }) {
  const [items, setItems] = useState<(SavedRequest & { visit: PublicVisit })[]>([]);
  useEffect(() => {
    const saved = store.get<SavedRequest[]>("nest.requests", []);
    if (!saved.length) return;
    Promise.all(
      saved.map((s) =>
        api<{ visit: PublicVisit }>(`/public/requests/${s.token}`)
          .then((r) => ({ ...s, visit: r.visit }))
          .catch(() => null),
      ),
    ).then((list) => {
      const valid = list.filter((x): x is SavedRequest & { visit: PublicVisit } => !!x);
      setItems(valid.reverse());
      store.set(
        "nest.requests",
        valid.map(({ token, kind, createdAt }) => ({ token, kind, createdAt })).reverse(),
      );
    });
  }, [version]);
  if (!items.length) return null;
  return (
    <section class="section section-tight" aria-labelledby="mine-title">
      <h2 id="mine-title" class="h3">
        {t("pub.mine.title")}
      </h2>
      <div class="mine">
        {items.map(({ token, visit: v }) => (
          <Link key={token} href={`/r/${token}`} class="mine-row">
            <span class={`slot-icon k-${v.kind}`} aria-hidden="true">
              {v.kind === "meal" ? "🍲" : "☕"}
            </span>
            <span class="mine-when">
              {v.date ? `${dayShort(v.date)}${v.start ? `, ${timeRange(v.start, v.end)}` : ""}` : t("pub.mine.proposals")}
            </span>
            <StatusBadge status={v.status} />
            <Icon name="chevronRight" size={18} />
          </Link>
        ))}
      </div>
    </section>
  );
}
