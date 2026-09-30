// Secret iCalendar feeds the parents subscribe to in Google / Apple Calendar.
// URL: /cal/<token>/family.ics | visits.ics | all.ics
import { Hono } from "hono";
import { addDays, zonedNow } from "../../shared/dates";
import { buildIcs } from "../../shared/ics";
import type { IcsEvent } from "../../shared/ics";
import { CATEGORY_EMOJI } from "../../shared/types";
import { lang, loadSettings } from "../db";
import { occurrencesBetween } from "../queries";
import type { AppEnv } from "../types";
import { safeEqual } from "../util";

const app = new Hono<AppEnv>();
const FEEDS = ["family", "visits", "all"] as const;
type Feed = (typeof FEEDS)[number];

app.get("/:token/:file", async (c) => {
  const s = await loadSettings(c.env.DB);
  const token = c.req.param("token");
  const feed = c.req.param("file").replace(/\.ics$/i, "") as Feed;
  if (!s.ics_token || !safeEqual(token, s.ics_token) || !FEEDS.includes(feed)) return c.text("Not found", 404);

  const de = lang(s) === "de";
  const now = zonedNow(s.timezone);
  const from = addDays(now.date, -90);
  const to = addDays(now.date, 550);
  const events: IcsEvent[] = [];

  if (feed !== "visits") {
    for (const o of await occurrencesBetween(c.env.DB, from, to)) {
      events.push({
        // Repeating events are written as individual occurrences with their own ids.
        uid: o.repeat === "none" ? o.uid : `${o.occ.replace(/-/g, "")}-${o.uid}`,
        title: `${CATEGORY_EMOJI[o.category]} ${o.title}`,
        date: o.occ,
        endDate: o.occEnd,
        start: o.start,
        end: o.end,
        location: o.location,
        description: o.notes,
      });
    }
  }

  if (feed !== "family") {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM visits WHERE status = 'confirmed' AND date >= ? AND date <= ? ORDER BY date, start_time",
    )
      .bind(from, to)
      .all<Record<string, any>>();
    const origin = new URL(c.req.url).origin;
    for (const v of results) {
      const title =
        v.kind === "meal"
          ? `🍲 ${de ? "Essen" : "Meal"}: ${v.name}${v.bring ? ` – ${v.bring}` : ""}`
          : `☕ ${de ? "Besuch" : "Visit"}: ${v.name}${v.party_size > 1 ? ` (${v.party_size})` : ""}`;
      events.push({
        uid: `visit-${v.id}@nestchen`,
        title,
        date: v.date,
        start: v.start_time,
        end: v.end_time,
        description: [v.contact, v.message].filter(Boolean).join("\n"),
        url: `${origin}/family/visits`,
        updatedAt: v.updated_at,
      });
    }
  }

  const label = { family: de ? "Termine" : "Appointments", visits: de ? "Besuche" : "Visits", all: "" }[feed];
  const name = label ? `${s.site_name} · ${label}` : s.site_name;
  return new Response(buildIcs(events, { name, tz: s.timezone }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${feed}.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
});

export default app;
