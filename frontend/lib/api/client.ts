import type { PageMeta } from "@/types";
import {
  adminMemoGetKey,
  catalogCacheTtlMs,
  isAdminCatalogMemoKey,
  isAdminCatalogWritePath,
} from "./cacheTtl";
import {
  ADMIN_SESSION_COOKIE,
  TOKEN_KEYS,
  clearStoredTokens,
  readToken,
  writeToken,
} from "./tokens";

export { ADMIN_SESSION_COOKIE, TOKEN_KEYS, readToken, writeToken, catalogCacheTtlMs };

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface Envelope<T> {
  data: T;
  meta?: PageMeta & Record<string, unknown>;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function qs(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  headers?: Record<string, string>;
  auth?: keyof typeof TOKEN_KEYS;
  /** localStorage-ийн оронд энэ Bearer токен. */
  bearer?: string;
  /** Server component-ээс дуудахад кэш хийхгүй. */
  cache?: RequestCache;
}

async function parseEnvelope<T>(res: Response): Promise<Envelope<T>> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }

  if (!res.ok) {
    const error = json.error as
      | { code?: string; message?: string; details?: unknown }
      | undefined;
    throw new ApiError(
      res.status,
      error?.code ?? "ERROR",
      error?.message ?? "Алдаа гарлаа.",
      error?.details,
    );
  }

  return json as unknown as Envelope<T>;
}

function requestKey(path: string, options: RequestOptions): string {
  const token = options.auth ? (readToken(options.auth) ?? "") : "";
  if ((options.method ?? "GET") === "GET" && options.auth === "admin") {
    return adminMemoGetKey(token, path, qs(options.query));
  }
  return `${options.method ?? "GET"}:${options.auth ?? ""}:${token}:${path}${qs(options.query)}`;
}

function getTtlMs(path: string, options: RequestOptions): number {
  const method = options.method ?? "GET";
  if (method !== "GET") return -1;
  if (options.auth === "admin") return catalogCacheTtlMs(path, "admin");
  if (path === "/store" || path === "/categories" || path === "/ads") return 30_000;
  if (path === "/home" || path === "/products" || path.startsWith("/products/")) return 5_000;
  return 0;
}

const inflightGets = new Map<string, Promise<Envelope<unknown>>>();
const memoGets = new Map<string, { at: number; value: Envelope<unknown> }>();
let catalogMemoEpoch = 0;

function invalidateAdminCatalogCache(path: string): void {
  if (!isAdminCatalogWritePath(path)) return;
  catalogMemoEpoch += 1;
  for (const key of [...memoGets.keys()]) {
    if (isAdminCatalogMemoKey(key)) memoGets.delete(key);
  }
  for (const key of [...inflightGets.keys()]) {
    if (isAdminCatalogMemoKey(key)) inflightGets.delete(key);
  }
}

export function clearRequestCache(): void {
  catalogMemoEpoch += 1;
  inflightGets.clear();
  memoGets.clear();
}

export function clearSessionClientState(): void {
  clearStoredTokens();
  clearRequestCache();
}

async function fetchEnvelope<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const token = options.bearer ?? (options.auth ? readToken(options.auth) : null);
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(options.query)}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: options.cache ?? "no-store",
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "Сервертэй холбогдож чадсангүй. Интернэтээ шалгана уу.",
    );
  }

  return parseEnvelope<T>(res);
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const method = options.method ?? "GET";
  if (method !== "GET") invalidateAdminCatalogCache(path);
  const ttl = getTtlMs(path, options);
  if (ttl < 0) return fetchEnvelope<T>(path, options);

  const key = requestKey(path, options);
  if (ttl > 0) {
    const hit = memoGets.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as Envelope<T>;
  }
  const pending = inflightGets.get(key);
  if (pending) return pending as Promise<Envelope<T>>;

  const epoch = catalogMemoEpoch;
  const p = fetchEnvelope<T>(path, options)
    .then((value) => {
      if (ttl > 0 && epoch === catalogMemoEpoch) memoGets.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inflightGets.delete(key);
    });
  inflightGets.set(key, p as Promise<Envelope<unknown>>);
  return p;
}

/** Админ зураг — JSON биш, түүхий файл илгээнэ. */
export async function uploadBinary<T>(path: string, file: Blob): Promise<Envelope<T>> {
  const headers: Record<string, string> = {
    "content-type": file.type || "application/octet-stream",
  };
  const token = readToken("admin");
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: file,
      cache: "no-store",
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "Сервертэй холбогдож чадсангүй. Интернэтээ шалгана уу.",
    );
  }

  return parseEnvelope<T>(res);
}

/** Токен хүчингүй болсон эсэх — дахин нэвтрүүлэхэд ашиглана. */
export const isAuthError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);


export const adminAuth = { auth: "admin" as const };
