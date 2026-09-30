// The private API for the parents. Every route requires a valid login session.
import { Hono } from "hono";
import type { Context } from "hono";
import { REPEATS, addDays, diffDays, isValidTimeZone, zonedNow } from "../../shared/dates";
import { MAX_SLOTS_PER_BATCH, generateSlots } from "../../shared/slots";
import { CATEGORIES, LIST_KINDS, TEXT_KEYS, USER_COLORS } from "../../shared/types";
import type { HomeData, ThanksEntry } from "../../shared/types";
import { currentUser, hashPassword, validPassword, validUsername, verifyPassword } from "../auth";
import {
  loadSettings,
  mapClaim,
  mapItem,
  mapList,
  mapUser,
  mapVisit,
  saveSettings,
  settingsForAdmin,
  textKey,
} from "../db";
import { notify, notifyText } from "../notify";
import { occurrencesBetween, slotsBetween } from "../queries";
import { registerFeedingRoutes } from "./feedings";
import type { AppEnv } from "../types";
import {
  ApiError,
  bool,
  date,
  int,
  invalid,
  oneOf,
  randomToken,
  readJson,
  str,
  tags,
  text,
  time,
  url,
} from "../util";

const app = new Hono<AppEnv>();
const MAX_ID = Number.MAX_SAFE_INTEGER;

app.use("*", async (c, next) => {
  const session = await currentUser(c);
  if (!session) throw new ApiError(401, "unauthorized");
  c.set("user", session.user);
  c.set("sessionId", session.sessionId);
  c.set("settings", await loadSettings(c.env.DB));
  await next();
});

registerFeedingRoutes(app);

const idParam = (c: Context<AppEnv>) => int(c.req.param("id"), "id", 1, MAX_ID);
const today = (c: Context<AppEnv>) => zonedNow(c.get("settings").timezone);

/** UPDATE with column names that come from this file only (never from user input). */
async function updateRow(db: D1Database, table: string, id: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await db
    .prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...keys.map((k) => fields[k] ?? null), id)
    .run();
}

async function mustExist(db: D1Database, table: string, id: number): Promise<Record<string, any>> {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Record<string, any>>();
  if (!row) throw new ApiError(404, "not_found");
  return row;
}

const allUsers = async (db: D1Database) =>
  (await db.prepare("SELECT * FROM users ORDER BY id").all<Record<string, any>>()).results.map(mapUser);

// ---------------------------------------------------------------- home & badges

app.get("/home", async (c) => {
  const db = c.env.DB;
  const s = c.get("settings");
  const me = c.get("user");
  const now = today(c);
  const [visits, pending, todos, counts, todoList] = await db.batch<Record<string, any>>([
    db
      .prepare(
        "SELECT * FROM visits WHERE status = 'confirmed' AND date >= ? AND date <= ? ORDER BY date, start_time LIMIT 30",
      )
      .bind(now.date, addDays(now.date, 14)),
    db.prepare("SELECT * FROM visits WHERE status = 'pending' ORDER BY created_at LIMIT 30"),
    db
      .prepare(
        `SELECT i.*, l.title AS list_title, l.emoji AS list_emoji FROM items i JOIN lists l ON l.id = i.list_id
         WHERE l.kind = 'todo' AND i.done = 0 AND ((i.due_date IS NOT NULL AND i.due_date <= ?) OR i.assignee_id = ? OR i.priority > 0)
         ORDER BY i.due_date IS NULL, i.due_date, i.priority DESC, i.id LIMIT 12`,
      )
      .bind(addDays(now.date, 7), me.id),
    db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM items i JOIN lists l ON l.id = i.list_id WHERE l.kind = 'todo' AND i.done = 0) AS open_todos,
        (SELECT COUNT(*) FROM claims WHERE thanked = 0) +
        (SELECT COUNT(*) FROM items i JOIN lists l ON l.id = i.list_id WHERE l.kind = 'gifts' AND i.done = 0) AS thanks_open`,
    ),
    db.prepare("SELECT id FROM lists WHERE kind = 'todo' ORDER BY position, id LIMIT 1"),
  ]);
  const data: HomeData = {
    now,
    events: await occurrencesBetween(db, now.date, addDays(now.date, 7)),
    visits: visits.results.map(mapVisit),
    pending: pending.results.map(mapVisit),
    todos: todos.results.map((r) => ({ ...mapItem(r), listTitle: r.list_title, listEmoji: r.list_emoji })),
    openTodos: counts.results[0]?.open_todos ?? 0,
    thanksOpen: counts.results[0]?.thanks_open ?? 0,
    birthDate: s.birth_date,
    todoListId: todoList.results[0]?.id ?? null,
  };
  return c.json(data);
});

app.get("/badges", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM visits WHERE status = 'pending') AS pending,
            (SELECT COUNT(*) FROM claims WHERE thanked = 0) +
            (SELECT COUNT(*) FROM items i JOIN lists l ON l.id = i.list_id WHERE l.kind = 'gifts' AND i.done = 0) AS thanks`,
  ).first<{ pending: number; thanks: number }>();
  return c.json({ pending: row?.pending ?? 0, thanks: row?.thanks ?? 0 });
});

// ---------------------------------------------------------------- calendar & events

app.get("/calendar", async (c) => {
  const from = date(c.req.query("from"), "from", true)!;
  const to = date(c.req.query("to"), "to", true)!;
  if (to < from || diffDays(from, to) > 400) throw invalid("to");
  const db = c.env.DB;
  const visits = await db
    .prepare(
      "SELECT * FROM visits WHERE date >= ? AND date <= ? AND status IN ('pending', 'confirmed') ORDER BY date, start_time",
    )
    .bind(from, to)
    .all<Record<string, any>>();
  return c.json({
    events: await occurrencesBetween(db, from, to),
    visits: visits.results.map(mapVisit),
    slots: await slotsBetween(db, from, to),
  });
});

function readEvent(body: Record<string, unknown>) {
  const title = str(body.title, "title", 120, true);
  const category = oneOf(body.category, "category", CATEGORIES, "other");
  const day = date(body.date, "date", true)!;
  const start = time(body.start, "start");
  const end = start ? time(body.end, "end") : null;
  const endDate = start ? null : date(body.endDate, "endDate");
  if (endDate && (endDate < day || diffDays(day, endDate) > 366)) throw invalid("endDate");
  const repeat = oneOf(body.repeat, "repeat", REPEATS, "none");
  const repeatUntil = repeat === "none" ? null : date(body.repeatUntil, "repeatUntil");
  if (repeatUntil && repeatUntil < day) throw invalid("repeatUntil");
  return {
    title,
    category,
    date: day,
    end_date: endDate && endDate > day ? endDate : null,
    start_time: start,
    end_time: end,
    location: str(body.location, "location", 200),
    notes: text(body.notes, "notes", 4000),
    repeat,
    repeat_until: repeatUntil,
  };
}

app.post("/events", async (c) => {
  const e = readEvent(await readJson(c));
  const now = Date.now();
  const res = await c.env.DB.prepare(
    `INSERT INTO events (uid, title, category, date, end_date, start_time, end_time, location, notes, repeat, repeat_until, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `${randomToken(12)}@nestchen`,
      e.title,
      e.category,
      e.date,
      e.end_date,
      e.start_time,
      e.end_time,
      e.location,
      e.notes,
      e.repeat,
      e.repeat_until,
      c.get("user").id,
      now,
      now,
    )
    .run();
  return c.json({ id: res.meta.last_row_id });
});

app.put("/events/:id", async (c) => {
  const id = idParam(c);
  await mustExist(c.env.DB, "events", id);
  const e = readEvent(await readJson(c));
  await updateRow(c.env.DB, "events", id, { ...e, updated_at: Date.now() });
  return c.json({ id });
});

app.delete("/events/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM events WHERE id = ?").bind(idParam(c)).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- slots

app.get("/slots", async (c) => {
  const now = today(c);
  const from = date(c.req.query("from"), "from") ?? now.date;
  const to = date(c.req.query("to"), "to") ?? addDays(now.date, 400);
  return c.json({ slots: await slotsBetween(c.env.DB, from, to) });
});

app.post("/slots", async (c) => {
  const body = await readJson(c);
  const kind = oneOf(body.kind, "kind", ["visit", "meal"] as const);
  const from = date(body.from, "from", true)!;
  const to = date(body.to, "to", true)!;
  if (to < from || diffDays(from, to) > 366) throw invalid("to");
  const weekdays = Array.isArray(body.weekdays)
    ? body.weekdays.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6)
    : [];
  const start = time(body.start, "start", true)!;
  const end = time(body.end, "end", true)!;
  if (end <= start) throw invalid("end", "end_before_start");
  const split = int(body.split, "split", 0, 720, 0);
  const capacity = int(body.capacity, "capacity", 1, 20, 1);
  const note = str(body.note, "note", 200);
  const slots = generateSlots({ from, to, weekdays, start, end, split });
  if (!slots.length) throw invalid("weekdays", "no_slots");
  if (slots.length > MAX_SLOTS_PER_BATCH) throw invalid("to", "too_many");
  const db = c.env.DB;
  const now = Date.now();
  for (let i = 0; i < slots.length; i += 50) {
    await db.batch(
      slots
        .slice(i, i + 50)
        .map((s) =>
          db
            .prepare(
              "INSERT INTO slots (kind, date, start_time, end_time, capacity, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(kind, s.date, s.start, s.end, capacity, note, now),
        ),
    );
  }
  return c.json({ created: slots.length });
});

app.put("/slots/:id", async (c) => {
  const id = idParam(c);
  await mustExist(c.env.DB, "slots", id);
  const body = await readJson(c);
  const day = date(body.date, "date", true)!;
  const start = time(body.start, "start", true)!;
  const end = time(body.end, "end", true)!;
  if (end <= start) throw invalid("end", "end_before_start");
  const fields = {
    kind: oneOf(body.kind, "kind", ["visit", "meal"] as const),
    date: day,
    start_time: start,
    end_time: end,
    capacity: int(body.capacity, "capacity", 1, 20, 1),
    note: str(body.note, "note", 200),
  };
  // Guests who booked this slot move along with it.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE slots SET kind = ?, date = ?, start_time = ?, end_time = ?, capacity = ?, note = ? WHERE id = ?",
    ).bind(fields.kind, day, start, end, fields.capacity, fields.note, id),
    c.env.DB.prepare(
      "UPDATE visits SET date = ?, start_time = ?, end_time = ?, updated_at = ? WHERE slot_id = ? AND status IN ('pending', 'confirmed')",
    ).bind(day, start, end, Date.now(), id),
  ]);
  return c.json({ id });
});

app.delete("/slots/:id", async (c) => {
  // Visits that were booked on this slot keep their date and time.
  await c.env.DB.prepare("DELETE FROM slots WHERE id = ?").bind(idParam(c)).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- visits

app.get("/visits", async (c) => {
  const scope = oneOf(c.req.query("scope"), "scope", ["open", "upcoming", "past"] as const, "open");
  const now = today(c);
  const db = c.env.DB;
  const query = {
    open: db.prepare("SELECT * FROM visits WHERE status = 'pending' ORDER BY created_at"),
    upcoming: db
      .prepare("SELECT * FROM visits WHERE status = 'confirmed' AND date >= ? ORDER BY date, start_time")
      .bind(now.date),
    past: db
      .prepare(
        `SELECT * FROM visits WHERE (status = 'confirmed' AND date < ?) OR status IN ('declined', 'cancelled')
         ORDER BY COALESCE(date, '') DESC, updated_at DESC LIMIT 200`,
      )
      .bind(now.date),
  }[scope];
  const { results } = await query.all<Record<string, any>>();
  return c.json({ visits: results.map(mapVisit) });
});

app.get("/visits/:id", async (c) => {
  return c.json({ visit: mapVisit(await mustExist(c.env.DB, "visits", idParam(c))) });
});

function readVisitPatch(body: Record<string, unknown>) {
  const u: Record<string, unknown> = {};
  if ("status" in body) u.status = oneOf(body.status, "status", ["pending", "confirmed", "declined", "cancelled"] as const);
  if ("kind" in body) u.kind = oneOf(body.kind, "kind", ["visit", "meal"] as const);
  if ("date" in body) u.date = date(body.date, "date");
  if ("start" in body) u.start_time = time(body.start, "start");
  if ("end" in body) u.end_time = time(body.end, "end");
  if ("reply" in body) u.reply = text(body.reply, "reply", 1000);
  if ("name" in body) u.name = str(body.name, "name", 80, true);
  if ("contact" in body) u.contact = str(body.contact, "contact", 120);
  if ("partySize" in body) u.party_size = int(body.partySize, "partySize", 1, 20);
  if ("message" in body) u.message = text(body.message, "message", 1000);
  if ("bring" in body) u.bring = str(body.bring, "bring", 200);
  return u;
}

function checkVisit(v: Record<string, any>) {
  if (v.status === "confirmed" && !v.date) throw invalid("date", "required");
  if (v.start_time && v.end_time && v.end_time <= v.start_time) throw invalid("end", "end_before_start");
  if (!v.start_time && v.end_time) throw invalid("start", "required");
}

app.post("/visits", async (c) => {
  const body = await readJson(c);
  const v: Record<string, any> = {
    status: "confirmed",
    kind: "visit",
    party_size: 1,
    contact: "",
    message: "",
    bring: "",
    reply: "",
    ...readVisitPatch(body),
  };
  if (!v.name) throw invalid("name", "required");
  if (!v.date) throw invalid("date", "required");
  checkVisit(v);
  const now = Date.now();
  const res = await c.env.DB.prepare(
    `INSERT INTO visits (token, kind, source, status, name, contact, party_size, message, bring, date, start_time, end_time, reply, lang, created_at, updated_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomToken(18),
      v.kind,
      v.status,
      v.name,
      v.contact,
      v.party_size,
      v.message,
      v.bring,
      v.date,
      v.start_time ?? null,
      v.end_time ?? null,
      v.reply,
      body.lang === "en" ? "en" : c.get("settings").default_lang === "en" ? "en" : "de",
      now,
      now,
    )
    .run();
  const row = await mustExist(c.env.DB, "visits", res.meta.last_row_id);
  return c.json({ visit: mapVisit(row) });
});

app.patch("/visits/:id", async (c) => {
  const id = idParam(c);
  const row = await mustExist(c.env.DB, "visits", id);
  const updates = readVisitPatch(await readJson(c));
  const merged = { ...row, ...updates };
  checkVisit(merged);
  // Moving a visit away from its slot frees the slot for someone else.
  if (
    row.slot_id &&
    (merged.date !== row.date || merged.start_time !== row.start_time || merged.end_time !== row.end_time)
  ) {
    updates.slot_id = null;
  }
  await updateRow(c.env.DB, "visits", id, { ...updates, updated_at: Date.now() });
  return c.json({ visit: mapVisit(await mustExist(c.env.DB, "visits", id)) });
});

app.delete("/visits/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM visits WHERE id = ?").bind(idParam(c)).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- lists & items

app.get("/lists", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.*,
       (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id AND i.done = 0) AS open,
       (SELECT COUNT(*) FROM items i WHERE i.list_id = l.id) AS total
     FROM lists l ORDER BY l.position, l.id`,
  ).all<Record<string, any>>();
  return c.json({ lists: results.map(mapList) });
});

function readList(body: Record<string, unknown>) {
  const kind = oneOf(body.kind, "kind", LIST_KINDS, "todo");
  return {
    title: str(body.title, "title", 60, true),
    kind,
    emoji: str(body.emoji, "emoji", 16),
    is_public: kind === "wishlist" && bool(body.isPublic) ? 1 : 0,
  };
}

app.post("/lists", async (c) => {
  const l = readList(await readJson(c));
  const now = Date.now();
  const res = await c.env.DB.prepare(
    `INSERT INTO lists (title, kind, emoji, is_public, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM lists), ?, ?)`,
  )
    .bind(l.title, l.kind, l.emoji, l.is_public, now, now)
    .run();
  return c.json({ id: res.meta.last_row_id });
});

app.put("/lists/:id", async (c) => {
  const id = idParam(c);
  await mustExist(c.env.DB, "lists", id);
  await updateRow(c.env.DB, "lists", id, { ...readList(await readJson(c)), updated_at: Date.now() });
  return c.json({ id });
});

app.delete("/lists/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM lists WHERE id = ?").bind(idParam(c)).run();
  return c.json({ ok: true });
});

app.post("/lists/order", async (c) => {
  const body = await readJson(c);
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)).slice(0, 200) : [];
  if (ids.length) {
    await c.env.DB.batch(
      ids.map((id, i) => c.env.DB.prepare("UPDATE lists SET position = ? WHERE id = ?").bind(i, id)),
    );
  }
  return c.json({ ok: true });
});

app.get("/lists/:id", async (c) => {
  const id = idParam(c);
  const list = await mustExist(c.env.DB, "lists", id);
  const [items, claims] = await c.env.DB.batch<Record<string, any>>([
    c.env.DB.prepare("SELECT * FROM items WHERE list_id = ? ORDER BY position, id").bind(id),
    c.env.DB.prepare(
      "SELECT c.* FROM claims c JOIN items i ON i.id = c.item_id WHERE i.list_id = ? ORDER BY c.created_at",
    ).bind(id),
  ]);
  const byItem = new Map<number, ReturnType<typeof mapClaim>[]>();
  for (const r of claims.results) {
    const list = byItem.get(r.item_id) ?? [];
    list.push(mapClaim(r));
    byItem.set(r.item_id, list);
  }
  return c.json({
    list: mapList(list),
    items: items.results.map((r) => ({ ...mapItem(r), claims: byItem.get(r.id) ?? [] })),
  });
});

async function readItemPatch(db: D1Database, body: Record<string, unknown>) {
  const u: Record<string, unknown> = {};
  if ("title" in body) u.title = str(body.title, "title", 200, true);
  if ("notes" in body) u.notes = text(body.notes, "notes", 4000);
  if ("url" in body) u.url = url(body.url, "url");
  if ("price" in body) u.price = str(body.price, "price", 40);
  if ("quantity" in body) u.quantity = int(body.quantity, "quantity", 1, 999);
  if ("priority" in body) u.priority = bool(body.priority) ? 1 : 0;
  if ("tags" in body) u.tags = JSON.stringify(tags(body.tags));
  if ("done" in body) {
    u.done = bool(body.done) ? 1 : 0;
    u.done_at = u.done ? Date.now() : null;
  }
  if ("dueDate" in body) u.due_date = date(body.dueDate, "dueDate");
  if ("phone" in body) u.phone = str(body.phone, "phone", 40);
  if ("person" in body) u.person = str(body.person, "person", 80);
  if ("assigneeId" in body) {
    u.assignee_id = body.assigneeId == null || body.assigneeId === "" ? null : int(body.assigneeId, "assigneeId", 1, MAX_ID);
    if (u.assignee_id != null) await mustExist(db, "users", u.assignee_id as number).catch(() => {
      throw invalid("assigneeId");
    });
  }
  if ("listId" in body) {
    u.list_id = int(body.listId, "listId", 1, MAX_ID);
    await mustExist(db, "lists", u.list_id as number).catch(() => {
      throw invalid("listId");
    });
  }
  return u;
}

app.post("/lists/:id/items", async (c) => {
  const listId = idParam(c);
  await mustExist(c.env.DB, "lists", listId);
  const fields = await readItemPatch(c.env.DB, await readJson(c));
  if (!fields.title) throw invalid("title", "required");
  const now = Date.now();
  const item = { ...fields, list_id: listId, created_at: now, updated_at: now };
  const keys = Object.keys(item);
  const res = await c.env.DB.prepare(
    `INSERT INTO items (${keys.join(", ")}, position)
     VALUES (${keys.map(() => "?").join(", ")}, (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE list_id = ?))`,
  )
    .bind(...keys.map((k) => (item as Record<string, unknown>)[k] ?? null), listId)
    .run();
  const row = await mustExist(c.env.DB, "items", res.meta.last_row_id);
  return c.json({ item: { ...mapItem(row), claims: [] } });
});

app.patch("/items/:id", async (c) => {
  const id = idParam(c);
  await mustExist(c.env.DB, "items", id);
  const fields = await readItemPatch(c.env.DB, await readJson(c));
  await updateRow(c.env.DB, "items", id, { ...fields, updated_at: Date.now() });
  return c.json({ item: mapItem(await mustExist(c.env.DB, "items", id)) });
});

app.delete("/items/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM items WHERE id = ?").bind(idParam(c)).run();
  return c.json({ ok: true });
});

app.post("/lists/:id/clear-done", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM items WHERE list_id = ? AND done = 1").bind(idParam(c)).run();
  return c.json({ removed: res.meta.changes });
});

app.post("/lists/:id/order", async (c) => {
  const listId = idParam(c);
  const body = await readJson(c);
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)).slice(0, 1000) : [];
  for (let i = 0; i < ids.length; i += 100) {
    await c.env.DB.batch(
      ids
        .slice(i, i + 100)
        .map((id, j) =>
          c.env.DB.prepare("UPDATE items SET position = ? WHERE id = ? AND list_id = ?").bind(i + j, id, listId),
        ),
    );
  }
  return c.json({ ok: true });
});

app.get("/tags", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT DISTINCT j.value AS tag FROM items, json_each(items.tags) j ORDER BY j.value COLLATE NOCASE LIMIT 200",
  ).all<{ tag: string }>();
  return c.json({ tags: results.map((r) => r.tag) });
});

// ---------------------------------------------------------------- reservations & thank-yous

function readClaimPatch(body: Record<string, unknown>) {
  const u: Record<string, unknown> = {};
  if ("name" in body) u.name = str(body.name, "name", 80, true);
  if ("quantity" in body) u.quantity = int(body.quantity, "quantity", 1, 99);
  if ("message" in body) u.message = text(body.message, "message", 500);
  if ("received" in body) u.received = bool(body.received) ? 1 : 0;
  if ("thanked" in body) u.thanked = bool(body.thanked) ? 1 : 0;
  return u;
}

app.post("/items/:id/claims", async (c) => {
  const itemId = idParam(c);
  await mustExist(c.env.DB, "items", itemId);
  const u: Record<string, any> = { quantity: 1, message: "", received: 0, thanked: 0, ...readClaimPatch(await readJson(c)) };
  if (!u.name) throw invalid("name", "required");
  const res = await c.env.DB.prepare(
    "INSERT INTO claims (item_id, token, name, quantity, message, received, thanked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(itemId, randomToken(18), u.name, u.quantity, u.message, u.received, u.thanked, Date.now())
    .run();
  return c.json({ claim: mapClaim(await mustExist(c.env.DB, "claims", res.meta.last_row_id)) });
});

app.patch("/claims/:id", async (c) => {
  const id = idParam(c);
  await mustExist(c.env.DB, "claims", id);
  await updateRow(c.env.DB, "claims", id, readClaimPatch(await readJson(c)));
  return c.json({ claim: mapClaim(await mustExist(c.env.DB, "claims", id)) });
});

app.delete("/claims/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM claims WHERE id = ?").bind(idParam(c)).run();
  return c.json({ ok: true });
});

app.get("/thanks", async (c) => {
  const [claims, gifts] = await c.env.DB.batch<Record<string, any>>([
    c.env.DB.prepare("SELECT c.*, i.title AS item_title FROM claims c JOIN items i ON i.id = c.item_id"),
    c.env.DB.prepare("SELECT i.* FROM items i JOIN lists l ON l.id = i.list_id WHERE l.kind = 'gifts'"),
  ]);
  const entries: ThanksEntry[] = [
    ...claims.results.map((r) => ({
      type: "claim" as const,
      id: r.id,
      title: r.item_title,
      person: r.name,
      quantity: r.quantity,
      message: r.message,
      received: !!r.received,
      thanked: !!r.thanked,
      createdAt: r.created_at,
    })),
    ...gifts.results.map((r) => ({
      type: "gift" as const,
      id: r.id,
      title: r.title,
      person: r.person,
      quantity: r.quantity,
      message: r.notes,
      received: true,
      thanked: !!r.done,
      createdAt: r.created_at,
    })),
  ].sort((a, b) => Number(a.thanked) - Number(b.thanked) || b.createdAt - a.createdAt);
  return c.json({ entries });
});

app.post("/thanks/gifts", async (c) => {
  const body = await readJson(c);
  const title = str(body.title, "title", 200, true);
  const person = str(body.person, "person", 80);
  const notes = text(body.notes, "notes", 1000);
  const db = c.env.DB;
  let list = await db.prepare("SELECT id FROM lists WHERE kind = 'gifts' ORDER BY position, id LIMIT 1").first<{ id: number }>();
  const now = Date.now();
  if (!list) {
    const de = c.get("settings").default_lang !== "en";
    const res = await db
      .prepare(
        `INSERT INTO lists (title, kind, emoji, is_public, position, created_at, updated_at)
         VALUES (?, 'gifts', '🎀', 0, (SELECT COALESCE(MAX(position), -1) + 1 FROM lists), ?, ?)`,
      )
      .bind(de ? "Geschenke & Danke" : "Gifts & thank-yous", now, now)
      .run();
    list = { id: res.meta.last_row_id };
  }
  await db
    .prepare(
      `INSERT INTO items (list_id, title, person, notes, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM items WHERE list_id = ?), ?, ?)`,
    )
    .bind(list.id, title, person, notes, list.id, now, now)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- settings

function parseGcalEmbed(v: unknown, tz: string): string {
  let s = str(v, "gcalEmbed", 3000);
  if (!s) return "";
  const src = s.match(/src="([^"]+)"/);
  if (src) s = src[1].replace(/&amp;/g, "&");
  if (/^[^\s@/]+@[^\s@/]+$/.test(s)) {
    return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(s)}&ctz=${encodeURIComponent(tz)}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw invalid("gcalEmbed");
  }
  if (u.protocol !== "https:" || u.hostname !== "calendar.google.com" || !u.pathname.startsWith("/calendar/embed")) {
    throw invalid("gcalEmbed");
  }
  return u.toString();
}

app.get("/settings", async (c) => {
  return c.json({ settings: settingsForAdmin(c.get("settings")), users: await allUsers(c.env.DB) });
});

app.put("/settings", async (c) => {
  const b = await readJson(c);
  const s = c.get("settings");
  const entries: [string, string][] = [];
  const set = (key: string, value: string) => entries.push([key, value]);
  if ("siteName" in b) set("site_name", str(b.siteName, "siteName", 40, true));
  if ("defaultLang" in b) set("default_lang", oneOf(b.defaultLang, "defaultLang", ["de", "en"] as const));
  let tz = s.timezone;
  if ("timezone" in b) {
    tz = str(b.timezone, "timezone", 64, true);
    if (!isValidTimeZone(tz)) throw invalid("timezone");
    set("timezone", tz);
  }
  if ("phoneCc" in b) {
    const cc = str(b.phoneCc, "phoneCc", 5).replace(/^\+/, "");
    if (!/^\d{1,4}$/.test(cc)) throw invalid("phoneCc");
    set("phone_cc", cc);
  }
  const flags: [string, string][] = [
    ["showVisits", "show_visits"],
    ["showMeals", "show_meals"],
    ["showWishlist", "show_wishlist"],
    ["autoConfirm", "auto_confirm"],
  ];
  for (const [key, column] of flags) if (key in b) set(column, bool(b[key]) ? "1" : "0");
  if ("guestCode" in b) set("guest_code", str(b.guestCode, "guestCode", 40));
  if ("ntfyUrl" in b) {
    const u = url(b.ntfyUrl, "ntfyUrl");
    if (u && !u.startsWith("https://")) throw invalid("ntfyUrl");
    set("ntfy_url", u);
  }
  if ("gcalEmbed" in b) set("gcal_embed", parseGcalEmbed(b.gcalEmbed, tz));
  if ("birthDate" in b) set("birth_date", date(b.birthDate, "birthDate") ?? "");
  if (b.texts && typeof b.texts === "object") {
    const t = b.texts as Record<string, Record<string, unknown> | undefined>;
    for (const key of TEXT_KEYS) {
      for (const l of ["de", "en"] as const) {
        const value = t[key]?.[l];
        if (value !== undefined) set(textKey(key, l), text(value, `texts.${key}`, 3000));
      }
    }
  }
  await saveSettings(c.env.DB, entries);
  return c.json({ settings: settingsForAdmin(await loadSettings(c.env.DB)) });
});

app.post("/settings/rotate-ics", async (c) => {
  const token = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await saveSettings(c.env.DB, [["ics_token", token]]);
  return c.json({ icsToken: token });
});

app.post("/settings/test-ntfy", async (c) => {
  const s = c.get("settings");
  if (!s.ntfy_url) throw invalid("ntfyUrl", "required");
  const ok = await notify(s, { title: s.site_name, message: notifyText(s).test, tags: ["tada"] });
  if (!ok) throw new ApiError(400, "ntfy_failed");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- accounts

app.get("/users", async (c) => c.json({ users: await allUsers(c.env.DB) }));

app.post("/users", async (c) => {
  const body = await readJson(c);
  const username = validUsername(body.username);
  if (!username) throw invalid("username");
  const displayName = str(body.displayName, "displayName", 40, true);
  const password = validPassword(body.password);
  if (!password) throw invalid("password", "too_short");
  const db = c.env.DB;
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n ?? 0;
  if (count >= 6) throw new ApiError(409, "too_many_users");
  if (await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first()) {
    throw new ApiError(409, "username_taken", "username");
  }
  const color = USER_COLORS[count % USER_COLORS.length];
  await db
    .prepare("INSERT INTO users (username, display_name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(username, displayName, await hashPassword(password), color, Date.now())
    .run();
  return c.json({ users: await allUsers(db) });
});

app.patch("/users/me", async (c) => {
  const body = await readJson(c);
  const fields: Record<string, unknown> = {};
  if ("displayName" in body) fields.display_name = str(body.displayName, "displayName", 40, true);
  if ("color" in body) fields.color = oneOf(body.color, "color", USER_COLORS);
  await updateRow(c.env.DB, "users", c.get("user").id, fields);
  return c.json({ user: mapUser(await mustExist(c.env.DB, "users", c.get("user").id)) });
});

app.post("/users/me/password", async (c) => {
  const body = await readJson(c);
  const me = await mustExist(c.env.DB, "users", c.get("user").id);
  if (typeof body.current !== "string" || !(await verifyPassword(body.current, me.password_hash))) {
    throw new ApiError(403, "wrong_password", "current");
  }
  const next = validPassword(body.next);
  if (!next) throw invalid("next", "too_short");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(next), me.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(me.id, c.get("sessionId")),
  ]);
  return c.json({ ok: true });
});

app.post("/users/me/logout-others", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .bind(c.get("user").id, c.get("sessionId"))
    .run();
  return c.json({ removed: res.meta.changes });
});

app.delete("/users/:id", async (c) => {
  const id = idParam(c);
  if (id === c.get("user").id) throw new ApiError(409, "cannot_delete_self");
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return c.json({ users: await allUsers(c.env.DB) });
});

// ---------------------------------------------------------------- export

app.get("/export", async (c) => {
  const db = c.env.DB;
  const tables = ["slots", "visits", "events", "lists", "items", "claims", "feedings"] as const;
  const results = await db.batch<Record<string, any>>(tables.map((t) => db.prepare(`SELECT * FROM ${t}`)));
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), format: "nestchen-export-v1" };
  const { app_secret: _secret, ...settings } = c.get("settings");
  data.settings = settings;
  data.users = (await allUsers(db)).map(({ id, username, displayName }) => ({ id, username, displayName }));
  tables.forEach((t, i) => {
    data[t] = results[i].results.map(({ ip_hash: _ip, ...row }) => row);
  });
  const stamp = today(c).date;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="nestchen-export-${stamp}.json"`,
    },
  });
});

export default app;
