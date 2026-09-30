import type { Context } from "hono";
import { isDate, isTime } from "../shared/dates";
import type { AppEnv } from "./types";

/** An error that is sent to the browser as `{ error: code, field? }`. */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500,
    public code: string,
    public field?: string,
  ) {
    super(code);
  }
}

export const invalid = (field: string, code = "invalid") => new ApiError(400, code, field);

// ---------------------------------------------------------------- request body

export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (!type.includes("application/json")) throw new ApiError(400, "json_required");
  const raw = await c.req.text();
  if (raw.length > 64_000) throw new ApiError(413, "too_large");
  try {
    const data = JSON.parse(raw || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}

// ---------------------------------------------------------------- validation

/** Single-line text: trimmed, whitespace collapsed. */
export function str(v: unknown, field: string, max: number, required = false): string {
  if (v == null) v = "";
  if (typeof v !== "string") throw invalid(field);
  const s = v.replace(/\s+/g, " ").trim();
  if (required && !s) throw invalid(field, "required");
  if (s.length > max) throw invalid(field, "too_long");
  return s;
}

/** Multi-line text: keeps line breaks, trims the ends. */
export function text(v: unknown, field: string, max: number): string {
  if (v == null) v = "";
  if (typeof v !== "string") throw invalid(field);
  const s = v.replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (s.length > max) throw invalid(field, "too_long");
  return s;
}

export function int(v: unknown, field: string, min: number, max: number, fallback?: number): number {
  if ((v == null || v === "") && fallback !== undefined) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw invalid(field);
  return n;
}

export const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[], fallback?: T): T {
  if ((v == null || v === "") && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !values.includes(v as T)) throw invalid(field);
  return v as T;
}

export function date(v: unknown, field: string, required = false): string | null {
  if (v == null || v === "") {
    if (required) throw invalid(field, "required");
    return null;
  }
  if (!isDate(v)) throw invalid(field);
  return v;
}

export function time(v: unknown, field: string, required = false): string | null {
  if (v == null || v === "") {
    if (required) throw invalid(field, "required");
    return null;
  }
  if (!isTime(v)) throw invalid(field);
  return v;
}

/** '' or an absolute http(s) URL. */
export function url(v: unknown, field: string): string {
  const s = str(v, field, 2000);
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw invalid(field);
  }
}

export function tags(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw invalid("tags");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v.slice(0, 12)) {
    if (typeof raw !== "string") continue;
    const tag = raw.replace(/^#/, "").replace(/\s+/g, " ").trim().slice(0, 32);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- crypto

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomToken(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(input: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Anonymised client IP (we never store raw IP addresses). */
export async function clientKey(c: Context<AppEnv>, secret: string): Promise<string> {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
  return (await hmacHex(secret, "ip:" + ip)).slice(0, 24);
}

// ---------------------------------------------------------------- rate limiting

/** Allow at most `max` hits per `windowMs` for a bucket; throws 429 otherwise. */
export async function rateLimit(db: D1Database, bucket: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM attempts WHERE bucket = ? AND at > ?")
    .bind(bucket, now - windowMs)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= max) throw new ApiError(429, "rate_limited");
  const statements = [db.prepare("INSERT INTO attempts (bucket, at) VALUES (?, ?)").bind(bucket, now)];
  if (Math.random() < 0.05) statements.push(db.prepare("DELETE FROM attempts WHERE at < ?").bind(now - 86_400_000));
  await db.batch(statements);
}
