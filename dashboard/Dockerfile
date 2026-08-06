# Dashboard image for the VPS, sitting beside Postgres on the internal network.
#
# It ran on cPanel until iFastNet's outbound block made the database unreachable
# from there — no route, no workaround. Here it connects to `postgres` directly,
# so there is no read API, no bearer token and no cross-host hop.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Standalone output omits these two by design, assuming a CDN serves them. There
# is no CDN here, so they are copied into the runtime image below.
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
