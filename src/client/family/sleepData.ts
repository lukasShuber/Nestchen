// Sleep tracker: day/night and place suggestions and statistics (pure functions, no UI).
import { addDays } from "../../shared/dates";
import type { Sleep, SleepKind, SleepPlace } from "../../shared/types";
import { HOUR, durationOf, localDate, localMinutes, mean } from "./trackerData";

/** Sleep that starts between 19:00 and 07:00 is night sleep unless changed. */
export function kindAt(ms: number, tz: string): SleepKind {
  const min = localMinutes(ms, tz);
  return min >= 19 * 60 || min < 7 * 60 ? "night" : "nap";
}

/** Where the baby slept last time for this kind of sleep (at night usually the same bed). */
export function suggestPlace(sessions: Sleep[], kind: SleepKind): SleepPlace | null {
  let best: Sleep | null = null;
  for (const s of sessions) if (s.kind === kind && s.place && (!best || s.startedAt > best.startedAt)) best = s;
  return best?.place ?? (kind === "night" ? "bed" : null);
}

/**
 * The day a sleep counts for: naps count for the day they started, night sleep for the evening it
 * began – a night from Monday 20:00 to Tuesday 06:00, wake-ups included, belongs to Monday.
 */
export const sleepDate = (s: Sleep, tz: string) => localDate(s.kind === "night" ? s.startedAt - 12 * HOUR : s.startedAt, tz);

export type PlaceKey = SleepPlace | "none";

export interface SleepDay {
  date: string;
  napMs: number;
  nightMs: number;
  naps: number;
  /** Stretches of night sleep (wake-ups = stretches − 1). */
  nightPhases: number;
  longestMs: number | null;
  /** Sleep time per place (ms). */
  places: Partial<Record<PlaceKey, number>>;
}

export interface SleepSummary {
  trackedDays: number;
  /** Averages per day (night + naps), per night, per day with naps … */
  totalMs: number | null;
  nightMs: number | null;
  napMs: number | null;
  naps: number | null;
  longestMs: number | null;
  wakings: number | null;
  places: Partial<Record<PlaceKey, number>>;
}

/**
 * One entry per day from `from` to `to`: that day's naps plus the night after it.
 * `skip` leaves out a day whose night is still running (it isn't complete yet).
 */
export function sleepDays(sessions: Sleep[], tz: string, from: string, to: string, skip: string | null = null): SleepDay[] {
  const days = new Map<string, SleepDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { date: d, napMs: 0, nightMs: 0, naps: 0, nightPhases: 0, longestMs: null, places: {} });
  }
  for (const s of sessions) {
    if (s.endedAt == null) continue;
    const date = sleepDate(s, tz);
    const day = date === skip ? undefined : days.get(date);
    if (!day) continue;
    const dur = durationOf(s);
    if (s.kind === "night") {
      day.nightMs += dur;
      day.nightPhases++;
    } else {
      day.napMs += dur;
      day.naps++;
    }
    day.longestMs = Math.max(day.longestMs ?? 0, dur);
    const place: PlaceKey = s.place ?? "none";
    day.places[place] = (day.places[place] ?? 0) + dur;
  }
  return [...days.values()];
}

export function sleepSummary(days: SleepDay[]): SleepSummary {
  const tracked = days.filter((d) => d.naps + d.nightPhases > 0);
  const nights = tracked.filter((d) => d.nightPhases > 0);
  const napDays = tracked.filter((d) => d.naps > 0);
  const places: Partial<Record<PlaceKey, number>> = {};
  for (const d of tracked) for (const [k, v] of Object.entries(d.places) as [PlaceKey, number][]) places[k] = (places[k] ?? 0) + v;
  return {
    trackedDays: tracked.length,
    totalMs: mean(tracked.map((d) => d.napMs + d.nightMs)),
    nightMs: mean(nights.map((d) => d.nightMs)),
    napMs: mean(napDays.map((d) => d.napMs)),
    naps: mean(napDays.map((d) => d.naps)),
    longestMs: mean(tracked.map((d) => d.longestMs ?? 0)),
    wakings: mean(nights.map((d) => d.nightPhases - 1)),
    places,
  };
}

/** Sleep within the window [from, to] (ms), counting only the overlapping part of each sleep. */
export function sleptWithin(sessions: Sleep[], from: number, to: number, now: number): number {
  let total = 0;
  for (const s of sessions) {
    const a = Math.max(s.startedAt, from);
    const b = Math.min(s.endedAt ?? now, to);
    if (b > a) total += b - a;
  }
  return total;
}
