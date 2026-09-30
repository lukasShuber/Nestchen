// Optional push notifications to the parents' phones via ntfy (https://ntfy.sh).
// The parents install the ntfy app, subscribe to a secret topic, and paste the
// topic URL into the settings. Nothing is sent when no URL is configured.
import { toUTC } from "../shared/dates";
import type { SettingsMap } from "./db";
import { lang } from "./db";

export interface Notice {
  title: string;
  message: string;
  tags?: string[];
  click?: string;
}

export async function notify(settings: SettingsMap, notice: Notice): Promise<boolean> {
  if (!settings.ntfy_url) return false;
  try {
    const target = new URL(settings.ntfy_url);
    const topic = target.pathname.replace(/^\/+|\/+$/g, "");
    if (!topic || topic.includes("/")) return false;
    const res = await fetch(`${target.origin}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, ...notice }),
    });
    return res.ok;
  } catch (err) {
    console.warn("ntfy notification failed", err);
    return false;
  }
}

const T = {
  de: {
    visit: "Neue Besuchsanfrage",
    meal: "Neues Essens-Angebot",
    cancelled: "Abgesagt",
    claim: "Geschenk reserviert",
    unclaim: "Reservierung zurückgenommen",
    test: "Test von deinem Nestchen – alles funktioniert 🎉",
    persons: (n: number) => (n === 1 ? "1 Person" : `${n} Personen`),
    proposals: "schlägt Termine vor",
  },
  en: {
    visit: "New visit request",
    meal: "New meal offer",
    cancelled: "Cancelled",
    claim: "Gift reserved",
    unclaim: "Reservation withdrawn",
    test: "Test from your Nestchen – everything works 🎉",
    persons: (n: number) => (n === 1 ? "1 person" : `${n} people`),
    proposals: "suggests dates",
  },
};

export const notifyText = (s: SettingsMap) => T[lang(s)];

/** Short human date like "Sa., 3. Okt., 15:00–16:30" in the parents' language. */
export function when(s: SettingsMap, date: string | null, start?: string | null, end?: string | null): string {
  if (!date) return "";
  const day = new Intl.DateTimeFormat(lang(s) === "de" ? "de-DE" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(toUTC(date));
  return start ? `${day}, ${start}${end ? "–" + end : ""}` : day;
}
