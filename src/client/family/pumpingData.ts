// Pumping tracker: suggestions and statistics (pure functions, no UI).
import { addDays } from "../../shared/dates";
import type { FeedSide, Pumping } from "../../shared/types";
import { HOUR, durationOf, intervalsByDay, localDate, mean, sum } from "./trackerData";

/** Longer sessions are almost certainly a forgotten timer – they don't count for averages. */
const MAX_COUNTED = 2 * HOUR;
/** Longer gaps are tracking gaps, not the rhythm between sessions. */
const MAX_INTERVAL = 12 * HOUR;

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
