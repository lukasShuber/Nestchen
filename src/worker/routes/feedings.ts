// Feeding tracker: start/stop a feed, log one afterwards, edit and delete.
// Times are UTC timestamps (ms); the browser groups them by day in the family's time zone.
import type { Context, Hono } from "hono";
import { FEED_METHODS, FEED_SIDES, hasAmount, isBreastMethod } from "../../shared/types";
import type { FeedMethod, FeedingData } from "../../shared/types";
import { mapFeeding } from "../db";
import type { AppEnv } from "../types";
import { ApiError, int, invalid, oneOf, readJson, text } from "../util";

const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_DURATION = 8 * 60 * MINUTE;
const MAX_ID = Number.MAX_SAFE_INTEGER;

function readSide(method: FeedMethod, v: unknown) {
  if (!isBreastMethod(method) || v == null || v === "") return null;
  return oneOf(v, "side", FEED_SIDES);
}

function readAmount(method: FeedMethod, v: unknown) {
  if (!hasAmount(method) || v == null || v === "") return null;
  return int(v, "amountMl", 0, 1000);
}

function checkTimes(start: number, end: number | null) {
  const now = Date.now();
  if (start > now + 5 * MINUTE) throw invalid("startedAt", "in_future");
  if (start < now - 400 * DAY) throw invalid("startedAt");
  if (end == null) return;
  if (end <= start) throw invalid("endedAt", "end_before_start");
  if (end - start > MAX_DURATION) throw invalid("endedAt", "feed_too_long");
  if (end > now + 5 * MINUTE) throw invalid("endedAt", "in_future");
}

async function find(c: Context<AppEnv>) {
  const id = int(c.req.param("id"), "id", 1, MAX_ID);
  const row = await c.env.DB.prepare("SELECT * FROM feedings WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!row) throw new ApiError(404, "not_found");
  return row;
}

export function registerFeedingRoutes(app: Hono<AppEnv>) {
  app.get("/feedings", async (c) => {
    const days = int(c.req.query("days"), "days", 1, 400, 30);
    const db = c.env.DB;
    const [list, running, last] = await db.batch<Record<string, any>>([
      db.prepare("SELECT * FROM feedings WHERE started_at >= ? ORDER BY started_at").bind(Date.now() - days * DAY),
      db.prepare("SELECT * FROM feedings WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"),
      db.prepare("SELECT * FROM feedings WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1"),
    ]);
    const data: FeedingData = {
      serverNow: Date.now(),
      feedings: list.results.map(mapFeeding),
      running: running.results[0] ? mapFeeding(running.results[0]) : null,
      last: last.results[0] ? mapFeeding(last.results[0]) : null,
    };
    return c.json(data);
  });

  /** Start a feed now. Only one feed can run at a time – a second start returns the running one. */
  app.post("/feedings/start", async (c) => {
    const body = await readJson(c);
    const method = oneOf(body.method, "method", FEED_METHODS, "breast");
    const side = readSide(method, body.side);
    const now = Date.now();
    const res = await c.env.DB.prepare(
      `INSERT INTO feedings (started_at, method, side, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM feedings WHERE ended_at IS NULL)`,
    )
      .bind(now, method, side, c.get("user").id, now, now)
      .run();
    const row = await c.env.DB.prepare("SELECT * FROM feedings WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
      .first<Record<string, any>>();
    return c.json({ feeding: row ? mapFeeding(row) : null, alreadyRunning: !res.meta.changes });
  });

  app.post("/feedings/:id/stop", async (c) => {
    const row = await find(c);
    if (row.ended_at == null) {
      const now = Date.now();
      await c.env.DB.prepare("UPDATE feedings SET ended_at = ?, updated_at = ? WHERE id = ? AND ended_at IS NULL")
        .bind(Math.max(now, row.started_at + 1000), now, row.id)
        .run();
    }
    return c.json({ feeding: mapFeeding(await find(c)) });
  });

  /** Log a feed afterwards. */
  app.post("/feedings", async (c) => {
    const body = await readJson(c);
    const method = oneOf(body.method, "method", FEED_METHODS, "breast");
    const start = int(body.startedAt, "startedAt", 0, MAX_ID);
    const end = int(body.endedAt, "endedAt", 0, MAX_ID);
    checkTimes(start, end);
    const now = Date.now();
    const res = await c.env.DB.prepare(
      `INSERT INTO feedings (started_at, ended_at, method, side, amount_ml, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(start, end, method, readSide(method, body.side), readAmount(method, body.amountMl), text(body.notes, "notes", 1000), c.get("user").id, now, now)
      .run();
    const row = await c.env.DB.prepare("SELECT * FROM feedings WHERE id = ?").bind(res.meta.last_row_id).first<Record<string, any>>();
    return c.json({ feeding: mapFeeding(row!) });
  });

  app.patch("/feedings/:id", async (c) => {
    const row = await find(c);
    const body = await readJson(c);
    const method = "method" in body ? oneOf(body.method, "method", FEED_METHODS) : (row.method as FeedMethod);
    const start = "startedAt" in body ? int(body.startedAt, "startedAt", 0, MAX_ID) : row.started_at;
    const end = "endedAt" in body ? (body.endedAt == null ? null : int(body.endedAt, "endedAt", 0, MAX_ID)) : row.ended_at;
    if (end == null && row.ended_at != null) throw invalid("endedAt", "required");
    checkTimes(start, end);
    const side = "side" in body ? readSide(method, body.side) : isBreastMethod(method) ? row.side : null;
    const amount = "amountMl" in body ? readAmount(method, body.amountMl) : hasAmount(method) ? row.amount_ml : null;
    const notes = "notes" in body ? text(body.notes, "notes", 1000) : row.notes;
    await c.env.DB.prepare(
      "UPDATE feedings SET started_at = ?, ended_at = ?, method = ?, side = ?, amount_ml = ?, notes = ?, updated_at = ? WHERE id = ?",
    )
      .bind(start, end, method, side, amount, notes, Date.now(), row.id)
      .run();
    return c.json({ feeding: mapFeeding(await find(c)) });
  });

  app.delete("/feedings/:id", async (c) => {
    const row = await find(c);
    await c.env.DB.prepare("DELETE FROM feedings WHERE id = ?").bind(row.id).run();
    return c.json({ ok: true });
  });
}
