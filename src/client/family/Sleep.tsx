// Private sleep tracker: "fell asleep" / "woke up" with a live timer, day or night sleep and where,
// history (with the awake time in between), statistics and a home-screen row.
import { useState } from "preact/hooks";
import { addDays, zonedNow } from "../../shared/dates";
import { SLEEP_KINDS, SLEEP_PLACES } from "../../shared/types";
import type { Sleep, SleepKind, SleepPlace } from "../../shared/types";
import { errorText } from "../lib/api";
import { clockTime, dayShort, fmtDur, fmtNumber } from "../lib/format";
import { t, tn } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import { Button, Chip, Empty, ErrorBox, Field, Loading, Segmented } from "../ui/base";
import { Icon } from "../ui/icons";
import { confirmDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Page } from "./common";
import { useFamily } from "./context";
import { kindAt, sleepDate, sleepDays, sleepSummary, sleptWithin, suggestPlace } from "./sleepData";
import type { PlaceKey, SleepDay } from "./sleepData";
import { ColumnChart, Legend, LineChart, RankBars, Rhythm, StatTable } from "./trackerCharts";
import { HOUR, change, durationOf, sum, trackerApi, useSessions, useTick, withRunning } from "./trackerData";
import type { Tracked } from "./trackerData";
import { Elapsed, Kpi, SessionForm, SessionHistory, SessionSheet, StatsCard, TodayCard, TrackerRow, TrackerSwitch, useBusy } from "./trackerUi";
import type { SheetState } from "./trackerUi";

const LONG_RUNNING = 14 * HOUR;
const calls = trackerApi<Sleep>("sleeps");

const kindCls = (k: SleepKind) => (k === "night" ? "s-night" : "s-nap");
const placeLabel = (p: PlaceKey) => t(`sleep.place.${p}`);
const describe = (s: { kind: SleepKind; place: SleepPlace | null }) => [t(`sleep.kindShort.${s.kind}`), s.place && placeLabel(s.place)].filter(Boolean).join(" · ");
const hours = (ms: number) => t("trk.hoursShort", { n: fmtNumber(ms / HOUR) });

function awakeText(last: Sleep | null, now: number) {
  if (!last?.endedAt) return t("sleep.none");
  return now - last.endedAt < 60_000 ? t("sleep.justWoke") : t("sleep.awakeFor", { d: fmtDur(now - last.endedAt) });
}

function KindPicker({ value, onChange }: { value: SleepKind; onChange: (k: SleepKind) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      label={t("sleep.kind")}
      options={SLEEP_KINDS.map((k) => ({
        value: k,
        label: (
          <>
            <Icon name={k === "night" ? "moon" : "sun"} size={16} /> {t(`sleep.kind.${k}`)}
          </>
        ),
      }))}
    />
  );
}

function PlacePicker({ value, onChange }: { value: SleepPlace | null; onChange: (p: SleepPlace | null) => void }) {
  return (
    <div class="chips" role="group" aria-label={t("sleep.place")}>
      {SLEEP_PLACES.map((p) => (
        <Chip key={p} active={value === p} onClick={() => onChange(value === p ? null : p)}>
          {placeLabel(p)}
        </Chip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- page

export function SleepPage() {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const trk = useSessions<Sleep>("sleeps", 62);
  const [sheet, setSheet] = useState<SheetState<Sleep>>(null);
  useTick(30_000);

  if (trk.error && !trk.data) {
    return (
      <Page title={t("sleep.title")}>
        <TrackerSwitch active="sleep" />
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
    <Page title={t("sleep.title")} subtitle={data.running ? null : awakeText(data.last, now)}>
      <TrackerSwitch active="sleep" />
      <div class="feed-top">
        <SleepControl trk={trk} sessions={all} onFinished={(s) => setSheet({ mode: "finish", session: s })} onAdd={() => setSheet({ mode: "new" })} />
        <SleepToday sessions={all} tz={tz} today={today} now={now} />
      </div>
      <SleepStats sessions={all} running={data.running} tz={tz} today={today} now={now} />
      <SessionHistory
        sessions={all}
        tz={tz}
        today={today}
        onOpen={(s) => setSheet({ mode: "edit", session: s })}
        row={(s) => ({ cls: kindCls(s.kind), what: describe(s), notes: s.notes })}
        dayMeta={(list) => `${tn("sleep.count", list.length)} · ${fmtDur(sum(list.map(durationOf)))}`}
        gap={(ms) => t("sleep.awakeGap", { d: fmtDur(ms) })}
        empty={<Empty emoji="🌙" title={t("sleep.empty")} />}
      />
      <SleepSheet state={sheet} sessions={all} onClose={() => setSheet(null)} onSaved={trk.reload} />
    </Page>
  );
}

function SleepControl({ trk, sessions, onFinished, onAdd }: { trk: Tracked<Sleep>; sessions: Sleep[]; onFinished: (s: Sleep) => void; onAdd: () => void }) {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const data = trk.data!;
  const running = data.running;
  // Day or night follows the clock and the place follows the last sleep of that kind – until picked by hand.
  const [pickedKind, setPickedKind] = useState<SleepKind | null>(null);
  const [pickedPlace, setPickedPlace] = useState<SleepPlace | null | undefined>(undefined);
  const kind = pickedKind ?? kindAt(trk.now(), tz);
  const place = pickedPlace === undefined ? suggestPlace(sessions, kind) : pickedPlace;
  const [busy, run] = useBusy();

  const start = () =>
    run(async () => {
      const r = await calls.start({ kind, place });
      if (r.alreadyRunning) toast(t("sleep.alreadyRunning"));
      trk.setData({ ...data, running: r.session });
      setPickedKind(null);
      setPickedPlace(undefined);
      trk.reload();
    });

  const stop = () =>
    run(async () => {
      const r = await calls.stop(running!.id);
      trk.setData({ ...data, running: null, last: r.session });
      onFinished(r.session);
      trk.reload();
    });

  const changeRunning = (patch: Partial<Sleep>) =>
    run(async () => {
      const r = await calls.patch(running!.id, patch);
      trk.setData({ ...data, running: r.session });
    });

  const discard = async () => {
    if (!(await confirmDialog(t("sleep.discardConfirm"), { danger: true, ok: t("trk.discard") }))) return;
    run(async () => {
      await calls.remove(running!.id);
      trk.setData({ ...data, running: null });
      trk.reload();
    });
  };

  if (running) {
    return (
      <section class="card feed-control sleep-control is-running" aria-live="polite">
        <div class="feed-live">
          <span class="live-dot" aria-hidden="true" />
          {t("sleep.asleepSince", { time: clockTime(running.startedAt, tz) })}
        </div>
        <div class="feed-timer">
          <Elapsed session={running} now={trk.now} />
        </div>
        <KindPicker value={running.kind} onChange={(k) => changeRunning({ kind: k })} />
        <PlacePicker value={running.place} onChange={(p) => changeRunning({ place: p })} />
        {trk.now() - running.startedAt > LONG_RUNNING && (
          <p class="hint-box">
            <Icon name="info" size={16} /> {t("sleep.tooLong")}
          </p>
        )}
        <Button class="btn-xl btn-stop" block icon="sun" busy={busy} onClick={stop}>
          {t("sleep.stop")}
        </Button>
        <button type="button" class="text-btn center" onClick={discard}>
          {t("trk.discard")}
        </button>
      </section>
    );
  }

  return (
    <section class="card feed-control sleep-control">
      <div class="stack">
        <div class="field-label">{t("sleep.kind")}</div>
        <KindPicker value={kind} onChange={setPickedKind} />
      </div>
      <div class="stack">
        <div class="field-label">{t("sleep.place")}</div>
        <PlacePicker value={place} onChange={setPickedPlace} />
      </div>
      <Button class="btn-xl" block icon="moon" busy={busy} onClick={start}>
        {t("sleep.start")}
      </Button>
      <button type="button" class="text-btn center" onClick={onAdd}>
        + {t("sleep.add")}
      </button>
    </section>
  );
}

function SleepToday({ sessions, tz, today, now }: { sessions: Sleep[]; tz: string; today: string; now: number }) {
  const night = sessions.filter((s) => s.kind === "night" && sleepDate(s, tz) === addDays(today, -1));
  const naps = sessions.filter((s) => s.kind === "nap" && sleepDate(s, tz) === today);
  const nightMs = sum(night.map((s) => (s.endedAt ?? now) - s.startedAt));
  const napMs = sum(naps.map((s) => (s.endedAt ?? now) - s.startedAt));
  return (
    <TodayCard
      tiles={[
        {
          value: night.length ? fmtDur(nightMs) : "–",
          label: night.length > 1 ? `${t("sleep.todayNight")} · ${tn("sleep.wakings", night.length - 1)}` : t("sleep.todayNight"),
        },
        { value: naps.length ? fmtDur(napMs) : "–", label: naps.length ? `${t("sleep.todayNaps")} · ${naps.length}×` : t("sleep.todayNaps") },
        { value: fmtDur(sleptWithin(sessions, now - 24 * HOUR, now, now)), label: t("sleep.today24h") },
      ]}
    />
  );
}

function DayTip({ day }: { day: SleepDay }) {
  return (
    <>
      <strong>{fmtDur(day.nightMs + day.napMs)}</strong>
      <span>{dayShort(day.date)}</span>
      {day.nightPhases > 0 && (
        <span>
          {t("sleep.kind.night")} {fmtDur(day.nightMs)}
        </span>
      )}
      {day.naps > 0 && (
        <span>
          {t("sleep.kind.nap")} {fmtDur(day.napMs)} · {day.naps}×
        </span>
      )}
    </>
  );
}

function SleepStats({ sessions, running, tz, today, now }: { sessions: Sleep[]; running: Sleep | null; tz: string; today: string; now: number }) {
  // A night that's still going isn't complete – leave its day out.
  const skip = running?.kind === "night" ? sleepDate(running, tz) : null;
  return (
    <StatsCard storeKey="nest.sleepRange" hint={t("sleep.statsHint")}>
      {(range) => {
        const days = sleepDays(sessions, tz, addDays(today, -range), addDays(today, -1), skip);
        const cur = sleepSummary(days);
        const prev = sleepSummary(sleepDays(sessions, tz, addDays(today, -2 * range), addDays(today, -range - 1)));
        const comparable = prev.trackedDays >= Math.min(3, range);
        const delta = (a: number | null, b: number | null) => (comparable ? change(a, b) : undefined);
        if (cur.trackedDays === 0) return <Empty emoji="📊" title={t("trk.statsEmpty")} />;
        const dur = (ms: number | null) => (ms == null ? null : fmtDur(ms));
        const placeTotal = sum(Object.values(cur.places) as number[]);
        return (
          <>
            <div class="kpis">
              <Kpi label={t("sleep.kpi.total")} value={dur(cur.totalMs)} delta={delta(cur.totalMs, prev.totalMs)} days={range} />
              <Kpi label={t("sleep.kpi.night")} value={dur(cur.nightMs)} delta={delta(cur.nightMs, prev.nightMs)} days={range} />
              <Kpi label={t("sleep.kpi.day")} value={dur(cur.napMs)} delta={delta(cur.napMs, prev.napMs)} days={range} />
              <Kpi label={t("sleep.kpi.naps")} value={cur.naps == null ? null : fmtNumber(cur.naps)} delta={delta(cur.naps, prev.naps)} days={range} />
              <Kpi label={t("sleep.kpi.longest")} value={dur(cur.longestMs)} delta={delta(cur.longestMs, prev.longestMs)} days={range} />
              <Kpi label={t("sleep.kpi.wakings")} value={cur.wakings == null ? null : fmtNumber(cur.wakings)} delta={delta(cur.wakings, prev.wakings)} days={range} />
            </div>
            {!comparable && <p class="field-hint">{t("trk.trendNone")}</p>}
            <div class="charts">
              <div>
                <h3 class="chart-title">{t("sleep.chart.perDay")}</h3>
                <ColumnChart
                  label={t("sleep.chart.perDay")}
                  steps={[2, 4, 6, 8]}
                  seriesCls={["s-night", "s-nap"]}
                  data={days.map((d) => ({
                    date: d.date,
                    values: [d.nightMs / HOUR, d.napMs / HOUR],
                    tip: <DayTip day={d} />,
                    aria: `${dayShort(d.date)}: ${fmtDur(d.nightMs + d.napMs)}`,
                  }))}
                  lastLabel={(d) => hours((d.values[0] + d.values[1]) * HOUR)}
                />
                <Legend
                  items={[
                    { label: t("sleep.kind.night"), cls: "s-night" },
                    { label: t("sleep.kind.nap"), cls: "s-nap" },
                  ]}
                />
              </div>
              <div>
                <h3 class="chart-title">{t("sleep.chart.longest")}</h3>
                <LineChart
                  label={t("sleep.chart.longest")}
                  steps={[1, 2, 4]}
                  minTop={4}
                  data={days.map((d) => ({
                    date: d.date,
                    value: d.longestMs == null ? null : d.longestMs / HOUR,
                    tip: (
                      <>
                        <strong>{d.longestMs == null ? "–" : fmtDur(d.longestMs)}</strong>
                        <span>{dayShort(d.date)}</span>
                      </>
                    ),
                    aria: `${dayShort(d.date)}: ${d.longestMs == null ? "–" : fmtDur(d.longestMs)}`,
                  }))}
                  fmtLast={(p) => fmtDur(p.value! * HOUR)}
                />
              </div>
            </div>
            <h3 class="chart-title">{t("sleep.chart.places")}</h3>
            <RankBars
              label={t("sleep.chart.places")}
              parts={(Object.entries(cur.places) as [PlaceKey, number][]).map(([p, ms]) => ({
                key: p,
                label: placeLabel(p),
                value: ms,
                text: `${Math.round((ms / Math.max(1, placeTotal)) * 100)} %`,
              }))}
            />
            <h3 class="chart-title">{t("trk.chart.rhythm")}</h3>
            <p class="field-hint chart-hint">{t("trk.chart.rhythmHint")}</p>
            <Rhythm
              dates={Array.from({ length: range + 1 }, (_, i) => addDays(today, -i))}
              tz={tz}
              now={now}
              items={sessions.map((s) => ({
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                cls: kindCls(s.kind),
                aria: `${clockTime(s.startedAt, tz)}, ${fmtDur(durationOf(s))}, ${describe(s)}`,
                tip: (
                  <>
                    <strong>
                      {clockTime(s.startedAt, tz)}–{s.endedAt ? clockTime(s.endedAt, tz) : "…"}
                    </strong>
                    <span>
                      {fmtDur((s.endedAt ?? now) - s.startedAt)} · {describe(s)}
                    </span>
                  </>
                ),
              }))}
            />
            <Legend
              items={[
                { label: t("sleep.kind.night"), cls: "s-night" },
                { label: t("sleep.kind.nap"), cls: "s-nap" },
              ]}
            />
            <StatTable
              head={[t("trk.col.day"), t("sleep.col.total"), t("sleep.col.night"), t("sleep.col.day"), t("sleep.col.longest"), t("sleep.col.wakings")]}
              rows={[...days]
                .reverse()
                .filter((d) => d.naps + d.nightPhases > 0)
                .map((d) => ({
                  key: d.date,
                  cells: [
                    dayShort(d.date),
                    fmtDur(d.nightMs + d.napMs),
                    d.nightPhases ? fmtDur(d.nightMs) : "–",
                    d.naps ? `${fmtDur(d.napMs)} · ${d.naps}×` : "–",
                    d.longestMs == null ? "–" : fmtDur(d.longestMs),
                    d.nightPhases ? d.nightPhases - 1 : "–",
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

const OBSERVATIONS: Key[] = ["sleep.obs.1", "sleep.obs.2", "sleep.obs.3", "sleep.obs.4", "sleep.obs.5", "sleep.obs.6"];

function SleepSheet({ state, sessions, onClose, onSaved }: { state: SheetState<Sleep>; sessions: Sleep[]; onClose: () => void; onSaved: () => void }) {
  return (
    <SessionSheet state={state} onClose={onClose} addTitle={t("sleep.add")} editTitle={t("sleep.edit")}>
      {(st) => <SleepForm key={st.mode === "new" ? "new" : st.session.id} state={st} sessions={sessions} onClose={onClose} onSaved={onSaved} />}
    </SessionSheet>
  );
}

function SleepForm({ state, sessions, onClose, onSaved }: { state: NonNullable<SheetState<Sleep>>; sessions: Sleep[]; onClose: () => void; onSaved: () => void }) {
  const { settings } = useFamily();
  const s = state.mode === "new" ? null : state.session;
  const [kind, setKind] = useState<SleepKind>(() => s?.kind ?? kindAt(Date.now() - HOUR, settings.timezone));
  const [place, setPlace] = useState<SleepPlace | null>(() => (s ? s.place : suggestPlace(sessions, kind)));
  return (
    <SessionForm
      kind="sleeps"
      state={state}
      onClose={onClose}
      onSaved={onSaved}
      defaultMinutes={60}
      fields={() => ({ kind, place })}
      observations={OBSERVATIONS}
      notesPh={t("sleep.notesPh")}
      deleteText={t("sleep.deleteConfirm")}
    >
      <Field group label={t("sleep.kind")}>
        <KindPicker value={kind} onChange={setKind} />
      </Field>
      <Field group label={t("sleep.place")}>
        <PlacePicker value={place} onChange={setPlace} />
      </Field>
    </SessionForm>
  );
}

// ---------------------------------------------------------------- home screen

export function SleepRow() {
  const { settings } = useFamily();
  const tz = settings.timezone;
  const trk = useSessions<Sleep>("sleeps", 3);
  const [sheet, setSheet] = useState<SheetState<Sleep>>(null);
  const [busy, run] = useBusy();
  useTick(30_000);
  const data = trk.data;
  const running = data?.running ?? null;
  const now = trk.now();

  const start = () =>
    run(async () => {
      const kind = kindAt(trk.now(), tz);
      const r = await calls.start({ kind, place: suggestPlace(data!.sessions, kind) });
      if (r.alreadyRunning) toast(t("sleep.alreadyRunning"));
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
        href="/family/sleep"
        icon="moon"
        title={t("sleep.title")}
        running={!!running}
        main={!data ? "…" : running ? <Elapsed session={running} now={trk.now} /> : awakeText(data.last, now)}
        sub={
          running
            ? `${describe(running)} · ${t("sleep.asleepSince", { time: clockTime(running.startedAt, tz) })}`
            : data?.last && `${describe(data.last)} · ${fmtDur(durationOf(data.last))}`
        }
      >
        {running ? (
          <Button class="btn-stop" icon="sun" busy={busy} onClick={stop}>
            {t("sleep.stop")}
          </Button>
        ) : (
          <Button icon="moon" busy={busy} disabled={!data} onClick={start}>
            {t("sleep.start")}
          </Button>
        )}
      </TrackerRow>
      <SleepSheet state={sheet} sessions={data?.sessions ?? []} onClose={() => setSheet(null)} onSaved={trk.reload} />
    </>
  );
}
