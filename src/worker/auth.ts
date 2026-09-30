// Password hashing and login sessions for the private area.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { User } from "../shared/types";
import { mapUser } from "./db";
import type { AppEnv } from "./types";
import { randomToken, safeEqual, sha256Hex } from "./util";

// PBKDF2 is the strongest password hash built into Workers. The iteration count is
// stored with each hash, so it can be raised later without breaking old passwords.
// It is kept moderate because the free Workers plan allows ~10 ms of CPU per request.
const ITERATIONS = 40_000;
const SESSION_DAYS = 120;
const DAY = 86_400_000;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  const derived = await pbkdf2(password, fromB64(salt), Number(iter));
  return safeEqual(toB64(derived), hash);
}

let dummyHash: string | null = null;
/** A throw-away hash so unknown usernames take as long to reject as wrong passwords. */
export async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword(randomToken());
  return dummyHash;
}

// ---------------------------------------------------------------- sessions

const isHttps = (c: Context<AppEnv>) => new URL(c.req.url).protocol === "https:";
// The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and path=/.
const cookieName = (c: Context<AppEnv>) => (isHttps(c) ? "__Host-nest" : "nest");

export async function createSession(c: Context<AppEnv>, userId: number) {
  const token = randomToken(32);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, now, now + SESSION_DAYS * DAY)
    .run();
  setCookie(c, cookieName(c), token, {
    path: "/",
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** The logged-in user, or null. Sessions slide forward while they are being used. */
export async function currentUser(c: Context<AppEnv>): Promise<{ user: User; sessionId: string } | null> {
  const token = getCookie(c, cookieName(c));
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sid, s.last_seen, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  )
    .bind(id)
    .first<Record<string, any>>();
  const now = Date.now();
  if (!row || row.expires_at < now) return null;
  if (now - row.last_seen > DAY) {
    await c.env.DB.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?")
      .bind(now, now + SESSION_DAYS * DAY, id)
      .run();
  }
  return { user: mapUser(row), sessionId: id };
}

export async function destroySession(c: Context<AppEnv>) {
  const token = getCookie(c, cookieName(c));
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, cookieName(c), { path: "/", secure: isHttps(c) });
}

export function validUsername(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9._-]{2,32}$/.test(s) ? s : null;
}

export function validPassword(v: unknown): string | null {
  return typeof v === "string" && v.length >= 8 && v.length <= 200 ? v : null;
}
