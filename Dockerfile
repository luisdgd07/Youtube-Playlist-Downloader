FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip zip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
