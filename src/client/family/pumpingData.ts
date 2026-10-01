// Pumping tracker: suggestions and statistics (pure functions, no UI).
import { addDays } from "../../shared/dates";
import { isBreastMethod } from "../../shared/types";
import type { FeedSide, Feeding, Pumping } from "../../shared/types";
import { HOUR, MINUTE, durationOf, intervalsByDay, localDate, mean, sum } from "./trackerData";

/** Longer sessions are almost certainly a forgotten timer – they don't count for averages. */
const MAX_COUNTED = 2 * HOUR;
/** Longer gaps are tracking gaps, not the rhythm between sessions. */
const MAX_INTERVAL = 12 * HOUR;
/** Breastfeeding and then pumping the rest (or the other way round) within this gap is one emptying. */
const MERGE_GAP = 30 * MINUTE;

/** Both sides stay both; one side at a time alternates like breastfeeding. */
export function suggestSide(last: Pumping | null): FeedSide {
  if (!last) return "both";
  return last.side === "left" ? "right" : last.side === "right" ? "left" : "both";
}

/** Sum of the known amounts, or null when no session has one. */
export const amountOf = (list: Pumping[]) => (list.some((p) => p.amountMl != null) ? sum(list.map((p) => p.amountMl ?? 0)) : null);

export interface PumpDay {
  date: string;
  count: number;
  /** Sum of the known amounts (null when none of the day's sessions has one). */
  amountMl: number | null;
  /** Number of sessions with an amount. */
  withAmount: number;
  durations: number[];
  intervals: number[];
}

export interface PumpSummary {
  trackedDays: number;
  perDay: number | null;
  amountPerDay: number | null;
  amountPerSession: number | null;
  avgDurationMs: number | null;
  totalPerDayMs: number | null;
  avgIntervalMs: number | null;
}

/** One entry per day from `from` to `to` (inclusive, family time zone). */
export function pumpDays(sessions: Pumping[], tz: string, from: string, to: string): PumpDay[] {
  const done = sessions.filter((p) => p.endedAt != null);
  const intervals = intervalsByDay(done, tz, MAX_INTERVAL);
  const days = new Map<string, PumpDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { date: d, count: 0, amountMl: null, withAmount: 0, durations: [], intervals: intervals.get(d) ?? [] });
  }
  for (const p of done) {
    const day = days.get(localDate(p.startedAt, tz));
    if (!day) continue;
    day.count++;
    const dur = durationOf(p);
    if (dur <= MAX_COUNTED) day.durations.push(dur);
    if (p.amountMl != null) {
      day.amountMl = (day.amountMl ?? 0) + p.amountMl;
      day.withAmount++;
    }
  }
  return [...days.values()];
}

export function pumpSummary(days: PumpDay[]): PumpSummary {
  const tracked = days.filter((d) => d.count > 0);
  const withAmount = tracked.filter((d) => d.amountMl != null);
  const amountSessions = sum(withAmount.map((d) => d.withAmount));
  return {
    trackedDays: tracked.length,
    perDay: tracked.length ? sum(tracked.map((d) => d.count)) / tracked.length : null,
    amountPerDay: mean(withAmount.map((d) => d.amountMl!)),
    amountPerSession: amountSessions ? sum(withAmount.map((d) => d.amountMl!)) / amountSessions : null,
    avgDurationMs: mean(tracked.flatMap((d) => d.durations)),
    totalPerDayMs: mean(tracked.map((d) => sum(d.durations))),
    avgIntervalMs: mean(tracked.flatMap((d) => d.intervals)),
  };
}

// ---------------------------------------------------------------- emptyings (pumping + breastfeeding)

export interface Emptying {
  start: number;
  end: number;
  /** Active time of all sessions in it (pauses don't count). */
  activeMs: number;
  /** Did the baby drink at the breast (breast or nipple shield)? */
  nursing: boolean;
}

/**
 * Every time the breasts were emptied: pumping sessions plus breastfeeding (breast or nipple shield).
 * Sessions that overlap or follow within 30 minutes count once – e.g. breastfeeding and then pumping the rest.
 */
export function emptyings(pumpings: Pumping[], feedings: Feeding[]): Emptying[] {
  const sessions = [
    ...pumpings.map((s) => ({ s, nursing: false })),
    ...feedings.filter((f) => isBreastMethod(f.method)).map((s) => ({ s, nursing: true })),
  ]
    // Forgotten timers would swallow everything after them.
    .filter(({ s }) => s.endedAt != null && s.endedAt - s.startedAt <= 3 * HOUR)
    .sort((a, b) => a.s.startedAt - b.s.startedAt);
  const out: Emptying[] = [];
  for (const { s, nursing } of sessions) {
    const last = out[out.length - 1];
    if (last && s.startedAt <= last.end + MERGE_GAP) {
      last.end = Math.max(last.end, s.endedAt!);
      last.activeMs += durationOf(s);
      last.nursing ||= nursing;
    } else out.push({ start: s.startedAt, end: s.endedAt!, activeMs: durationOf(s), nursing });
  }
  return out;
}

export interface EmptyDay {
  date: string;
  /** Emptyings by pumping only, and those with breastfeeding. */
  pumpOnly: number;
  nursing: number;
  durations: number[];
  intervals: number[];
}

export interface EmptySummary {
  trackedDays: number;
  perDay: number | null;
  avgDurationMs: number | null;
  totalPerDayMs: number | null;
  avgIntervalMs: number | null;
}

export function emptyDays(events: Emptying[], tz: string, from: string, to: string): EmptyDay[] {
  const days = new Map<string, EmptyDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, pumpOnly: 0, nursing: 0, durations: [], intervals: [] });
  events.forEach((e, i) => {
    const day = days.get(localDate(e.start, tz));
    if (!day) return;
    if (e.nursing) day.nursing++;
    else day.pumpOnly++;
    day.durations.push(e.activeMs);
    const prev = events[i - 1];
    if (prev && e.start - prev.start <= MAX_INTERVAL) day.intervals.push(e.start - prev.start);
  });
  return [...days.values()];
}

export function emptySummary(days: EmptyDay[]): EmptySummary {
  const tracked = days.filter((d) => d.pumpOnly + d.nursing > 0);
  return {
    trackedDays: tracked.length,
    perDay: tracked.length ? sum(tracked.map((d) => d.pumpOnly + d.nursing)) / tracked.length : null,
    avgDurationMs: mean(tracked.flatMap((d) => d.durations)),
    totalPerDayMs: mean(tracked.map((d) => sum(d.durations))),
    avgIntervalMs: mean(tracked.flatMap((d) => d.intervals)),
  };
}
