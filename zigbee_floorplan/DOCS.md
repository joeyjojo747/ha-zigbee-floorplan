# Zigbee Floorplan

Shows your Zigbee2MQTT network on your floorplan.

## Requirements

- The **Mosquitto broker** add-on. The broker address and credentials are picked up automatically.
- **Zigbee2MQTT** connected to that broker.

## Options

| Option | Default | Description |
|---|---|---|
| `base_topic` | `zigbee2mqtt` | Zigbee2MQTT's MQTT base topic. |
| `scan_timeout_seconds` | `300` | How long to wait for a network scan before giving up. |

## Scanning

**Scan now** asks Zigbee2MQTT for a network map. This queries every router, takes
a minute or two on most networks and adds traffic to the mesh, so avoid running it
repeatedly. The last scan is kept and shown until the next one.

Link quality (LQI) is shown as good (≥ 100), fair (50–99), poor (< 50) or unknown
(not measured — common for battery devices).
