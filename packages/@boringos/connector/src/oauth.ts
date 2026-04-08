import { randomBytes } from "node:crypto";
import type { OAuthConfig, OAuthTokens } from "./types.js";

export interface OAuthManager {
  getAuthorizationUrl(redirectUri: string, state?: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
}

export function createOAuthManager(config: OAuthConfig, clientId: string, clientSecret: string): OAuthManager {
  return {
    getAuthorizationUrl(redirectUri: string, state?: string): string {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: config.scopes.join(" "),
        state: state ?? randomBytes(16).toString("hex"),
        ...(config.extraParams ?? {}),
      });

      if (config.pkce) {
        params.set("code_challenge_method", "S256");
      }

      return `${config.authorizationUrl}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OAuth token exchange failed (${res.status}): ${text}`);
      }

      const data = await res.json() as Record<string, unknown>;
      return parseTokenResponse(data);
    },

    async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
      }

      const data = await res.json() as Record<string, unknown>;
      const tokens = parseTokenResponse(data);
      // Preserve refresh token if not returned in response
      if (!tokens.refreshToken) tokens.refreshToken = refreshToken;
      return tokens;
    },
  };
}

function parseTokenResponse(data: Record<string, unknown>): OAuthTokens {
  const expiresIn = data.expires_in as number | undefined;
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scope: data.scope as string | undefined,
    tokenType: data.token_type as string | undefined,
  };
}
