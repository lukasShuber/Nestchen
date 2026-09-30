// Wall-clock date/time helpers shared by the Worker and the browser.
// Dates are 'YYYY-MM-DD' strings and times 'HH:MM' strings, always in the family's
// time zone. Internally a wall-clock value is treated as if it were UTC, so no
// accidental time-zone conversion can happen while doing date arithmetic.

export const pad2 = (n: number) => String(n).padStart(2, "0");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toUTC(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function isDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s) && fromUTC(toUTC(s)) === s;
}

export function isTime(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

export function addDays(date: string, n: number): string {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

/** Number of days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** Monday = 0 … Sunday = 6 */
export function weekday(date: string): number {
  return (toUTC(date).getUTCDay() + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shift a 'YYYY-MM' month key by n months. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/** Current wall-clock date and time in an IANA time zone. */
export function zonedNow(tz: string, now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMs));
  const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUTC = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second"));
  return asUTC - utcMs;
}

/** Convert a wall-clock date + time in `tz` to a UTC timestamp (ms). */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(t, tz);
  if (second !== t) t = second;
  return t;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type Repeat = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
export const REPEATS: readonly Repeat[] = ["none", "daily", "weekly", "biweekly", "monthly", "yearly"];

export interface RepeatingDates {
  date: string;
  endDate?: string | null;
  repeat: Repeat;
  repeatUntil?: string | null;
}

/**
 * Start dates of every occurrence of a (possibly repeating, possibly multi-day)
 * event that overlaps the inclusive range [from, to].
 */
export function occurrences(ev: RepeatingDates, from: string, to: string, limit = 1000): string[] {
  const span = ev.endDate && ev.endDate > ev.date ? diffDays(ev.date, ev.endDate) : 0;
  const last = ev.repeatUntil && ev.repeatUntil < to ? ev.repeatUntil : to;
  const out: string[] = [];
  const push = (d: string) => {
    if (d <= to && addDays(d, span) >= from) out.push(d);
  };

  if (ev.repeat === "none") {
    push(ev.date);
    return out;
  }

  if (ev.repeat === "daily" || ev.repeat === "weekly" || ev.repeat === "biweekly") {
    const step = ev.repeat === "daily" ? 1 : ev.repeat === "weekly" ? 7 : 14;
    const gap = diffDays(ev.date, from) - span;
    for (let k = gap > 0 ? Math.floor(gap / step) : 0; ; k++) {
      const d = addDays(ev.date, k * step);
      if (d > last || out.length >= limit) break;
      push(d);
    }
    return out;
  }

  // monthly / yearly: same day of the month; months without that day are skipped
  const [y0, m0, d0] = ev.date.split("-").map(Number);
  const [fy, fm] = from.split("-").map(Number);
  const stepMonths = ev.repeat === "monthly" ? 1 : 12;
  const monthsToFrom = (fy - y0) * 12 + (fm - m0) - 1 - Math.ceil(span / 28);
  for (let k = Math.max(0, Math.floor(monthsToFrom / stepMonths)); ; k++) {
    const total = m0 - 1 + k * stepMonths;
    const y = y0 + Math.floor(total / 12);
    const m = (total % 12) + 1;
    if (`${y}-${pad2(m)}-01` > last || out.length >= limit) break;
    if (d0 > daysInMonth(y, m)) continue;
    const d = `${y}-${pad2(m)}-${pad2(d0)}`;
    if (d > last) break;
    push(d);
  }
  return out;
}

/** RRULE for Google Calendar template links. */
export function rrule(repeat: Repeat, until?: string | null): string | null {
  const freq: Record<Repeat, string | null> = {
    none: null,
    daily: "FREQ=DAILY",
    weekly: "FREQ=WEEKLY",
    biweekly: "FREQ=WEEKLY;INTERVAL=2",
    monthly: "FREQ=MONTHLY",
    yearly: "FREQ=YEARLY",
  };
  const base = freq[repeat];
  if (!base) return null;
  return until ? `${base};UNTIL=${until.replace(/-/g, "")}` : base;
}
