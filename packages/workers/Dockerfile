FROM node:22-alpine

WORKDIR /app

COPY packages/workers/package.json ./
RUN npm install --production

COPY packages/workers/tsconfig.json ./
COPY packages/workers/src ./src

RUN npm install -g tsx

CMD ["tsx", "src/index.ts"]
