ARG BUILD_FROM

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${BUILD_FROM}
RUN apk add --no-cache nodejs
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY run.sh /run.sh
RUN chmod a+x /run.sh
CMD ["/run.sh"]
