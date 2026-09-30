// Shared data layer of the trackers (feeding, pumping, sleep): loading with a server-synced clock,
// the start/stop/change calls and small time helpers. Pure logic, no UI.
import { useEffect, useState } from "preact/hooks";
import { timeToMin, zonedNow } from "../../shared/dates";
import type { TrackerData } from "../../shared/types";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";

export type TrackerKind = "feedings" | "pumpings" | "sleeps";

export interface Session {
  id: number;
  /** UTC timestamps (ms); endedAt is null while the session is running. */
  startedAt: number;
  endedAt: number | null;
  notes: string;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Sessions of the last `days` days, the running one, and a clock synced to the server. */
export function useSessions<T extends Session>(kind: TrackerKind, days: number) {
  // Remember when the answer arrived, so the clock offset is measured once per fetch.
  const load = useLoad(
    async () => ({ ...(await api<TrackerData<T>>(`/admin/${kind}?days=${days}`)), receivedAt: Date.now() }),
    [kind, days],
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

export type Tracked<T extends Session> = ReturnType<typeof useSessions<T>>;

/** Re-render every `ms` milliseconds (for timers and "… ago" texts). */
export function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

type Body = Record<string, unknown>;

export const trackerApi = <T>(kind: TrackerKind) => ({
  start: (body: Body) => api<{ session: T; alreadyRunning: boolean }>(`/admin/${kind}/start`, { body }),
  stop: (id: number) => api<{ session: T }>(`/admin/${kind}/${id}/stop`, { body: {} }),
  patch: (id: number, body: Body) => api<{ session: T }>(`/admin/${kind}/${id}`, { method: "PATCH", body }),
  create: (body: Body) => api<{ session: T }>(`/admin/${kind}`, { body }),
  remove: (id: number) => api(`/admin/${kind}/${id}`, { method: "DELETE" }),
});

/** The loaded sessions plus the running one (which may have started before the loaded range). */
export function withRunning<T extends Session>(data: TrackerData<T>): T[] {
  const r = data.running;
  return r && !data.sessions.some((s) => s.id === r.id) ? [...data.sessions, r] : data.sessions;
}

export const localDate = (ms: number, tz: string) => zonedNow(tz, new Date(ms)).date;
export const localMinutes = (ms: number, tz: string) => timeToMin(zonedNow(tz, new Date(ms)).time);
export const durationOf = (s: Session) => (s.endedAt ?? s.startedAt) - s.startedAt;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Relative change (0.12 = +12 %), or null when there's nothing solid to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Start-to-start intervals between consecutive finished sessions (ms), keyed by the later session's day. */
export function intervalsByDay(sessions: Session[], tz: string, max: number): Map<string, number[]> {
  const done = sessions.filter((s) => s.endedAt != null).sort((a, b) => a.startedAt - b.startedAt);
  const out = new Map<string, number[]>();
  done.forEach((s, i) => {
    if (!i) return;
    const gap = s.startedAt - done[i - 1].startedAt;
    if (gap > max) return;
    const d = localDate(s.startedAt, tz);
    out.set(d, [...(out.get(d) ?? []), gap]);
  });
  return out;
}
