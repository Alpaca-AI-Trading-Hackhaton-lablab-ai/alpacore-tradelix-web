# syntax=docker/dockerfile:1

FROM oven/bun:1.4-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json biome.json ./
COPY src ./src
ENV VITE_APP_TITLE="TradeLix AI" \
    VITE_API_URL=/api \
    VITE_DEFAULT_SYMBOL=SPY
RUN bun run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV API_UPSTREAM=tradelix-backend:8000
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
