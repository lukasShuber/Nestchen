// Charts for the feeding statistics: feeds per day, average duration, methods and the daily rhythm.
// Single-series charts use the app's primary colour; the four methods use a validated categorical
// palette (light + dark, colour-blind checked). Every value is also in the table view.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { FEED_METHODS } from "../../shared/types";
import type { FeedMethod, Feeding } from "../../shared/types";
import { clockTime, dayShort, fmtDate, fmtDur } from "../lib/format";
import { t, tn } from "../lib/i18n";
import { cls } from "../ui/base";
import { durationOf, localDate, localMinutes } from "./feedingData";
import type { DayStat } from "./feedingData";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** One tooltip per chart, positioned inside the chart box. */
function useTip(width: number) {
  const [tip, setTip] = useState<{ x: number; y: number; content: ComponentChildren } | null>(null);
  const node = tip && (
    <div class="chart-tip" role="status" style={{ left: Math.min(Math.max(tip.x, 70), Math.max(70, width - 70)), top: tip.y }}>
      {tip.content}
    </div>
  );
  return { show: (x: number, y: number, content: ComponentChildren) => setTip({ x, y, content }), hide: () => setTip(null), node };
}

const methodLabel = (m: FeedMethod) => (m === "shield" ? t("feed.mShort.shield") : t(`feed.m.${m}`));

function dayTick(date: string, total: number) {
  return total <= 7 ? fmtDate(date, { weekday: "short" }).replace(/\.$/, "") : fmtDate(date, { day: "numeric" });
}

function niceStep(max: number, steps: number[]) {
  return steps.find((s) => max / s <= 5) ?? steps[steps.length - 1];
}

/** Column with a 4px rounded top and a square base. */
function column(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const TOP = 20;
const PLOT = 150;
const AXIS = 24;
const LEFT = 30;
const RIGHT = 8;

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

export function CountChart({ days }: { days: DayStat[] }) {
  const [ref, width] = useWidth();
  const tip = useTip(width);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const step = niceStep(max, [1, 2, 5, 10]);
  const top = Math.ceil(max / step) * step;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const band = days.length ? plotW / days.length : 0;
  const barW = Math.max(3, Math.min(24, band * 0.6));
  const y = (v: number) => TOP + PLOT * (1 - v / top);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 38))));
  const lastIdx = days.map((d) => d.count > 0).lastIndexOf(true);

  const enter = (i: number) => {
    setHover(i);
    tip.show(LEFT + band * i + band / 2, y(days[i].count) - 8, <DayTip day={days[i]} />);
  };
  const leave = () => {
    setHover(null);
    tip.hide();
  };

  return (
    <div class="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={TOP + PLOT + AXIS} role="img" aria-label={t("feed.chart.count")}>
          {ticks.map((v) => (
            <g key={v}>
              <line class="grid" x1={LEFT} x2={width - RIGHT} y1={y(v)} y2={y(v)} />
              <text class="tick" x={LEFT - 8} y={y(v)} text-anchor="end" dominant-baseline="middle">
                {v}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = LEFT + band * i + band / 2;
            return (
              <g key={d.date}>
                {d.count > 0 && <path class={cls("bar", hover === i && "is-hover")} d={column(cx - barW / 2, y(d.count), barW, PLOT + TOP - y(d.count))} />}
                {(i % every === 0 || i === days.length - 1) && (
                  <text class="tick" x={cx} y={TOP + PLOT + 16} text-anchor="middle">
                    {dayTick(d.date, days.length)}
                  </text>
                )}
                {i === lastIdx && (
                  <text class="value-label" x={cx} y={y(d.count) - 6} text-anchor="middle">
                    {d.count}
                  </text>
                )}
                <rect
                  class="hit"
                  x={LEFT + band * i}
                  y={TOP - 12}
                  width={band}
                  height={PLOT + 12}
                  tabIndex={0}
                  aria-label={`${dayShort(d.date)}: ${tn("feed.count", d.count)}`}
                  onPointerEnter={() => enter(i)}
                  onPointerLeave={leave}
                  onFocus={() => enter(i)}
                  onBlur={leave}
                />
              </g>
            );
          })}
        </svg>
      )}
      {tip.node}
    </div>
  );
}

export function DurationChart({ days }: { days: DayStat[] }) {
  const [ref, width] = useWidth();
  const tip = useTip(width);
  const [hover, setHover] = useState<number | null>(null);
  const mins = days.map((d) => (d.avgMs == null ? null : d.avgMs / 60_000));
  const max = Math.max(5, ...mins.map((m) => m ?? 0));
  const step = niceStep(max, [5, 10, 15, 30, 60]);
  const top = Math.ceil(max / step) * step;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const band = days.length ? plotW / days.length : 0;
  const x = (i: number) => LEFT + band * i + band / 2;
  const y = (v: number) => TOP + PLOT * (1 - v / top);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 38))));

  // Split into continuous runs (days without feeds break the line).
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  mins.forEach((m, i) => {
    if (m == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push([x(i), y(m)]);
  });
  if (run.length) runs.push(run);
  const lastIdx = mins.map((m) => m != null).lastIndexOf(true);
  const base = TOP + PLOT;

  const enter = (i: number) => {
    setHover(i);
    tip.show(x(i), (mins[i] == null ? base : y(mins[i]!)) - 10, <DayTip day={days[i]} />);
  };
  const leave = () => {
    setHover(null);
    tip.hide();
  };

  return (
    <div class="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={TOP + PLOT + AXIS} role="img" aria-label={t("feed.chart.duration")}>
          {ticks.map((v) => (
            <g key={v}>
              <line class="grid" x1={LEFT} x2={width - RIGHT} y1={y(v)} y2={y(v)} />
              <text class="tick" x={LEFT - 8} y={y(v)} text-anchor="end" dominant-baseline="middle">
                {v}
              </text>
            </g>
          ))}
          {runs.map((r, k) => (
            <g key={k}>
              <path class="area" d={`M${r[0][0]},${base}${r.map(([px, py]) => `L${px},${py}`).join("")}L${r[r.length - 1][0]},${base}Z`} />
              <path class="line" d={r.map(([px, py], j) => `${j ? "L" : "M"}${px},${py}`).join("")} />
            </g>
          ))}
          {hover != null && <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={TOP - 6} y2={base} />}
          {hover != null && mins[hover] != null && <circle class="dot" cx={x(hover)} cy={y(mins[hover]!)} r={4} />}
          {lastIdx >= 0 && (
            <>
              <circle class="dot" cx={x(lastIdx)} cy={y(mins[lastIdx]!)} r={4} />
              <text
                class="value-label"
                x={x(lastIdx)}
                y={(mins[lastIdx - 1] ?? 0) > mins[lastIdx]! ? y(mins[lastIdx]!) + 20 : y(mins[lastIdx]!) - 10}
                text-anchor={lastIdx > days.length / 2 ? "end" : "middle"}
              >
                {fmtDur(days[lastIdx].avgMs!)}
              </text>
            </>
          )}
          {days.map((d, i) =>
            i % every === 0 || i === days.length - 1 ? (
              <text key={d.date} class="tick" x={x(i)} y={base + 16} text-anchor="middle">
                {dayTick(d.date, days.length)}
              </text>
            ) : null,
          )}
          {days.map((d, i) => (
            <rect
              key={d.date}
              class="hit"
              x={LEFT + band * i}
              y={TOP - 12}
              width={band}
              height={PLOT + 12}
              tabIndex={0}
              aria-label={`${dayShort(d.date)}: ${d.avgMs == null ? "–" : fmtDur(d.avgMs)}`}
              onPointerEnter={() => enter(i)}
              onPointerLeave={leave}
              onFocus={() => enter(i)}
              onBlur={leave}
            />
          ))}
        </svg>
      )}
      {tip.node}
    </div>
  );
}

export function MethodBreakdown({ methods }: { methods: Record<FeedMethod, number> }) {
  const total = FEED_METHODS.reduce((n, m) => n + methods[m], 0);
  if (!total) return null;
  const present = FEED_METHODS.filter((m) => methods[m] > 0);
  const pct = (m: FeedMethod) => Math.round((methods[m] / total) * 100);
  return (
    <div class="methods">
      <div class="method-bar" role="img" aria-label={present.map((m) => `${methodLabel(m)} ${pct(m)} %`).join(", ")}>
        {present.map((m) => (
          <span key={m} class={`method-seg m-${m}`} style={{ flexGrow: methods[m] }} title={`${t(`feed.m.${m}`)}: ${methods[m]} (${pct(m)} %)`} />
        ))}
      </div>
      <ul class="method-legend">
        {present.map((m) => (
          <li key={m}>
            <span class={`swatch m-${m}`} aria-hidden="true" />
            <span class="legend-name">{t(`feed.m.${m}`)}</span>
            <span class="legend-val">
              {methods[m]} · {pct(m)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One row per day (0–24 h), every feed as a block – shows the baby's rhythm at a glance. */
export function Rhythm({ feedings, dates, tz, now }: { feedings: Feeding[]; dates: string[]; tz: string; now: number }) {
  const [ref, width] = useWidth();
  const tip = useTip(width);
  const blocks = new Map<string, { from: number; to: number; f: Feeding }[]>();
  const add = (date: string, from: number, to: number, f: Feeding) => blocks.set(date, [...(blocks.get(date) ?? []), { from, to, f }]);
  for (const f of feedings) {
    const end = f.endedAt ?? now;
    const startDate = localDate(f.startedAt, tz);
    const endDate = localDate(end, tz);
    const from = localMinutes(f.startedAt, tz);
    const to = localMinutes(end, tz);
    if (startDate === endDate) add(startDate, from, Math.max(to, from + 1), f);
    else {
      add(startDate, from, 1440, f);
      add(endDate, 0, Math.max(to, 1), f);
    }
  }
  const show = (e: Event, f: Feeding) => {
    const box = ref.current!.getBoundingClientRect();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tip.show(
      r.left + r.width / 2 - box.left,
      r.top - box.top - 6,
      <>
        <strong>
          {clockTime(f.startedAt, tz)}–{f.endedAt ? clockTime(f.endedAt, tz) : "…"}
        </strong>
        <span>
          {fmtDur(durationOf(f))} · {methodLabel(f.method)}
          {f.side ? ` · ${t(`feed.side.${f.side}`)}` : ""}
        </span>
      </>,
    );
  };
  return (
    <div class="rhythm" ref={ref}>
      {dates.map((d) => (
        <div class="rhythm-row" key={d}>
          <span class="rhythm-label">{fmtDate(d, { weekday: "short", day: "numeric" })}</span>
          <div class="rhythm-track">
            <i class="rhythm-night" style={{ left: 0, width: "25%" }} />
            <i class="rhythm-night" style={{ left: `${(22 / 24) * 100}%`, width: `${(2 / 24) * 100}%` }} />
            {(blocks.get(d) ?? []).map((b, i) => (
              <span
                key={i}
                class={cls("rhythm-block", b.f.endedAt == null && "is-running")}
                style={{ left: `${(b.from / 1440) * 100}%`, width: `max(3px, ${((b.to - b.from) / 1440) * 100}%)` }}
                tabIndex={0}
                aria-label={`${clockTime(b.f.startedAt, tz)}, ${fmtDur(durationOf(b.f))}`}
                onPointerEnter={(e) => show(e, b.f)}
                onPointerLeave={tip.hide}
                onFocus={(e) => show(e, b.f)}
                onBlur={tip.hide}
              />
            ))}
          </div>
        </div>
      ))}
      <div class="rhythm-row rhythm-axis" aria-hidden="true">
        <span class="rhythm-label" />
        <div class="rhythm-track">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {h}
            </span>
          ))}
        </div>
      </div>
      {tip.node}
    </div>
  );
}

/** The same numbers as a table (accessible and exact). */
export function DayTable({ days }: { days: DayStat[] }) {
  const rows = [...days].reverse().filter((d) => d.count > 0);
  const withAmount = rows.some((d) => d.amountMl != null);
  if (!rows.length) return null;
  return (
    <details class="table-view">
      <summary>{t("feed.table")}</summary>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("feed.col.day")}</th>
              <th>{t("feed.col.count")}</th>
              <th>{t("feed.col.avg")}</th>
              <th>{t("feed.col.total")}</th>
              <th>{t("feed.col.longest")}</th>
              {withAmount && <th>{t("feed.col.amount")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date}>
                <td>{dayShort(d.date)}</td>
                <td>{d.count}</td>
                <td>{d.avgMs == null ? "–" : fmtDur(d.avgMs)}</td>
                <td>{fmtDur(d.totalMs)}</td>
                <td>{d.longestGapMs == null ? "–" : fmtDur(d.longestGapMs)}</td>
                {withAmount && <td>{d.amountMl == null ? "–" : `${d.amountMl} ml`}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
