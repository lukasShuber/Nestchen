// Links into other apps: Google Calendar, .ics files, WhatsApp, SMS, e-mail.
import { addDays, minToTime, rrule, timeToMin } from "../../shared/dates";
import type { Repeat } from "../../shared/dates";
import { buildIcs } from "../../shared/ics";
import type { IcsEvent } from "../../shared/ics";
import type { Lang, Visit } from "../../shared/types";
import { when } from "./format";

const compact = (d: string) => d.replace(/-/g, "");
const compactTime = (t: string) => t.replace(":", "") + "00";

export interface CalLinkEvent {
  title: string;
  date: string;
  endDate?: string | null;
  start?: string | null;
  end?: string | null;
  details?: string;
  location?: string;
  repeat?: Repeat;
  repeatUntil?: string | null;
}

/** Opens Google Calendar with the event pre-filled (one tap to save it). */
export function googleCalUrl(e: CalLinkEvent, tz: string): string {
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title });
  if (e.start) {
    const end = e.end ?? minToTime(Math.min(timeToMin(e.start) + 60, 23 * 60 + 59));
    const endDate = end <= e.start ? addDays(e.date, 1) : e.date;
    p.set("dates", `${compact(e.date)}T${compactTime(e.start)}/${compact(endDate)}T${compactTime(end)}`);
    p.set("ctz", tz);
  } else {
    const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
    p.set("dates", `${compact(e.date)}/${compact(addDays(last, 1))}`);
  }
  if (e.details) p.set("details", e.details);
  if (e.location) p.set("location", e.location);
  const rule = e.repeat ? rrule(e.repeat, e.repeatUntil) : null;
  if (rule) p.set("recur", `RRULE:${rule}`);
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function downloadIcs(events: IcsEvent[], name: string, tz: string, filename: string) {
  const blob = new Blob([buildIcs(events, { name, tz })], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const feedUrl = (origin: string, token: string, feed: "all" | "family" | "visits") =>
  `${origin}/cal/${token}/${feed}.ics`;
export const webcalUrl = (url: string) => url.replace(/^https?:/, "webcal:");
export const googleSubscribeUrl = (url: string) =>
  `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(url))}`;

/** Only http(s) links are ever rendered as clickable. */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** International digits (without +) from a free-text contact, using the default country code. */
export function phoneDigits(contact: string, cc: string): string | null {
  const m = contact.match(/\+?\d[\d\s()/.-]{4,}\d/);
  if (!m) return null;
  let d = m[0].replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = cc + d.slice(1);
  return d.length >= 6 ? d : null;
}

export const emailOf = (contact: string) => contact.match(/[^\s@<>(),;]+@[^\s@<>(),;]+\.[a-z]{2,}/i)?.[0] ?? null;
export const telUrl = (digits: string) => `tel:+${digits}`;
export const whatsappUrl = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
export const smsUrl = (digits: string, text: string) => `sms:+${digits}?&body=${encodeURIComponent(text)}`;
export const mailtoUrl = (email: string, subject: string, body: string) =>
  `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const MESSAGES: Record<Lang, Record<string, (name: string, when: string) => string>> = {
  de: {
    subject: (site) => `Dein Besuch bei ${site}`,
    subjectMeal: (site) => `Essen für ${site}`,
    confirmed: (n, w) => `Hallo ${n}! 😊 Dein Besuch am ${w} ist bestätigt – wir freuen uns auf dich!`,
    confirmedMeal: (n, w) => `Hallo ${n}! 😊 Wie lieb von dir – ${w} passt super. Danke schon mal fürs Essen!`,
    declined: (n, w) =>
      `Hallo ${n}, danke für deine Anfrage! ${w ? `Am ${w} passt es leider nicht.` : "Leider passt es zu diesen Zeiten nicht."}`,
    cancelled: (n, w) => `Hallo ${n}, leider müssen wir ${w ? `den Termin am ${w}` : "den Termin"} absagen – tut uns leid!`,
    pending: (n) => `Hallo ${n}! Danke für deine Anfrage – wir melden uns bald.`,
    link: (url) => `Alle Infos: ${url}`,
  },
  en: {
    subject: (site) => `Your visit – ${site}`,
    subjectMeal: (site) => `Meal for ${site}`,
    confirmed: (n, w) => `Hi ${n}! 😊 Your visit on ${w} is confirmed – we're looking forward to seeing you!`,
    confirmedMeal: (n, w) => `Hi ${n}! 😊 How kind of you – ${w} works perfectly. Thank you so much for the meal!`,
    declined: (n, w) =>
      `Hi ${n}, thanks for your request! ${w ? `Unfortunately ${w} doesn't work for us.` : "Unfortunately those times don't work for us."}`,
    cancelled: (n, w) => `Hi ${n}, unfortunately we have to cancel ${w ? `the visit on ${w}` : "the visit"} – we're sorry!`,
    pending: (n) => `Hi ${n}! Thanks for your request – we'll get back to you soon.`,
    link: (url) => `All details: ${url}`,
  },
};

/** A friendly, pre-written message to the guest in *their* language. */
export function guestMessage(v: Visit, origin: string, siteName: string): { subject: string; body: string } {
  const m = MESSAGES[v.lang];
  const w = v.date ? when(v.date, v.start, v.end, v.lang) : "";
  const key =
    v.status === "confirmed" ? (v.kind === "meal" ? "confirmedMeal" : "confirmed") : v.status === "pending" ? "pending" : v.status;
  let body = m[key](v.name, w);
  if (v.reply) body += `\n\n${v.reply}`;
  body += `\n\n${m.link(`${origin}/r/${v.token}`, "")}`;
  return { subject: m[v.kind === "meal" ? "subjectMeal" : "subject"](siteName, ""), body };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
