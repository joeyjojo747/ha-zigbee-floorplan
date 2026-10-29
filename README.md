# Zigbee Floorplan for Home Assistant

A Home Assistant add-on that shows your Zigbee2MQTT mesh on your house floorplan:
place each device where it really is and see the links between them, coloured by
signal quality.

> Status: early scaffold (0.1.0). It scans the network and lists devices and links;
> the floorplan editor is next. See [docs/design.md](docs/design.md).

## Install

1. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add `https://github.com/joeyjojo747/ha-zigbee-floorplan`.
3. Install **Zigbee Floorplan**, start it, and open it from the sidebar.

Requires Home Assistant OS or Supervised, the Mosquitto broker add-on and Zigbee2MQTT.

## Development

Node isn't needed on the dev machine; npm runs in Docker:

```powershell
.\scripts\dev.ps1 install      # dependencies (kept in a Docker volume)
.\scripts\dev.ps1 test         # unit tests, including the captured network
.\scripts\dev.ps1 run build    # typecheck + build server and UI
.\scripts\dev.ps1 serve        # offline mode on http://localhost:8099
```

Build the add-on image for a Raspberry Pi 4:

```powershell
cd zigbee_floorplan
docker buildx build --platform linux/arm64 --build-arg BUILD_FROM=ghcr.io/home-assistant/aarch64-base:3.21 -t zigbee_floorplan:aarch64-test --load .
```
