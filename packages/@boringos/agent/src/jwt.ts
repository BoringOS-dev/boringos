import { createHmac } from "node:crypto";

export interface CallbackTokenClaims {
  sub: string;       // runId
  agent_id: string;
  tenant_id: string;
  iat: number;
  exp: number;
}

const ALGORITHM = "HS256";
const TOKEN_EXPIRY_SECONDS = 4 * 60 * 60; // 4 hours

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function signCallbackToken(
  claims: { runId: string; agentId: string; tenantId: string },
  secret: string,
): string {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: ALGORITHM, typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: claims.runId,
    agent_id: claims.agentId,
    tenant_id: claims.tenantId,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  }));

  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

export function verifyCallbackToken(
  token: string,
  secret: string,
): CallbackTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  // Verify signature
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  if (signature !== expected) return null;

  // Parse and verify expiry
  try {
    const claims = JSON.parse(base64urlDecode(payload)) as CallbackTokenClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}
