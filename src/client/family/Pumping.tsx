// Private pumping tracker: start/pause/stop with a live timer, the amount via slider, history,
// statistics (optionally counting breastfeeding as emptying the breasts too) and a home-screen row.
import { useEffect, useState } from "preact/hooks";
import { addDays, zonedNow } from "../../shared/dates";
import { isBreastMethod } from "../../shared/types";
import type { FeedSide, Feeding, Pumping } from "../../shared/types";
import { errorText } from "../lib/api";
import { clockTime, dayShort, fmtDur, fmtNumber } from "../lib/format";
import { t, tn } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import { store } from "../lib/storage";
import { Button, Empty, ErrorBox, Field, IconButton, Loading, Segmented, cls } from "../ui/base";
import { Icon } from "../ui/icons";
import { confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page } from "./common";
import { useFamily } from "./context";
import { SidePicker } from "./Feeding";
import { amountOf, emptyDays, emptySummary, emptyings, pumpDays, pumpSummary, suggestSide } from "./pumpingData";
import type { EmptyDay, PumpDay } from "./pumpingData";
import { ColumnChart, Legend, LineChart, Rhythm, StatTable } from "./trackerCharts";
import { HOUR, activeMs, change, durationOf, isPaused, localDate, mean, trackerApi, useSessions, useTick, withRunning } from "./trackerData";
import type { Tracked } from "./trackerData";
import {
  AmountSlider,
  Elapsed,
  Kpi,
  RunningButtons,
  SessionForm,
  SessionHistory,
  SessionSheet,
  StatsCard,
  TodayCard,
  TrackerRow,
  TrackerSwitch,
  agoText,
  liveText,
  pauseNote,
  useBusy,
} from "./trackerUi";
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
  // Breastfeeding, for the "with breastfeeding" statistics.
  const feeds = useSessions<Feeding>("feedings", 62);
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
      <PumpStats sessions={all} feedings={feeds.data?.sessions ?? []} tz={tz} today={today} now={now} />
      <SessionHistory
        sessions={all}
        tz={tz}
        today={today}
        onOpen={(p) => setSheet({ mode: "edit", session: p })}
        row={(p) => ({ cls: "s-pump", what: describe(p), notes: [pauseNote(p), p.notes].filter(Boolean).join(" · ") })}
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

  const update = (call: Promise<{ session: Pumping }>) =>
    run(async () => {
      const r = await call;
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
      <section class={cls("card feed-control is-running", isPaused(running) && "is-paused")} aria-live="polite">
        <div class="feed-live">
          <span class="live-dot" aria-hidden="true" />
          {liveText(running, settings.timezone)}
        </div>
        <div class="feed-timer">
          <Elapsed session={running} now={trk.now} />
        </div>
        <SidePicker value={running.side} onChange={(s) => update(calls.patch(running.id, { side: s }))} />
        {activeMs(running, trk.now()) > LONG_RUNNING && (
          <p class="hint-box">
            <Icon name="info" size={16} /> {t("pump.tooLong")}
          </p>
        )}
        <RunningButtons
          session={running}
          busy={busy}
          onPause={() => update(calls.pause(running.id))}
          onResume={() => update(calls.resume(running.id))}
          onStop={stop}
        />
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

function EmptyTip({ day }: { day: EmptyDay }) {
  return (
    <>
      <strong>{tn("pump.emptyings", day.pumpOnly + day.nursing)}</strong>
      <span>{dayShort(day.date)}</span>
      <span>
        {t("pump.series.pump")} {day.pumpOnly} · {t("pump.series.nursing")} {day.nursing}
      </span>
    </>
  );
}

type Basis = "pump" | "all";

function PumpStats({ sessions, feedings, tz, today, now }: { sessions: Pumping[]; feedings: Feeding[]; tz: string; today: string; now: number }) {
  const [basis, setBasis] = useState<Basis>(() => (store.get<string>("nest.pumpBasis", "pump") === "all" ? "all" : "pump"));
  const withNursing = basis === "all";
  const events = withNursing ? emptyings(sessions, feedings) : [];
  return (
    <StatsCard
      storeKey="nest.pumpRange"
      hint={t("trk.statsHint")}
      extra={
        <div class="stack">
          <Segmented
            value={basis}
            label={t("pump.basis")}
            onChange={(v) => {
              setBasis(v);
              store.set("nest.pumpBasis", v);
            }}
            options={[
              { value: "pump", label: t("pump.basis.pump") },
              { value: "all", label: t("pump.basis.all") },
            ]}
          />
          {withNursing && <p class="field-hint">{t("pump.basisHint")}</p>}
        </div>
      }
    >
      {(range) => {
        const from = addDays(today, -range);
        const to = addDays(today, -1);
        const prevFrom = addDays(today, -2 * range);
        const prevTo = addDays(today, -range - 1);
        const days = pumpDays(sessions, tz, from, to);
        const cur = pumpSummary(days);
        const prev = pumpSummary(pumpDays(sessions, tz, prevFrom, prevTo));
        const eDays = emptyDays(events, tz, from, to);
        const eCur = emptySummary(eDays);
        const ePrev = emptySummary(emptyDays(events, tz, prevFrom, prevTo));
        const tracked = withNursing ? eCur.trackedDays : cur.trackedDays;
        const comparable = (withNursing ? ePrev.trackedDays : prev.trackedDays) >= Math.min(3, range);
        const delta = (a: number | null, b: number | null) => (comparable ? change(a, b) : undefined);
        if (tracked === 0) return <Empty emoji="📊" title={t("trk.statsEmpty")} />;
        const perSession = (d: PumpDay) => (d.withAmount ? d.amountMl! / d.withAmount : null);
        // Counts and times: pumping alone, or every emptying incl. breastfeeding.
        const c = withNursing ? eCur : cur;
        const p = withNursing ? ePrev : prev;
        const nursing = feedings.filter((f) => isBreastMethod(f.method));
        return (
          <>
            <div class="kpis">
              <Kpi label={t("pump.kpi.amountDay")} value={cur.amountPerDay == null ? null : ml(cur.amountPerDay)} delta={delta(cur.amountPerDay, prev.amountPerDay)} days={range} />
              <Kpi label={t("pump.kpi.amountSession")} value={cur.amountPerSession == null ? null : ml(cur.amountPerSession)} delta={delta(cur.amountPerSession, prev.amountPerSession)} days={range} />
              <Kpi label={t(withNursing ? "pump.kpi.emptyings" : "pump.kpi.perDay")} value={c.perDay == null ? null : fmtNumber(c.perDay)} delta={delta(c.perDay, p.perDay)} days={range} />
              <Kpi label={t("pump.kpi.duration")} value={c.avgDurationMs == null ? null : fmtDur(c.avgDurationMs)} delta={delta(c.avgDurationMs, p.avgDurationMs)} days={range} />
              <Kpi label={t("pump.kpi.interval")} value={c.avgIntervalMs == null ? null : fmtDur(c.avgIntervalMs)} delta={delta(c.avgIntervalMs, p.avgIntervalMs)} days={range} />
              <Kpi label={t(withNursing ? "pump.kpi.totalAll" : "pump.kpi.total")} value={c.totalPerDayMs == null ? null : fmtDur(c.totalPerDayMs)} delta={delta(c.totalPerDayMs, p.totalPerDayMs)} days={range} />
            </div>
            {!comparable && <p class="field-hint">{t("trk.trendNone")}</p>}
            <div class="charts s-pump">
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
                  fmtLast={(pt) => ml(pt.value)}
                />
              </div>
              {withNursing && (
                <div>
                  <h3 class="chart-title">{t("pump.chart.emptyings")}</h3>
                  <ColumnChart
                    label={t("pump.chart.emptyings")}
                    steps={[1, 2, 5, 10]}
                    seriesCls={["s-pump", "m-breast"]}
                    data={eDays.map((d) => ({
                      date: d.date,
                      values: [d.pumpOnly, d.nursing],
                      tip: <EmptyTip day={d} />,
                      aria: `${dayShort(d.date)}: ${tn("pump.emptyings", d.pumpOnly + d.nursing)}`,
                    }))}
                    lastLabel={(d) => String(d.values[0] + d.values[1])}
                  />
                  <Legend
                    items={[
                      { label: t("pump.series.pump"), cls: "s-pump" },
                      { label: t("pump.series.nursing"), cls: "m-breast" },
                    ]}
                  />
                </div>
              )}
            </div>
            <h3 class="chart-title">{t("trk.chart.rhythm")}</h3>
            <p class="field-hint chart-hint">{t("trk.chart.rhythmHint")}</p>
            <div class="s-pump">
              <Rhythm
                dates={Array.from({ length: range + 1 }, (_, i) => addDays(today, -i))}
                tz={tz}
                now={now}
                items={[
                  ...sessions.map((s) => ({
                    startedAt: s.startedAt,
                    endedAt: s.endedAt,
                    aria: `${clockTime(s.startedAt, tz)}, ${describe(s)}`,
                    tip: (
                      <>
                        <strong>
                          {clockTime(s.startedAt, tz)}–{s.endedAt ? clockTime(s.endedAt, tz) : "…"}
                        </strong>
                        <span>
                          {fmtDur(activeMs(s, now))} · {describe(s)}
                        </span>
                      </>
                    ),
                  })),
                  ...(withNursing ? nursing : []).map((f) => ({
                    startedAt: f.startedAt,
                    endedAt: f.endedAt,
                    cls: "m-breast",
                    aria: `${clockTime(f.startedAt, tz)}, ${t("pump.nursing")}`,
                    tip: (
                      <>
                        <strong>
                          {clockTime(f.startedAt, tz)}–{f.endedAt ? clockTime(f.endedAt, tz) : "…"}
                        </strong>
                        <span>
                          {fmtDur(activeMs(f, now))} · {t("pump.nursing")}
                        </span>
                      </>
                    ),
                  })),
                ]}
              />
              {withNursing && (
                <Legend
                  items={[
                    { label: t("pump.title"), cls: "s-pump" },
                    { label: t("pump.nursing"), cls: "m-breast" },
                  ]}
                />
              )}
            </div>
            <StatTable
              head={
                withNursing
                  ? [t("trk.col.day"), t("pump.col.emptyings"), t("pump.col.withNursing"), t("pump.col.amount"), t("pump.col.avg")]
                  : [t("trk.col.day"), t("pump.col.count"), t("pump.col.amount"), t("pump.col.perSession"), t("pump.col.avg")]
              }
              rows={[...days]
                .reverse()
                .map((d, i) => ({ d, e: eDays[eDays.length - 1 - i] }))
                .filter(({ d, e }) => (withNursing ? e.pumpOnly + e.nursing > 0 : d.count > 0))
                .map(({ d, e }) => ({
                  key: d.date,
                  cells: withNursing
                    ? [dayShort(d.date), e.pumpOnly + e.nursing, e.nursing, ml(d.amountMl), e.durations.length ? fmtDur(mean(e.durations)!) : "–"]
                    : [dayShort(d.date), d.count, ml(d.amountMl), ml(perSession(d)), d.durations.length ? fmtDur(mean(d.durations)!) : "–"],
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
      pausable
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
  const pauseOrResume = () =>
    run(async () => {
      const r = await (isPaused(running) ? calls.resume : calls.pause)(running!.id);
      trk.setData({ ...data!, running: r.session });
    });

  return (
    <>
      <TrackerRow
        href="/family/pumping"
        icon="drop"
        title={t("pump.title")}
        running={!!running}
        paused={isPaused(running)}
        main={
          !data ? "…" : running ? <Elapsed session={running} now={trk.now} /> : agoText(data.last?.startedAt ?? null, now, "trk.lastAgo", "trk.lastJustNow", "trk.none")
        }
        sub={
          running
            ? `${t(`pump.side.${running.side}`)} · ${liveText(running, tz)}`
            : data &&
              (todays.length ? [t("pump.homeToday", { n: todays.length }), amount != null && `${amount} ml`].filter(Boolean).join(" · ") : t("pump.homeNone"))
        }
      >
        {running ? (
          <>
            <IconButton
              icon={isPaused(running) ? "play" : "pause"}
              label={isPaused(running) ? t("trk.resume") : t("trk.pauseBtn")}
              class="icon-btn-soft"
              disabled={busy}
              onClick={pauseOrResume}
            />
            <Button class="btn-stop" icon="stop" busy={busy} onClick={stop}>
              {t("trk.stop")}
            </Button>
          </>
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
