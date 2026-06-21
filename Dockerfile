FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Ensure SQLite database exists and schema is up to date
RUN DATABASE_URL="file:./dev.db" npx prisma db push

# Disable Next.js telemetry during the build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Copy the initial dev.db to the image
COPY --from=builder --chown=nextjs:nodejs /app/prisma/dev.db /app/default.db

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

USER root
# Create entrypoint script
RUN npm install -g prisma@6.19.3
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'mkdir -p /app/data' >> /app/start.sh && \
    echo 'chown -R nextjs:nodejs /app/data' >> /app/start.sh && \
    echo 'if [ ! -f /app/data/dev.db ]; then' >> /app/start.sh && \
    echo '  echo "Initializing database..."' >> /app/start.sh && \
    echo '  cp /app/default.db /app/data/dev.db' >> /app/start.sh && \
    echo '  chown nextjs:nodejs /app/data/dev.db' >> /app/start.sh && \
    echo 'fi' >> /app/start.sh && \
    echo 'echo "Checking and applying database migrations..."' >> /app/start.sh && \
    echo 'cd /app && export DATABASE_URL="file:/app/data/dev.db" && prisma db push --accept-data-loss' >> /app/start.sh && \
    echo 'exec su nextjs -s /bin/sh -c "node server.js"' >> /app/start.sh && \
    chmod +x /app/start.sh

CMD ["/app/start.sh"]
