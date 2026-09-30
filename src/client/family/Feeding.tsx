// Private feeding tracker: start/stop with a live timer, history, statistics, and a home-screen card.
import { useEffect, useState } from "preact/hooks";
import { addDays, isDate, isTime, zonedNow, zonedToUtc } from "../../shared/dates";
import { FEED_METHODS, FEED_SIDES, hasAmount, isBreastMethod } from "../../shared/types";
import type { FeedMethod, FeedSide, Feeding } from "../../shared/types";
import { ApiError, api, errorText } from "../lib/api";
import { clockTime, fmtDur, fmtNumber, fmtTimer, relDay } from "../lib/format";
import { t, tn } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import { Link } from "../lib/router";
import { store } from "../lib/storage";
import { Button, Chip, Empty, ErrorBox, Field, Input, Loading, Segmented, Textarea, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import { Sheet, SheetActions, confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page } from "./common";
import { useFamily } from "./context";
import { change, dailyStats, durationOf, localDate, patchFeed, startFeed, stopFeed, suggestNext, summarize, useFeedings, useTick } from "./feedingData";
import { CountChart, DayTable, DurationChart, MethodBreakdown, Rhythm } from "./FeedingCharts";

const RANGES = [7, 14, 30] as const;
const LONG_RUNNING = 2 * 3_600_000;

const methodLabel = (m: FeedMethod) => (m === "shield" ? t("feed.mShort.shield") : t(`feed.m.${m}`));
const describe = (f: { method: FeedMethod; side: FeedSide | null; amountMl?: number | null }) =>
  [methodLabel(f.method), f.side && t(`feed.sideLc.${f.side}`), f.amountMl != null && `${f.amountMl} ml`].filter(Boolean).join(" · ");

function lastFedText(last: Feeding | null, now: number) {
  if (!last?.endedAt) return t("feed.lastNone");
  const ago = now - last.startedAt;
  return ago < 60_000 ? t("feed.lastJustNow") : t("feed.lastAgo", { d: fmtDur(ago) });
}

/** The ticking stopwatch (re-renders only itself every second). */
function Elapsed({ since, now }: { since: number; now: () => number }) {
  useTick(1000);
  return <>{fmtTimer(now() - since)}</>;
}

function MethodPicker({ value, onChange }: { value: FeedMethod; onChange: (m: FeedMethod) => void }) {
  return (
    <div class="method-picker" role="radiogroup" aria-label={t("feed.how")}>
      {FEED_METHODS.map((m) => (
        <button type="button" key={m} role="radio" aria-checked={value === m} class={cls("method-opt", `m-${m}`, value === m && "is-active")} onClick={() => onChange(m)}>
          <span class="swatch" aria-hidden="true" />
          <span>{t(`feed.m.${m}`)}</span>
        </button>
      ))}
    </div>
  );
}

function SidePicker({ value, onChange }: { value: FeedSide | null; onChange: (s: FeedSide) => void }) {
  return (
    <Segmented
      value={value ?? "left"}
      onChange={onChange}
      label={t("feed.side")}
      options={FEED_SIDES.map((s) => ({ value: s, label: t(`feed.side.${s}`) }))}
    />
  );
}

type Feed = ReturnType<typeof useFeedings>;
type SheetState = { mode: "new" } | { mode: "edit" | "finish"; feeding: Feeding } | null;

// ---------------------------------------------------------------- page

export function FeedingPage() {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const feed = useFeedings(62);
  const [sheet, setSheet] = useState<SheetState>(null);
  useTick(30_000);

  if (feed.error && !feed.data) {
    return (
      <Page title={t("feed.title")}>
        <ErrorBox error={errorText(feed.error)} onRetry={feed.reload} />
      </Page>
    );
  }
  if (!feed.data) return <Loading />;
  const data = feed.data;
  const now = feed.now();
  const today = zonedNow(tz, new Date(now)).date;
  const all = data.running && !data.feedings.some((f) => f.id === data.running!.id) ? [...data.feedings, data.running] : data.feedings;

  return (
    <Page title={t("feed.title")} subtitle={data.running ? null : lastFedText(data.last, now)}>
      <div class="feed-top">
        <FeedControl feed={feed} onFinished={(f) => setSheet({ mode: "finish", feeding: f })} onAdd={() => setSheet({ mode: "new" })} />
        <TodayCard feedings={all} tz={tz} today={today} now={now} />
      </div>
      <StatsSection feedings={all} tz={tz} today={today} now={now} />
      <History feedings={all} tz={tz} today={today} onOpen={(f) => setSheet({ mode: "edit", feeding: f })} />
      <FeedSheet state={sheet} defaults={suggestNext(data.last)} onClose={() => setSheet(null)} onSaved={feed.reload} />
    </Page>
  );
}

function FeedControl({ feed, onFinished, onAdd }: { feed: Feed; onFinished: (f: Feeding) => void; onAdd: () => void }) {
  const { settings } = useFamily();
  const data = feed.data!;
  const running = data.running;
  const suggestion = suggestNext(data.last);
  const [method, setMethod] = useState<FeedMethod>(suggestion.method);
  const [side, setSide] = useState<FeedSide | null>(suggestion.side);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Follow the suggestion (e.g. after the other parent logged a feed) until someone picks by hand.
  useEffect(() => {
    if (touched) return;
    setMethod(suggestion.method);
    setSide(suggestion.side);
  }, [data.last?.id]);

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

  const start = () =>
    run(async () => {
      const r = await startFeed(method, isBreastMethod(method) ? (side ?? "left") : null);
      if (r.alreadyRunning) toast(t("feed.alreadyRunning"));
      feed.setData({ ...data, running: r.feeding });
      setTouched(false);
      feed.reload();
    });

  const stop = () =>
    run(async () => {
      const r = await stopFeed(running!.id);
      feed.setData({ ...data, running: null, last: r.feeding });
      onFinished(r.feeding);
      feed.reload();
    });

  const changeRunning = (patch: Partial<Feeding>) =>
    run(async () => {
      const r = await patchFeed(running!.id, patch);
      feed.setData({ ...data, running: r.feeding });
    });

  const discard = async () => {
    if (!(await confirmDialog(t("feed.discardConfirm"), { danger: true, ok: t("feed.discard") }))) return;
    run(async () => {
      await api(`/admin/feedings/${running!.id}`, { method: "DELETE" });
      feed.setData({ ...data, running: null });
      feed.reload();
    });
  };

  if (running) {
    const tooLong = feed.now() - running.startedAt > LONG_RUNNING;
    return (
      <section class="card feed-control is-running" aria-live="polite">
        <div class="feed-live">
          <span class="live-dot" aria-hidden="true" />
          {t("feed.runningSince", { time: clockTime(running.startedAt, settings.timezone) })}
        </div>
        <div class="feed-timer">
          <Elapsed since={running.startedAt} now={feed.now} />
        </div>
        <MethodPicker value={running.method} onChange={(m) => changeRunning({ method: m, side: isBreastMethod(m) ? (running.side ?? "left") : null })} />
        {isBreastMethod(running.method) && <SidePicker value={running.side} onChange={(s) => changeRunning({ side: s })} />}
        {tooLong && (
          <p class="hint-box">
            <Icon name="info" size={16} /> {t("feed.tooLong")}
          </p>
        )}
        <Button class="btn-xl btn-stop" block icon="stop" busy={busy} onClick={stop}>
          {t("feed.stop")}
        </Button>
        <button type="button" class="text-btn center" onClick={discard}>
          {t("feed.discard")}
        </button>
      </section>
    );
  }

  return (
    <section class="card feed-control">
      <div class="field-label">{t("feed.how")}</div>
      <MethodPicker
        value={method}
        onChange={(m) => {
          setTouched(true);
          setMethod(m);
          if (isBreastMethod(m) && !side) setSide(suggestion.side ?? "left");
        }}
      />
      {isBreastMethod(method) && (
        <div class="stack">
          <div class="field-label">
            {t("feed.side")}
            {data.last?.side && <span class="opt"> · {t("feed.lastSide", { side: t(`feed.sideLc.${data.last.side}`) })}</span>}
          </div>
          <SidePicker
            value={side}
            onChange={(s) => {
              setTouched(true);
              setSide(s);
            }}
          />
        </div>
      )}
      <Button class="btn-xl" block icon="play" busy={busy} onClick={start}>
        {t("feed.start")}
      </Button>
      <button type="button" class="text-btn center" onClick={onAdd}>
        + {t("feed.add")}
      </button>
    </section>
  );
}

function TodayCard({ feedings, tz, today, now }: { feedings: Feeding[]; tz: string; today: string; now: number }) {
  const todays = feedings.filter((f) => localDate(f.startedAt, tz) === today).sort((a, b) => a.startedAt - b.startedAt);
  const total = todays.reduce((sum, f) => sum + ((f.endedAt ?? now) - f.startedAt), 0);
  const intervals = todays.slice(1).map((f, i) => f.startedAt - todays[i].startedAt);
  const avgInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  return (
    <section class="card today-card">
      <h2 class="card-title">
        <Icon name="sun" /> {t("feed.todayTitle")}
      </h2>
      <div class="today-stats">
        <div>
          <span class="today-value">{todays.length}</span>
          <span class="today-label">{t("feed.todayCount")}</span>
        </div>
        <div>
          <span class="today-value">{todays.length ? fmtDur(total) : "–"}</span>
          <span class="today-label">{t("feed.todayTotal")}</span>
        </div>
        <div>
          <span class="today-value">{avgInterval == null ? "–" : fmtDur(avgInterval)}</span>
          <span class="today-label">{t("feed.todayInterval")}</span>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, delta, days }: { label: string; value: string | null; delta: number | null | undefined; days: number }) {
  let trend: string | null = null;
  if (delta !== undefined && delta !== null) {
    trend =
      Math.abs(delta) < 0.05
        ? t("feed.trendFlat", { n: days })
        : t(delta > 0 ? "feed.trendUp" : "feed.trendDown", { pct: Math.round(Math.abs(delta) * 100), n: days });
  }
  return (
    <div class="kpi">
      <div class="kpi-label">{label}</div>
      <div class="kpi-value">{value ?? "–"}</div>
      {trend && <div class="kpi-trend">{trend}</div>}
    </div>
  );
}

function StatsSection({ feedings, tz, today, now }: { feedings: Feeding[]; tz: string; today: string; now: number }) {
  const [range, setRange] = useState<number>(() => {
    const saved = store.get<number>("nest.feedRange", 7);
    return RANGES.includes(saved as 7) ? saved : 7;
  });
  const days = dailyStats(feedings, tz, addDays(today, -range), addDays(today, -1));
  const cur = summarize(days);
  const prev = summarize(dailyStats(feedings, tz, addDays(today, -2 * range), addDays(today, -range - 1)));
  const comparable = prev.trackedDays >= Math.min(3, range);
  const delta = (a: number | null, b: number | null) => (comparable ? change(a, b) : undefined);
  const rhythmDates = Array.from({ length: range + 1 }, (_, i) => addDays(today, -i));

  return (
    <section class="card stats-card">
      <div class="stats-head">
        <h2 class="card-title">
          <Icon name="star" /> {t("feed.stats")}
        </h2>
        <Segmented
          value={String(range)}
          onChange={(v) => {
            setRange(Number(v));
            store.set("nest.feedRange", Number(v));
          }}
          options={RANGES.map((n) => ({ value: String(n), label: t("feed.days", { n }) }))}
        />
      </div>
      <p class="field-hint">{t("feed.statsHint")}</p>
      {cur.trackedDays === 0 ? (
        <Empty emoji="📊" title={t("feed.statsEmpty")} />
      ) : (
        <>
          <div class="kpis">
            <Kpi label={t("feed.kpi.perDay")} value={cur.perDay == null ? null : fmtNumber(cur.perDay)} delta={delta(cur.perDay, prev.perDay)} days={range} />
            <Kpi label={t("feed.kpi.duration")} value={cur.avgDurationMs == null ? null : fmtDur(cur.avgDurationMs)} delta={delta(cur.avgDurationMs, prev.avgDurationMs)} days={range} />
            <Kpi label={t("feed.kpi.interval")} value={cur.avgIntervalMs == null ? null : fmtDur(cur.avgIntervalMs)} delta={delta(cur.avgIntervalMs, prev.avgIntervalMs)} days={range} />
            <Kpi label={t("feed.kpi.longest")} value={cur.avgLongestGapMs == null ? null : fmtDur(cur.avgLongestGapMs)} delta={delta(cur.avgLongestGapMs, prev.avgLongestGapMs)} days={range} />
            <Kpi label={t("feed.kpi.total")} value={cur.totalPerDayMs == null ? null : fmtDur(cur.totalPerDayMs)} delta={delta(cur.totalPerDayMs, prev.totalPerDayMs)} days={range} />
            {cur.amountPerDay != null && (
              <Kpi label={t("feed.kpi.amount")} value={`${Math.round(cur.amountPerDay)} ml`} delta={delta(cur.amountPerDay, prev.amountPerDay)} days={range} />
            )}
          </div>
          {!comparable && <p class="field-hint">{t("feed.trendNone")}</p>}
          <div class="charts">
            <div>
              <h3 class="chart-title">{t("feed.chart.count")}</h3>
              <CountChart days={days} />
            </div>
            <div>
              <h3 class="chart-title">{t("feed.chart.duration")}</h3>
              <DurationChart days={days} />
            </div>
          </div>
          <h3 class="chart-title">{t("feed.chart.methods")}</h3>
          <MethodBreakdown methods={cur.methods} />
          <h3 class="chart-title">{t("feed.chart.rhythm")}</h3>
          <p class="field-hint chart-hint">{t("feed.chart.rhythmHint")}</p>
          <Rhythm feedings={feedings} dates={rhythmDates} tz={tz} now={now} />
          <DayTable days={days} />
        </>
      )}
    </section>
  );
}

function History({ feedings, tz, today, onOpen }: { feedings: Feeding[]; tz: string; today: string; onOpen: (f: Feeding) => void }) {
  const [shown, setShown] = useState(3);
  const groups = new Map<string, Feeding[]>();
  for (const f of [...feedings].sort((a, b) => b.startedAt - a.startedAt)) {
    const d = localDate(f.startedAt, tz);
    groups.set(d, [...(groups.get(d) ?? []), f]);
  }
  const dates = [...groups.keys()];
  return (
    <section class="card">
      <h2 class="card-title">
        <Icon name="clock" /> {t("feed.history")}
      </h2>
      {!dates.length ? (
        <Empty emoji="🍼" title={t("feed.empty")} />
      ) : (
        <>
          {dates.slice(0, shown).map((date) => {
            const list = groups.get(date)!;
            const total = list.reduce((sum, f) => sum + durationOf(f), 0);
            return (
              <div class="feed-day" key={date}>
                <div class="feed-day-head">
                  <strong>{relDay(date, today)}</strong>
                  <span class="muted small">
                    {tn("feed.count", list.length)} · {fmtDur(total)}
                  </span>
                </div>
                <div class="feed-rows">
                  {list.map((f, i) => {
                    const older = list[i + 1];
                    const running = f.endedAt == null;
                    return (
                      <div key={f.id} class="feed-entry">
                        <button type="button" class={cls("feeding-row", `m-${f.method}`, running && "is-running")} onClick={() => !running && onOpen(f)} disabled={running}>
                          <span class="swatch" aria-hidden="true" />
                          <span class="feed-time">
                            {clockTime(f.startedAt, tz)}
                            {running ? "" : `–${clockTime(f.endedAt!, tz)}`}
                          </span>
                          <span class="feed-main">
                            <span class="feed-what">{describe(f)}</span>
                            {f.notes && <span class="feed-notes">{f.notes}</span>}
                          </span>
                          <span class="feed-dur">{running ? <span class="badge badge-live">{t("feed.live")}</span> : fmtDur(durationOf(f))}</span>
                        </button>
                        {older?.endedAt != null && f.startedAt > older.endedAt && (
                          <div class="feed-pause">{t("feed.pause", { d: fmtDur(f.startedAt - older.endedAt) })}</div>
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
              {t("feed.showOlder")}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- add / edit / finish sheet

const OBSERVATIONS: Key[] = ["feed.obs.1", "feed.obs.2", "feed.obs.3", "feed.obs.4", "feed.obs.5", "feed.obs.6"];

export function FeedSheet({ state, defaults, onClose, onSaved }: { state: SheetState; defaults: { method: FeedMethod; side: FeedSide | null }; onClose: () => void; onSaved: () => void }) {
  const title = !state
    ? ""
    : state.mode === "new"
      ? t("feed.add")
      : state.mode === "finish"
        ? t("feed.savedTitle", { d: fmtDur(durationOf(state.feeding)) })
        : t("feed.edit");
  return (
    <Sheet open={!!state} onClose={onClose} title={title}>
      {state && <FeedForm key={state.mode === "new" ? "new" : state.feeding.id} state={state} defaults={defaults} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function FeedForm({ state, defaults, onClose, onSaved }: { state: NonNullable<SheetState>; defaults: { method: FeedMethod; side: FeedSide | null }; onClose: () => void; onSaved: () => void }) {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const f = state.mode === "new" ? null : state.feeding;
  const [initial] = useState(() => {
    const now = Date.now();
    const s = zonedNow(tz, new Date(f ? f.startedAt : now - 20 * 60_000));
    const e = zonedNow(tz, new Date(f ? (f.endedAt ?? now) : now));
    return { date: s.date, start: s.time, end: e.time };
  });
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [method, setMethod] = useState<FeedMethod>(f?.method ?? defaults.method);
  const [side, setSide] = useState<FeedSide | null>(f ? f.side : defaults.side);
  const [amount, setAmount] = useState(f?.amountMl != null ? String(f.amountMl) : "");
  const [notes, setNotes] = useState(f?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const phrases = notes.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  const hasPhrase = (p: string) => phrases.some((x) => x.toLowerCase() === p.toLowerCase());
  const togglePhrase = (p: string) =>
    setNotes((hasPhrase(p) ? phrases.filter((x) => x.toLowerCase() !== p.toLowerCase()) : [...phrases, p]).join(", "));
  const timesChanged = date !== initial.date || start !== initial.start || end !== initial.end;

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        method,
        side: isBreastMethod(method) ? (side ?? "left") : null,
        amountMl: hasAmount(method) && amount.trim() !== "" ? Number(amount) : null,
        notes,
      };
      if (!f || timesChanged) {
        if (!isDate(date) || !isTime(start) || !isTime(end)) throw new ApiError(400, "invalid", "startedAt");
        body.startedAt = zonedToUtc(date, start, tz);
        body.endedAt = zonedToUtc(end < start ? addDays(date, 1) : date, end, tz);
      }
      if (f) await api(`/admin/feedings/${f.id}`, { method: "PATCH", body });
      else await api("/admin/feedings", { body });
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
    if (!f || !(await confirmDialog(t("feed.deleteConfirm"), { danger: true }))) return;
    try {
      await api(`/admin/feedings/${f.id}`, { method: "DELETE" });
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
      <Input type="time" value={start} onValue={setStart} required aria-label={t("feed.startTime")} />
      <span class="dash" aria-hidden="true">
        –
      </span>
      <Input type="time" value={end} onValue={setEnd} required aria-label={t("feed.endTime")} />
    </div>
  );

  return (
    <form class="form" onSubmit={save}>
      {state.mode !== "finish" && (
        <Field group label={`${t("feed.startTime")} – ${t("feed.endTime")}`}>
          {times}
        </Field>
      )}
      <Field group label={t("feed.how")}>
        <MethodPicker value={method} onChange={setMethod} />
      </Field>
      {isBreastMethod(method) && (
        <Field group label={t("feed.side")}>
          <SidePicker value={side} onChange={setSide} />
        </Field>
      )}
      {hasAmount(method) && (
        <Field label={t("feed.amount")}>
          <Input type="number" inputMode="numeric" min={0} max={1000} step={5} value={amount} onValue={setAmount} placeholder={t("feed.amountPh")} />
        </Field>
      )}
      <Field group label={t("feed.notes")}>
        <div class="chips">
          {OBSERVATIONS.map((k) => (
            <Chip key={k} active={hasPhrase(t(k))} onClick={() => togglePhrase(t(k))}>
              {t(k)}
            </Chip>
          ))}
        </div>
        <Textarea value={notes} onValue={setNotes} rows={2} maxLength={1000} placeholder={t("feed.notesPh")} />
      </Field>
      {state.mode === "finish" && (
        <details class="adjust">
          <summary>{t("feed.adjustTimes")}</summary>
          {times}
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
          {state.mode === "finish" ? t("feed.done") : t("common.save")}
        </Button>
      </SheetActions>
    </form>
  );
}

// ---------------------------------------------------------------- home card

export function FeedingWidget() {
  const { settings } = useFamily();
  const feed = useFeedings(1);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [busy, setBusy] = useState(false);
  useTick(30_000);
  const data = feed.data;
  const running = data?.running ?? null;
  const suggestion = suggestNext(data?.last ?? null);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    act(async () => {
      const r = await startFeed(suggestion.method, suggestion.side);
      if (r.alreadyRunning) toast(t("feed.alreadyRunning"));
      feed.setData({ ...data!, running: r.feeding });
    });
  const stop = () =>
    act(async () => {
      const r = await stopFeed(running!.id);
      feed.setData({ ...data!, running: null, last: r.feeding });
      setSheet({ mode: "finish", feeding: r.feeding });
    });

  return (
    <section class={cls("card feed-widget", running && "is-running")}>
      <div class="feed-widget-head">
        <h2 class="card-title">
          <Icon name="bottle" /> {t("feed.title")}
        </h2>
        <Link href="/family/feeding" class="text-link small">
          {t("feed.more")} →
        </Link>
      </div>
      {!data ? (
        <Loading />
      ) : running ? (
        <div class="feed-widget-body">
          <div class="feed-widget-info">
            <div class="feed-widget-timer">
              <span class="live-dot" aria-hidden="true" />
              <Elapsed since={running.startedAt} now={feed.now} />
            </div>
            <div class="muted small">
              {describe(running)} · {t("feed.runningSince", { time: clockTime(running.startedAt, settings.timezone) })}
            </div>
          </div>
          <Button class="btn-stop" icon="stop" busy={busy} onClick={stop}>
            {t("feed.stop")}
          </Button>
        </div>
      ) : (
        <div class="feed-widget-body">
          <div class="feed-widget-info">
            <div class="feed-last">{lastFedText(data.last, feed.now())}</div>
            {data.last && (
              <div class="muted small">
                {describe(data.last)} · {fmtDur(durationOf(data.last))}
              </div>
            )}
          </div>
          <Button icon="play" busy={busy} onClick={start}>
            {t("feed.start")} · {describe({ ...suggestion, amountMl: null })}
          </Button>
        </div>
      )}
      <FeedSheet state={sheet} defaults={suggestion} onClose={() => setSheet(null)} onSaved={feed.reload} />
    </section>
  );
}
