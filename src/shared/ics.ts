// Minimal iCalendar (RFC 5545) writer used for the subscription feeds and
// single-event downloads. Timed events are written in UTC so every calendar app
// shows them at the right local time; repeating events are expanded by the caller.
import { addDays, zonedToUtc } from "./dates";

export interface IcsEvent {
  uid: string;
  title: string;
  date: string;
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string;
  description?: string;
  url?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  updatedAt?: number;
}

const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines longer than 75 octets, as required by the spec. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let length = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const max = chunks.length === 0 ? 75 : 74;
    if (length + size > max) {
      chunks.push(current);
      current = ch;
      length = size;
    } else {
      current += ch;
      length += size;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const compact = (date: string) => date.replace(/-/g, "");

/** UTC start/end (ms) of a timed event; a missing or earlier end means "one hour" / "next day". */
export function eventTimes(e: Pick<IcsEvent, "date" | "endDate" | "start" | "end">, tz: string) {
  const start = zonedToUtc(e.date, e.start!, tz);
  let end = start + 3_600_000;
  if (e.end) {
    const endDate = e.endDate && e.endDate > e.date ? e.endDate : e.end > e.start! ? e.date : addDays(e.date, 1);
    end = zonedToUtc(endDate, e.end, tz);
  }
  if (end <= start) end = start + 3_600_000;
  return { start, end };
}

export function buildIcs(events: IcsEvent[], opts: { name: string; tz: string }): string {
  const now = utcStamp(Date.now());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nestchen//Family Organiser//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    `X-WR-TIMEZONE:${opts.tz}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${e.updatedAt ? utcStamp(e.updatedAt) : now}`);
    if (e.start) {
      const { start, end } = eventTimes(e, opts.tz);
      lines.push(`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`);
    } else {
      const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
      lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDays(last, 1))}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
