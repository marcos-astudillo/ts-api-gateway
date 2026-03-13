import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { env } from '../../config/env';
import { logger } from '../../logger';

// ─── Types ────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject — typically the user ID */
  sub: string;
  aud: string | string[];
  iss: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

// ─── JWKS client (singleton with built-in caching) ────────────

let jwksClient: jwksRsa.JwksClient | null = null;

function getClient(): jwksRsa.JwksClient {
  if (!jwksClient) {
    if (!env.JWKS_URI) {
      throw new Error('JWKS_URI is not configured — cannot validate JWTs');
    }
    jwksClient = jwksRsa({
      jwksUri: env.JWKS_URI,
      // Cache JWKS keys in memory — avoids an HTTP round-trip on every request.
      // Bottleneck from design doc: "cache keys, rotate safely"
      cache: true,
      cacheMaxAge: env.JWKS_CACHE_TTL_SECONDS * 1000,
      // Rate-limit JWKS fetches to prevent hammering the auth provider
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    });
  }
  return jwksClient;
}

function getPublicKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    getClient().getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      const signingKey = key?.getPublicKey();
      if (!signingKey) return reject(new Error('No signing key returned from JWKS'));
      resolve(signingKey);
    });
  });
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Validates a JWT Bearer token.
 *
 * Steps:
 *  1. Decode the token header to get the `kid` (key ID).
 *  2. Fetch the matching public key from the JWKS endpoint (cached).
 *  3. Verify signature, audience, issuer, and expiration.
 *
 * Throws on any validation failure — caller must handle and return 401.
 */
export async function verifyToken(token: string): Promise<JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded || typeof decoded === 'string') {
    throw new Error('Malformed JWT — cannot decode header');
  }

  const publicKey = await getPublicKey(decoded.header);

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      publicKey,
      {
        audience: env.JWT_AUDIENCE,
        issuer: env.JWT_ISSUER,
        algorithms: ['RS256'],
      },
      (err, payload) => {
        if (err) {
          logger.debug({ err: err.message }, 'JWT verification failed');
          return reject(err);
        }
        resolve(payload as JwtPayload);
      },
    );
  });
}

/** Clears the JWKS client — useful in tests to reset state. */
export function resetJwksClient(): void {
  jwksClient = null;
}
