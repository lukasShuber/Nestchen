// Trackers (feeding, pumping, sleep): start/stop a session with a live timer, log one afterwards,
// edit and delete. All three work the same way; only their extra columns differ.
// Times are UTC timestamps (ms); the browser groups them by day in the family's time zone.
import type { Context, Hono } from "hono";
import { FEED_METHODS, FEED_SIDES, SLEEP_KINDS, SLEEP_PLACES, hasAmount, isBreastMethod } from "../../shared/types";
import type { FeedMethod } from "../../shared/types";
import { mapFeeding, mapPumping, mapSleep } from "../db";
import type { AppEnv } from "../types";
import { ApiError, int, invalid, oneOf, readJson, text } from "../util";

type Row = Record<string, any>;
type Body = Record<string, unknown>;
type Fields = Record<string, string | number | null>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_ID = Number.MAX_SAFE_INTEGER;

interface Tracker {
  /** Table name and URL segment (/api/admin/<table>). */
  table: "feedings" | "pumpings" | "sleeps";
  maxDuration: number;
  /** Error code for a session longer than maxDuration. */
  tooLong: string;
  map: (r: Row) => unknown;
  /** Extra columns of a session started right now. */
  start: (body: Body) => Fields;
  /** Extra columns of a logged session (row = null) or of a change (row = the stored session). */
  fields: (body: Body, row: Row | null) => Fields;
  /** Names the feeding API used before the trackers were merged (still sent for open older tabs). */
  legacy?: { one: string; many: string };
}

const notes = (b: Body, row: Row | null) => ("notes" in b ? text(b.notes, "notes", 1000) : (row?.notes ?? ""));
const amount = (v: unknown) => (v == null || v === "" ? null : int(v, "amountMl", 0, 2000));

const feedSide = (method: FeedMethod, v: unknown) =>
  !isBreastMethod(method) || v == null || v === "" ? null : oneOf(v, "side", FEED_SIDES);

const feeding: Tracker = {
  table: "feedings",
  maxDuration: 8 * HOUR,
  tooLong: "feed_too_long",
  map: mapFeeding,
  legacy: { one: "feeding", many: "feedings" },
  start: (b) => {
    const method = oneOf(b.method, "method", FEED_METHODS, "breast");
    return { method, side: feedSide(method, b.side) };
  },
  fields: (b, row) => {
    const method = oneOf(b.method, "method", FEED_METHODS, (row?.method as FeedMethod) ?? "breast");
    return {
      method,
      side: "side" in b ? feedSide(method, b.side) : row && isBreastMethod(method) ? row.side : null,
      amount_ml: "amountMl" in b ? (hasAmount(method) ? amount(b.amountMl) : null) : row && hasAmount(method) ? row.amount_ml : null,
      notes: notes(b, row),
    };
  },
};

const pumping: Tracker = {
  table: "pumpings",
  maxDuration: 3 * HOUR,
  tooLong: "pump_too_long",
  map: mapPumping,
  start: (b) => ({ side: oneOf(b.side, "side", FEED_SIDES, "both") }),
  fields: (b, row) => ({
    side: oneOf(b.side, "side", FEED_SIDES, row?.side ?? "both"),
    amount_ml: "amountMl" in b ? amount(b.amountMl) : (row?.amount_ml ?? null),
    notes: notes(b, row),
  }),
};

const sleepPlace = (v: unknown) => (v == null || v === "" ? null : oneOf(v, "place", SLEEP_PLACES));

const sleep: Tracker = {
  table: "sleeps",
  maxDuration: 16 * HOUR,
  tooLong: "sleep_too_long",
  map: mapSleep,
  start: (b) => ({ kind: oneOf(b.kind, "kind", SLEEP_KINDS, "nap"), place: sleepPlace(b.place) }),
  fields: (b, row) => ({
    kind: oneOf(b.kind, "kind", SLEEP_KINDS, row?.kind ?? "nap"),
    place: "place" in b ? sleepPlace(b.place) : (row?.place ?? null),
    notes: notes(b, row),
  }),
};

function checkTimes(tr: Tracker, start: number, end: number | null) {
  const now = Date.now();
  if (start > now + 5 * MINUTE) throw invalid("startedAt", "in_future");
  if (start < now - 400 * DAY) throw invalid("startedAt");
  if (end == null) return;
  if (end <= start) throw invalid("endedAt", "end_before_start");
  if (end - start > tr.maxDuration) throw invalid("endedAt", tr.tooLong);
  if (end > now + 5 * MINUTE) throw invalid("endedAt", "in_future");
}

function register(app: Hono<AppEnv>, tr: Tracker) {
  const T = tr.table;
  const base = `/${T}`;
  /** `{ session }` (plus the old name for feedings). */
  const one = (session: unknown, extra: Record<string, unknown> = {}) => ({
    session,
    ...(tr.legacy && { [tr.legacy.one]: session }),
    ...extra,
  });

  async function find(c: Context<AppEnv>) {
    const id = int(c.req.param("id"), "id", 1, MAX_ID);
    const row = await c.env.DB.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(id).first<Row>();
    if (!row) throw new ApiError(404, "not_found");
    return row;
  }

  app.get(base, async (c) => {
    const days = int(c.req.query("days"), "days", 1, 400, 30);
    const db = c.env.DB;
    const [list, running, last] = await db.batch<Row>([
      db.prepare(`SELECT * FROM ${T} WHERE started_at >= ? ORDER BY started_at`).bind(Date.now() - days * DAY),
      db.prepare(`SELECT * FROM ${T} WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`),
      db.prepare(`SELECT * FROM ${T} WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`),
    ]);
    const sessions = list.results.map(tr.map);
    return c.json({
      serverNow: Date.now(),
      sessions,
      running: running.results[0] ? tr.map(running.results[0]) : null,
      last: last.results[0] ? tr.map(last.results[0]) : null,
      ...(tr.legacy && { [tr.legacy.many]: sessions }),
    });
  });

  /** Start now. Only one session per tracker can run – a second start returns the running one. */
  app.post(`${base}/start`, async (c) => {
    const cols = tr.start(await readJson(c));
    const names = Object.keys(cols);
    const now = Date.now();
    const res = await c.env.DB.prepare(
      `INSERT INTO ${T} (started_at, ${names.join(", ")}, created_by, created_at, updated_at)
       SELECT ?, ${names.map(() => "?").join(", ")}, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ${T} WHERE ended_at IS NULL)`,
    )
      .bind(now, ...Object.values(cols), c.get("user").id, now, now)
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM ${T} WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).first<Row>();
    return c.json(one(row ? tr.map(row) : null, { alreadyRunning: !res.meta.changes }));
  });

  app.post(`${base}/:id/stop`, async (c) => {
    const row = await find(c);
    if (row.ended_at == null) {
      const now = Date.now();
      await c.env.DB.prepare(`UPDATE ${T} SET ended_at = ?, updated_at = ? WHERE id = ? AND ended_at IS NULL`)
        .bind(Math.max(now, row.started_at + 1000), now, row.id)
        .run();
    }
    return c.json(one(tr.map(await find(c))));
  });

  /** Log a session afterwards. */
  app.post(base, async (c) => {
    const body = await readJson(c);
    const start = int(body.startedAt, "startedAt", 0, MAX_ID);
    const end = int(body.endedAt, "endedAt", 0, MAX_ID);
    checkTimes(tr, start, end);
    const cols = tr.fields(body, null);
    const names = Object.keys(cols);
    const now = Date.now();
    const res = await c.env.DB.prepare(
      `INSERT INTO ${T} (started_at, ended_at, ${names.join(", ")}, created_by, created_at, updated_at)
       VALUES (?, ?, ${names.map(() => "?").join(", ")}, ?, ?, ?)`,
    )
      .bind(start, end, ...Object.values(cols), c.get("user").id, now, now)
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM ${T} WHERE id = ?`).bind(res.meta.last_row_id).first<Row>();
    return c.json(one(tr.map(row!)));
  });

  app.patch(`${base}/:id`, async (c) => {
    const row = await find(c);
    const body = await readJson(c);
    const start = "startedAt" in body ? int(body.startedAt, "startedAt", 0, MAX_ID) : (row.started_at as number);
    const end = "endedAt" in body ? (body.endedAt == null ? null : int(body.endedAt, "endedAt", 0, MAX_ID)) : (row.ended_at as number | null);
    if (end == null && row.ended_at != null) throw invalid("endedAt", "required");
    checkTimes(tr, start, end);
    const cols = tr.fields(body, row);
    const names = Object.keys(cols);
    await c.env.DB.prepare(`UPDATE ${T} SET started_at = ?, ended_at = ?, ${names.map((n) => `${n} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(start, end, ...Object.values(cols), Date.now(), row.id)
      .run();
    return c.json(one(tr.map(await find(c))));
  });

  app.delete(`${base}/:id`, async (c) => {
    const row = await find(c);
    await c.env.DB.prepare(`DELETE FROM ${T} WHERE id = ?`).bind(row.id).run();
    return c.json({ ok: true });
  });
}

export function registerTrackerRoutes(app: Hono<AppEnv>) {
  for (const tr of [feeding, pumping, sleep]) register(app, tr);
}
