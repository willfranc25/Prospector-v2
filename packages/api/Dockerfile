FROM node:22-alpine

WORKDIR /app

COPY packages/api/package.json ./
RUN npm install --production

COPY packages/api/tsconfig.json ./
COPY packages/api/src ./src

RUN npm install -g tsx

EXPOSE 3001

CMD ["tsx", "src/server.ts"]
