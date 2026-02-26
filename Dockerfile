# Build stage: compile TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY types ./types
COPY tsconfig.json ./
RUN npm run build

# Final stage: production runtime
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/lib ./lib

ENTRYPOINT ["node", "/app/lib/main.js"]
