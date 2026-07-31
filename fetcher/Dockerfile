# Playwright's own image already carries Chromium and every system library it
# needs — building this from node:alpine means chasing missing .so files.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 8080
USER pwuser
CMD ["node", "server.js"]
