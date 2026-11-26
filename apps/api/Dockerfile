# Runtime image for the api. Build context is dist/apps/api from `nx build api`
# (main.js bundle + the pruned package.json/package-lock.json it generates);
# scripts/deploy.sh copies this file there and deploys it to Cloud Run.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY main.js ./

# Cloud Run sets PORT (default 8080); the api reads it via its config module.
USER node
CMD ["node", "main.js"]
