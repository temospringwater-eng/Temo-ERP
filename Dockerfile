FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY services ./services
COPY public ./public

RUN mkdir -p /data /app/storage

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/hayrila.db

EXPOSE 3000

CMD ["npm", "start"]
