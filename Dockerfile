# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace files
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./

# Copy package files for dependencies
COPY returns-service/package.json ./returns-service/
COPY returns-db/package.json ./returns-db/
COPY kafka-client/package.json ./kafka-client/
COPY typescript-config/package.json ./typescript-config/
COPY eslint-config/package.json ./eslint-config/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY returns-service ./returns-service
COPY returns-db ./returns-db
COPY kafka-client ./kafka-client
COPY typescript-config ./typescript-config
COPY eslint-config ./eslint-config

# Generate Prisma client
WORKDIR /app/returns-db
RUN pnpm prisma generate

# Build the service
WORKDIR /app/returns-service
RUN pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built files and dependencies
COPY --from=builder /app/returns-service/dist ./dist
COPY --from=builder /app/returns-service/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/returns-db ./returns-db

# Set environment
ENV NODE_ENV=production
ENV PORT=3010

EXPOSE 3010

CMD ["node", "dist/index.js"]
