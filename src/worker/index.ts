// Cloudflare Worker entry: the JSON API under /api and the calendar feeds under /cal.
// Everything else is served as static files (the single-page app) by Cloudflare.
import { Hono } from "hono";
import { ensureSchema } from "./db";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import calRoutes from "./routes/cal";
import publicRoutes from "./routes/public";
import type { AppEnv } from "./types";
import { ApiError } from "./util";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  // Refuse cross-site writes (CSRF). Browsers always send an Origin header with them.
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) throw new ApiError(403, "bad_origin");
  }
  await ensureSchema(c.env.DB);
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("Referrer-Policy", "same-origin");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.route("/api/public", publicRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/cal", calRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code, field: err.field }, err.status);
  console.error(err);
  return c.json({ error: "server_error" }, 500);
});

export default app;
