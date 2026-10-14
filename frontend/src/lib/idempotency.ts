"use client";

import { useCallback, useRef } from "react";

/**
 * Idempotency keys for mutating API calls.
 *
 * The key is minted when the user expresses an *intent* and is reused for every attempt at
 * that same intent, which is what lets the API collapse a double-click, a fetch retried after
 * a timeout, or React's dev-mode double-invoked effects into one execution.
 *
 * The rule that matters is when to throw the key away:
 *
 *   - The request came back with an answer (any status the client actually received), so the
 *     outcome is known. A new attempt is a new intent and needs a new key. Rotating here is
 *     what stops a corrected form resubmission from replaying the previous 400.
 *   - The request failed with no answer at all -- fetch rejected, or a 5xx -- so whether the
 *     write landed is genuinely unknown. That is the one case worth retrying, so the key is
 *     kept and the retry asks "did it already happen?" instead of doing it again.
 */

const HEX = "0123456789abcdef";

/**
 * RFC 4122 v4 shape, spelled out because crypto.randomUUID is not available over plain HTTP.
 *
 * Exported because the homepage editor needs ids of exactly this shape for its tree: element
 * and section ids are generated in the browser, and `randomUUID` is a secure-context API, so
 * on an http deployment the fallback below is the one that actually runs.
 */
export function newUuid(): string {
  // Typed as possibly-absent because over plain HTTP `globalThis.crypto` can genuinely be
  // missing, which the DOM lib's non-optional `crypto` declaration would otherwise hide.
  const source: Partial<Crypto> | undefined = globalThis.crypto;

  if (typeof source?.randomUUID === "function") return source.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    const byte = bytes[i];
    out += HEX[byte >> 4] + HEX[byte & 0x0f];
  }
  return out;
}

/**
 * True when the request's outcome is unknown, so the same key must be reused on a retry.
 *
 * A missing status means fetch itself rejected: DNS failure, connection reset, a CORS
 * rejection or an aborted request. The server may have processed the write before the
 * connection dropped, which is exactly the case idempotency exists for.
 */
export function outcomeUnknown(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status !== "number") return true;
  return status >= 500;
}

/**
 * For form submits and button handlers.
 *
 * `run` supplies the key, rotates it once the outcome is known, and leaves it in place when
 * the outcome is not. Keeping that decision here rather than at each call site is the point:
 * eleven call sites each remembering the rule is eleven chances to get it wrong.
 */
export function useIdempotency() {
  const ref = useRef<string | null>(null);

  const run = useCallback(async function send<T>(
    request: (idempotencyKey: string) => Promise<T>,
  ): Promise<T> {
    // Minted on first use and reused until the outcome is known, so a second submit that
    // lands while the first is still in flight reuses the key and is replayed, not re-run.
    if (ref.current === null) ref.current = newUuid();

    try {
      const result = await request(ref.current);
      ref.current = null;
      return result;
    } catch (error) {
      if (!outcomeUnknown(error)) ref.current = null;
      throw error;
    }
  }, []);

  return { run };
}

/**
 * For one-shot work on mount, such as verifying an email token from a link.
 *
 * Deliberately never rotates: the intent is "verify this token", not "click verify", so
 * every attempt for the lifetime of the page shares one key. That is what makes React's
 * StrictMode double-invoked effect collapse into a single execution instead of verifying
 * twice.
 */
export function useFixedIdempotencyKey(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = newUuid();
  return ref.current;
}