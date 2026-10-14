import Redis from "ioredis";
import { config } from "./config.ts";

/**
 * Redis is the idempotency store, and it is deliberately not on the critical path.
 *
 * Every command here fails *fast* and returns a value the caller can branch on rather than
 * throwing, because the caller's fallback is to perform the write without a replay record.
 * That is a real reduction in the guarantee, and middleware/idempotency.ts reports it on the
 * response as `Idempotency-Status: bypassed` instead of pretending otherwise.
 *
 * The offline queue is DISABLED, and that is the important decision in this file.
 *
 * ioredis can queue commands issued while disconnected and flush them on reconnect, which
 * sounds helpful and is actively wrong here. A `SET NX` reservation queued during a 90-second
 * outage would land 90 seconds late, after that request had already finished, and stamp an
 * `in_flight` marker onto a key that a legitimate retry may be using at that exact moment.
 * A stale reservation is worse than no reservation: it turns a retry into a 409 and hides the
 * real write. So commands fail immediately, and the middleware decides what to do about it.
 *
 * What is queued instead is the *response* of a request that already ran, held in-process by
 * store() and drained on the next `ready`. That is safe in the direction that matters: the
 * write already happened, so a late record can only improve replay, never invent one.
 */
let client: Redis | null = null;
let ready = false;
let lastLoggedError = 0;

/** Completed records Redis has not accepted yet. Bounded; see PENDING_LIMIT. */
const pending = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();

// A record is a few hundred bytes. At a few thousand per hour this never fills, but an
// unbounded map keyed by client-supplied keys is a memory-growth path Redis being down.
const PENDING_LIMIT = 500;

export interface IdempotencyRecord {
  state: "in_flight" | "done";
  fingerprint: string;
  /** Response, present once state is "done". */
  status?: number;
  body?: string;
  contentType?: string;
  setCookie?: string[];
  /** Diagnostics only. Never part of the lookup key. */
  path?: string;
  clientIp?: string;
}

function logThrottled(message: string): void {
  // An unreachable Redis produces an error per command; without this the logs bury
  // everything else within seconds.
  const now = Date.now();
  if (now - lastLoggedError < 30_000) return;
  lastLoggedError = now;
  console.warn(`[redis] ${message}`);
}

function connect(): Redis {
  if (client) return client;

  const instance = new Redis(config.redisUrl, {
    // See the file header: a command issued while disconnected must not be queued.
    enableOfflineQueue: false,
    // A connection that is accepted but never answers would otherwise hang the request
    // that issued the command, which is worse than losing the idempotency record.
    commandTimeout: config.redisCommandTimeoutMs,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    // Keep trying, with a backoff that settles at 5s. A restart of the redis container must
    // not require a restart of the API to recover.
    retryStrategy: (times) => Math.min(times * 250, 5000),
  });

  instance.on("ready", () => {
    ready = true;
    void flushPending();
  });

  instance.on("end", () => {
    ready = false;
  });

  // Without a listener ioredis emits an unhandled 'error' event and takes the process down.
  instance.on("error", (err: Error) => {
    ready = false;
    logThrottled(`unavailable (${err.message}); writes proceed without idempotency records`);
  });

  client = instance;
  return instance;
}

/**
 * Resolves true if Redis answers within the window, false otherwise.
 *
 * Exists to close the cold-start hole: the client connects asynchronously, so the first
 * mutation after boot would otherwise find it not ready, bypass idempotency, and be
 * unprotected. Waiting a few hundred milliseconds is cheaper than that.
 */
function waitReady(ms: number): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  const instance = connect();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      instance.off("ready", onReady);
      resolve(value);
    };
    const onReady = () => finish(true);
    const timer = setTimeout(() => finish(false), ms);
    instance.once("ready", onReady);
  });
}

export function isRedisReady(): boolean {
  return ready;
}

export type ReserveOutcome = "reserved" | "exists" | "unavailable";

/**
 * Claims a key for this request. "exists" means someone else holds it; "unavailable" means
 * the answer is unknown and the caller should proceed unprotected.
 */
export async function reserve(
  key: string,
  record: IdempotencyRecord,
  leaseSeconds: number,
): Promise<ReserveOutcome> {
  if (!(await waitReady(300))) return "unavailable";

  try {
    const won = await connect().set(key, JSON.stringify(record), "EX", leaseSeconds, "NX");
    return won === "OK" ? "reserved" : "exists";
  } catch (err) {
    logThrottled(`reserve failed (${(err as Error).message})`);
    return "unavailable";
  }
}

export async function read(key: string): Promise<IdempotencyRecord | null> {
  if (!ready) return null;

  try {
    const raw = await connect().get(key);
    return raw ? (JSON.parse(raw) as IdempotencyRecord) : null;
  } catch (err) {
    logThrottled(`read failed (${(err as Error).message})`);
    return null;
  }
}

/**
 * Writes the completed response.
 *
 * A failure here is not an error for the caller: the write it describes has already happened.
 * The record is held in memory and flushed on reconnect, which is a genuine improvement in
 * replay coverage, but it is per-process and does not survive a restart. Callers must not
 * treat a buffered record as equivalent to a stored one.
 */
export async function store(
  key: string,
  record: IdempotencyRecord,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = Date.now() + ttlSeconds * 1000;

  if (!ready) {
    buffer(key, record, expiresAt);
    return;
  }

  try {
    await connect().set(key, JSON.stringify(record), "EX", ttlSeconds);
  } catch (err) {
    logThrottled(`store failed (${(err as Error).message}); record buffered in-process`);
    buffer(key, record, expiresAt);
  }
}

function buffer(key: string, record: IdempotencyRecord, expiresAt: number): void {
  // Map preserves insertion order, so the first key is the oldest.
  if (pending.size >= PENDING_LIMIT) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.delete(key);
  pending.set(key, { record, expiresAt });
}

export async function release(key: string): Promise<void> {
  // Drop the reservation so the same key can be retried. Used when the handler failed with a
  // 5xx: the outcome is unknown, and a client retrying on the same key must be able to run
  // the handler again rather than be told, forever, that this key is taken.
  pending.delete(key);
  if (!ready) return;

  try {
    await connect().del(key);
  } catch {
    // The lease expires on its own, which covers this case.
  }
}

async function flushPending(): Promise<void> {
  const now = Date.now();
  const entries = [...pending.entries()];

  for (const [key, { record, expiresAt }] of entries) {
    if (expiresAt <= now) {
      pending.delete(key);
      continue;
    }
    try {
      const ttl = Math.max(1, Math.ceil((expiresAt - now) / 1000));
      await connect().set(key, JSON.stringify(record), "EX", ttl);
      pending.delete(key);
    } catch (err) {
      logThrottled(`flush failed (${(err as Error).message}); still buffered`);
      return;
    }
  }
}

/**
 * Claims the right to perform a rate-limited action once per window.
 *
 * Returns true when the caller may proceed, false when the window is still open. True is also
 * returned when Redis cannot answer, and that is the decision that matters here -- the opposite
 * of what a strict reading would suggest:
 *
 * A cooldown is an anti-abuse measure, not a correctness invariant. Failing closed would mean a
 * Redis blip stops *legitimate* users receiving the mail that is the only way back into their
 * account, while the thing actually being prevented -- a handful of duplicate emails -- costs
 * some mail provider quota and nothing else. So an unknown answer resolves to "allow", and the
 * worst case is exactly the behaviour that existed before this function did.
 *
 * Namespaced away from the idempotency keys deliberately. `KEYS 'idem:*'` is a documented way to
 * inspect this store (see the Makefile), and burying rate-limit keys in that namespace would put
 * entries there that are not replay records.
 */
export async function claimCooldown(key: string, windowSeconds: number): Promise<boolean> {
  if (!(await waitReady(300))) return true;

  try {
    const won = await connect().set(`cooldown:${key}`, "1", "EX", windowSeconds, "NX");
    return won === "OK";
  } catch (err) {
    logThrottled(`cooldown claim failed (${(err as Error).message}); allowing the action`);
    return true;
  }
}