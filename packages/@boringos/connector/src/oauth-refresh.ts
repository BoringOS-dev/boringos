// SPDX-License-Identifier: BUSL-1.1
//
// Shared OAuth refresh-token helper.
//
// Used by every code path that calls a connector action against an
// OAuth-credentialed connector (workflow's connector-action handler,
// the /api/connectors/actions/:kind/:action HTTP endpoint, future
// background syncers). Without it, every direct call against an
// expired access token surfaces as a generic 401 to the caller and
// the user has to reconnect manually.

const TOKEN_ENDPOINTS: Record<string, string> = {
  google: "https://oauth2.googleapis.com/token",
  slack: "https://slack.com/api/oauth.v2.access",
};

export interface RefreshedToken {
  accessToken: string;
  /** ISO timestamp; absent when the provider didn't return expires_in. */
  expiresAt?: string;
}

/**
 * Exchange a stored refresh token for a fresh access token.
 *
 * Returns null when the refresh fails — caller should fall through to
 * surfacing the original auth error so the user can reconnect.
 *
 * Reads `<KIND>_CLIENT_ID` / `<KIND>_CLIENT_SECRET` from the
 * environment (currently Google only).
 */
export async function refreshOAuthToken(
  connectorKind: string,
  refreshToken: string,
): Promise<RefreshedToken | null> {
  const tokenUrl = TOKEN_ENDPOINTS[connectorKind];
  if (!tokenUrl) return null;

  const envKind = connectorKind.toUpperCase();
  const clientId = process.env[`${envKind}_CLIENT_ID`];
  const clientSecret = process.env[`${envKind}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = data.access_token as string | undefined;
    if (!accessToken) return null;
    const expiresIn = data.expires_in as number | undefined;
    return {
      accessToken,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
    };
  } catch {
    return null;
  }
}
