// Date and time formatting in the current UI language.
import { addDays, daysInMonth, diffDays, pad2, toUTC } from "../../shared/dates";
import type { Lang } from "../../shared/types";
import { getLang, t, tn } from "./i18n";

const locale = (lang: Lang) => (lang === "de" ? "de-DE" : "en-GB");

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions, lang: Lang = getLang()): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: "UTC", ...opts }).format(toUTC(date));
}

export const dayLong = (d: string, l?: Lang) => fmtDate(d, { weekday: "long", day: "numeric", month: "long" }, l);
export const dayShort = (d: string, l?: Lang) => fmtDate(d, { weekday: "short", day: "numeric", month: "short" }, l);
export const dayMonth = (d: string, l?: Lang) => fmtDate(d, { day: "numeric", month: "short" }, l);
export const monthTitle = (ym: string, l?: Lang) => fmtDate(`${ym}-01`, { month: "long", year: "numeric" }, l);
export const weekdayNames = (l?: Lang) =>
  Array.from({ length: 7 }, (_, i) => fmtDate(addDays("2024-01-01", i), { weekday: "short" }, l).replace(/\.$/, ""));

export function timeRange(start?: string | null, end?: string | null, lang: Lang = getLang()): string {
  if (!start) return "";
  return `${start}${end ? `–${end}` : ""}${t("common.timeSuffix", undefined, lang)}`;
}

/** "Samstag, 3. Oktober, 15:00–16:30 Uhr" */
export function when(date: string | null, start?: string | null, end?: string | null, lang: Lang = getLang()): string {
  if (!date) return "";
  const range = timeRange(start, end, lang);
  return range ? `${dayLong(date, lang)}, ${range}` : dayLong(date, lang);
}

/** "Heute", "Morgen", or "Sa., 3. Okt." */
export function relDay(date: string, today: string, lang: Lang = getLang()): string {
  const d = diffDays(today, date);
  if (d === 0) return t("common.today", undefined, lang);
  if (d === 1) return t("common.tomorrow", undefined, lang);
  if (d === -1) return t("common.yesterday", undefined, lang);
  return dayShort(date, lang);
}

export function ago(ms: number, lang: Lang = getLang()): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(0, "minute");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

function addMonthsClamped(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = m - 1 + n;
  const yy = y + Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${pad2(mm)}-${pad2(Math.min(d, daysInMonth(yy, mm)))}`;
}

/** "3 Wochen und 2 Tage", "4 Monate und 1 Woche", … */
export function babyAge(birth: string, today: string): string {
  const days = diffDays(birth, today);
  if (days <= 0) return "";
  const and = ` ${t("common.and")} `;
  if (days < 14) return tn("age.day", days);
  if (days < 56) {
    const weeks = Math.floor(days / 7);
    const rest = days % 7;
    return rest ? tn("age.week", weeks) + and + tn("age.day", rest) : tn("age.week", weeks);
  }
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months--;
  if (months < 24) {
    const weeks = Math.floor(diffDays(addMonthsClamped(birth, months), today) / 7);
    return weeks ? tn("age.month", months) + and + tn("age.week", weeks) : tn("age.month", months);
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? tn("age.year", years) + and + tn("age.month", rest) : tn("age.year", years);
}

// ---------------------------------------------------------------- durations & instants

/** "18 Min.", "2 Std. 5 Min.", "< 1 Min." */
export function fmtDur(ms: number): string {
  const total = Math.round(ms / 60_000);
  if (ms < 60_000) return t("dur.lt1");
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return t("dur.m", { m });
  return m ? t("dur.hm", { h, m }) : t("dur.h", { h });
}

/** Stopwatch style: "12:05" or "1:02:05". */
export function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = pad2(Math.floor((s % 3600) / 60));
  const ss = pad2(s % 60);
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Wall-clock time ("14:32") of a UTC timestamp in the family's time zone. */
export function clockTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

export function fmtNumber(n: number, digits = 1, lang: Lang = getLang()): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits }).format(n);
}
