FROM node:20-alpine AS build
RUN apk add --no-cache openssl

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache openssl curl

# Install litestream binary
RUN curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz \
    | tar -xz -C /usr/local/bin litestream

EXPOSE 3000
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY dbsetup.js litestream.yml ./

CMD ["node", "./dbsetup.js", "npm", "run", "docker-start"]
