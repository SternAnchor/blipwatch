# BlipWatch

BlipWatch is an open-source Node.js server for receiving radar data from a Navico/B&G/Simrad HALO radar on a local Ethernet network and exposing live radar imagery through standard HTTP endpoints.

The 1.1.0 development line adds the first real HALO hardware path plus platform-maturity features: target aging/decay, configurable rendering, replay APIs and dashboard controls, WebSocket streaming, expanded diagnostics, package validation, and Raspberry Pi profiling tools.

## Safety Notice

BlipWatch is experimental situational-awareness software.

It is not a certified navigation, collision-avoidance, watchkeeping, or safety-of-life system. Do not rely on BlipWatch as the sole source of navigational information. Use certified marine instruments, visual watchkeeping, radar displays, AIS, charts, and seamanship appropriate to the vessel and conditions.

## Project Status

This repository is preparing the 1.1.0 hardware-integration release.

Current limitations:

- Real HALO/Navico packet decoding is implemented for the currently modeled Navico frame envelope, but still needs confirmation with real captures from supported hardware.
- The committed `BWS1` packet format is a deterministic placeholder used by tests and the simulator.
- Passive Navico report discovery is implemented. Active wake control is enabled by default; transmit still requires `RADAR_CONTROL_MODE=transmit` or an explicit dashboard/API request.
- Gain, sea clutter, rain clutter, and range controls send documented Navico/HALO UDP command payloads while active control is enabled; validate these carefully against your hardware.
- Replay storage is in memory only and is lost on restart.
- WebSocket streaming sends live notifications and image URLs, not binary image frames.
- The HTTP API is intentionally minimal and unauthenticated.
- Docker and npm publishing are configured through GitHub Actions using Actions secret `NPM_TOKEN`.

Phase 3 adds the operator-facing tools needed for broader testing:

- Target persistence/fade and render tuning controls.
- Replay listing, timestamp lookup, playback state, and dashboard replay controls.
- WebSocket notifications at `/api/radar/stream`.
- Runtime diagnostics for renderer, replay, control, streaming, process memory, and uptime.
- Cross-platform CI validation and npm package dry-run checks.
- A deterministic radar profiler for Raspberry Pi 5 readiness checks.

## Phase 2 Validation Status

Phase 2 adds the first real HALO hardware path: passive report discovery, UDP receive diagnostics, Navico/HALO frame-shaped packet classification, spoke decoding into the internal radar model, rendering of high-density HALO spokes, and replay/testing tools.

Attempted hardware so far:

- Navico/B&G/Simrad HALO-family radar on the local Ethernet network. Exact model and firmware still need to be recorded from an observed report packet or vessel display.
- Local laptop interface: macOS wired Ethernet `en7`, address `192.168.15.188`.
- Observed HALO radar address: `192.168.15.182`, serial/name `129265451`.

Most recent local hardware smoke test:

- BlipWatch started successfully on `192.168.15.188` with active control explicitly enabled.
- Passive discovery joined `236.6.7.5:6878` and parsed `01b2` location reports from `192.168.15.182`.
- Discovery reported primary data endpoint `236.6.7.8:6678`, command endpoint `236.6.7.10:6680`, and report endpoint `236.6.7.9:6679`.
- Active transmit control switched from fallback to the discovered command endpoint after the first location report.
- Radar spoke receiver bound `0.0.0.0:6678` with multicast interface `192.168.15.188`.
- `/api/radar/status` reached `receiving-and-rendering` with 978 decoded spokes, 980 received packets, and `imageAvailable=true`.
- `GET /api/radar/latest.png` returned a 1024x1024 rendered radar image with real returns.

Known protocol gaps:

- Confirm the real HALO report payload fields for model, firmware, and operating state beyond the currently parsed `01b2` location report.
- Improve rendering persistence/decay so real returns are easier to inspect visually between spoke updates.
- Add range, gain, and other control commands after the wake/transmit/standby path has been validated safely.
- Add sanitized real packet fixtures once hardware traffic is captured.

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
npm pack --dry-run
```

GitHub Actions runs validation on Ubuntu, macOS, and Windows for pull requests and commits to `develop` and `main`. Docker build validation runs on Ubuntu, and release jobs build multi-architecture Docker images for `linux/amd64` and `linux/arm64` when publishing is enabled.

Run the compiled server:

```bash
npm run build
npm start
```

Run from an npm install:

```bash
npm install -g blipwatch
blipwatch
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
3. Identify the local interface address assigned on the radar network if you want to override automatic selection.
4. Run BlipWatch with `RADAR_INTERFACE=auto`, or set a concrete interface address such as `192.168.15.188`.
5. Open `http://localhost:8080/` for the live radar dashboard, or `http://localhost:8080/api/radar/latest.png` for the raw image.

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
RADAR_DISCOVERY_ENABLED=true \
RADAR_INTERFACE=auto \
RADAR_MULTICAST_GROUPS=236.6.7.8 \
RADAR_REPORT_MULTICAST_GROUP=236.6.7.5 \
RADAR_REPORT_UDP_PORT=6878 \
RADAR_UDP_PORT=6678 \
IMAGE_SIZE=1024 \
LOG_LEVEL=debug \
npm start
```

Or from source during development:

```bash
PORT=8080 \
RADAR_DISCOVERY_ENABLED=true \
RADAR_INTERFACE=auto \
RADAR_MULTICAST_GROUPS=236.6.7.8 \
RADAR_REPORT_MULTICAST_GROUP=236.6.7.5 \
RADAR_REPORT_UDP_PORT=6878 \
RADAR_UDP_PORT=6678 \
IMAGE_SIZE=1024 \
LOG_LEVEL=debug \
npm run dev
```

Debug logs should help identify UDP bind status, discovery report bind/join status, source addresses, packet counts, decode failures, render updates, replay capture, and HTTP image requests. Avoid sharing logs publicly if they contain vessel, marina, or network details.

### HALO Wake/Transmit Control

Active control is enabled by default so BlipWatch can wake the HALO and expose dashboard/API controls without extra setup. The default mode is `wake`; startup transmit still requires `RADAR_CONTROL_MODE=transmit`, or an explicit dashboard/API transmit request. Set `RADAR_CONTROL_ENABLED=false` to run receive-only without active Navico/HALO commands.

Wake the radar without requesting transmit:

```bash
RADAR_CONTROL_MODE=wake \
RADAR_INTERFACE=auto \
npm run dev
```

Request transmit on startup and keep the HALO active with periodic stay-alive commands:

```bash
RADAR_CONTROL_ENABLED=true \
RADAR_CONTROL_MODE=transmit \
RADAR_CONTROL_HOST=auto \
RADAR_CONTROL_FALLBACK_HOST=236.6.8.36 \
RADAR_CONTROL_PORT=6516 \
RADAR_CONTROL_WAKE_HOST=236.6.7.5 \
RADAR_CONTROL_WAKE_PORT=6878 \
RADAR_INTERFACE=auto \
npm run dev
```

The control sequence sends the documented Navico wake command to `RADAR_CONTROL_WAKE_HOST:RADAR_CONTROL_WAKE_PORT`, then sends transmit-on once for the active command target and follows with periodic stay-alive commands while the desired state is `transmit`. If discovery later reports a different command endpoint, BlipWatch sends transmit-on once to that new target before resuming stay-alive commands. The root dashboard also exposes `Standby` and `Transmit` buttons backed by `POST /api/radar/control/standby` and `POST /api/radar/control/transmit`, plus a local `Clear Screen` action backed by `POST /api/radar/clear`. With `RADAR_CONTROL_HOST=auto`, BlipWatch uses a command endpoint extracted from discovery reports when available, otherwise it falls back to `RADAR_CONTROL_FALLBACK_HOST:RADAR_CONTROL_PORT`. Control state, desired state, observed radar state, command counts, last command, target source, tuning capabilities, and any socket errors are exposed through `/api/radar/status` and the root dashboard. If another device moves the radar to standby, BlipWatch updates observed state and pauses transmit stay-alive after the current request grace window.

Gain, sea clutter, rain clutter, and range control are available through both the API and dashboard advanced controls when active radar control is enabled. The payloads are based on the published Navico control interface and the GPL-compatible OpenCPN radar_pi Navico implementation, then implemented in BlipWatch as small TypeScript packet builders. Treat them as active hardware commands: confirm the radar can transmit safely, keep another display available, and validate behavior on your specific HALO model before relying on them operationally.

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

- `RADAR_UDP_PORT=6678` is the current default image/spoke receive port.
- `RADAR_INTERFACE=auto` selects a likely non-virtual IPv4 interface before joining multicast groups. Set it to a concrete local address if auto-selection picks the wrong network.
- `RADAR_MULTICAST_GROUPS=236.6.7.8` joins the commonly documented Navico image multicast stream by default.
- Passive Navico discovery is enabled by default with `RADAR_DISCOVERY_ENABLED=true`, `RADAR_REPORT_MULTICAST_GROUP=236.6.7.5`, and `RADAR_REPORT_UDP_PORT=6878`.
- Passive discovery listens for report packets and exposes detected radar metadata through `/api/radar/status`; set `RADAR_CONTROL_ENABLED=false` to disable active wake/transmit commands.
- Real HALO control ports and exact report payload fields can vary by radar. Keep `RADAR_CONTROL_HOST=auto` to prefer discovered command endpoints, or set `RADAR_CONTROL_HOST` and `RADAR_CONTROL_PORT` explicitly if packet capture shows a different command endpoint.
- Observed HALO location report `01b2` maps primary data to `236.6.7.8:6678`, primary command control to `236.6.7.10:6680`, and primary report/status traffic to `236.6.7.9:6679` for serial `129265451`.
- The `BWS1` simulator packet format is not a real HALO packet format.
- Current HALO packet classification is provisional: packets with a `HALO` ASCII prefix or larger unknown UDP payloads are reported as HALO candidates until real captures are decoded.
- The initial Navico/HALO frame decoder is based on high-level packet structure documented in the GPL-compatible OpenCPN `radar_pi` Navico receiver: an 8-byte frame header followed by 24-byte scan-line headers and packed 4-bit return samples. It currently decodes the first structurally valid scan line from a packet.
- Keep explicit notes for observed packet sizes, repeated headers, counters, angle-like fields, and intensity-like payload regions.

Capture checklist for future decoder work:

- Laptop OS and version.
- HALO model, firmware version if available, and transmit/standby state.
- Laptop interface name and IP address.
- Radar source IP address and UDP source/destination ports.
- Whether traffic is broadcast, multicast, or unicast.
- Chartplotter screenshot or photo from the same time window when tuning render calibration.
- Short pcap file with timestamps preserved.
- Debug log excerpt from the same capture window.

Troubleshooting no packets:

- Confirm the laptop interface is on the radar subnet and use its concrete address for `RADAR_INTERFACE`.
- Keep `RADAR_DISCOVERY_ENABLED=true` and check `/api/radar/status.discovery.running`.
- Check whether `reportsReceived`, `packetsReceived`, or both remain zero.
- Run a privileged capture such as `sudo tcpdump -i <interface> -n udp`.
- If tcpdump shows packets but BlipWatch does not, compare destination address, UDP port, and multicast group against `RADAR_REPORT_*`, `RADAR_UDP_PORT`, and `RADAR_MULTICAST_GROUPS`.

Troubleshooting decode failures or blank images:

- If `receiver.packetsReceived` increases but `decoder.packetsRejected` also increases, save a short sanitized replay payload for decoder work.
- If `decoder.packetsDecoded` increases but `renderer.imageAvailable` remains false, capture `/api/radar/status` and `/api/radar/latest.json` from the same test window.
- If `/api/radar/latest.png` is empty while packets decode, note range, angle, packet sizes, and whether the radar was in standby or transmit.
- If the radar remains in standby, try wake mode first, then transmit mode only when it is safe for the radar to radiate.

Troubleshooting Phase 3 features:

- If replay is empty, confirm `renderer.imageAvailable=true`, `replay.frameCount`, and `REPLAY_FRAME_INTERVAL_MS`. Replay frames are captured only after rendered spokes exist.
- If the dashboard stays in replay mode, click `Live` or call `POST /api/radar/replay/playback` with `{"action":"live"}`.
- If WebSocket clients do not update, check `/api/radar/status.streaming.clientsConnected`, `messagesSent`, and `updatesDropped`.
- If control settings return `radar_control_setting_failed`, confirm `RADAR_CONTROL_ENABLED=true`, the control socket is running, and the discovered or configured command endpoint matches the radar.
- If CPU or memory pressure is high, compare `/api/radar/status.process`, `/api/radar/status.replay.totalBytes`, and `npm run profile:radar` output before reducing image size or replay retention.

### Calibration Capture

Enable calibration capture when comparing BlipWatch output with chartplotter imagery. This writes a bundle at startup, then continues writing timestamped bundles at the configured interval. Each bundle contains the latest rendered PNG, render metadata, radar status, replay metadata, replay frame list, recent raw UDP payloads, and a manifest. Pair each bundle with a chartplotter screenshot or photo captured at the same moment.

```bash
CALIBRATION_CAPTURE_ENABLED=true \
CALIBRATION_CAPTURE_DIRECTORY=captures/calibration \
CALIBRATION_CAPTURE_INTERVAL_MS=10000 \
CALIBRATION_CAPTURE_PACKET_LIMIT=250 \
RADAR_DISPLAY_RANGE_METERS=463 \
RADAR_RENDER_PALETTE=chartplotter \
RADAR_BRIGHTNESS_SCALE=100 \
RADAR_TARGET_EXPANSION=100 \
npm start
```

The `packets.ndjson` file uses the same `payloadHex` line format accepted by `npm run replay:packets`, with receive timing and source metadata included for calibration. Set `RADAR_DISPLAY_RANGE_METERS` to the chartplotter range when comparing screenshots, for example `463` for 1/4 NM. Use `RADAR_RENDER_PALETTE`, `RADAR_BRIGHTNESS_SCALE`, and `RADAR_TARGET_EXPANSION` when tuning the rendered view against the chartplotter. Calibration bundles are ignored by git under `captures/` because they can reveal vessel location, marina/network details, and radar imagery. Review and sanitize before sharing.

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

Summarize a replay payload file when comparing baseline traffic with MARPA acquisition or active tracking windows:

```bash
REPLAY_PACKET_FILE=captures/marpa-investigation/<bundle>/packets.ndjson \
npm run inspect:packets
```

The packet summary reports classifier counts, payload length counts, first-eight-byte prefix counts, total bytes, delay, and average byte entropy. Use it with the repeatable capture matrix in [HALO Target and MARPA Packet Investigation](docs/halo-target-investigation.md) to identify native target metadata candidates before adding decoder support.

### Radar Performance Profiling

Use the deterministic radar profiler when checking Raspberry Pi 5 readiness or comparing changes across machines. It renders synthetic spokes, captures replay frames, and prints JSON with elapsed time, spoke throughput, replay bytes, and memory deltas.

```bash
npm run profile:radar
```

Optional workload controls:

```bash
PROFILE_IMAGE_SIZE=1024 \
PROFILE_SPOKES=4096 \
PROFILE_SAMPLE_COUNT=512 \
PROFILE_CAPTURE_EVERY=16 \
PROFILE_RANGE_METERS=2000 \
npm run profile:radar
```

Record the JSON output with the device, OS, Node.js version, and whether the process is running from source, npm, Docker, or systemd. For Raspberry Pi-style deployments, start with lower `IMAGE_SIZE`, shorter replay retention, or a larger `REPLAY_FRAME_INTERVAL_MS` if heap, RSS, or replay bytes grow too quickly.

Local reference run on macOS arm64 with Node.js 25.9.0, source execution, defaults above:

- 4096 spokes rendered in 13405 ms.
- 306 spokes per second.
- 256 replay frames captured.
- 1499392 replay PNG bytes.
- RSS delta 39600128 bytes.

## Configuration

BlipWatch is configured through environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `CALIBRATION_CAPTURE_ENABLED` | `false` | Enables periodic calibration bundles for chartplotter/render comparison. |
| `CALIBRATION_CAPTURE_DIRECTORY` | `captures/calibration` | Directory where timestamped calibration bundles are written. `CALIBRATION_CAPTURE_DIR` is also accepted as a shorter alias. |
| `CALIBRATION_CAPTURE_INTERVAL_MS` | `10000` | Interval between calibration bundle captures when enabled. |
| `CALIBRATION_CAPTURE_PACKET_LIMIT` | `250` | Maximum number of recent raw UDP payloads to include in each calibration bundle. Set to `0` to disable packet payload capture. |
| `HEADLESS` | `false` | Disables desktop browser launch when `true`. `BLIPWATCH_HEADLESS` is also accepted. Docker sets this to `true` by default. |
| `OPEN_BROWSER` | `true` unless headless | Opens the dashboard in the local desktop browser after startup. `BLIPWATCH_OPEN_BROWSER` is also accepted. |
| `PORT` | `8080` | HTTP API port. |
| `PORT_FALLBACK_ENABLED` | `true` | When the configured HTTP port is busy, try sequential fallback ports. `BLIPWATCH_PORT_FALLBACK_ENABLED` is also accepted. |
| `PORT_FALLBACK_MAX_ATTEMPTS` | `5` | Number of sequential HTTP ports to try, so the default probes `8080` through `8084`. `BLIPWATCH_PORT_FALLBACK_MAX_ATTEMPTS` is also accepted. |
| `RADAR_DISCOVERY_ENABLED` | `true` | Enables passive Navico/HALO report listening. |
| `RADAR_BRIGHTNESS_SCALE` | `100` | Percentage multiplier applied to radar return intensity before rendering. Increase for dim targets or decrease for saturated returns. |
| `RADAR_DISPLAY_RANGE_METERS` | `auto` | Render display range in meters. `auto` uses the decoded packet sweep range; set a value such as `463` to match a 1/4 NM chartplotter view. |
| `RADAR_RENDER_PALETTE` | `chartplotter` | Render color palette. Supported values are `chartplotter`, `grayscale`, and `green`. |
| `RADAR_CONTROL_ENABLED` | `true` | Enables active Navico/HALO wake or transmit commands. Set to `false` for receive-only operation. |
| `RADAR_CONTROL_MODE` | `wake` | Active control mode. Use `wake` to wake only or `transmit` to request transmit plus stay-alive. |
| `RADAR_CONTROL_WAKE_HOST` | `236.6.7.5` | IPv4 destination for the Navico wake command. |
| `RADAR_CONTROL_WAKE_PORT` | `6878` | UDP destination port for the Navico wake command. |
| `RADAR_CONTROL_HOST` | `auto` | IPv4 destination for transmit and stay-alive commands, or `auto` to use discovery before falling back. |
| `RADAR_CONTROL_FALLBACK_HOST` | `236.6.8.36` | Fallback IPv4 destination for transmit and stay-alive commands when `RADAR_CONTROL_HOST=auto` and no discovery command endpoint is available. |
| `RADAR_CONTROL_PORT` | `6516` | UDP destination port for transmit and stay-alive commands. |
| `RADAR_CONTROL_STAY_ALIVE_INTERVAL_MS` | `1000` | Interval between repeated control cycles while active control is enabled. |
| `RADAR_INTERFACE` | `auto` | Local interface address used for UDP radar packet binding, or `auto` to choose a likely hardware interface. |
| `RADAR_MULTICAST_GROUPS` | `236.6.7.8` | Comma-separated IPv4 multicast groups for radar image/spoke reception. |
| `RADAR_REPORT_MULTICAST_GROUP` | `236.6.7.5` | IPv4 multicast group used for passive Navico/HALO report discovery. |
| `RADAR_REPORT_UDP_PORT` | `6878` | UDP port used for passive Navico/HALO report discovery. |
| `RADAR_TARGET_EXPANSION` | `100` | Percentage multiplier for rendered target footprint size. Increase to make returns easier to see on high-resolution displays. |
| `RADAR_TARGET_PERSISTENCE_MS` | `4000` | Time a radar return stays at full rendered intensity before fading begins. |
| `RADAR_TARGET_FADE_MS` | `8000` | Duration of the linear fade after the persistence window. |
| `RADAR_TARGET_MAX_AGE_MS` | `15000` | Maximum age for a rendered return before it is removed. |
| `RADAR_UDP_PORT` | `6678` | UDP port used for radar packet reception. |
| `IMAGE_SIZE` | `1024` | Width and height, in pixels, of the rendered radar image. |
| `REPLAY_RETENTION_SECONDS` | `300` | In-memory replay retention window. |
| `REPLAY_FRAME_INTERVAL_MS` | `1000` | Minimum interval between captured replay frames. |
| `TARGET_TRACKING_ENABLED` | `true` | Enables the Phase 4 target abstraction and lifecycle manager. Native target decoding and detection sources are added separately. |
| `TARGET_LOST_TIMEOUT_SECONDS` | `10` | Time since last observation before an active target is marked `lost`. |
| `LOG_LEVEL` | `info` | Logging verbosity. Use `debug` for packet, decode, render, replay, and request diagnostics. |

Example:

```bash
PORT=8080 \
RADAR_DISCOVERY_ENABLED=true \
RADAR_INTERFACE=auto \
RADAR_MULTICAST_GROUPS=236.6.7.8 \
RADAR_REPORT_MULTICAST_GROUP=236.6.7.5 \
RADAR_REPORT_UDP_PORT=6878 \
RADAR_RENDER_PALETTE=chartplotter \
RADAR_BRIGHTNESS_SCALE=100 \
RADAR_TARGET_EXPANSION=100 \
RADAR_TARGET_PERSISTENCE_MS=4000 \
RADAR_TARGET_FADE_MS=8000 \
RADAR_TARGET_MAX_AGE_MS=15000 \
RADAR_UDP_PORT=6678 \
IMAGE_SIZE=1024 \
REPLAY_RETENTION_SECONDS=300 \
REPLAY_FRAME_INTERVAL_MS=1000 \
LOG_LEVEL=info \
npm start
```

## HTTP API

### `GET /`

Returns the browser dashboard with the current radar image, live diagnostics, packet counters, multicast groups, transmit/standby controls, clear screen control, advanced radar control inputs, replay controls, next actions, and raw `/api/radar/status` JSON. The dashboard refreshes status, replay metadata, and imagery automatically.

The replay panel supports returning to live mode, pausing on the newest replay frame, resuming replay playback state, scrubbing recent frames with the timeline, jumping to a timestamp, and selecting 1x, 2x, 5x, or 10x playback speed. In replay mode the main image uses `/api/radar/replay/frame`; in live mode it returns to `/api/radar/latest.png`.

The advanced controls panel exposes gain, sea clutter, rain clutter, and range controls through the same `/api/radar/control/settings` endpoint used by API clients. These controls are disabled if `RADAR_CONTROL_ENABLED=false` prevents the active command socket from starting. The dashboard range control shows unit and current range side-by-side, then steps through operator-friendly Imperial or Metric preset distances with plus/minus buttons that immediately send `rangeMeters` to the API. Standby, transmit, tuning, and range commands are active hardware commands. Clear Screen only resets BlipWatch's local rendered reflections.

### `GET /api/health`

Returns service health and basic renderer/replay state.

```json
{
  "ok": true,
  "service": "blipwatch"
}
```

### `GET /api/radar/latest.png`

Returns the latest rendered radar image.

- Content type: `image/png`
- Cache policy: `no-store`

Before radar data arrives, this returns a valid empty image.

### `GET /api/radar/latest.json`

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

### `GET /api/radar/status`

Returns hardware-focused discovery, receiver, decoder, and renderer diagnostics.

```json
{
  "diagnostics": {
    "phase": "receiving-and-rendering",
    "summary": "Radar spokes are decoding and rendering.",
    "nextActions": ["Open /api/radar/latest.png or /api/radar/latest.json to inspect current rendered imagery."]
  },
  "discovery": {
    "enabled": true,
    "running": true,
    "reportsReceived": 1,
    "lastReportAt": "2026-06-07T00:00:00.000Z",
    "lastReportSource": "192.0.2.11:6878",
    "multicastGroup": "236.6.7.5",
    "boundInterface": "0.0.0.0",
    "multicastInterface": "192.168.15.188",
    "udpPort": 6878,
    "radar": {
      "reportType": "0x01",
      "command": "0xc4",
      "status": "0x01",
      "statusName": "standby",
      "sourceAddress": "192.0.2.11",
      "sourcePort": 6878,
      "commandEndpoint": "236.6.7.10:6680",
      "dataEndpoint": "236.6.7.8:6678",
      "reportEndpoint": "236.6.7.9:6679",
      "model": "HALO",
      "serial": "123456",
      "name": "HALO",
      "firstSeenAt": "2026-06-07T00:00:00.000Z",
      "lastSeenAt": "2026-06-07T00:00:00.000Z"
    }
  },
  "receiver": {
    "running": true,
    "packetsReceived": 1,
    "lastPacketAt": "2026-06-07T00:00:00.000Z",
    "lastSourceAddress": "192.0.2.10:6678",
    "multicastGroups": ["236.6.7.8"],
    "boundInterface": "0.0.0.0",
    "multicastInterface": "192.168.15.188",
    "udpPort": 6678
  },
  "decoder": {
    "packetsDecoded": 1,
    "packetsRejected": 0,
    "lastDecodedSpokeAt": "2026-06-07T00:00:00.000Z"
  },
  "renderer": {
    "activePixelCount": 128,
    "imageAvailable": true,
    "imageSize": 1024,
    "lastRenderedImageAt": "2026-06-07T00:00:00.000Z",
    "lastSpokeAt": "2026-06-07T00:00:00.000Z",
    "maxIntensity": 255,
    "radarBrightnessScale": 100,
    "radarRenderPalette": "chartplotter",
    "renderState": "ready",
    "spokeCount": 1,
    "targetExpansion": 100,
    "targetMaxAgeMs": 15000
  },
  "replay": {
    "frameCount": 10,
    "frameIntervalMs": 1000,
    "newestFrameAt": "2026-06-07T00:00:00.000Z",
    "oldestFrameAt": "2026-06-07T00:00:00.000Z",
    "retentionSeconds": 300,
    "totalBytes": 40960
  },
  "process": {
    "uptimeSeconds": 120,
    "memory": {
      "rss": 67108864,
      "heapTotal": 18874368,
      "heapUsed": 10485760,
      "external": 2097152,
      "arrayBuffers": 1048576
    }
  },
  "streaming": {
    "clientsConnected": 1,
    "lastClientConnectedAt": "2026-06-07T00:00:00.000Z",
    "lastMessageAt": "2026-06-07T00:00:01.000Z",
    "messagesSent": 10,
    "totalClientsConnected": 2,
    "updatesDropped": 1
  },
  "control": {
    "enabled": true,
    "running": true,
    "mode": "transmit",
    "desiredState": "transmit",
    "observedState": "standby",
    "observedStateAt": "2026-06-07T00:00:00.000Z",
    "observedStateSource": "report",
    "commandTarget": "236.6.7.10:6680",
    "commandTargetSource": "discovered",
    "wakeTarget": "236.6.7.5:6878",
    "commandsSent": 3,
    "lastCommandAt": "2026-06-07T00:00:00.000Z",
    "lastCommandName": "stay-alive-a",
    "lastRequestAt": "2026-06-07T00:00:00.000Z",
    "lastError": null,
    "stayAliveIntervalMs": 1000
  }
}
```

This endpoint is intended for Phase 2 hardware testing and troubleshooting. It helps confirm whether BlipWatch is receiving UDP packets, decoding radar spokes, and rendering current imagery.

### `GET /api/radar/stream`

Opens a WebSocket stream for live radar notifications. The server sends an initial `radar.snapshot` message when a client connects, then throttled `radar.update` messages when a replay frame is captured or control/replay state changes.

Messages include current status, renderer metadata, replay metadata, and image URLs:

```json
{
  "type": "radar.update",
  "timestamp": "2026-06-07T00:00:01.000Z",
  "reason": "frame",
  "image": {
    "latestUrl": "/api/radar/latest.png",
    "replayFrameAt": "2026-06-07T00:00:01.000Z",
    "replayFrameUrl": "/api/radar/replay/frame?at=2026-06-07T00%3A00%3A01.000Z"
  },
  "renderer": {
    "imageSize": 1024,
    "renderState": "ready"
  },
  "replay": {
    "frameCount": 10
  },
  "status": {
    "diagnostics": {
      "phase": "receiving-and-rendering"
    }
  }
}
```

The stream applies lightweight throttling and skips clients with excessive buffered data. Connection counts, messages sent, and dropped update counts are exposed through `/api/radar/status.streaming`.

### `GET /api/radar/control/settings`

Returns radar tuning capabilities and the latest requested tuning state.

```json
{
  "capabilities": {
    "gain": {
      "supported": true,
      "reason": null
    },
    "seaClutter": {
      "supported": true,
      "reason": null
    },
    "rainClutter": {
      "supported": true,
      "reason": null
    },
    "range": {
      "supported": true,
      "reason": null
    }
  },
  "tuning": {
    "gain": {
      "mode": "auto",
      "value": null,
      "lastRequestAt": null,
      "lastError": null
    },
    "range": {
      "rangeMeters": null,
      "lastRequestAt": null,
      "lastError": null
    }
  }
}
```

### `POST /api/radar/control/settings`

Validates, sends, and records a requested tuning control change from the API or dashboard advanced controls panel. Radar control must be enabled and running. Range values must be between `50` and `72704` meters. The dashboard may display range presets in feet/nautical miles or meters/kilometers, but API clients should continue sending integer `rangeMeters`.

Successful responses return `200` with the updated tuning status. If the control socket is unavailable or a UDP send fails, the endpoint returns `500` with `radar_control_setting_failed`.

Examples:

```bash
curl -X POST http://localhost:8080/api/radar/control/settings \
  -H 'content-type: application/json' \
  -d '{"setting":"gain","mode":"manual","value":42}'

curl -X POST http://localhost:8080/api/radar/control/settings \
  -H 'content-type: application/json' \
  -d '{"setting":"range","rangeMeters":463}'
```

### `POST /api/radar/clear`

Clears BlipWatch's current rendered radar image and publishes a stream update so connected dashboards refresh. This does not send a hardware command and does not change radar transmit, standby, gain, clutter, or range state.

```bash
curl -X POST http://localhost:8080/api/radar/clear
```

### `GET /api/radar/replay`

Returns replay buffer metadata.

```json
{
  "frameCount": 1,
  "frameIntervalMs": 1000,
  "newestFrameAt": "2026-06-07T00:00:00.000Z",
  "oldestFrameAt": "2026-06-07T00:00:00.000Z",
  "playback": {
    "currentFrameAt": null,
    "mode": "live",
    "requestedAt": null,
    "speed": 1,
    "status": "live",
    "updatedAt": "2026-06-07T00:00:00.000Z"
  },
  "retentionSeconds": 300
}
```

### `GET /api/radar/replay/frames`

Returns available replay frame metadata.

Optional query parameters:

- `from`: ISO-8601 timestamp for the earliest frame to include.
- `to`: ISO-8601 timestamp for the latest frame to include.
- `limit`: positive integer limiting the response to the newest matching frames.

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

### `GET /api/radar/replay/frame?at=<timestamp>`

Returns the closest replay frame to the requested timestamp.

- Query parameter: `at`, an ISO-8601 timestamp
- Content type: `image/png`
- Response header: `x-blipwatch-frame-at`

Error responses:

- `400` when `at` is missing
- `404` when no replay frame is available

### `GET /api/radar/replay/playback`

Returns the current replay playback state.

```json
{
  "currentFrameAt": "2026-06-07T00:00:00.000Z",
  "mode": "replay",
  "requestedAt": "2026-06-07T00:00:00.000Z",
  "speed": 5,
  "status": "paused",
  "updatedAt": "2026-06-07T00:00:01.000Z"
}
```

### `POST /api/radar/replay/playback`

Updates replay playback state for clients that need pause, resume, jump, scrub, and return-to-live behavior.

Supported JSON fields:

- `action`: one of `pause`, `resume`, `jump`, `scrub`, or `live`.
- `at`: ISO-8601 timestamp. Required for `jump` and `scrub`.
- `speed`: optional playback speed, one of `1`, `2`, `5`, or `10`.

Example:

```bash
curl -X POST http://localhost:8080/api/radar/replay/playback \
  -H 'content-type: application/json' \
  -d '{"action":"jump","at":"2026-06-07T00:00:00.000Z","speed":5}'
```

## Docker

Build the local image:

```bash
npm run docker:build
```

Run with standard bridge networking:

```bash
docker run --rm \
  -p 8080:8080/tcp \
  -p 6878:6878/udp \
  -p 6678:6678/udp \
  -e PORT=8080 \
  -e HEADLESS=true \
  -e RADAR_DISCOVERY_ENABLED=true \
  -e RADAR_INTERFACE=auto \
  -e RADAR_MULTICAST_GROUPS=236.6.7.8 \
  -e RADAR_REPORT_MULTICAST_GROUP=236.6.7.5 \
  -e RADAR_REPORT_UDP_PORT=6878 \
  -e RADAR_UDP_PORT=6678 \
  blipwatch:local
```

For onboard hardware directly connected to a radar Ethernet network, host networking is often the simplest way to receive UDP traffic:

```bash
docker run --rm --network host \
  -e PORT=8080 \
  -e HEADLESS=true \
  -e RADAR_DISCOVERY_ENABLED=true \
  -e RADAR_INTERFACE=auto \
  -e RADAR_MULTICAST_GROUPS=236.6.7.8 \
  -e RADAR_REPORT_MULTICAST_GROUP=236.6.7.5 \
  -e RADAR_REPORT_UDP_PORT=6878 \
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
4. Open `http://<host>:8080/` to confirm the server is running and inspect the current image/status.

Example:

```bash
docker run -d --name blipwatch --restart unless-stopped --network host \
  -e PORT=8080 \
  -e RADAR_INTERFACE=auto \
  -e RADAR_MULTICAST_GROUPS=236.6.7.8 \
  -e RADAR_REPORT_MULTICAST_GROUP=236.6.7.5 \
  -e RADAR_REPORT_UDP_PORT=6878 \
  -e RADAR_UDP_PORT=6678 \
  -e LOG_LEVEL=info \
  ghcr.io/sternanchor/blipwatch:latest
```

Use `LOG_LEVEL=debug` during installation or troubleshooting to inspect UDP packet reception, decode failures, render updates, and replay capture.

Suggested Raspberry Pi tuning order:

1. Start with `IMAGE_SIZE=1024`, `REPLAY_FRAME_INTERVAL_MS=1000`, and `REPLAY_RETENTION_SECONDS=300`.
2. If `/api/radar/status.process.memory.rss` grows too quickly, reduce replay retention or increase `REPLAY_FRAME_INTERVAL_MS`.
3. If rendering lags, lower `IMAGE_SIZE` to `768` or `512`, then compare `activePixelCount`, `spokeCount`, and profiler output.
4. Use `npm run profile:radar` on the target host before and after tuning so changes have a repeatable baseline.

For systemd-style installs, run BlipWatch with a dedicated service user, set environment variables in an environment file, and prefer a wired interface on the radar network with VPNs disabled.

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
