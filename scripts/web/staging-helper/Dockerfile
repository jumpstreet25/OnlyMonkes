FROM node:22-slim
WORKDIR /app
COPY package.json index.mjs ./
RUN npm install --omit=dev --no-audit --no-fund && mkdir /data && chown node:node /data
USER node
CMD ["node", "index.mjs"]
