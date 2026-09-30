// Feeding tracker: data hook, suggestions and statistics (pure functions, no UI).
import { useEffect, useState } from "preact/hooks";
import { addDays, timeToMin, zonedNow } from "../../shared/dates";
import { FEED_METHODS, isBreastMethod } from "../../shared/types";
import type { FeedMethod, FeedSide, Feeding, FeedingData } from "../../shared/types";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Longer sessions are almost certainly a forgotten timer – they don't count for averages. */
const MAX_COUNTED = 3 * HOUR;
/** Gaps longer than this are tracking gaps, not breaks between feeds. */
const MAX_GAP = 12 * HOUR;
const MAX_INTERVAL = 8 * HOUR;

/** Feeds of the last `days` days, the running feed, and a clock synced to the server. */
export function useFeedings(days: number) {
  // Remember when the answer arrived, so the clock offset is measured once per fetch.
  const load = useLoad(
    async () => ({ ...(await api<FeedingData>(`/admin/feedings?days=${days}`)), receivedAt: Date.now() }),
    [days],
  );
  const offset = load.data ? load.data.serverNow - load.data.receivedAt : 0;

  useEffect(() => {
    // Both parents may use it at the same time: refresh regularly and when the app comes back.
    const refresh = () => document.visibilityState === "visible" && load.reload();
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [load.reload]);

  const now = () => Date.now() + offset;
  return { ...load, now };
}

/** Re-render every `ms` milliseconds (for timers and "… ago" texts). */
export function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export const startFeed = (method: FeedMethod, side: FeedSide | null) =>
  api<{ feeding: Feeding; alreadyRunning: boolean }>("/admin/feedings/start", { body: { method, side } });
export const stopFeed = (id: number) => api<{ feeding: Feeding }>(`/admin/feedings/${id}/stop`, { body: {} });
export const patchFeed = (id: number, body: Partial<Feeding>) =>
  api<{ feeding: Feeding }>(`/admin/feedings/${id}`, { method: "PATCH", body });

/** Same method as last time; for the breast the other side (the classic "which side next?"). */
export function suggestNext(last: Feeding | null): { method: FeedMethod; side: FeedSide | null } {
  if (!last) return { method: "breast", side: "left" };
  if (!isBreastMethod(last.method)) return { method: last.method, side: null };
  const side: FeedSide = last.side === "left" ? "right" : last.side === "right" ? "left" : last.side === "both" ? "both" : "left";
  return { method: last.method, side };
}

export const localDate = (ms: number, tz: string) => zonedNow(tz, new Date(ms)).date;
export const localMinutes = (ms: number, tz: string) => timeToMin(zonedNow(tz, new Date(ms)).time);
export const durationOf = (f: Feeding) => (f.endedAt ?? f.startedAt) - f.startedAt;

// ---------------------------------------------------------------- statistics

export interface DayStat {
  date: string;
  count: number;
  /** Durations of the day's feeds (ms), without forgotten timers. */
  durations: number[];
  totalMs: number;
  avgMs: number | null;
  /** Start-to-start intervals that end on this day (ms). */
  intervals: number[];
  /** Longest break (end → next start) ending on this day. */
  longestGapMs: number | null;
  amountMl: number | null;
  methods: Record<FeedMethod, number>;
}

export interface Summary {
  trackedDays: number;
  count: number;
  perDay: number | null;
  avgDurationMs: number | null;
  avgIntervalMs: number | null;
  avgLongestGapMs: number | null;
  totalPerDayMs: number | null;
  amountPerDay: number | null;
  methods: Record<FeedMethod, number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const emptyMethods = () => Object.fromEntries(FEED_METHODS.map((m) => [m, 0])) as Record<FeedMethod, number>;

/** One entry per day from `from` to `to` (inclusive, family time zone). */
export function dailyStats(feedings: Feeding[], tz: string, from: string, to: string): DayStat[] {
  const done = feedings.filter((f) => f.endedAt != null).sort((a, b) => a.startedAt - b.startedAt);
  const days = new Map<string, DayStat>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { date: d, count: 0, durations: [], totalMs: 0, avgMs: null, intervals: [], longestGapMs: null, amountMl: null, methods: emptyMethods() });
  }
  done.forEach((f, i) => {
    const day = days.get(localDate(f.startedAt, tz));
    if (!day) return;
    day.count++;
    day.methods[f.method]++;
    const dur = durationOf(f);
    if (dur <= MAX_COUNTED) {
      day.durations.push(dur);
      day.totalMs += dur;
    }
    if (f.amountMl != null) day.amountMl = (day.amountMl ?? 0) + f.amountMl;
    const prev = done[i - 1];
    if (prev) {
      const interval = f.startedAt - prev.startedAt;
      if (interval <= MAX_INTERVAL) day.intervals.push(interval);
      const gap = f.startedAt - prev.endedAt!;
      if (gap > 0 && gap <= MAX_GAP) day.longestGapMs = Math.max(day.longestGapMs ?? 0, gap);
    }
  });
  for (const day of days.values()) day.avgMs = mean(day.durations);
  return [...days.values()];
}

export function summarize(days: DayStat[]): Summary {
  const tracked = days.filter((d) => d.count > 0);
  const methods = emptyMethods();
  for (const d of tracked) for (const m of FEED_METHODS) methods[m] += d.methods[m];
  const count = tracked.reduce((n, d) => n + d.count, 0);
  const amounts = tracked.filter((d) => d.amountMl != null).map((d) => d.amountMl!);
  return {
    trackedDays: tracked.length,
    count,
    perDay: tracked.length ? count / tracked.length : null,
    avgDurationMs: mean(tracked.flatMap((d) => d.durations)),
    avgIntervalMs: mean(tracked.flatMap((d) => d.intervals)),
    avgLongestGapMs: mean(tracked.filter((d) => d.longestGapMs != null).map((d) => d.longestGapMs!)),
    totalPerDayMs: mean(tracked.map((d) => d.totalMs)),
    amountPerDay: mean(amounts),
    methods,
  };
}

/** Relative change (0.12 = +12 %), or null when there's nothing solid to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}
