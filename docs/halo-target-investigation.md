# HALO Target and MARPA Packet Investigation

BlipWatch Phase 4 keeps target tracking behind a normalized `RadarTarget` model while native HALO target and MARPA payload support is still being verified. This document defines the repeatable capture workflow for finding native target metadata packets without mixing them up with image spokes, discovery reports, or control traffic.

## Goals

- Capture comparable traffic windows for normal operation, MARPA acquisition, active MARPA tracking, target drop, standby, and transmit.
- Identify packet sizes, prefixes, rates, and classifier changes that only appear when MARPA targets are active.
- Preserve enough context to implement a decoder later while avoiding committed artifacts that expose vessel, marina, or network details.

## Capture Matrix

Record each scenario as a short pcap and, when possible, a matching BlipWatch replay payload file from calibration capture.

| Scenario | Radar state | Chartplotter state | What to look for |
| --- | --- | --- | --- |
| Baseline transmit | Transmit | No MARPA targets selected | Normal spoke, report, and control traffic rates. |
| MARPA acquire | Transmit | Begin acquiring a visible target | New packet sizes, prefixes, counters, or multicast groups. |
| MARPA tracking | Transmit | One or more targets actively tracked | Stable recurring payloads correlated with target updates. |
| Target dropped | Transmit | Cancel/drop one tracked target | Payload disappearance or status/state changes. |
| Standby | Standby | No active tracking | Whether native target packets stop, continue, or report lost state. |
| Transmit resume | Transmit | Previously tracked or reacquired target | Whether target identifiers persist across state changes. |

## Packet Capture

Use `RADAR_INTERFACE` as the concrete laptop interface address when possible, and keep the chartplotter online so MARPA can be controlled from a known-good device.

```bash
sudo tcpdump -i <interface> -n udp -w captures/halo-marpa-baseline.pcap
```

Capture all relevant Navico multicast/report groups while BlipWatch is running:

```bash
RADAR_UDP_PORT=6678 \
RADAR_MULTICAST_GROUPS="236.6.7.8,236.6.7.9,236.6.7.19,236.6.7.13,236.6.7.4" \
RADAR_INTERFACE=<laptop-ip> \
RADAR_CONTROL_ENABLED=true \
RADAR_CONTROL_MODE=transmit \
CALIBRATION_CAPTURE_ENABLED=true \
CALIBRATION_CAPTURE_DIRECTORY=captures/marpa-investigation \
npm run dev
```

For each scenario, note:

- UTC timestamp and local time.
- HALO model, serial, and firmware if visible.
- Laptop IP/interface and radar IP.
- Chartplotter MARPA action taken.
- Approximate target bearing/range from the chartplotter.
- BlipWatch `/api/radar/status` output.
- Any packet sizes or multicast groups visible in Wireshark that changed during the scenario.

## Replay Payload Inspection

Calibration bundles include `packets.ndjson`, which can be summarized without replaying traffic:

```bash
REPLAY_PACKET_FILE=captures/marpa-investigation/<bundle>/packets.ndjson \
npm run inspect:packets
```

The summary groups packets by current BlipWatch classifier kind, payload length, first eight payload bytes, total bytes, delay, and average byte entropy. Compare summaries between baseline and MARPA-active windows. Candidate native target metadata is most likely to appear as a new or newly frequent non-spoke length/prefix, a changed report/status packet, or traffic on a multicast group that is quiet during baseline transmit.

## Current Findings

- BlipWatch can decode and render HALO image spokes from the observed Navico/HALO frame structure.
- Passive discovery reports currently expose radar identity and command/data endpoints, not confirmed target tracks.
- No production native target decoder is implemented yet.
- Until capture comparisons prove a native target packet shape, Phase 4 target APIs and UI use the normalized in-memory target manager and leave HALO-native target ingestion as a future decoder hook.

## Safety

Only request transmit when the radar can radiate safely. Keep a chartplotter or manufacturer display available as the operational reference while BlipWatch target work is under development.
