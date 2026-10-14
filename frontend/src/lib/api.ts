/**
 * Base URL for API calls.
 *
 * Empty by default, which makes every request relative ("/products"). In Docker mode nginx
 * serves the API at /api on the same origin as the app, so this needs no configuration and
 * there is no CORS and no cross-site cookie to reason about.
 *
 * Set NEXT_PUBLIC_API_URL only when the API is on another origin: standalone dev pointing at
 * nginx on :80 uses http://localhost/api. Note this value is inlined at build time, and a
 * bind-mounted dev container reads the same file the host does, so prefer passing it on the
 * command line over committing it to a local env file.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL;

interface ApiResponse<T = unknown> {
  data: T;
  message: string;
  error: boolean;
}

/**
 * Request options plus one extra.
 *
 * `idempotencyKey` is threaded in here rather than at each call site so the header name lives
 * in exactly one place. See lib/idempotency.ts for how a key is chosen and when it is reused.
 */
export interface ApiOptions extends RequestInit {
  idempotencyKey?: string;
}

/** Methods the API will replay for a repeated key. GET is already naturally idempotent. */
const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Joins the base with a path without producing a double slash or dropping a leading one. */
function resolve(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<ApiResponse<T>> {
  const { idempotencyKey, ...request } = options;

  // FormData carries its own multipart boundary; setting Content-Type by hand truncates it.
  const isForm = typeof FormData !== "undefined" && request.body instanceof FormData;

  // Sent for any mutating method the caller gave a key for. The backend treats the header as
  // opt-in, so omitting it leaves the request behaving exactly as it did before.
  const method = (request.method ?? "GET").toUpperCase();
  const idempotencyHeader: Record<string, string> =
    idempotencyKey && IDEMPOTENT_METHODS.has(method)
      ? { "Idempotency-Key": idempotencyKey }
      : {};

  const res = await fetch(resolve(path), {
    ...request,
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...idempotencyHeader,
      ...request.headers,
    },
  });

  const body = await res.json().catch(() => ({
    data: null,
    message: `Unreadable response (${res.status})`,
    error: true,
  }));

  if (!res.ok || body.error) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).data = body.data;
    throw err;
  }

  return body;
}