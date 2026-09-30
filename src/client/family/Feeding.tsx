// Private feeding tracker: start/stop with a live timer, history, statistics, and a home-screen row.
import { useEffect, useState } from "preact/hooks";
import { addDays, zonedNow } from "../../shared/dates";
import { FEED_METHODS, FEED_SIDES, hasAmount, isBreastMethod } from "../../shared/types";
import type { FeedMethod, FeedSide, Feeding } from "../../shared/types";
import { errorText } from "../lib/api";
import { clockTime, dayShort, fmtDur, fmtNumber } from "../lib/format";
import { t, tn } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import { Button, Empty, ErrorBox, Field, Loading, Segmented, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import { confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page } from "./common";
import { useFamily } from "./context";
import { dailyStats, suggestNext, summarize } from "./feedingData";
import type { DayStat } from "./feedingData";
import { ColumnChart, LineChart, Rhythm, ShareBar, StatTable } from "./trackerCharts";
import { change, durationOf, trackerApi, useSessions, useTick, withRunning } from "./trackerData";
import type { Tracked } from "./trackerData";
import { AmountSlider, Elapsed, Kpi, SessionForm, SessionHistory, SessionSheet, StatsCard, TodayCard, TrackerRow, TrackerSwitch, agoText, useBusy } from "./trackerUi";
import type { SheetState } from "./trackerUi";

const LONG_RUNNING = 2 * 3_600_000;
const calls = trackerApi<Feeding>("feedings");

const methodLabel = (m: FeedMethod) => (m === "shield" ? t("feed.mShort.shield") : t(`feed.m.${m}`));
const describe = (f: { method: FeedMethod; side: FeedSide | null; amountMl?: number | null }) =>
  [methodLabel(f.method), f.side && t(`feed.sideLc.${f.side}`), f.amountMl != null && `${f.amountMl} ml`].filter(Boolean).join(" · ");

/** Feeds count from their start (the usual way to measure feeding intervals). */
const lastFedText = (last: Feeding | null, now: number) => agoText(last?.startedAt ?? null, now, "feed.lastAgo", "feed.lastJustNow", "feed.lastNone");

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

export function SidePicker({ value, onChange }: { value: FeedSide | null; onChange: (s: FeedSide) => void }) {
  return (
    <Segmented
      value={value ?? "left"}
      onChange={onChange}
      label={t("feed.side")}
      options={FEED_SIDES.map((s) => ({ value: s, label: t(`feed.side.${s}`) }))}
    />
  );
}

// ---------------------------------------------------------------- page

export function FeedingPage() {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const trk = useSessions<Feeding>("feedings", 62);
  const [sheet, setSheet] = useState<SheetState<Feeding>>(null);
  useTick(30_000);

  if (trk.error && !trk.data) {
    return (
      <Page title={t("feed.title")}>
        <TrackerSwitch active="feeding" />
        <ErrorBox error={errorText(trk.error)} onRetry={trk.reload} />
      </Page>
    );
  }
  if (!trk.data) return <Loading />;
  const data = trk.data;
  const now = trk.now();
  const today = zonedNow(tz, new Date(now)).date;
  const all = withRunning(data);

  return (
    <Page title={t("feed.title")} subtitle={data.running ? null : lastFedText(data.last, now)}>
      <TrackerSwitch active="feeding" />
      <div class="feed-top">
        <FeedControl trk={trk} onFinished={(f) => setSheet({ mode: "finish", session: f })} onAdd={() => setSheet({ mode: "new" })} />
        <FeedToday feedings={all} tz={tz} today={today} now={now} />
      </div>
      <FeedStats feedings={all} tz={tz} today={today} now={now} />
      <SessionHistory
        sessions={all}
        tz={tz}
        today={today}
        onOpen={(f) => setSheet({ mode: "edit", session: f })}
        row={(f) => ({ cls: `m-${f.method}`, what: describe(f), notes: f.notes })}
        dayMeta={(list) => `${tn("feed.count", list.length)} · ${fmtDur(list.reduce((sum, f) => sum + durationOf(f), 0))}`}
        gap={(ms) => t("trk.pause", { d: fmtDur(ms) })}
        empty={<Empty emoji="🍼" title={t("feed.empty")} />}
      />
      <FeedSheet state={sheet} defaults={suggestNext(data.last)} onClose={() => setSheet(null)} onSaved={trk.reload} />
    </Page>
  );
}

function FeedControl({ trk, onFinished, onAdd }: { trk: Tracked<Feeding>; onFinished: (f: Feeding) => void; onAdd: () => void }) {
  const { settings } = useFamily();
  const data = trk.data!;
  const running = data.running;
  const suggestion = suggestNext(data.last);
  const [method, setMethod] = useState<FeedMethod>(suggestion.method);
  const [side, setSide] = useState<FeedSide | null>(suggestion.side);
  const [touched, setTouched] = useState(false);
  const [busy, run] = useBusy();

  // Follow the suggestion (e.g. after the other parent logged a feed) until someone picks by hand.
  useEffect(() => {
    if (touched) return;
    setMethod(suggestion.method);
    setSide(suggestion.side);
  }, [data.last?.id]);

  const start = () =>
    run(async () => {
      const r = await calls.start({ method, side: isBreastMethod(method) ? (side ?? "left") : null });
      if (r.alreadyRunning) toast(t("feed.alreadyRunning"));
      trk.setData({ ...data, running: r.session });
      setTouched(false);
      trk.reload();
    });

  const stop = () =>
    run(async () => {
      const r = await calls.stop(running!.id);
      trk.setData({ ...data, running: null, last: r.session });
      onFinished(r.session);
      trk.reload();
    });

  const changeRunning = (patch: Partial<Feeding>) =>
    run(async () => {
      const r = await calls.patch(running!.id, patch);
      trk.setData({ ...data, running: r.session });
    });

  const discard = async () => {
    if (!(await confirmDialog(t("feed.discardConfirm"), { danger: true, ok: t("trk.discard") }))) return;
    run(async () => {
      await calls.remove(running!.id);
      trk.setData({ ...data, running: null });
      trk.reload();
    });
  };

  if (running) {
    const tooLong = trk.now() - running.startedAt > LONG_RUNNING;
    return (
      <section class="card feed-control is-running" aria-live="polite">
        <div class="feed-live">
          <span class="live-dot" aria-hidden="true" />
          {t("trk.runningSince", { time: clockTime(running.startedAt, settings.timezone) })}
        </div>
        <div class="feed-timer">
          <Elapsed since={running.startedAt} now={trk.now} />
        </div>
        <MethodPicker value={running.method} onChange={(m) => changeRunning({ method: m, side: isBreastMethod(m) ? (running.side ?? "left") : null })} />
        {isBreastMethod(running.method) && <SidePicker value={running.side} onChange={(s) => changeRunning({ side: s })} />}
        {tooLong && (
          <p class="hint-box">
            <Icon name="info" size={16} /> {t("feed.tooLong")}
          </p>
        )}
        <Button class="btn-xl btn-stop" block icon="stop" busy={busy} onClick={stop}>
          {t("trk.stop")}
        </Button>
        <button type="button" class="text-btn center" onClick={discard}>
          {t("trk.discard")}
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
        {t("trk.start")}
      </Button>
      <button type="button" class="text-btn center" onClick={onAdd}>
        + {t("feed.add")}
      </button>
    </section>
  );
}

function FeedToday({ feedings, tz, today, now }: { feedings: Feeding[]; tz: string; today: string; now: number }) {
  const todays = feedings.filter((f) => zonedNow(tz, new Date(f.startedAt)).date === today).sort((a, b) => a.startedAt - b.startedAt);
  const total = todays.reduce((sum, f) => sum + ((f.endedAt ?? now) - f.startedAt), 0);
  const intervals = todays.slice(1).map((f, i) => f.startedAt - todays[i].startedAt);
  const avgInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  return (
    <TodayCard
      tiles={[
        { value: todays.length, label: t("feed.todayCount") },
        { value: todays.length ? fmtDur(total) : "–", label: t("feed.todayTotal") },
        { value: avgInterval == null ? "–" : fmtDur(avgInterval), label: t("trk.todayInterval") },
      ]}
    />
  );
}

function DayTip({ day }: { day: DayStat }) {
  return (
    <>
      <strong>{tn("feed.count", day.count)}</strong>
      <span>{dayShort(day.date)}</span>
      {day.avgMs != null && (
        <span>
          {t("feed.kpi.duration")} {fmtDur(day.avgMs)}
        </span>
      )}
    </>
  );
}

function FeedStats({ feedings, tz, today, now }: { feedings: Feeding[]; tz: string; today: string; now: number }) {
  return (
    <StatsCard storeKey="nest.feedRange" hint={t("trk.statsHint")}>
      {(range) => {
        const days = dailyStats(feedings, tz, addDays(today, -range), addDays(today, -1));
        const cur = summarize(days);
        const prev = summarize(dailyStats(feedings, tz, addDays(today, -2 * range), addDays(today, -range - 1)));
        const comparable = prev.trackedDays >= Math.min(3, range);
        const delta = (a: number | null, b: number | null) => (comparable ? change(a, b) : undefined);
        if (cur.trackedDays === 0) return <Empty emoji="📊" title={t("trk.statsEmpty")} />;
        const totalMethods = FEED_METHODS.reduce((n, m) => n + cur.methods[m], 0);
        const withAmount = days.some((d) => d.amountMl != null);
        return (
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
            {!comparable && <p class="field-hint">{t("trk.trendNone")}</p>}
            <div class="charts">
              <div>
                <h3 class="chart-title">{t("feed.chart.count")}</h3>
                <ColumnChart
                  label={t("feed.chart.count")}
                  steps={[1, 2, 5, 10]}
                  data={days.map((d) => ({ date: d.date, values: [d.count], tip: <DayTip day={d} />, aria: `${dayShort(d.date)}: ${tn("feed.count", d.count)}` }))}
                  lastLabel={(d) => String(d.values[0])}
                />
              </div>
              <div>
                <h3 class="chart-title">{t("feed.chart.duration")}</h3>
                <LineChart
                  label={t("feed.chart.duration")}
                  steps={[5, 10, 15, 30, 60]}
                  minTop={5}
                  data={days.map((d) => ({
                    date: d.date,
                    value: d.avgMs == null ? null : d.avgMs / 60_000,
                    tip: <DayTip day={d} />,
                    aria: `${dayShort(d.date)}: ${d.avgMs == null ? "–" : fmtDur(d.avgMs)}`,
                  }))}
                  fmtLast={(p) => fmtDur(p.value! * 60_000)}
                />
              </div>
            </div>
            <h3 class="chart-title">{t("feed.chart.methods")}</h3>
            <ShareBar
              label={t("feed.chart.methods")}
              parts={FEED_METHODS.map((m) => ({
                key: m,
                label: t(`feed.m.${m}`),
                value: cur.methods[m],
                cls: `m-${m}`,
                text: `${cur.methods[m]} · ${Math.round((cur.methods[m] / Math.max(1, totalMethods)) * 100)} %`,
              }))}
            />
            <h3 class="chart-title">{t("trk.chart.rhythm")}</h3>
            <p class="field-hint chart-hint">{t("trk.chart.rhythmHint")}</p>
            <Rhythm
              dates={Array.from({ length: range + 1 }, (_, i) => addDays(today, -i))}
              tz={tz}
              now={now}
              items={feedings.map((f) => ({
                startedAt: f.startedAt,
                endedAt: f.endedAt,
                aria: `${clockTime(f.startedAt, tz)}, ${fmtDur(durationOf(f))}`,
                tip: (
                  <>
                    <strong>
                      {clockTime(f.startedAt, tz)}–{f.endedAt ? clockTime(f.endedAt, tz) : "…"}
                    </strong>
                    <span>
                      {fmtDur(durationOf(f))} · {describe({ ...f, amountMl: null })}
                    </span>
                  </>
                ),
              }))}
            />
            <StatTable
              head={[t("trk.col.day"), t("feed.col.count"), t("feed.col.avg"), t("feed.col.total"), t("feed.col.longest"), ...(withAmount ? [t("feed.col.amount")] : [])]}
              rows={[...days]
                .reverse()
                .filter((d) => d.count > 0)
                .map((d) => ({
                  key: d.date,
                  cells: [
                    dayShort(d.date),
                    d.count,
                    d.avgMs == null ? "–" : fmtDur(d.avgMs),
                    fmtDur(d.totalMs),
                    d.longestGapMs == null ? "–" : fmtDur(d.longestGapMs),
                    ...(withAmount ? [d.amountMl == null ? "–" : `${d.amountMl} ml`] : []),
                  ],
                }))}
            />
          </>
        );
      }}
    </StatsCard>
  );
}

// ---------------------------------------------------------------- add / edit / finish sheet

const OBSERVATIONS: Key[] = ["feed.obs.1", "feed.obs.2", "feed.obs.3", "feed.obs.4", "feed.obs.5", "feed.obs.6"];
type Defaults = { method: FeedMethod; side: FeedSide | null };

function FeedSheet({ state, defaults, onClose, onSaved }: { state: SheetState<Feeding>; defaults: Defaults; onClose: () => void; onSaved: () => void }) {
  return (
    <SessionSheet state={state} onClose={onClose} addTitle={t("feed.add")} editTitle={t("feed.edit")}>
      {(st) => <FeedForm key={st.mode === "new" ? "new" : st.session.id} state={st} defaults={defaults} onClose={onClose} onSaved={onSaved} />}
    </SessionSheet>
  );
}

function FeedForm({ state, defaults, onClose, onSaved }: { state: NonNullable<SheetState<Feeding>>; defaults: Defaults; onClose: () => void; onSaved: () => void }) {
  const f = state.mode === "new" ? null : state.session;
  const [method, setMethod] = useState<FeedMethod>(f?.method ?? defaults.method);
  const [side, setSide] = useState<FeedSide | null>(f ? f.side : defaults.side);
  const [amount, setAmount] = useState<number | null>(f?.amountMl ?? null);
  return (
    <SessionForm
      kind="feedings"
      state={state}
      onClose={onClose}
      onSaved={onSaved}
      defaultMinutes={20}
      fields={() => ({ method, side: isBreastMethod(method) ? (side ?? "left") : null, amountMl: hasAmount(method) ? amount : null })}
      observations={OBSERVATIONS}
      notesPh={t("feed.notesPh")}
      deleteText={t("feed.deleteConfirm")}
    >
      <Field group label={t("feed.how")}>
        <MethodPicker value={method} onChange={setMethod} />
      </Field>
      {isBreastMethod(method) && (
        <Field group label={t("feed.side")}>
          <SidePicker value={side} onChange={setSide} />
        </Field>
      )}
      {hasAmount(method) && <AmountSlider label={t("feed.amount")} value={amount} onChange={setAmount} max={250} />}
    </SessionForm>
  );
}

// ---------------------------------------------------------------- home screen

export function FeedingRow() {
  const { settings } = useFamily();
  const trk = useSessions<Feeding>("feedings", 1);
  const [sheet, setSheet] = useState<SheetState<Feeding>>(null);
  const [busy, run] = useBusy();
  useTick(30_000);
  const data = trk.data;
  const running = data?.running ?? null;
  const suggestion = suggestNext(data?.last ?? null);

  const start = () =>
    run(async () => {
      const r = await calls.start(suggestion);
      if (r.alreadyRunning) toast(t("feed.alreadyRunning"));
      trk.setData({ ...data!, running: r.session });
    });
  const stop = () =>
    run(async () => {
      const r = await calls.stop(running!.id);
      trk.setData({ ...data!, running: null, last: r.session });
      setSheet({ mode: "finish", session: r.session });
    });

  return (
    <>
      <TrackerRow
        href="/family/feeding"
        icon="bottle"
        title={t("feed.title")}
        running={!!running}
        main={
          !data ? "…" : running ? <Elapsed since={running.startedAt} now={trk.now} /> : agoText(data.last?.startedAt ?? null, trk.now(), "trk.lastAgo", "trk.lastJustNow", "trk.none")
        }
        sub={
          running
            ? `${describe(running)} · ${t("trk.runningSince", { time: clockTime(running.startedAt, settings.timezone) })}`
            : data?.last && `${describe(data.last)} · ${fmtDur(durationOf(data.last))}`
        }
      >
        {running ? (
          <Button class="btn-stop" icon="stop" busy={busy} onClick={stop}>
            {t("trk.stop")}
          </Button>
        ) : (
          <Button icon="play" busy={busy} disabled={!data} onClick={start}>
            {describe({ ...suggestion, amountMl: null })}
          </Button>
        )}
      </TrackerRow>
      <FeedSheet state={sheet} defaults={suggestion} onClose={() => setSheet(null)} onSaved={trk.reload} />
    </>
  );
}
