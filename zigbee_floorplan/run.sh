#!/usr/bin/with-contenv bashio
# shellcheck shell=bash

MQTT_HOST="$(bashio::services mqtt 'host')"
MQTT_PORT="$(bashio::services mqtt 'port')"
MQTT_USERNAME="$(bashio::services mqtt 'username')"
MQTT_PASSWORD="$(bashio::services mqtt 'password')"
BASE_TOPIC="$(bashio::config 'base_topic')"
SCAN_TIMEOUT_SECONDS="$(bashio::config 'scan_timeout_seconds')"
export MQTT_HOST MQTT_PORT MQTT_USERNAME MQTT_PASSWORD BASE_TOPIC SCAN_TIMEOUT_SECONDS

export DATA_DIR=/data
export PORT=8099

bashio::log.info "Starting Zigbee Floorplan (broker ${MQTT_HOST}:${MQTT_PORT}, topic ${BASE_TOPIC})"
exec node /app/dist/server/index.js
