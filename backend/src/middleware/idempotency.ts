import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import AppError from "../lib/appError.ts";
import { config } from "../lib/config.ts";
import {
  read,
  release,
  reserve,
  store,
  type IdempotencyRecord,
} from "../lib/redis.ts";

/**
 * Idempotency for mutating requests, driven by a client-supplied `Idempotency-Key` header.
 *
 * The key is minted by the frontend when the user expresses an *intent* and is rotated only
 * once the outcome of that intent is known. So a double-click, a retried fetch after a
 * timeout, and React's dev-mode double-invoked effects all arrive here as the same key and
 * collapse into one execution.
 *
 * Two decisions worth stating outright, because the obvious alternative is worse:
 *
 * 1. The key is looked up ALONE, not namespaced by user or IP. Scoping by principal looks
 *    safer but breaks the case this exists for: a retried `/login` carries cookies the first
 *    attempt did not have, so a cookie-derived namespace would miss its own record and
 *    execute the login twice. Keys are client-generated UUIDs, so cross-user collision would
 *    require guessing one. The client IP is recorded inside the record for triage, and is
 *    deliberately not part of the key.
 *
 * 2. A 5xx response is NOT recorded. The handler failed, so whether the write happened is
 *    unknown, and the whole point of reusing a key is to find that out by retrying. Storing
 *    the failure would make the key permanently unusable for the retry that needs it. The
 *    reservation is dropped instead, and 4xx is recorded like any other response because the
 *    client knows that outcome and will rotate its key.
 */

/** UUID-ish: the alphabet excludes anything that needs escaping in a header or a Redis key. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const POLL_INTERVAL_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Order-independent serialisation.
 *
 * The raw body is deliberately not hashed even though express.json stashes it in `rawBody`:
 * two requests that mean the same thing can differ byte-for-byte purely in key order, and
 * reporting that as a 422 would be a false accusation of key reuse.
 */
function canonicalize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

function fingerprint(req: Request): string {
  const path = req.originalUrl.split("?")[0];

  // multipart bodies are not parsed yet at this layer -- multer owns them further down -- so
  // there is nothing to hash. Those requests fall back to method+path, which is enough to
  // catch a recycled key and deliberately not enough to claim the body was compared.
  const contentType = req.headers["content-type"] ?? "";
  const body =
    contentType.startsWith("multipart/form-data") || req.body === undefined
      ? ""
      : canonicalize(req.body);

  return crypto.createHash("sha256").update(`${req.method}\n${path}\n${body}`).digest("hex");
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "";
}

/**
 * Captures exactly what went to the client by intercepting res.end, which every Express
 * response path funnels through (json -> send -> end). Wrapping res.json instead would miss
 * 204s and risk double-capturing, since res.json delegates to res.send internally.
 */
function captureResponse(res: Response, onSent: (status: number, body: string) => void): void {
  const originalEnd = res.end.bind(res);
  let captured = false;

  res.end = function patchedEnd(chunk?: unknown, ...rest: unknown[]) {
    if (!captured) {
      captured = true;
      const body =
        chunk === undefined || chunk === null
          ? ""
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : typeof chunk === "string"
              ? chunk
              : Buffer.from(chunk as Uint8Array).toString("utf8");
      onSent(res.statusCode, body);
    }
    return (originalEnd as (...args: unknown[]) => Response)(chunk, ...rest);
  } as Response["end"];
}

export default async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!MUTATING.has(req.method)) return next();

  const key = req.get("Idempotency-Key");
  // No key means the caller is not asking for replay semantics (or is an older client).
  // Idempotency is opt-in on the wire so a missing header can never be a new failure mode.
  if (key === undefined) return next();

  if (!KEY_PATTERN.test(key)) {
    throw new AppError(
      "Idempotency-Key must be 8-255 characters of A-Z, a-z, 0-9, hyphen or underscore",
      400,
    );
  }

  // Awaited rather than fire-and-forgotten: a 409 or 422 raised below must reach the error
  // handler, and Express 5 only forwards rejections from middleware that return their promise.
  return await handle(req, res, next, key);
}

async function handle(
  req: Request,
  res: Response,
  next: NextFunction,
  key: string,
): Promise<void> {
  const redisKey = `idem:${key}`;
  const print = fingerprint(req);
  const reservation: IdempotencyRecord = {
    state: "in_flight",
    fingerprint: print,
    path: req.originalUrl.split("?")[0],
    clientIp: clientIp(req),
  };

  res.setHeader("Idempotency-Key", key);

  const outcome = await reserve(
    redisKey,
    reservation,
    config.idempotencyLeaseSeconds,
  );

  if (outcome === "reserved") return execute(req, res, next, key, redisKey, print, "stored");

  if (outcome === "unavailable") {
    // Fail open: perform the write, keep the response for a later flush. Reported on the
    // response and in the log so an unprotected write is visible rather than silent.
    console.warn(
      `[idempotency] ${req.method} ${reservation.path}: Redis unavailable, ` +
        "executing without a replay record",
    );
    return execute(req, res, next, key, redisKey, print, "bypassed");
  }

  return await settle(req, res, next, key, redisKey, print);
}

/** Runs the handler and records what it produced. */
function execute(
  req: Request,
  res: Response,
  next: NextFunction,
  key: string,
  redisKey: string,
  print: string,
  status: "stored" | "bypassed",
): void {
  // Set in the writeHead patch rather than up front, because the outcome is not known until
  // the handler has run: a 5xx releases its reservation instead of recording one, and
  // reporting that as "stored" would tell the client its failed response is replayable when
  // the whole point is that it must not be. Node routes the implicit header flush through
  // this.writeHead(), so an instance-level patch is seen at exactly the right moment.
  const originalWriteHead = res.writeHead.bind(res);

  res.writeHead = function patchedWriteHead(...args: unknown[]) {
    const code = typeof args[0] === "number" ? args[0] : res.statusCode;
    res.setHeader("Idempotency-Status", code >= 500 ? "released" : status);
    return (originalWriteHead as (...a: unknown[]) => Response)(...args);
  } as Response["writeHead"];

  captureResponse(res, (code, body) => {
    if (code >= 500) {
      console.warn(
        `[idempotency] ${req.method} ${req.originalUrl.split("?")[0]} returned ${code}; ` +
          "reservation released so the key can be retried",
      );
      void release(redisKey);
      return;
    }

    const headers = res.getHeaders();
    const setCookie = headers["set-cookie"];

    void store(
      redisKey,
      {
        state: "done",
        fingerprint: print,
        status: code,
        body,
        contentType: headers["content-type"] as string | undefined,
        // Replayed so that a retried /login whose response was lost comes back with working
        // cookies rather than a 200 the client cannot use. This is what puts live session
        // tokens in Redis for the TTL; see the README.
        setCookie: Array.isArray(setCookie) ? (setCookie as string[]) : undefined,
        path: req.originalUrl.split("?")[0],
        clientIp: clientIp(req),
      },
      config.idempotencyTtlSeconds,
    );
  });

  next();
}

/** Decides what an already-seen key means, waiting briefly for an in-flight original. */
async function settle(
  req: Request,
  res: Response,
  next: NextFunction,
  key: string,
  redisKey: string,
  print: string,
): Promise<void> {
  const deadline = Date.now() + config.idempotencyWaitMs;

  for (;;) {
    const existing = await read(redisKey);

    if (!existing) {
      // The lease expired between our failed SET and this read, which means the original
      // either finished and its record aged out, or the process holding it died. Either way
      // the key is free, so claim it and run.
      const retry = await reserve(
        redisKey,
        { state: "in_flight", fingerprint: print, path: req.originalUrl.split("?")[0] },
        config.idempotencyLeaseSeconds,
      );

      if (retry === "reserved") return execute(req, res, next, key, redisKey, print, "stored");
      if (retry === "unavailable") {
        return execute(req, res, next, key, redisKey, print, "bypassed");
      }

      // Lost a race for the key between the read and the reserve. Sleep rather than spin:
      // the loop is bounded by the deadline check further down, but a tight spin would burn
      // the whole window in microseconds.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (existing.fingerprint !== print) {
      throw new AppError(
        "Idempotency-Key was already used for a different request. Use a new key for a " +
          "different action.",
        422,
      );
    }

    if (existing.state === "done") return replay(res, existing);

    if (Date.now() >= deadline) {
      throw new AppError(
        "A request with this Idempotency-Key is still in progress. Retry shortly.",
        409,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function replay(res: Response, record: IdempotencyRecord): void {
  res.setHeader("Idempotency-Status", "replayed");
  if (record.contentType) res.setHeader("Content-Type", record.contentType);
  if (record.setCookie?.length) res.setHeader("Set-Cookie", record.setCookie);

  res.status(record.status ?? 200).send(record.body ?? "");
}