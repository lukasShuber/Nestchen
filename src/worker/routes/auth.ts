// Login, logout and the one-time account setup for the parents.
import { Hono } from "hono";
import {
  createSession,
  currentUser,
  destroySession,
  getDummyHash,
  hashPassword,
  validPassword,
  validUsername,
  verifyPassword,
} from "../auth";
import { loadSettings, mapUser, saveSettings, seedLists } from "../db";
import type { AppEnv } from "../types";
import { ApiError, clientKey, invalid, rateLimit, readJson, safeEqual, str } from "../util";

const app = new Hono<AppEnv>();

/** How many accounts can be created with the setup code (one per parent). */
const SETUP_ACCOUNTS = 2;

const userCount = async (db: D1Database) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n ?? 0;

app.get("/state", async (c) => {
  const session = await currentUser(c);
  const count = await userCount(c.env.DB);
  return c.json({
    user: session?.user ?? null,
    hasUsers: count > 0,
    setupOpen: count < SETUP_ACCOUNTS && !!c.env.SETUP_CODE,
    setupConfigured: !!c.env.SETUP_CODE,
  });
});

app.post("/setup", async (c) => {
  const settings = await loadSettings(c.env.DB);
  await rateLimit(c.env.DB, "setup:" + (await clientKey(c, settings.app_secret)), 10, 15 * 60_000);
  const body = await readJson(c);
  const count = await userCount(c.env.DB);
  if (count >= SETUP_ACCOUNTS) throw new ApiError(409, "setup_closed");
  const setupCode = c.env.SETUP_CODE?.trim();
  if (!setupCode) throw new ApiError(403, "setup_disabled");
  if (typeof body.setupCode !== "string" || !safeEqual(body.setupCode.trim(), setupCode)) {
    throw new ApiError(403, "wrong_setup_code", "setupCode");
  }
  const username = validUsername(body.username);
  if (!username) throw invalid("username");
  const displayName = str(body.displayName, "displayName", 40, true);
  const password = validPassword(body.password);
  if (!password) throw invalid("password", "too_short");
  const language = body.lang === "en" ? "en" : "de";
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (exists) throw new ApiError(409, "username_taken", "username");

  const color = count === 0 ? "sage" : "peach";
  const res = await c.env.DB.prepare(
    "INSERT INTO users (username, display_name, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(username, displayName, await hashPassword(password), color, Date.now())
    .run();
  if (count === 0) {
    await saveSettings(c.env.DB, [["default_lang", language]]);
    await seedLists(c.env.DB, language);
  }
  const userId = res.meta.last_row_id;
  await createSession(c, userId);
  return c.json({ user: { id: userId, username, displayName, color } });
});

app.post("/login", async (c) => {
  const settings = await loadSettings(c.env.DB);
  const body = await readJson(c);
  await rateLimit(c.env.DB, "login:" + (await clientKey(c, settings.app_secret)), 10, 15 * 60_000);
  const username = validUsername(body.username) ?? "";
  const password = typeof body.password === "string" ? body.password : "";
  const row = username
    ? await c.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<Record<string, any>>()
    : null;
  const ok = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()));
  if (!row || !ok) throw new ApiError(401, "invalid_login");
  await createSession(c, row.id);
  return c.json({ user: mapUser(row) });
});

app.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

export default app;
