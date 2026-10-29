# Zigbee Floorplan for Home Assistant

![Zigbee Floorplan](zigbee_floorplan/logo.png)

A Home Assistant add-on that shows your Zigbee2MQTT mesh on your house floorplan:
place each device where it really is and see the links between them, coloured by
signal quality.

> Status: 0.4.x — every level in one panel, aligned to each other with floor heights,
> in 2D or 3D. See [docs/design.md](docs/design.md) for the design and
> [DOCS.md](zigbee_floorplan/DOCS.md) for how to use it.

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

The store icon and logo (`zigbee_floorplan/icon.png`, `logo.png`) are rendered from
`art/icon.svg` and `art/logo.svg` (the logo embeds a copy of the icon):

```powershell
docker run --rm -v "${PWD}:/w" -w /w/art alpine:3.22 sh -c "apk add -q rsvg-convert font-dejavu && rsvg-convert -w 128 -h 128 icon.svg -o ../zigbee_floorplan/icon.png && rsvg-convert -w 250 -h 100 logo.svg -o ../zigbee_floorplan/logo.png"
```

Build the add-on image for a Raspberry Pi 4:

```powershell
cd zigbee_floorplan
docker buildx build --platform linux/arm64 -t zigbee_floorplan:aarch64-test --load .
```

## Releasing

GitHub Actions ([build.yaml](.github/workflows/build.yaml)) tests every push and
publishes `ghcr.io/joeyjojo747/zigbee-floorplan` for amd64 and aarch64, tagged with
the `version` in `zigbee_floorplan/config.yaml`. Home Assistant pulls that tag, so to
release: bump the version, add a CHANGELOG entry and push. Wait for the workflow to
finish before updating in Home Assistant.
