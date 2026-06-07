# BlipWatch

BlipWatch is an open-source Node.js server for receiving radar data from a Navico/B&G/Simrad HALO radar on a local Ethernet network and exposing live radar imagery through standard HTTP endpoints.

The 1.0.0 implementation provides the first end-to-end server path: UDP packet reception, placeholder packet decoding for hardware-free development, image rendering, in-memory replay, HTTP APIs, Docker packaging, and release automation scaffolding.

## Safety Notice

BlipWatch is experimental situational-awareness software.

It is not a certified navigation, collision-avoidance, watchkeeping, or safety-of-life system. Do not rely on BlipWatch as the sole source of navigational information. Use certified marine instruments, visual watchkeeping, radar displays, AIS, charts, and seamanship appropriate to the vessel and conditions.

## Project Status

This repository is in early 1.0.0 development.

Current limitations:

- Real HALO/Navico packet decoding is not complete.
- The committed `BWS1` packet format is a deterministic placeholder used by tests and the simulator.
- Replay storage is in memory only and is lost on restart.
- The HTTP API is intentionally minimal and unauthenticated.
- Docker and npm publishing are configured through GitHub Actions using Actions secret `NPM_TOKEN`.

## Requirements

- Node.js 22 or newer
- npm
- Docker, when building or running the container
- Direct network access to radar UDP traffic for live onboard use

## Local Development

Install dependencies:

```bash
npm install
```

Run validation:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run the compiled server:

```bash
npm run build
npm start
```

Run in development mode:

```bash
npm run dev
```

Run with debug logging:

```bash
npm run debug
```

Debug mode sets `LOG_LEVEL=debug` and logs configuration, UDP receive activity, decode results, render updates, replay capture, HTTP requests, startup, and shutdown.

## Simulator

BlipWatch includes a small UDP simulator for development without radar hardware. It sends deterministic placeholder radar packets to the configured UDP host and port.

```bash
SIM_RADAR_HOST=127.0.0.1 \
SIM_RADAR_PORT=6678 \
SIM_PACKET_COUNT=5 \
SIM_PACKET_INTERVAL_MS=1000 \
npm run simulate:radar
```

The simulator logs JSON events for start, packet send, and finish. The placeholder packet format is for local development only and is not the real HALO wire format.

## Phase 2 HALO Hardware Testing

Phase 2 focuses on laptop-based testing against real Navico/B&G/Simrad HALO radar hardware. Start with a macOS, Linux, or Windows laptop connected to the same Ethernet/IP network as the radar. Raspberry Pi and Docker appliance deployment remain useful later, but the first hardware goal is direct laptop execution and packet visibility.

Keep the safety notice in mind during all testing. BlipWatch is experimental diagnostic software, not a certified navigation or collision-avoidance display.

### Connect a Laptop

1. Connect the laptop to the radar Ethernet network or to the same switch as the HALO radar.
2. Disable VPNs or firewall rules that may block local UDP traffic while testing.
3. Identify the local interface address assigned on the radar network.
4. Run BlipWatch with that interface or `0.0.0.0` while protocol details are still being discovered.
5. Open `http://localhost:8080/radar/latest.png` and `http://localhost:8080/health`.

Useful interface discovery commands:

```bash
# macOS
networksetup -listallhardwareports
ifconfig

# Linux
ip addr
ip route

# Windows PowerShell
Get-NetAdapter
Get-NetIPAddress
```

### Run With Hardware Diagnostics

Use debug logging during hardware testing:

```bash
PORT=8080 \
RADAR_INTERFACE=0.0.0.0 \
RADAR_MULTICAST_GROUPS= \
RADAR_UDP_PORT=6678 \
IMAGE_SIZE=1024 \
LOG_LEVEL=debug \
npm start
```

Or from source during development:

```bash
PORT=8080 \
RADAR_INTERFACE=0.0.0.0 \
RADAR_MULTICAST_GROUPS= \
RADAR_UDP_PORT=6678 \
IMAGE_SIZE=1024 \
LOG_LEVEL=debug \
npm run dev
```

Debug logs should help identify UDP bind status, source addresses, packet counts, decode failures, render updates, replay capture, and HTTP image requests. Avoid sharing logs publicly if they contain vessel, marina, or network details.

### Capture Radar Traffic

Packet captures are the most useful artifact when hardware is available but decoder work needs to continue later. Save captures in a private location first, then sanitize or trim them before committing fixtures.

Use `tcpdump` on macOS or Linux:

```bash
sudo tcpdump -i <interface> -n udp -w halo-capture.pcap
```

To focus on the current default receive port:

```bash
sudo tcpdump -i <interface> -n udp port 6678 -w halo-6678.pcap
```

Use Wireshark when a visual packet view is easier:

1. Select the radar-network interface.
2. Capture with display filter `udp`.
3. Note source IPs, destination IPs, UDP ports, multicast addresses, packet sizes, and packet rates.
4. Save a short capture around radar startup, standby/transmit changes, and visible target returns.

Current protocol notes:

- `RADAR_UDP_PORT=6678` is the current default receive port from Phase 1.
- `RADAR_MULTICAST_GROUPS` can be set to a comma-separated list of IPv4 multicast groups once observed for the target radar.
- Real HALO multicast groups, control ports, and spoke packet layout are still being confirmed.
- The `BWS1` simulator packet format is not a real HALO packet format.
- Current HALO packet classification is provisional: packets with a `HALO` ASCII prefix or larger unknown UDP payloads are reported as HALO candidates until real captures are decoded.
- Keep explicit notes for observed packet sizes, repeated headers, counters, angle-like fields, and intensity-like payload regions.

Capture checklist for future decoder work:

- Laptop OS and version.
- HALO model, firmware version if available, and transmit/standby state.
- Laptop interface name and IP address.
- Radar source IP address and UDP source/destination ports.
- Whether traffic is broadcast, multicast, or unicast.
- Short pcap file with timestamps preserved.
- Debug log excerpt from the same capture window.

### Replay Saved UDP Payloads

For decoder development, save sanitized UDP payloads in a newline-delimited replay file. Each non-empty line can be either raw hexadecimal:

```text
425753310101000a03e80004004080ff
```

or JSON with a payload and delay before sending that packet:

```json
{"payloadHex":"42 57 53 31 01 01 00 14 03 e8 00 02 40 ff","delayMs":25}
```

Lines beginning with `#` are ignored. The replay format stores UDP payload bytes only; it does not preserve Ethernet/IP/UDP headers from a pcap.

Start BlipWatch in one terminal, then replay packets into its UDP receiver:

```bash
REPLAY_PACKET_FILE=captures/halo-sample.ndjson \
REPLAY_RADAR_HOST=127.0.0.1 \
REPLAY_RADAR_PORT=6678 \
npm run replay:packets
```

Use this format for small sanitized fixtures. Keep raw pcaps private until they have been reviewed for vessel, marina, and network details.

## Configuration

BlipWatch is configured through environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP API port. |
| `RADAR_INTERFACE` | `0.0.0.0` | Local interface address used for UDP radar packet binding. |
| `RADAR_MULTICAST_GROUPS` | empty | Optional comma-separated IPv4 multicast groups to join after UDP bind. |
| `RADAR_UDP_PORT` | `6678` | UDP port used for radar packet reception. |
| `IMAGE_SIZE` | `1024` | Width and height, in pixels, of the rendered radar image. |
| `REPLAY_RETENTION_SECONDS` | `300` | In-memory replay retention window. |
| `REPLAY_FRAME_INTERVAL_MS` | `1000` | Minimum interval between captured replay frames. |
| `LOG_LEVEL` | `info` | Logging verbosity. Use `debug` for packet, decode, render, replay, and request diagnostics. |

Example:

```bash
PORT=8080 \
RADAR_INTERFACE=0.0.0.0 \
RADAR_MULTICAST_GROUPS= \
RADAR_UDP_PORT=6678 \
IMAGE_SIZE=1024 \
REPLAY_RETENTION_SECONDS=300 \
REPLAY_FRAME_INTERVAL_MS=1000 \
LOG_LEVEL=info \
npm start
```

## HTTP API

### `GET /health`

Returns service health and basic renderer/replay state.

```json
{
  "ok": true,
  "service": "blipwatch"
}
```

### `GET /radar/latest.png`

Returns the latest rendered radar image.

- Content type: `image/png`
- Cache policy: `no-store`

Before radar data arrives, this returns a valid empty image.

### `GET /radar/latest.json`

Returns latest render metadata.

```json
{
  "imageSize": 1024,
  "lastFrameAt": "2026-06-07T00:00:00.000Z",
  "lastSpokeAt": "2026-06-07T00:00:00.000Z",
  "maxIntensity": 255,
  "renderState": "ready",
  "spokeCount": 1
}
```

When no radar data has arrived, `renderState` is `empty` and timestamps are `null`.

### `GET /radar/status`

Returns hardware-focused receiver, decoder, and renderer diagnostics.

```json
{
  "receiver": {
    "running": true,
    "packetsReceived": 1,
    "lastPacketAt": "2026-06-07T00:00:00.000Z",
    "lastSourceAddress": "192.0.2.10:6678",
    "multicastGroups": ["239.2.1.1"],
    "boundInterface": "0.0.0.0",
    "udpPort": 6678
  },
  "decoder": {
    "packetsDecoded": 1,
    "packetsRejected": 0,
    "lastDecodedSpokeAt": "2026-06-07T00:00:00.000Z"
  },
  "renderer": {
    "imageAvailable": true,
    "imageSize": 1024,
    "lastRenderedImageAt": "2026-06-07T00:00:00.000Z",
    "lastSpokeAt": "2026-06-07T00:00:00.000Z",
    "renderState": "ready",
    "spokeCount": 1
  }
}
```

This endpoint is intended for Phase 2 hardware testing and troubleshooting. It helps confirm whether BlipWatch is receiving UDP packets, decoding radar spokes, and rendering current imagery.

### `GET /radar/replay`

Returns replay buffer metadata.

```json
{
  "frameCount": 1,
  "frameIntervalMs": 1000,
  "newestFrameAt": "2026-06-07T00:00:00.000Z",
  "oldestFrameAt": "2026-06-07T00:00:00.000Z",
  "retentionSeconds": 300
}
```

### `GET /radar/replay/frames`

Returns available replay frame metadata.

```json
{
  "frames": [
    {
      "capturedAt": "2026-06-07T00:00:00.000Z",
      "metadata": {
        "imageSize": 1024,
        "renderState": "ready"
      },
      "sizeBytes": 4096
    }
  ]
}
```

### `GET /radar/replay/frame?at=<timestamp>`

Returns the closest replay frame to the requested timestamp.

- Query parameter: `at`, an ISO-8601 timestamp
- Content type: `image/png`
- Response header: `x-blipwatch-frame-at`

Error responses:

- `400` when `at` is missing
- `404` when no replay frame is available

## Docker

Build the local image:

```bash
npm run docker:build
```

Run with standard bridge networking:

```bash
docker run --rm \
  -p 8080:8080/tcp \
  -p 6678:6678/udp \
  -e PORT=8080 \
  -e RADAR_INTERFACE=0.0.0.0 \
  -e RADAR_UDP_PORT=6678 \
  blipwatch:local
```

For onboard hardware directly connected to a radar Ethernet network, host networking is often the simplest way to receive UDP traffic:

```bash
docker run --rm --network host \
  -e PORT=8080 \
  -e RADAR_INTERFACE=0.0.0.0 \
  -e RADAR_UDP_PORT=6678 \
  -e IMAGE_SIZE=1024 \
  -e REPLAY_RETENTION_SECONDS=300 \
  -e REPLAY_FRAME_INTERVAL_MS=1000 \
  -e LOG_LEVEL=info \
  ghcr.io/sternanchor/blipwatch:latest
```

Build a multi-architecture image for AMD64 and ARM64:

```bash
npm run docker:buildx
```

The CI/CD workflow publishes GHCR images for:

- `latest` for stable `main` releases
- stable version tags from `main`
- `develop` for preview releases
- prerelease version tags from `develop`
- commit SHA tags from `develop`

## Raspberry Pi / Onboard Deployment

Use a Raspberry Pi or similar Linux host with Ethernet access to the radar network.

1. Connect the host to the radar Ethernet network.
2. Confirm the host can receive UDP traffic from the radar.
3. Run the container with host networking.
4. Open `http://<host>:8080/health` to confirm the server is running.
5. Open `http://<host>:8080/radar/latest.png` to inspect the current image.

Example:

```bash
docker run -d --name blipwatch --restart unless-stopped --network host \
  -e PORT=8080 \
  -e RADAR_INTERFACE=0.0.0.0 \
  -e RADAR_UDP_PORT=6678 \
  -e LOG_LEVEL=info \
  ghcr.io/sternanchor/blipwatch:latest
```

Use `LOG_LEVEL=debug` during installation or troubleshooting to inspect UDP packet reception, decode failures, render updates, and replay capture.

## Release Process

BlipWatch uses Conventional Commits and semantic-release.

Examples:

```text
feat: add live radar image endpoint
fix: handle malformed UDP radar packet
chore: add docker build workflow
docs: add raspberry pi deployment notes
```

Branches:

- `develop` produces preview prereleases, such as `1.1.0-develop.1`.
- `main` produces stable releases.

Release automation:

- Runs validation before publishing.
- Runs the `CI/CD / Validate` check on pull requests into `develop` and `main`; require this check in branch protection before allowing merges to `main`.
- Publishes the Node package to npm using Actions secret `NPM_TOKEN` when it is available to the workflow.
- Publishes Docker images to GitHub Container Registry.
- Creates GitHub releases and release notes.
- Updates `CHANGELOG.md`, `package.json`, and `package-lock.json` during release commits.

Repository setup required for real publishing:

- Ensure `NPM_TOKEN` is available as a repository or org Actions secret for this repository.
- Ensure npm package publishing permissions are configured.
- Ensure GHCR package permissions allow workflow publishing.

## License

BlipWatch is licensed under the GNU General Public License v3.0. See `LICENSE`.
