# WakanDa: один образ — фронтенд собран, сервер отдаёт его сам (см. serveFrontend в server/src/main.ts).

# 1) Сборка: зависимости + фронтенд.
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci && npm ci --prefix server
COPY . .
ARG VITE_RELEASE=dev
ENV VITE_RELEASE=${VITE_RELEASE}
RUN npm run build

# 2) Запуск: только то, что нужно в рантайме.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=3001 \
    WAKANDA_DATA_DIR=/data
# Зависимости сервера (включая tsx и better-sqlite3 с нативным модулем).
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/package.json /app/server/package-lock.json ./
COPY --from=build /app/server/src ./src
# Собранный фронтенд и корневой package.json (для npm run build-скриптов не нужен).
COPY --from=build /app/dist /app/dist
COPY --from=build /app/public /app/public
COPY --from=build /app/scripts /app/scripts
COPY --from=build /app/package.json /app/package.json
EXPOSE 3001
VOLUME ["/data"]
# tsx уже в зависимостях, поэтому запускаем через него (см. также npm run start).
CMD ["node", "--import", "tsx", "src/main.ts"]