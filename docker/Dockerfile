# ─── Stage 1: Build ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy TypeScript configs and source
COPY tsconfig.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts

# Compile src/ → dist/  and  scripts/ → dist/scripts/
RUN npm run build

# ─── Stage 2: Production image ───────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output (includes dist/server.js + dist/scripts/migrate.js)
COPY --from=builder /app/dist ./dist

USER appuser

# PORT is injected at runtime by Railway (e.g. 8080).
# EXPOSE is documentation only — Railway routes to $PORT, not this value.
EXPOSE 3000

# NOTE: No HEALTHCHECK directive here.
# Railway uses railway.toml [deploy].healthcheckPath = "/healthz" to probe the
# correct $PORT at runtime.  A hardcoded Docker HEALTHCHECK on port 3000 would
# always fail when Railway sets PORT=8080, causing the container to be killed
# after the retry window (~7 min) even though the app is healthy.

# Run migrations then start the gateway
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/server.js"]
