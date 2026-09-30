// Private pumping tracker: start/stop with a live timer, the amount via slider, history, statistics
// and a home-screen row.
import { useEffect, useState } from "preact/hooks";
import { addDays, zonedNow } from "../../shared/dates";
import type { FeedSide, Pumping } from "../../shared/types";
import { errorText } from "../lib/api";
import { clockTime, dayShort, fmtDur, fmtNumber } from "../lib/format";
import { t, tn } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import { Button, Empty, ErrorBox, Field, Loading } from "../ui/base";
import { Icon } from "../ui/icons";
import { confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page } from "./common";
import { useFamily } from "./context";
import { SidePicker } from "./Feeding";
import { amountOf, pumpDays, pumpSummary, suggestSide } from "./pumpingData";
import type { PumpDay } from "./pumpingData";
import { ColumnChart, LineChart, Rhythm, StatTable } from "./trackerCharts";
import { HOUR, change, durationOf, localDate, mean, trackerApi, useSessions, useTick, withRunning } from "./trackerData";
import type { Tracked } from "./trackerData";
import { AmountSlider, Elapsed, Kpi, SessionForm, SessionHistory, SessionSheet, StatsCard, TodayCard, TrackerRow, TrackerSwitch, agoText, useBusy } from "./trackerUi";
import type { SheetState } from "./trackerUi";

const LONG_RUNNING = HOUR;
/** The home screen hides pumping after two weeks without a session. */
const HOME_HIDE_AFTER = 14 * 24 * HOUR;
const calls = trackerApi<Pumping>("pumpings");

const describe = (p: { side: FeedSide; amountMl: number | null }) =>
  [t(`pump.side.${p.side}`), p.amountMl != null && `${p.amountMl} ml`].filter(Boolean).join(" · ");
const ml = (v: number | null) => (v == null ? "–" : `${Math.round(v)} ml`);

// ---------------------------------------------------------------- page

export function PumpingPage() {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const trk = useSessions<Pumping>("pumpings", 62);
  const [sheet, setSheet] = useState<SheetState<Pumping>>(null);
  useTick(30_000);

  if (trk.error && !trk.data) {
    return (
      <Page title={t("pump.title")}>
        <TrackerSwitch active="pumping" />
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
    <Page title={t("pump.title")} subtitle={data.running ? null : agoText(data.last?.startedAt ?? null, now, "pump.lastAgo", "pump.lastJustNow", "pump.lastNone")}>
      <TrackerSwitch active="pumping" />
      <div class="feed-top">
        <PumpControl trk={trk} onFinished={(p) => setSheet({ mode: "finish", session: p })} onAdd={() => setSheet({ mode: "new" })} />
        <PumpToday sessions={all} tz={tz} today={today} />
      </div>
      <PumpStats sessions={all} tz={tz} today={today} now={now} />
      <SessionHistory
        sessions={all}
        tz={tz}
        today={today}
        onOpen={(p) => setSheet({ mode: "edit", session: p })}
        row={(p) => ({ what: describe(p), notes: p.notes })}
        dayMeta={(list) => {
          const amount = amountOf(list);
          return [tn("pump.count", list.length), amount != null && `${amount} ml`].filter(Boolean).join(" · ");
        }}
        gap={(ms) => t("trk.pause", { d: fmtDur(ms) })}
        empty={<Empty emoji="💧" title={t("pump.empty")} />}
      />
      <PumpSheet state={sheet} defaultSide={suggestSide(data.last)} onClose={() => setSheet(null)} onSaved={trk.reload} />
    </Page>
  );
}

function PumpControl({ trk, onFinished, onAdd }: { trk: Tracked<Pumping>; onFinished: (p: Pumping) => void; onAdd: () => void }) {
  const { settings } = useFamily();
  const data = trk.data!;
  const running = data.running;
  const suggestion = suggestSide(data.last);
  const [side, setSide] = useState<FeedSide>(suggestion);
  const [touched, setTouched] = useState(false);
  const [busy, run] = useBusy();

  // Follow the suggestion (e.g. after the other parent logged a session) until someone picks by hand.
  useEffect(() => {
    if (!touched) setSide(suggestion);
  }, [data.last?.id]);

  const start = () =>
    run(async () => {
      const r = await calls.start({ side });
      if (r.alreadyRunning) toast(t("pump.alreadyRunning"));
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

  const changeSide = (s: FeedSide) =>
    run(async () => {
      const r = await calls.patch(running!.id, { side: s });
      trk.setData({ ...data, running: r.session });
    });

  const discard = async () => {
    if (!(await confirmDialog(t("pump.discardConfirm"), { danger: true, ok: t("trk.discard") }))) return;
    run(async () => {
      await calls.remove(running!.id);
      trk.setData({ ...data, running: null });
      trk.reload();
    });
  };

  if (running) {
    return (
      <section class="card feed-control is-running" aria-live="polite">
        <div class="feed-live">
          <span class="live-dot" aria-hidden="true" />
          {t("trk.runningSince", { time: clockTime(running.startedAt, settings.timezone) })}
        </div>
        <div class="feed-timer">
          <Elapsed since={running.startedAt} now={trk.now} />
        </div>
        <SidePicker value={running.side} onChange={changeSide} />
        {trk.now() - running.startedAt > LONG_RUNNING && (
          <p class="hint-box">
            <Icon name="info" size={16} /> {t("pump.tooLong")}
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
      <div class="stack">
        <div class="field-label">
          {t("feed.side")}
          {data.last && <span class="opt"> · {t("feed.lastSide", { side: t(`feed.sideLc.${data.last.side}`) })}</span>}
        </div>
        <SidePicker
          value={side}
          onChange={(s) => {
            setTouched(true);
            setSide(s);
          }}
        />
      </div>
      {data.last && (
        <p class="muted small center">
          {t("pump.lastSession", { what: describe(data.last), d: fmtDur(durationOf(data.last)) })}
        </p>
      )}
      <Button class="btn-xl" block icon="play" busy={busy} onClick={start}>
        {t("trk.start")}
      </Button>
      <button type="button" class="text-btn center" onClick={onAdd}>
        + {t("pump.add")}
      </button>
    </section>
  );
}

function PumpToday({ sessions, tz, today }: { sessions: Pumping[]; tz: string; today: string }) {
  const todays = sessions.filter((p) => localDate(p.startedAt, tz) === today).sort((a, b) => a.startedAt - b.startedAt);
  const avg = mean(todays.slice(1).map((p, i) => p.startedAt - todays[i].startedAt));
  const amount = amountOf(todays);
  return (
    <TodayCard
      tiles={[
        { value: todays.length, label: t("pump.todayCount") },
        { value: amount == null ? "–" : `${amount} ml`, label: t("pump.todayAmount") },
        { value: avg == null ? "–" : fmtDur(avg), label: t("trk.todayInterval") },
      ]}
    />
  );
}

function DayTip({ day }: { day: PumpDay }) {
  return (
    <>
      <strong>{day.amountMl == null ? tn("pump.count", day.count) : `${day.amountMl} ml`}</strong>
      <span>{dayShort(day.date)}</span>
      {day.amountMl != null && <span>{tn("pump.count", day.count)}</span>}
    </>
  );
}

function PumpStats({ sessions, tz, today, now }: { sessions: Pumping[]; tz: string; today: string; now: number }) {
  return (
    <StatsCard storeKey="nest.pumpRange" hint={t("trk.statsHint")}>
      {(range) => {
        const days = pumpDays(sessions, tz, addDays(today, -range), addDays(today, -1));
        const cur = pumpSummary(days);
        const prev = pumpSummary(pumpDays(sessions, tz, addDays(today, -2 * range), addDays(today, -range - 1)));
        const comparable = prev.trackedDays >= Math.min(3, range);
        const delta = (a: number | null, b: number | null) => (comparable ? change(a, b) : undefined);
        if (cur.trackedDays === 0) return <Empty emoji="📊" title={t("trk.statsEmpty")} />;
        const perSession = (d: PumpDay) => (d.withAmount ? d.amountMl! / d.withAmount : null);
        return (
          <>
            <div class="kpis">
              <Kpi label={t("pump.kpi.amountDay")} value={cur.amountPerDay == null ? null : ml(cur.amountPerDay)} delta={delta(cur.amountPerDay, prev.amountPerDay)} days={range} />
              <Kpi label={t("pump.kpi.amountSession")} value={cur.amountPerSession == null ? null : ml(cur.amountPerSession)} delta={delta(cur.amountPerSession, prev.amountPerSession)} days={range} />
              <Kpi label={t("pump.kpi.perDay")} value={cur.perDay == null ? null : fmtNumber(cur.perDay)} delta={delta(cur.perDay, prev.perDay)} days={range} />
              <Kpi label={t("pump.kpi.duration")} value={cur.avgDurationMs == null ? null : fmtDur(cur.avgDurationMs)} delta={delta(cur.avgDurationMs, prev.avgDurationMs)} days={range} />
              <Kpi label={t("pump.kpi.interval")} value={cur.avgIntervalMs == null ? null : fmtDur(cur.avgIntervalMs)} delta={delta(cur.avgIntervalMs, prev.avgIntervalMs)} days={range} />
              <Kpi label={t("pump.kpi.total")} value={cur.totalPerDayMs == null ? null : fmtDur(cur.totalPerDayMs)} delta={delta(cur.totalPerDayMs, prev.totalPerDayMs)} days={range} />
            </div>
            {!comparable && <p class="field-hint">{t("trk.trendNone")}</p>}
            <div class="charts">
              <div>
                <h3 class="chart-title">{t("pump.chart.amount")}</h3>
                <ColumnChart
                  label={t("pump.chart.amount")}
                  steps={[50, 100, 200, 250, 500]}
                  data={days.map((d) => ({
                    date: d.date,
                    values: [d.amountMl ?? 0],
                    tip: <DayTip day={d} />,
                    aria: `${dayShort(d.date)}: ${d.amountMl == null ? "–" : `${d.amountMl} ml`}`,
                  }))}
                  lastLabel={(d) => `${d.values[0]} ml`}
                />
              </div>
              <div>
                <h3 class="chart-title">{t("pump.chart.perSession")}</h3>
                <LineChart
                  label={t("pump.chart.perSession")}
                  steps={[10, 20, 25, 50, 100]}
                  minTop={50}
                  data={days.map((d) => ({
                    date: d.date,
                    value: perSession(d),
                    tip: (
                      <>
                        <strong>{ml(perSession(d))}</strong>
                        <span>{dayShort(d.date)}</span>
                        <span>{tn("pump.count", d.count)}</span>
                      </>
                    ),
                    aria: `${dayShort(d.date)}: ${ml(perSession(d))}`,
                  }))}
                  fmtLast={(p) => ml(p.value)}
                />
              </div>
            </div>
            <h3 class="chart-title">{t("trk.chart.rhythm")}</h3>
            <p class="field-hint chart-hint">{t("trk.chart.rhythmHint")}</p>
            <Rhythm
              dates={Array.from({ length: range + 1 }, (_, i) => addDays(today, -i))}
              tz={tz}
              now={now}
              items={sessions.map((p) => ({
                startedAt: p.startedAt,
                endedAt: p.endedAt,
                aria: `${clockTime(p.startedAt, tz)}, ${describe(p)}`,
                tip: (
                  <>
                    <strong>
                      {clockTime(p.startedAt, tz)}–{p.endedAt ? clockTime(p.endedAt, tz) : "…"}
                    </strong>
                    <span>
                      {fmtDur(durationOf(p))} · {describe(p)}
                    </span>
                  </>
                ),
              }))}
            />
            <StatTable
              head={[t("trk.col.day"), t("pump.col.count"), t("pump.col.amount"), t("pump.col.perSession"), t("pump.col.avg")]}
              rows={[...days]
                .reverse()
                .filter((d) => d.count > 0)
                .map((d) => ({
                  key: d.date,
                  cells: [dayShort(d.date), d.count, ml(d.amountMl), ml(perSession(d)), d.durations.length ? fmtDur(mean(d.durations)!) : "–"],
                }))}
            />
          </>
        );
      }}
    </StatsCard>
  );
}

// ---------------------------------------------------------------- add / edit / finish sheet

const OBSERVATIONS: Key[] = ["pump.obs.1", "pump.obs.2", "pump.obs.3", "pump.obs.4", "pump.obs.5", "pump.obs.6"];

function PumpSheet({ state, defaultSide, onClose, onSaved }: { state: SheetState<Pumping>; defaultSide: FeedSide; onClose: () => void; onSaved: () => void }) {
  return (
    <SessionSheet state={state} onClose={onClose} addTitle={t("pump.add")} editTitle={t("pump.edit")}>
      {(st) => <PumpForm key={st.mode === "new" ? "new" : st.session.id} state={st} defaultSide={defaultSide} onClose={onClose} onSaved={onSaved} />}
    </SessionSheet>
  );
}

function PumpForm({ state, defaultSide, onClose, onSaved }: { state: NonNullable<SheetState<Pumping>>; defaultSide: FeedSide; onClose: () => void; onSaved: () => void }) {
  const p = state.mode === "new" ? null : state.session;
  const [side, setSide] = useState<FeedSide>(p?.side ?? defaultSide);
  const [amount, setAmount] = useState<number | null>(p?.amountMl ?? null);
  return (
    <SessionForm
      kind="pumpings"
      state={state}
      onClose={onClose}
      onSaved={onSaved}
      defaultMinutes={20}
      fields={() => ({ side, amountMl: amount })}
      observations={OBSERVATIONS}
      notesPh={t("pump.notesPh")}
      deleteText={t("pump.deleteConfirm")}
    >
      <AmountSlider label={t("pump.amount")} value={amount} onChange={setAmount} max={300} />
      <Field group label={t("feed.side")}>
        <SidePicker value={side} onChange={setSide} />
      </Field>
    </SessionForm>
  );
}

// ---------------------------------------------------------------- home screen

export function PumpingRow() {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const trk = useSessions<Pumping>("pumpings", 1);
  const [sheet, setSheet] = useState<SheetState<Pumping>>(null);
  const [busy, run] = useBusy();
  useTick(30_000);
  const data = trk.data;
  const running = data?.running ?? null;
  const now = trk.now();
  if (data && !running && data.last && now - data.last.startedAt > HOME_HIDE_AFTER) return null;

  const today = zonedNow(tz, new Date(now)).date;
  const todays = data ? data.sessions.filter((p) => p.endedAt != null && localDate(p.startedAt, tz) === today) : [];
  const amount = amountOf(todays);
  const start = () =>
    run(async () => {
      const r = await calls.start({ side: suggestSide(data!.last) });
      if (r.alreadyRunning) toast(t("pump.alreadyRunning"));
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
        href="/family/pumping"
        icon="drop"
        title={t("pump.title")}
        running={!!running}
        main={
          !data ? "…" : running ? <Elapsed since={running.startedAt} now={trk.now} /> : agoText(data.last?.startedAt ?? null, now, "trk.lastAgo", "trk.lastJustNow", "trk.none")
        }
        sub={
          running
            ? `${t(`pump.side.${running.side}`)} · ${t("trk.runningSince", { time: clockTime(running.startedAt, tz) })}`
            : data &&
              (todays.length ? [t("pump.homeToday", { n: todays.length }), amount != null && `${amount} ml`].filter(Boolean).join(" · ") : t("pump.homeNone"))
        }
      >
        {running ? (
          <Button class="btn-stop" icon="stop" busy={busy} onClick={stop}>
            {t("trk.stop")}
          </Button>
        ) : (
          <Button icon="play" busy={busy} disabled={!data} onClick={start}>
            {t("trk.start")}
          </Button>
        )}
      </TrackerRow>
      <PumpSheet state={sheet} defaultSide={suggestSide(data?.last ?? null)} onClose={() => setSheet(null)} onSaved={trk.reload} />
    </>
  );
}
