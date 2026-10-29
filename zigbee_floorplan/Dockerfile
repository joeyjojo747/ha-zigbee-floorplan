# The build output is plain JavaScript, so build once on the native platform
# and only run the small runtime stage per target architecture.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ghcr.io/home-assistant/base:3.24 AS runtime
RUN apk add --no-cache nodejs
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY run.sh /run.sh
RUN chmod a+x /run.sh
CMD ["/run.sh"]

# Home Assistant names architectures differently from Docker.
FROM runtime AS runtime-amd64
LABEL io.hass.arch="amd64"
FROM runtime AS runtime-arm64
LABEL io.hass.arch="aarch64"

FROM runtime-${TARGETARCH}
ARG BUILD_VERSION=dev
LABEL io.hass.type="app" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.name="Zigbee Floorplan" \
      io.hass.description="Show your Zigbee2MQTT mesh on your house floorplan" \
      io.hass.url="https://github.com/joeyjojo747/ha-zigbee-floorplan" \
      org.opencontainers.image.source="https://github.com/joeyjojo747/ha-zigbee-floorplan"
