// UI shared by the trackers (feeding, pumping, sleep): live timer, today tiles, KPI tiles, the
// statistics card, the day-grouped history, the add/edit/finish form, observation chips, the ml
// slider, the tracker switch and the rows on the home screen.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { addDays, isDate, isTime, zonedNow, zonedToUtc } from "../../shared/dates";
import { ApiError, errorText } from "../lib/api";
import { clockTime, fmtDur, fmtTimer, relDay } from "../lib/format";
import { t } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import { Link } from "../lib/router";
import { store } from "../lib/storage";
import { Button, Chip, ErrorBox, Field, Input, Segmented, Textarea, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { Sheet, SheetActions, confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { useFamily } from "./context";
import { MINUTE, activeMs, durationOf, isPaused, trackerApi, useTick } from "./trackerData";
import type { Session, TrackerKind } from "./trackerData";

/** The ticking stopwatch of a running session (pauses don't count; re-renders only itself). */
export function Elapsed({ session, now }: { session: Session; now: () => number }) {
  useTick(1000);
  return <>{fmtTimer(activeMs(session, now()))}</>;
}

/** "running since 14:20" or "paused since 14:35". */
export const liveText = (s: Session, tz: string) =>
  isPaused(s) ? t("trk.pausedSince", { time: clockTime(s.pausedAt!, tz) }) : t("trk.runningSince", { time: clockTime(s.startedAt, tz) });

/** "⏸ 5 min" for sessions with a pause. */
export const pauseNote = (s: Session) => ((s.pausedMs ?? 0) >= MINUTE ? t("trk.pausedFor", { d: fmtDur(s.pausedMs!) }) : "");

/** Pause / continue next to Stop (feeding, pumping). */
export function RunningButtons({ session, busy, onPause, onResume, onStop }: { session: Session; busy: boolean; onPause: () => void; onResume: () => void; onStop: () => void }) {
  const paused = isPaused(session);
  return (
    <div class="run-actions">
      <Button variant="secondary" class="btn-xl" icon={paused ? "play" : "pause"} busy={busy} onClick={paused ? onResume : onPause}>
        {paused ? t("trk.resume") : t("trk.pauseBtn")}
      </Button>
      <Button class="btn-xl btn-stop" icon="stop" busy={busy} onClick={onStop}>
        {t("trk.stop")}
      </Button>
    </div>
  );
}

/** Run an action with a busy flag; errors become a toast. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

/** "5 min ago"-style text, or `none` when there's nothing yet. */
export function agoText(ms: number | null, now: number, ago: Key, justNow: Key, none: Key) {
  if (ms == null) return t(none);
  return now - ms < MINUTE ? t(justNow) : t(ago, { d: fmtDur(now - ms) });
}

// ---------------------------------------------------------------- switch between the trackers

type TrackerName = "feeding" | "pumping" | "sleep";
const TRACKERS: { key: TrackerName; href: string; icon: IconName; label: Key }[] = [
  { key: "feeding", href: "/family/feeding", icon: "bottle", label: "nav.feeding" },
  { key: "pumping", href: "/family/pumping", icon: "drop", label: "nav.pumping" },
  { key: "sleep", href: "/family/sleep", icon: "moon", label: "nav.sleep" },
];
export const TRACKER_PATHS = TRACKERS.map((tr) => tr.href);
/** Where the "Baby" tab leads: the tracker used last. */
export const babyHref = () => {
  const saved = store.get<string>("nest.babyTab", TRACKERS[0].href);
  return TRACKER_PATHS.includes(saved) ? saved : TRACKERS[0].href;
};

/** Füttern · Abpumpen · Schlaf – on phones, where the sidebar isn't visible. */
export function TrackerSwitch({ active }: { active: TrackerName }) {
  useEffect(() => {
    store.set("nest.babyTab", TRACKERS.find((tr) => tr.key === active)!.href);
  }, [active]);
  return (
    <nav class="segmented tracker-switch" aria-label={t("nav.baby")}>
      {TRACKERS.map((tr) => (
        <Link key={tr.key} href={tr.href} class={cls("segment", tr.key === active && "is-active")} aria-current={tr.key === active ? "page" : undefined}>
          <Icon name={tr.icon} size={17} />
          {t(tr.label)}
        </Link>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- tiles & statistics

export function TodayCard({ title, tiles }: { title?: string; tiles: { value: ComponentChildren; label: string }[] }) {
  return (
    <section class="card today-card">
      <h2 class="card-title">
        <Icon name="sun" /> {title ?? t("trk.todayTitle")}
      </h2>
      <div class="today-stats">
        {tiles.map((x) => (
          <div key={x.label}>
            <span class="today-value">{x.value}</span>
            <span class="today-label">{x.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Kpi({ label, value, delta, days }: { label: string; value: string | null; delta: number | null | undefined; days: number }) {
  let trend: string | null = null;
  if (delta !== undefined && delta !== null) {
    trend =
      Math.abs(delta) < 0.05
        ? t("trk.trendFlat", { n: days })
        : t(delta > 0 ? "trk.trendUp" : "trk.trendDown", { pct: Math.round(Math.abs(delta) * 100), n: days });
  }
  return (
    <div class="kpi">
      <div class="kpi-label">{label}</div>
      <div class="kpi-value">{value ?? "–"}</div>
      {trend && <div class="kpi-trend">{trend}</div>}
    </div>
  );
}

const RANGES = [7, 14, 30];

/** The statistics card with its 7 / 14 / 30 day switch (remembered per tracker). */
export function StatsCard({
  storeKey,
  hint,
  extra,
  children,
}: {
  storeKey: string;
  hint: string;
  /** More controls under the hint (e.g. "with breastfeeding"). */
  extra?: ComponentChildren;
  children: (range: number) => ComponentChildren;
}) {
  const [range, setRange] = useState<number>(() => {
    const saved = store.get<number>(storeKey, 7);
    return RANGES.includes(saved) ? saved : 7;
  });
  return (
    <section class="card stats-card">
      <div class="stats-head">
        <h2 class="card-title">
          <Icon name="star" /> {t("trk.stats")}
        </h2>
        <Segmented
          value={String(range)}
          onChange={(v) => {
            setRange(Number(v));
            store.set(storeKey, Number(v));
          }}
          options={RANGES.map((n) => ({ value: String(n), label: t("trk.days", { n }) }))}
        />
      </div>
      <p class="field-hint">{hint}</p>
      {extra}
      {children(range)}
    </section>
  );
}

// ---------------------------------------------------------------- history

export interface HistoryRow {
  /** Colour class of the dot. */
  cls?: string;
  what: ComponentChildren;
  notes?: string;
}

/** Sessions grouped by the day they started, newest first, with the gap between them. */
export function SessionHistory<T extends Session>({
  sessions,
  tz,
  today,
  onOpen,
  row,
  dayMeta,
  gap,
  empty,
}: {
  sessions: T[];
  tz: string;
  today: string;
  onOpen: (s: T) => void;
  row: (s: T) => HistoryRow;
  dayMeta: (list: T[]) => string;
  /** Label between two sessions, e.g. "1 h break" or "2 h awake". */
  gap: (ms: number) => string;
  empty: ComponentChildren;
}) {
  const [shown, setShown] = useState(3);
  const groups = new Map<string, T[]>();
  for (const s of [...sessions].sort((a, b) => b.startedAt - a.startedAt)) {
    const d = zonedNow(tz, new Date(s.startedAt)).date;
    groups.set(d, [...(groups.get(d) ?? []), s]);
  }
  const dates = [...groups.keys()];
  return (
    <section class="card">
      <h2 class="card-title">
        <Icon name="clock" /> {t("trk.history")}
      </h2>
      {!dates.length ? (
        empty
      ) : (
        <>
          {dates.slice(0, shown).map((date) => {
            const list = groups.get(date)!;
            return (
              <div class="feed-day" key={date}>
                <div class="feed-day-head">
                  <strong>{relDay(date, today)}</strong>
                  <span class="muted small">{dayMeta(list)}</span>
                </div>
                <div class="feed-rows">
                  {list.map((s, i) => {
                    const older = list[i + 1];
                    const running = s.endedAt == null;
                    const r = row(s);
                    return (
                      <div key={s.id} class="feed-entry">
                        <button type="button" class={cls("feeding-row", r.cls, running && "is-running")} onClick={() => !running && onOpen(s)} disabled={running}>
                          <span class="swatch" aria-hidden="true" />
                          <span class="feed-time">
                            {clockTime(s.startedAt, tz)}
                            {running ? "" : `–${clockTime(s.endedAt!, tz)}`}
                          </span>
                          <span class="feed-main">
                            <span class="feed-what">{r.what}</span>
                            {r.notes && <span class="feed-notes">{r.notes}</span>}
                          </span>
                          <span class="feed-dur">
                            {running ? <span class="badge badge-live">{isPaused(s) ? t("trk.paused") : t("trk.live")}</span> : fmtDur(durationOf(s))}
                          </span>
                        </button>
                        {older?.endedAt != null && s.startedAt > older.endedAt && (
                          <div class="feed-pause">{gap(s.startedAt - older.endedAt)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {dates.length > shown && (
            <button type="button" class="text-btn center" onClick={() => setShown(shown + 7)}>
              {t("trk.showOlder")}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- add / edit / finish sheet

export type SheetState<T> = { mode: "new" } | { mode: "edit" | "finish"; session: T } | null;

export function SessionSheet<T extends Session>({
  state,
  onClose,
  addTitle,
  editTitle,
  children,
}: {
  state: SheetState<T>;
  onClose: () => void;
  addTitle: string;
  editTitle: string;
  children: (state: NonNullable<SheetState<T>>) => ComponentChildren;
}) {
  const title = !state
    ? ""
    : state.mode === "new"
      ? addTitle
      : state.mode === "finish"
        ? t("trk.savedTitle", { d: fmtDur(durationOf(state.session)) })
        : editTitle;
  return (
    <Sheet open={!!state} onClose={onClose} title={title}>
      {state && children(state)}
    </Sheet>
  );
}

/**
 * The form of all trackers: times (up front, or folded away right after stopping), the tracker's
 * own fields (children), observations, then delete / save.
 */
export function SessionForm<T extends Session>({
  kind,
  state,
  onClose,
  onSaved,
  defaultMinutes,
  fields,
  observations,
  notesPh,
  deleteText,
  pausable,
  children,
}: {
  kind: TrackerKind;
  state: NonNullable<SheetState<T>>;
  onClose: () => void;
  onSaved: () => void;
  /** Length of a newly logged session. */
  defaultMinutes: number;
  /** The tracker's own fields, as sent to the API. */
  fields: () => Record<string, unknown>;
  observations: Key[];
  notesPh: string;
  deleteText: string;
  /** Show the "pause (min)" field (feeding, pumping). */
  pausable?: boolean;
  children: ComponentChildren;
}) {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const session = state.mode === "new" ? null : state.session;
  const [initial] = useState(() => {
    const now = Date.now();
    const s = zonedNow(tz, new Date(session ? session.startedAt : now - defaultMinutes * MINUTE));
    const e = zonedNow(tz, new Date(session ? (session.endedAt ?? now) : now));
    return { date: s.date, start: s.time, end: e.time };
  });
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const initialPause = Math.round((session?.pausedMs ?? 0) / MINUTE);
  const [pause, setPause] = useState(initialPause ? String(initialPause) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const calls = trackerApi<T>(kind);
  const timesChanged = date !== initial.date || start !== initial.start || end !== initial.end;

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...fields(), notes };
      if (pausable) {
        const minutes = pause.trim() === "" ? 0 : Number(pause);
        if (!Number.isInteger(minutes) || minutes < 0) throw new ApiError(400, "invalid", "pausedMs");
        // Only when changed, so a pause of e.g. 90 s isn't rounded away.
        if (!session || minutes !== initialPause) body.pausedMs = minutes * MINUTE;
      }
      if (!session || timesChanged) {
        if (!isDate(date) || !isTime(start) || !isTime(end)) throw new ApiError(400, "invalid", "startedAt");
        body.startedAt = zonedToUtc(date, start, tz);
        // An end before the start means the next day (e.g. a night from 20:00 to 06:00).
        body.endedAt = zonedToUtc(end < start ? addDays(date, 1) : date, end, tz);
      }
      if (session) await calls.patch(session.id, body);
      else await calls.create(body);
      if (state.mode !== "finish") toast(t("common.saved"));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "network"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!session || !(await confirmDialog(deleteText, { danger: true }))) return;
    try {
      await calls.remove(session.id);
      toast(t("common.deleted"));
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };

  const times = (
    <div class="when-row">
      <Input type="date" value={date} onValue={setDate} required aria-label={t("common.date")} />
      <Input type="time" value={start} onValue={setStart} required aria-label={t("trk.startTime")} />
      <span class="dash" aria-hidden="true">
        –
      </span>
      <Input type="time" value={end} onValue={setEnd} required aria-label={t("trk.endTime")} />
    </div>
  );
  const pauseField = pausable && (
    <Field label={t("trk.pauseField")} class="pause-field">
      <Input type="number" inputMode="numeric" min={0} step={1} value={pause} onValue={setPause} placeholder="0" />
    </Field>
  );

  return (
    <form class="form" onSubmit={save}>
      {state.mode !== "finish" && (
        <Field group label={`${t("trk.startTime")} – ${t("trk.endTime")}`}>
          {times}
        </Field>
      )}
      {state.mode !== "finish" && pauseField}
      {children}
      <NotesField keys={observations} value={notes} onChange={setNotes} placeholder={notesPh} />
      {state.mode === "finish" && (
        <details class="adjust">
          <summary>{t("trk.adjustTimes")}</summary>
          {times}
          {pauseField}
        </details>
      )}
      {error && <ErrorBox error={errorText(error)} />}
      <SheetActions>
        {state.mode === "edit" && (
          <Button variant="danger" icon="trash" onClick={remove}>
            {t("common.delete")}
          </Button>
        )}
        <span class="spacer" />
        <Button type="submit" busy={busy} icon="check">
          {state.mode === "finish" ? t("trk.done") : t("common.save")}
        </Button>
      </SheetActions>
    </form>
  );
}

/** Tap-to-add observation phrases plus free text (stored as one comma-separated text). */
function NotesField({ keys, value, onChange, placeholder }: { keys: Key[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  const phrases = value.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const has = (p: string) => phrases.some((x) => x.toLowerCase() === p.toLowerCase());
  const toggle = (p: string) => onChange((has(p) ? phrases.filter((x) => x.toLowerCase() !== p.toLowerCase()) : [...phrases, p]).join(", "));
  return (
    <Field group label={t("trk.notes")}>
      <div class="chips">
        {keys.map((k) => (
          <Chip key={k} active={has(t(k))} onClick={() => toggle(t(k))}>
            {t(k)}
          </Chip>
        ))}
      </div>
      <Textarea value={value} onValue={onChange} rows={2} maxLength={1000} placeholder={placeholder} aria-label={t("trk.notes")} />
    </Field>
  );
}

// ---------------------------------------------------------------- amount slider

const AMOUNT_LIMIT = 2000;

/** Amount in ml: a slider for quick setting, − / + for 5 ml steps. `null` = not given. */
export function AmountSlider({ value, onChange, label, max: baseMax = 300 }: { value: number | null; onChange: (v: number | null) => void; label: string; max?: number }) {
  const v = value ?? 0;
  // The scale grows in 100 ml steps if a larger amount is entered with +.
  const max = Math.max(baseMax, Math.ceil(v / 100) * 100);
  const set = (n: number) => onChange(Math.min(AMOUNT_LIMIT, Math.max(0, Math.round(n / 5) * 5)));
  return (
    <div class="field amount" role="group" aria-label={label}>
      <div class="amount-head">
        <span class="field-label">{label}</span>
        <span class="amount-value" aria-hidden="true">
          {value == null ? "–" : value}
          <small> ml</small>
        </span>
      </div>
      <div class="amount-row">
        <button type="button" class="icon-btn amount-step" aria-label={t("trk.amountLess")} disabled={v <= 0} onClick={() => set(v - 5)}>
          −
        </button>
        <input
          type="range"
          class={cls("amount-range", value == null && "is-empty")}
          min={0}
          max={max}
          step={5}
          value={v}
          aria-label={label}
          aria-valuetext={value == null ? t("trk.amountNone") : `${value} ml`}
          style={{ "--pct": `${(v / max) * 100}%` }}
          onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <button type="button" class="icon-btn amount-step" aria-label={t("trk.amountMore")} disabled={v >= AMOUNT_LIMIT} onClick={() => set(v + 5)}>
          +
        </button>
      </div>
      <div class="amount-foot">
        <span class="field-hint">{value == null ? t("trk.amountHint") : `0 – ${max} ml`}</span>
        {value != null && (
          <button type="button" class="text-btn" onClick={() => onChange(null)}>
            {t("trk.amountClear")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- home screen

/** One tracker on the home screen: status on the left (links to the tracker), one action on the right. */
export function TrackerRow({
  href,
  icon,
  title,
  running,
  paused,
  main,
  sub,
  children,
}: {
  href: string;
  icon: IconName;
  title: string;
  running: boolean;
  paused?: boolean;
  main: ComponentChildren;
  sub?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <div class={cls("trk-row", running && "is-running", paused && "is-paused")}>
      <Link href={href} class="trk-row-link">
        <span class="trk-row-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <span class="trk-row-info">
          <span class="trk-row-title">
            {title}
            {paused ? <span class="paused-tag">{t("trk.paused")}</span> : running && <span class="live-dot" aria-hidden="true" />}
          </span>
          <span class="trk-row-main">{main}</span>
          {sub && <span class="trk-row-sub">{sub}</span>}
        </span>
      </Link>
      <div class="trk-row-action">{children}</div>
    </div>
  );
}
