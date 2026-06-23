FROM node:22-alpine AS builder

WORKDIR /app

COPY packages/web/package.json ./
RUN npm install

COPY packages/web/tsconfig.json packages/web/vite.config.ts packages/web/tailwind.config.js packages/web/postcss.config.js ./
COPY packages/web/index.html ./
COPY packages/web/src ./src

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
