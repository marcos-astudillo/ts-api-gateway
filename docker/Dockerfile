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

# Railway injects PORT automatically; default to 3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

# Run migrations then start the gateway
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/server.js"]
