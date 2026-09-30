// Charts shared by the trackers: columns (optionally stacked), a line, shares, ranked bars and the
// 24-hour rhythm. Single-series charts use the app's primary colour; categories use validated
// palettes (light + dark, colour-blind checked, see styles.css). Every chart has a hover/focus
// tooltip, and each page also offers its numbers as a table.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { addDays } from "../../shared/dates";
import { fmtDate } from "../lib/format";
import { t } from "../lib/i18n";
import { cls } from "../ui/base";
import { localDate, localMinutes } from "./trackerData";

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

function dayTick(date: string, total: number) {
  return total <= 7 ? fmtDate(date, { weekday: "short" }).replace(/\.$/, "") : fmtDate(date, { day: "numeric" });
}

/** Axis from 0 to a round number above `max`, with at most ~5 gridlines. */
function scale(max: number, steps: number[]) {
  const step = steps.find((s) => max / s <= 5) ?? steps[steps.length - 1];
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

/** Column with a 4px rounded top (only for the topmost segment) and a square base. */
function column(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const TOP = 20;
const PLOT = 150;
const AXIS = 24;
const RIGHT = 8;
/** Room for the y labels: wide enough for the longest tick text. */
const leftFor = (labels: string[]) => Math.max(26, 12 + Math.max(...labels.map((l) => l.length)) * 6.6);

export interface ColumnDatum {
  date: string;
  /** One value per series, stacked from the bottom. */
  values: number[];
  tip: ComponentChildren;
  aria: string;
}

export function ColumnChart({
  data,
  label,
  steps,
  fmtTick = String,
  seriesCls = ["bar"],
  lastLabel,
}: {
  data: ColumnDatum[];
  label: string;
  steps: number[];
  fmtTick?: (v: number) => string;
  seriesCls?: string[];
  /** Direct label on the most recent non-empty column. */
  lastLabel?: (d: ColumnDatum) => string;
}) {
  const [ref, width] = useWidth();
  const tip = useTip(width);
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const { top, ticks } = scale(Math.max(...totals, 0) || steps[0], steps);
  const left = leftFor(ticks.map(fmtTick));
  const plotW = Math.max(0, width - left - RIGHT);
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(3, Math.min(24, band * 0.6));
  const y = (v: number) => TOP + PLOT * (1 - v / top);
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 38))));
  const lastIdx = totals.map((v) => v > 0).lastIndexOf(true);

  const enter = (i: number) => {
    setHover(i);
    tip.show(left + band * i + band / 2, y(totals[i]) - 8, data[i].tip);
  };
  const leave = () => {
    setHover(null);
    tip.hide();
  };

  return (
    <div class="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={TOP + PLOT + AXIS} role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line class="grid" x1={left} x2={width - RIGHT} y1={y(v)} y2={y(v)} />
              <text class="tick" x={left - 8} y={y(v)} text-anchor="end" dominant-baseline="middle">
                {fmtTick(v)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = left + band * i + band / 2;
            const topSeries = d.values.map((v) => v > 0).lastIndexOf(true);
            let base = 0;
            return (
              <g key={d.date}>
                {d.values.map((v, s) => {
                  if (v <= 0) return null;
                  const y0 = y(base);
                  base += v;
                  // 2px surface gap between stacked segments.
                  const h = y0 - y(base) - (s > 0 && base - v > 0 ? 2 : 0);
                  return h > 0 ? (
                    <path key={s} class={cls("bar", seriesCls[s], hover === i && "is-hover")} d={column(cx - barW / 2, y(base), barW, h, s === topSeries)} />
                  ) : null;
                })}
                {(i % every === 0 || i === data.length - 1) && (
                  <text class="tick" x={cx} y={TOP + PLOT + 16} text-anchor="middle">
                    {dayTick(d.date, data.length)}
                  </text>
                )}
                {lastLabel && i === lastIdx && (
                  <text class="value-label" x={cx} y={y(totals[i]) - 6} text-anchor={i > data.length - 3 ? "end" : "middle"}>
                    {lastLabel(d)}
                  </text>
                )}
                <rect
                  class="hit"
                  x={left + band * i}
                  y={TOP - 12}
                  width={band}
                  height={PLOT + 12}
                  tabIndex={0}
                  aria-label={d.aria}
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

export interface LineDatum {
  date: string;
  value: number | null;
  tip: ComponentChildren;
  aria: string;
}

export function LineChart({
  data,
  label,
  steps,
  minTop,
  fmtTick = String,
  fmtLast,
}: {
  data: LineDatum[];
  label: string;
  steps: number[];
  /** The axis goes at least this high (so a flat line doesn't look dramatic). */
  minTop: number;
  fmtTick?: (v: number) => string;
  fmtLast: (d: LineDatum) => string;
}) {
  const [ref, width] = useWidth();
  const tip = useTip(width);
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value);
  const { top, ticks } = scale(Math.max(minTop, ...values.map((v) => v ?? 0)), steps);
  const left = leftFor(ticks.map(fmtTick));
  const plotW = Math.max(0, width - left - RIGHT);
  const band = data.length ? plotW / data.length : 0;
  const x = (i: number) => left + band * i + band / 2;
  const y = (v: number) => TOP + PLOT * (1 - v / top);
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 38))));
  const base = TOP + PLOT;

  // Split into continuous runs (days without data break the line).
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push([x(i), y(v)]);
  });
  if (run.length) runs.push(run);
  const lastIdx = values.map((v) => v != null).lastIndexOf(true);

  const enter = (i: number) => {
    setHover(i);
    tip.show(x(i), (values[i] == null ? base : y(values[i]!)) - 10, data[i].tip);
  };
  const leave = () => {
    setHover(null);
    tip.hide();
  };

  return (
    <div class="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={TOP + PLOT + AXIS} role="img" aria-label={label}>
          {ticks.map((v) => (
            <g key={v}>
              <line class="grid" x1={left} x2={width - RIGHT} y1={y(v)} y2={y(v)} />
              <text class="tick" x={left - 8} y={y(v)} text-anchor="end" dominant-baseline="middle">
                {fmtTick(v)}
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
          {hover != null && values[hover] != null && <circle class="dot" cx={x(hover)} cy={y(values[hover]!)} r={4} />}
          {lastIdx >= 0 && (
            <>
              <circle class="dot" cx={x(lastIdx)} cy={y(values[lastIdx]!)} r={4} />
              <text
                class="value-label"
                x={x(lastIdx)}
                y={(values[lastIdx - 1] ?? 0) > values[lastIdx]! ? y(values[lastIdx]!) + 20 : y(values[lastIdx]!) - 10}
                text-anchor={lastIdx > data.length / 2 ? "end" : "middle"}
              >
                {fmtLast(data[lastIdx])}
              </text>
            </>
          )}
          {data.map((d, i) =>
            i % every === 0 || i === data.length - 1 ? (
              <text key={d.date} class="tick" x={x(i)} y={base + 16} text-anchor="middle">
                {dayTick(d.date, data.length)}
              </text>
            ) : null,
          )}
          {data.map((d, i) => (
            <rect
              key={d.date}
              class="hit"
              x={left + band * i}
              y={TOP - 12}
              width={band}
              height={PLOT + 12}
              tabIndex={0}
              aria-label={d.aria}
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

export interface Part {
  key: string;
  label: string;
  value: number;
  /** Shown next to the label, e.g. "12 · 34 %". */
  text: string;
  /** Colour class for categorical shares. */
  cls?: string;
}

/** A single 100 % bar split into categories, with a legend (identity by colour + label). */
export function ShareBar({ parts, label }: { parts: Part[]; label: string }) {
  const present = parts.filter((p) => p.value > 0);
  if (!present.length) return null;
  return (
    <div class="methods">
      <div class="method-bar" role="img" aria-label={`${label}: ${present.map((p) => `${p.label} ${p.text}`).join(", ")}`}>
        {present.map((p) => (
          <span key={p.key} class={cls("method-seg", p.cls)} style={{ flexGrow: p.value }} title={`${p.label}: ${p.text}`} />
        ))}
      </div>
      <Legend items={present.map((p) => ({ label: p.label, cls: p.cls ?? "", value: p.text }))} />
    </div>
  );
}

/** Horizontal bars in one colour, largest first (magnitude, not identity). */
export function RankBars({ parts, label }: { parts: Part[]; label: string }) {
  const present = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  if (!present.length) return null;
  const max = present[0].value;
  return (
    <ul class="rank-bars" aria-label={label}>
      {present.map((p) => (
        <li key={p.key}>
          <span class="rank-label">{p.label}</span>
          <span class="rank-track" aria-hidden="true">
            <span class="rank-fill" style={{ width: `${Math.max(2, (p.value / max) * 100)}%` }} />
          </span>
          <span class="rank-val">{p.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Legend({ items }: { items: { label: string; cls: string; value?: string }[] }) {
  return (
    <ul class="method-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span class={cls("swatch", it.cls)} aria-hidden="true" />
          <span class="legend-name">{it.label}</span>
          {it.value && <span class="legend-val">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export interface RhythmItem {
  startedAt: number;
  endedAt: number | null;
  /** Colour class of the block (defaults to the primary colour). */
  cls?: string;
  tip: ComponentChildren;
  aria: string;
}

/** One row per day (0–24 h), every session as a block – shows the baby's rhythm at a glance. */
export function Rhythm({ items, dates, tz, now }: { items: RhythmItem[]; dates: string[]; tz: string; now: number }) {
  const [ref, width] = useWidth();
  const tip = useTip(width);
  const blocks = new Map<string, { from: number; to: number; it: RhythmItem }[]>();
  const add = (date: string, from: number, to: number, it: RhythmItem) => blocks.set(date, [...(blocks.get(date) ?? []), { from, to, it }]);
  for (const it of items) {
    const end = it.endedAt ?? now;
    // Walk day by day, so a night appears on both days it touches.
    let date = localDate(it.startedAt, tz);
    let from = localMinutes(it.startedAt, tz);
    const endDate = localDate(end, tz);
    for (let guard = 0; guard < 3 && date < endDate; guard++) {
      add(date, from, 1440, it);
      date = addDays(date, 1);
      from = 0;
    }
    add(date, from, Math.max(localMinutes(end, tz), from + 1), it);
  }
  const show = (e: Event, it: RhythmItem) => {
    const box = ref.current!.getBoundingClientRect();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tip.show(r.left + r.width / 2 - box.left, r.top - box.top - 6, it.tip);
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
                class={cls("rhythm-block", b.it.cls, b.it.endedAt == null && "is-running")}
                style={{ left: `${(b.from / 1440) * 100}%`, width: `max(3px, ${((b.to - b.from) / 1440) * 100}%)` }}
                tabIndex={0}
                aria-label={b.it.aria}
                onPointerEnter={(e) => show(e, b.it)}
                onPointerLeave={tip.hide}
                onFocus={(e) => show(e, b.it)}
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
export function StatTable({ head, rows }: { head: string[]; rows: { key: string; cells: ComponentChildren[] }[] }) {
  if (!rows.length) return null;
  return (
    <details class="table-view">
      <summary>{t("trk.table")}</summary>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
