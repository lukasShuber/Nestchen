// Everything guests can do: see free slots, request a visit or meal, suggest a
// time, follow their request via a private link, and reserve wishlist items.
import { Hono } from "hono";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";
import { addDays, zonedNow } from "../../shared/dates";
import { buildIcs } from "../../shared/ics";
import type { Proposal, PublicInfo, PublicSlot, PublicVisit, PublicWishlist, SlotKind } from "../../shared/types";
import { currentUser } from "../auth";
import { lang, loadSettings, mapVisit, texts } from "../db";
import type { SettingsMap } from "../db";
import { notify, notifyText, when } from "../notify";
import type { AppEnv } from "../types";
import {
  ApiError,
  clientKey,
  date,
  hmacHex,
  int,
  invalid,
  oneOf,
  parseJson,
  rateLimit,
  randomToken,
  readJson,
  safeEqual,
  str,
  text,
  time,
} from "../util";

const app = new Hono<AppEnv>();

const GUEST_COOKIE = "nest_guest";
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const normalizeCode = (code: string) => code.trim().toLowerCase();
const guestCookieValue = (s: SettingsMap) => hmacHex(s.app_secret, "guest:" + normalizeCode(s.guest_code));

app.use("*", async (c, next) => {
  const s = await loadSettings(c.env.DB);
  c.set("settings", s);
  let unlocked = true;
  if (s.guest_code) {
    const cookie = getCookie(c, GUEST_COOKIE);
    unlocked = !!cookie && safeEqual(cookie, await guestCookieValue(s));
    // Logged-in parents never need the family code.
    if (!unlocked) unlocked = !!(await currentUser(c));
  }
  c.set("unlocked", unlocked);
  await next();
});

/** Blocks access to the page content while the optional family code is missing. */
const guard = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("unlocked")) throw new ApiError(401, "locked");
  await next();
});

const origin = (url: string) => new URL(url).origin;

app.get("/info", (c) => {
  const s = c.get("settings");
  const info: PublicInfo = { locked: !c.get("unlocked"), siteName: s.site_name, defaultLang: lang(s) };
  if (!info.locked) {
    info.texts = texts(s);
    info.features = {
      visits: s.show_visits === "1",
      meals: s.show_meals === "1",
      wishlist: s.show_wishlist === "1",
    };
    info.tz = s.timezone;
    info.now = zonedNow(s.timezone);
  }
  return c.json(info);
});

app.post("/unlock", async (c) => {
  const s = c.get("settings");
  if (!s.guest_code) return c.json({ ok: true });
  const body = await readJson(c);
  await rateLimit(c.env.DB, "unlock:" + (await clientKey(c, s.app_secret)), 12, 15 * 60_000);
  const code = typeof body.code === "string" ? normalizeCode(body.code) : "";
  if (!code || !safeEqual(code, normalizeCode(s.guest_code))) throw new ApiError(403, "wrong_code");
  setCookie(c, GUEST_COOKIE, await guestCookieValue(s), {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: 365 * 86_400,
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- visits & meals

function enabledKinds(s: SettingsMap): SlotKind[] {
  const kinds: SlotKind[] = [];
  if (s.show_visits === "1") kinds.push("visit");
  if (s.show_meals === "1") kinds.push("meal");
  return kinds;
}

app.get("/slots", guard, async (c) => {
  const s = c.get("settings");
  const now = zonedNow(s.timezone);
  const kinds = enabledKinds(s);
  if (!kinds.length) return c.json({ slots: [], now });
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM visits v WHERE v.slot_id = s.id AND v.status IN ('pending', 'confirmed')) AS booked
     FROM slots s WHERE s.date >= ? AND s.date <= ? ORDER BY s.date, s.start_time LIMIT 1500`,
  )
    .bind(now.date, addDays(now.date, 400))
    .all<Record<string, any>>();
  const slots: PublicSlot[] = results
    .filter((r) => kinds.includes(r.kind) && !(r.date === now.date && r.start_time <= now.time))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      date: r.date,
      start: r.start_time,
      end: r.end_time,
      note: r.note,
      capacity: r.capacity,
      free: Math.max(0, r.capacity - r.booked),
    }));
  return c.json({ slots, now });
});

function parseProposals(raw: unknown, today: string): Proposal[] {
  if (!Array.isArray(raw)) throw invalid("proposals");
  const out: Proposal[] = [];
  for (const p of raw.slice(0, 3)) {
    if (!p || typeof p !== "object") continue;
    const entry = p as Record<string, unknown>;
    const d = date(entry.date, "proposals");
    if (!d) continue;
    if (d < today || d > addDays(today, 400)) throw invalid("proposals", "out_of_range");
    const start = time(entry.start, "proposals");
    const end = start ? time(entry.end, "proposals") : null;
    if (start && end && end <= start) throw invalid("proposals", "end_before_start");
    out.push({ date: d, start, end });
  }
  if (!out.length) throw invalid("proposals", "required");
  return out;
}

app.post("/requests", guard, async (c) => {
  const s = c.get("settings");
  const body = await readJson(c);
  // Honeypot field: real people never fill it in, simple spam bots do.
  if (body.website) return c.json({ token: randomToken(18), status: "pending" });

  const kind = oneOf(body.kind, "kind", ["visit", "meal"] as const);
  if (!enabledKinds(s).includes(kind)) throw new ApiError(400, "disabled");
  const name = str(body.name, "name", 80, true);
  const contact = str(body.contact, "contact", 120);
  const partySize = kind === "visit" ? int(body.partySize, "partySize", 1, 20, 1) : 1;
  const message = text(body.message, "message", 1000);
  const bring = kind === "meal" ? str(body.bring, "bring", 200) : "";
  const guestLang = body.lang === "en" ? "en" : "de";
  const now = zonedNow(s.timezone);
  const ts = Date.now();
  const token = randomToken(18);
  const ipHash = await clientKey(c, s.app_secret);
  await rateLimit(c.env.DB, "request:" + ipHash, 10, 3_600_000);
  const T = notifyText(s);
  const people = kind === "visit" ? ` (${T.persons(partySize)})` : bring ? ` – ${bring}` : "";

  if (body.slotId != null && body.slotId !== "") {
    const slotId = int(body.slotId, "slotId", 1, Number.MAX_SAFE_INTEGER);
    const slot = await c.env.DB.prepare("SELECT * FROM slots WHERE id = ?").bind(slotId).first<Record<string, any>>();
    if (!slot || slot.kind !== kind) throw new ApiError(404, "slot_not_found");
    if (slot.date < now.date || (slot.date === now.date && slot.start_time <= now.time)) {
      throw new ApiError(409, "slot_past");
    }
    const status = s.auto_confirm === "1" ? "confirmed" : "pending";
    // Insert only while the slot still has room (atomic, so two guests can't take the last spot).
    const res = await c.env.DB.prepare(
      `INSERT INTO visits (token, kind, source, slot_id, status, name, contact, party_size, message, bring, proposals,
                           date, start_time, end_time, lang, ip_hash, created_at, updated_at)
       SELECT ?, ?, 'slot', s.id, ?, ?, ?, ?, ?, ?, '[]', s.date, s.start_time, s.end_time, ?, ?, ?, ?
       FROM slots s
       WHERE s.id = ? AND (SELECT COUNT(*) FROM visits v WHERE v.slot_id = s.id AND v.status IN ('pending', 'confirmed')) < s.capacity`,
    )
      .bind(token, kind, status, name, contact, partySize, message, bring, guestLang, ipHash, ts, ts, slotId)
      .run();
    if (!res.meta.changes) throw new ApiError(409, "slot_full");
    c.executionCtx.waitUntil(
      notify(s, {
        title: kind === "meal" ? T.meal : T.visit,
        message: `${name}${people} · ${when(s, slot.date, slot.start_time, slot.end_time)}`,
        tags: [kind === "meal" ? "stew" : "coffee"],
        click: `${origin(c.req.url)}/family/visits`,
      }),
    );
    return c.json({ token, status });
  }

  const proposals = parseProposals(body.proposals, now.date);
  await c.env.DB.prepare(
    `INSERT INTO visits (token, kind, source, status, name, contact, party_size, message, bring, proposals, lang, ip_hash, created_at, updated_at)
     VALUES (?, ?, 'proposal', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(token, kind, name, contact, partySize, message, bring, JSON.stringify(proposals), guestLang, ipHash, ts, ts)
    .run();
  c.executionCtx.waitUntil(
    notify(s, {
      title: kind === "meal" ? T.meal : T.visit,
      message: `${name}${people} ${T.proposals}: ${proposals.map((p) => when(s, p.date, p.start, p.end)).join(" / ")}`,
      tags: [kind === "meal" ? "stew" : "coffee"],
      click: `${origin(c.req.url)}/family/visits`,
    }),
  );
  return c.json({ token, status: "pending" });
});

async function findVisit(c: Context<AppEnv>) {
  const token = c.req.param("token") ?? "";
  if (!TOKEN_RE.test(token)) throw new ApiError(404, "not_found");
  const row = await c.env.DB.prepare("SELECT * FROM visits WHERE token = ?").bind(token).first<Record<string, any>>();
  if (!row) throw new ApiError(404, "not_found");
  return row;
}

const toPublicVisit = (row: Record<string, any>): PublicVisit => {
  const v = mapVisit(row);
  return {
    kind: v.kind,
    status: v.status,
    source: v.source,
    name: v.name,
    partySize: v.partySize,
    message: v.message,
    bring: v.bring,
    proposals: v.proposals,
    date: v.date,
    start: v.start,
    end: v.end,
    reply: v.reply,
    createdAt: v.createdAt,
  };
};

app.get("/requests/:token", async (c) => {
  const s = c.get("settings");
  const row = await findVisit(c);
  const t = texts(s);
  return c.json({
    visit: toPublicVisit(row),
    siteName: s.site_name,
    tz: s.timezone,
    now: zonedNow(s.timezone),
    texts: { visitRules: t.visitRules, mealNotes: t.mealNotes },
  });
});

app.post("/requests/:token/cancel", async (c) => {
  const s = c.get("settings");
  const row = await findVisit(c);
  if (row.status !== "pending" && row.status !== "confirmed") throw new ApiError(409, "cannot_cancel");
  await c.env.DB.prepare("UPDATE visits SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run();
  const T = notifyText(s);
  c.executionCtx.waitUntil(
    notify(s, {
      title: T.cancelled,
      message: `${row.name}${row.date ? " · " + when(s, row.date, row.start_time, row.end_time) : ""}`,
      tags: ["x"],
      click: `${origin(c.req.url)}/family/visits`,
    }),
  );
  return c.json({ visit: toPublicVisit({ ...row, status: "cancelled" }) });
});

app.get("/requests/:token/ics", async (c) => {
  const s = c.get("settings");
  const row = await findVisit(c);
  if (row.status !== "confirmed" || !row.date) throw new ApiError(404, "not_found");
  const de = (c.req.query("lang") ?? row.lang) !== "en";
  const label = row.kind === "meal" ? (de ? "Essen vorbeibringen" : "Bring a meal") : de ? "Besuch" : "Visit";
  const title = `${label} · ${s.site_name}`;
  const link = `${origin(c.req.url)}/r/${row.token}`;
  const ics = buildIcs(
    [
      {
        uid: `visit-${row.id}-${String(row.token).slice(0, 8)}@nestchen`,
        title,
        date: row.date,
        start: row.start_time,
        end: row.end_time,
        description: link,
        url: link,
        status: "CONFIRMED",
        updatedAt: row.updated_at,
      },
    ],
    { name: title, tz: s.timezone },
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${row.kind === "meal" ? "meal" : "visit"}.ics"`,
    },
  });
});

// ---------------------------------------------------------------- wishlist

app.get("/wishlist", guard, async (c) => {
  const s = c.get("settings");
  if (s.show_wishlist !== "1") return c.json({ lists: [] });
  const [lists, items] = await c.env.DB.batch<Record<string, any>>([
    c.env.DB.prepare("SELECT id, title, emoji FROM lists WHERE kind = 'wishlist' AND is_public = 1 ORDER BY position, id"),
    c.env.DB.prepare(
      `SELECT i.*, (SELECT COALESCE(SUM(quantity), 0) FROM claims c WHERE c.item_id = i.id) AS taken
       FROM items i JOIN lists l ON l.id = i.list_id
       WHERE l.kind = 'wishlist' AND l.is_public = 1 AND i.done = 0
       ORDER BY i.priority DESC, i.position, i.id`,
    ),
  ]);
  const result: PublicWishlist[] = lists.results.map((l) => ({ id: l.id, title: l.title, emoji: l.emoji, items: [] }));
  const byId = new Map(result.map((l) => [l.id, l]));
  for (const r of items.results) {
    byId.get(r.list_id)?.items.push({
      id: r.id,
      title: r.title,
      notes: r.notes,
      url: r.url,
      price: r.price,
      quantity: r.quantity,
      priority: r.priority,
      tags: parseJson(r.tags, []),
      taken: Math.min(r.taken, r.quantity),
    });
  }
  return c.json({ lists: result });
});

app.post("/wishlist/:id/claim", guard, async (c) => {
  const s = c.get("settings");
  if (s.show_wishlist !== "1") throw new ApiError(400, "disabled");
  const body = await readJson(c);
  const token = randomToken(18);
  if (body.website) return c.json({ token });
  const itemId = int(c.req.param("id"), "id", 1, Number.MAX_SAFE_INTEGER);
  const name = str(body.name, "name", 80, true);
  const quantity = int(body.quantity, "quantity", 1, 99, 1);
  const message = text(body.message, "message", 500);
  const ipHash = await clientKey(c, s.app_secret);
  await rateLimit(c.env.DB, "claim:" + ipHash, 20, 3_600_000);
  const res = await c.env.DB.prepare(
    `INSERT INTO claims (item_id, token, name, quantity, message, ip_hash, created_at)
     SELECT i.id, ?, ?, ?, ?, ?, ? FROM items i JOIN lists l ON l.id = i.list_id
     WHERE i.id = ? AND l.kind = 'wishlist' AND l.is_public = 1 AND i.done = 0
       AND (SELECT COALESCE(SUM(quantity), 0) FROM claims c WHERE c.item_id = i.id) + ? <= i.quantity`,
  )
    .bind(token, name, quantity, message, ipHash, Date.now(), itemId, quantity)
    .run();
  if (!res.meta.changes) throw new ApiError(409, "not_available");
  const item = await c.env.DB.prepare("SELECT title FROM items WHERE id = ?").bind(itemId).first<{ title: string }>();
  const T = notifyText(s);
  c.executionCtx.waitUntil(
    notify(s, {
      title: T.claim,
      message: `${item?.title ?? ""}${quantity > 1 ? ` ×${quantity}` : ""} – ${name}`,
      tags: ["gift"],
      click: `${origin(c.req.url)}/family/thanks`,
    }),
  );
  return c.json({ token });
});

app.delete("/claims/:token", async (c) => {
  const s = c.get("settings");
  const token = c.req.param("token");
  if (!TOKEN_RE.test(token)) throw new ApiError(404, "not_found");
  const row = await c.env.DB.prepare(
    "SELECT c.*, i.title FROM claims c JOIN items i ON i.id = c.item_id WHERE c.token = ?",
  )
    .bind(token)
    .first<Record<string, any>>();
  if (!row) throw new ApiError(404, "not_found");
  if (row.received) throw new ApiError(409, "already_received");
  await c.env.DB.prepare("DELETE FROM claims WHERE id = ?").bind(row.id).run();
  const T = notifyText(s);
  c.executionCtx.waitUntil(
    notify(s, { title: T.unclaim, message: `${row.title} – ${row.name}`, tags: ["leftwards_arrow_with_hook"] }),
  );
  return c.json({ ok: true });
});

export default app;
