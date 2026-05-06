// SPDX-License-Identifier: MIT
//
// Signed-state helpers for the OAuth authorize → callback round-trip.
// Phase 1's connector-routes used `${tenantId}:${nonce}` as state, which
// is forgeable — any caller could pass an arbitrary tenantId. Phase 3
// (N2/N3) replaces that with an HMAC-SHA256 signature over a JSON
// payload.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface OAuthStatePayload {
  /** Tenant scope. The callback uses this verbatim to write the credentials row. */
  tenantId: string;
  /** Where to send the user after the callback completes. Validated as same-origin by the caller. */
  returnTo: string;
  /** Random per-flow nonce — defends against replay if the same code is delivered twice. */
  nonce: string;
  /** Issued-at, ms-since-epoch. The callback rejects expired states. */
  iat: number;
}

/** Default expiry: 10 minutes is plenty for a user to complete an OAuth dance. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function createState(
  partial: Omit<OAuthStatePayload, "nonce" | "iat">,
  secret: string,
  now: Date = new Date(),
): string {
  const payload: OAuthStatePayload = {
    ...partial,
    nonce: randomBytes(16).toString("hex"),
    iat: now.getTime(),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = b64url(Buffer.from(payloadStr, "utf-8"));
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export interface VerifyResult {
  ok: boolean;
  payload?: OAuthStatePayload;
  reason?:
    | "malformed"
    | "bad_signature"
    | "expired"
    | "bad_payload";
}

export function verifyState(
  token: string,
  secret: string,
  now: Date = new Date(),
  ttlMs: number = DEFAULT_TTL_MS,
): VerifyResult {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64, secret);
  // Constant-time compare — guards against timing oracles even though
  // the signature isn't a high-value secret.
  let sigOk = false;
  try {
    sigOk = timingSafeEqual(fromB64url(sig), fromB64url(expected));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: "bad_signature" };

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString("utf-8")) as OAuthStatePayload;
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.returnTo !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, reason: "bad_payload" };
  }

  if (now.getTime() - payload.iat > ttlMs) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

/**
 * Validate that a returnTo URL is safe to redirect to. Apps should not
 * be able to point this at arbitrary external sites — that's an open
 * redirector. We accept either:
 *   - A relative path (begins with `/` and not `//`)
 *   - An absolute URL whose origin matches one of the allowed origins
 *
 * Allowed origins must include the framework base URL and (in dev) the
 * shell's Vite origin.
 */
export function isSafeReturnTo(
  raw: string,
  allowedOrigins: string[],
): boolean {
  if (typeof raw !== "string" || raw.length === 0) return false;

  // Reject protocol-relative ("//evil.com/path") which the browser sees
  // as a different host.
  if (raw.startsWith("//")) return false;

  // Allow same-host relative paths.
  if (raw.startsWith("/")) return true;

  try {
    const u = new URL(raw);
    return allowedOrigins.includes(u.origin);
  } catch {
    return false;
  }
}
