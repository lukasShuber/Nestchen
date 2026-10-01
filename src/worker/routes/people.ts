// People not to forget (visits page): who should meet the baby – open, invited or already visited.
import type { Context, Hono } from "hono";
import { PERSON_STATUSES } from "../../shared/types";
import { mapPerson } from "../db";
import type { AppEnv } from "../types";
import { ApiError, int, oneOf, readJson, str, text } from "../util";

const MAX_PEOPLE = 500;

async function find(c: Context<AppEnv>) {
  const id = int(c.req.param("id"), "id", 1, Number.MAX_SAFE_INTEGER);
  const row = await c.env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(id).first<Record<string, any>>();
  if (!row) throw new ApiError(404, "not_found");
  return row;
}

export function registerPeopleRoutes(app: Hono<AppEnv>) {
  app.get("/people", async (c) => {
    const rows = await c.env.DB.prepare("SELECT * FROM people ORDER BY created_at, id").all<Record<string, any>>();
    return c.json({ people: rows.results.map(mapPerson) });
  });

  app.post("/people", async (c) => {
    const body = await readJson(c);
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM people").first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_PEOPLE) throw new ApiError(409, "too_many");
    const now = Date.now();
    const res = await c.env.DB.prepare("INSERT INTO people (name, contact, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(
        str(body.name, "name", 80, true),
        str(body.contact, "contact", 120),
        text(body.note, "note", 500),
        oneOf(body.status, "status", PERSON_STATUSES, "open"),
        now,
        now,
      )
      .run();
    const row = await c.env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(res.meta.last_row_id).first<Record<string, any>>();
    return c.json({ person: mapPerson(row!) });
  });

  app.patch("/people/:id", async (c) => {
    const row = await find(c);
    const body = await readJson(c);
    await c.env.DB.prepare("UPDATE people SET name = ?, contact = ?, note = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(
        "name" in body ? str(body.name, "name", 80, true) : row.name,
        "contact" in body ? str(body.contact, "contact", 120) : row.contact,
        "note" in body ? text(body.note, "note", 500) : row.note,
        "status" in body ? oneOf(body.status, "status", PERSON_STATUSES) : row.status,
        Date.now(),
        row.id,
      )
      .run();
    return c.json({ person: mapPerson(await find(c)) });
  });

  app.delete("/people/:id", async (c) => {
    const row = await find(c);
    await c.env.DB.prepare("DELETE FROM people WHERE id = ?").bind(row.id).run();
    return c.json({ ok: true });
  });
}
