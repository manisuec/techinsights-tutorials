import { createRemoteJWKSet, jwtVerify } from "jose";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { config, isDevAuth } from "./config.js";

/**
 * Verifies a JWT access token against the issuer's JWKS.
 *
 * Two behaviours of the SDK middleware drive the shape of this function:
 *   1. It rejects any AuthInfo whose `expiresAt` is not a number, so a token
 *      without an `exp` claim fails with a message about expiry.
 *   2. It maps errors by type -- InvalidTokenError becomes 401, everything
 *      unrecognised becomes 500. A raw `jose` throw would read as a server
 *      fault when it is really a bad token, so translate it here.
 */
function jwksVerifier(): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL!));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.AUTH_ISSUER,
          audience: config.AUTH_AUDIENCE,
        });

        if (typeof payload.sub !== "string" || payload.sub.length === 0) {
          throw new Error("Token has no subject claim");
        }

        return {
          token,
          clientId: String(payload.client_id ?? payload.azp ?? payload.sub),
          scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
          expiresAt: payload.exp,
          extra: { userId: payload.sub },
        };
      } catch (err) {
        throw new InvalidTokenError(
          err instanceof Error ? err.message : "Token verification failed"
        );
      }
    },
  };
}

/**
 * Development shortcut: one static token, one fixed subject. Config refuses to
 * construct this when NODE_ENV=production.
 */
function devVerifier(): OAuthTokenVerifier {
  const expected = config.DEV_AUTH_TOKEN!;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (token !== expected) throw new InvalidTokenError("Bad development token");
      return {
        token,
        clientId: "dev-client",
        scopes: ["mcp:access", "tools:read", "tools:invoke"],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: { userId: "dev-user" },
      };
    },
  };
}

export const tokenVerifier: OAuthTokenVerifier = isDevAuth ? devVerifier() : jwksVerifier();

export const requireAuth = requireBearerAuth({
  verifier: tokenVerifier,
  requiredScopes: ["mcp:access"],
  resourceMetadataUrl: `${config.PUBLIC_URL}/.well-known/oauth-protected-resource`,
});

/**
 * The authenticated subject. Tool arguments are model-supplied and must never
 * be the source of an identity used for an ownership check.
 */
export function userIdOf(auth: AuthInfo | undefined): string {
  const id = auth?.extra?.userId;
  if (typeof id !== "string" || id.length === 0) {
    throw new McpError(ErrorCode.InvalidRequest, "Unauthenticated request");
  }
  return id;
}

export function assertScope(auth: AuthInfo | undefined, scope: string): void {
  if (!auth?.scopes.includes(scope)) {
    throw new McpError(ErrorCode.InvalidRequest, `Missing required scope: ${scope}`);
  }
}
