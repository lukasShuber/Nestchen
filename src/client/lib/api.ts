// Fetch wrapper for the Worker API. Errors carry the server's error code.
import { hasKey, t } from "./i18n";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public field?: string,
  ) {
    super(code);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => (onUnauthorized = fn);

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path.startsWith("/admin")) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? "server_error", data.field);
  }
  return data as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `err.${err.code}`;
    return hasKey(key) ? t(key) : t("common.error");
  }
  return t("common.error");
}
