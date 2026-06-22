# Automatic Device Discovery Research

Date: 2026-06-21

## Scope

This note researches how C64 Commander could automatically discover reachable Ultimate-family devices, verify them, and integrate discovered devices into the existing saved-device/settings model.

The work included:

- reading the current C64 Commander connection, saved-device, native-bridge, Android, and iOS integration points;
- inspecting the sibling firmware repository at `/home/chris/dev/c64/1541ultimate`;
- live probing the local `u64` and `c64u` devices;
- checking mDNS behavior while accounting for `/etc/hosts` entries on this Linux machine.

The implementation that followed this research adds native Android discovery, a web no-op fallback, Settings integration, and startup/resume fallback discovery.

## Existing App Behavior Before Implementation

At the start of this work, C64 Commander had a solid verification path, but not a target-finding path.

Relevant implementation:

- `src/lib/connection/connectionManager.ts` centralizes startup/manual/settings/background discovery. Today this means probing the configured target with `GET /v1/info`.
- `src/lib/c64api/hostConfig.ts` stores and normalizes the selected device host and HTTP port.
- `src/lib/savedDevices/store.ts` stores multiple devices with host, HTTP/FTP/Telnet ports, last known product, hostname, unique ID, and verification summaries.
- `src/pages/SettingsPage.tsx` already exposes saved-device add/delete, host/port/password editing, Save & Connect, and Refresh Connection.
- Native plugin patterns already exist under `src/lib/native/`, `android/app/src/main/java/uk/gleissner/c64commander/`, and `ios/App/App/`.

Important pre-implementation limits:

- There is no `DeviceDiscovery` or mDNS native bridge today.
- Android manifest currently has `INTERNET`, foreground-service, and wake-lock permissions, but not `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, or `CHANGE_WIFI_MULTICAST_STATE`.
- iOS `Info.plist` enables local HTTP networking via `NSAllowsLocalNetworking`, but does not yet declare `NSLocalNetworkUsageDescription` or `NSBonjourServices`.
- Web/browser builds cannot reliably scan a LAN directly. A Docker/self-hosted web server could scan from the server side, but that discovers the server's LAN, not necessarily the phone/tablet's LAN.

## Firmware Findings

The firmware exposes device identity through `/v1/info`. In `software/api/routes.cc`, the `GET /v1/info` route returns:

- `product`
- `firmware_version`
- `fpga_version`
- `core_version` on U64 builds
- configured network `hostname`
- configured or default `unique_id`

The network settings in `software/network/network_config.cc` include:

- `Host Name`
- `Unique ID`
- `Network Password`
- service toggles for Ultimate Ident, DMA, Telnet, FTP, and Web Remote Control.

The firmware also enables DHCP hostname support:

- `software/network/config/lwipopts.h` sets `LWIP_NETIF_HOSTNAME 1`.
- `software/io/network/network_interface.cc` assigns `my_net_if.hostname = this->hostname`.

That means bare hostnames such as `u64` or `c64u` can work when the router/DHCP server registers DHCP option 12 into LAN DNS.

The firmware source also sets `LWIP_MDNS_RESPONDER 1` and calls `mdns_resp_add_netif(&my_net_if, this->hostname)`, but I found no application-level `mdns_resp_init(...)` call and no DNS-SD service registration such as `_http._tcp`, `_ftp._tcp`, or a custom Ultimate service. Live behavior below confirms that mDNS is not usable for these devices as currently installed.

If firmware can be changed later, the ideal firmware-side discovery improvement would be:

- initialize the mDNS responder explicitly if it is not already initialized elsewhere;
- advertise the host A record for `<configured-hostname>.local`;
- advertise at least `_http._tcp.local` on port 80;
- preferably also advertise a custom service such as `_c64ultimate._tcp.local`;
- include TXT fields such as `api=v1`, `product=...`, `fw=...`, `hostname=...`, and `id=...`.

## Live Device Findings

The local Linux workstation has `/etc/hosts` entries:

```text
192.168.1.13 u64
192.168.1.167 c64u
```

Because of that, plain `curl http://u64/...` and `curl http://c64u/...` are not valid evidence for LAN name discovery. I used those mappings only to identify the direct IP addresses, then probed the IPs directly.

Direct REST identity probes:

```text
http://192.168.1.13/v1/info
product: Ultimate 64 Elite
firmware_version: 3.14e
fpga_version: 122
core_version: 1.4B
hostname: u64
unique_id: 38C1BA
errors: []

http://192.168.1.167/v1/info
product: C64 Ultimate
firmware_version: 1.1.0
fpga_version: 122
core_version: 1.49
hostname: c64u
unique_id: 5D4E12
errors: []
```

TCP service probes showed both devices reachable on the expected service ports:

```text
192.168.1.13: 21/tcp open, 23/tcp open, 80/tcp open
192.168.1.167: 21/tcp open, 23/tcp open, 80/tcp open
```

## mDNS Findings

mDNS itself works on the LAN. A multicast query for `_services._dns-sd._udp.local` produced responses from routers, Matter devices, Spotify Connect devices, Hue, SMB, and other local services.

The Ultimate devices did not answer:

- multicast `A` queries for `u64.local`;
- multicast `A` queries for `c64u.local`;
- multicast PTR queries for `_http._tcp.local`;
- multicast PTR queries for `_services._dns-sd._udp.local`;
- direct UDP/5353 queries to `192.168.1.13` for `u64.local` or likely product default names;
- direct UDP/5353 queries to `192.168.1.167` for `c64u.local` or likely product default names.

System resolver checks agreed:

```text
getent hosts u64      -> 192.168.1.13, from /etc/hosts
getent hosts c64u     -> 192.168.1.167, from /etc/hosts
getent hosts u64.local  -> no result
getent hosts c64u.local -> no result
resolvectl query u64.local  -> no appropriate name servers or networks
resolvectl query c64u.local -> no appropriate name servers or networks
```

Conclusion: for the installed `u64` firmware `3.14e` and `c64u` firmware `1.1.0`, mDNS/DNS-SD is not a reliable discovery mechanism. It should stay out of the active app discovery path until firmware advertises a stable DNS-SD service or reliably answers hostname mDNS queries.

## mDNS Codebase Decision

A recent app commit removed the Android `MdnsResolver` plugin and its TypeScript bridge. That removal is warranted for the current app.

The firmware source suggests mDNS was intended to exist: lwIP is built with the mDNS sources, `LWIP_MDNS_RESPONDER` is enabled, and `network_interface.cc` calls `mdns_resp_add_netif(&my_net_if, this->hostname)`. However, lwIP's own mDNS documentation and example also require responder initialization, IP-change announcement, and explicit service registration for DNS-SD browsing. I did not find a firmware registration for `_http._tcp` or another Ultimate-specific service, and the live devices did not answer hostname or DNS-SD mDNS queries.

Restoring the old app mDNS resolver would add Android-specific complexity without making discovery reliable:

- Android NSD discovers services, not arbitrary products, and the tested firmware advertises no usable service.
- Bare hostname mDNS resolution still would not cover the observed installed firmware.
- Local-network scanning plus `/v1/info` verification already finds both tested devices on the Pixel 4 without needing multicast permissions or long-held multicast locks.

Keep mDNS out of the app's active discovery path for now. If future firmware starts advertising a stable service, add mDNS as a small optional candidate source inside the existing discovery plugin, not as a separate hostname-resolution layer.

## Platform Research

Android:

- Android Network Service Discovery uses DNS-SD and lets apps discover services by service type, not arbitrary devices by product family.
- Android Wi-Fi multicast receive paths commonly require a `WifiManager.MulticastLock`; Android documents that multicast packets are normally filtered and that enabling multicast can affect battery.
- A native bridge would need careful start/stop semantics, short scan windows, and no long-held multicast lock.

iOS:

- Bonjour/DNS-SD browsing requires local-network privacy handling.
- `Info.plist` needs `NSLocalNetworkUsageDescription`.
- If browsing specific Bonjour services, `NSBonjourServices` should list the service types.
- iOS can use `NWBrowser` or `NetServiceBrowser`, but current Ultimate firmware does not advertise a useful service.

Capacitor:

- Capacitor's intended pattern for this is a local native plugin with a TypeScript facade and native Android/iOS implementations.
- C64 Commander already uses this pattern for FTP, Telnet sockets, secure storage, feature flags, safe area, and other platform capabilities.

Primary references:

- Android NSD: https://developer.android.com/develop/connectivity/wifi/use-nsd
- Android `WifiManager.MulticastLock`: https://developer.android.com/reference/kotlin/android/net/wifi/WifiManager.MulticastLock
- Apple local network privacy: https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
- Capacitor custom native code/plugins: https://capacitorjs.com/docs/v6/android/custom-code and https://capacitorjs.com/docs/plugins/creating-plugins
- DNS-SD standard: https://datatracker.ietf.org/doc/html/rfc6763

## Best Discovery Strategy

The most resilient approach is a staged discovery pipeline:

1. Verify configured/saved devices first.
2. Try low-cost name candidates.
3. Fall back to a bounded native LAN scan.
4. Confirm every candidate with `/v1/info`.
5. Persist only confirmed Ultimate-family devices.

This avoids depending on any single LAN feature. It also respects the firmware reality: DHCP hostname registration may work on some routers, mDNS does not currently work on the tested devices, and a LAN scan is the only fully automatic path when no usable hostname is known.

### Stage 1: Saved Device Verification

On app start, keep the current behavior:

- if the selected saved device is reachable, use it;
- if it is not reachable, check other saved devices in parallel with strict limits;
- if a saved device verifies, switch to it using the existing saved-device switch path.

This protects users with multiple configured devices and avoids unnecessary network scanning.

### Stage 2: Low-Cost Name Candidates

Probe likely hostnames using the existing `/v1/info` verifier:

- currently selected host;
- saved-device hosts;
- `c64u`;
- `u64`;
- firmware default families: `Ultimate`, `Ultimate-II`, `Ultimate-IIp`, `Ultimate-IIpL`, `Ultimate-64`, `Ultimate-64-Elite`, `Ultimate-64-II`;
- prior `lastKnownHostname` values.

This stage is cheap and benefits LANs where the router registers DHCP hostnames. It must not conclude that discovery is broken if these names fail, because many mobile clients will not inherit desktop `/etc/hosts`, and many routers do not publish friendly DHCP names consistently.

### Stage 3: Bounded LAN Scan

Native LAN scan is the practical automatic fallback.

Recommended behavior:

- enumerate active private IPv4 interfaces from native code;
- scan only small local prefixes by default, normally `/24`;
- refuse or require manual confirmation for large networks;
- cap concurrency, for example 16 to 32 in-flight probes;
- use only `GET /v1/info` on HTTP port 80 initially;
- use short connect/request timeouts, for example 300-700 ms per host on native;
- stop early when a high-confidence selected candidate is found during startup;
- keep a total startup discovery budget, for example 3-5 seconds;
- for settings/manual discovery, allow a longer visible scan, for example 8-12 seconds;
- never scan FTP or Telnet during broad discovery. Verify those ports only after a device is selected or when the Settings page shows per-service health.

Candidate acceptance should require:

- HTTP success from `/v1/info`;
- JSON object with `product`;
- product matching `Ultimate`, `Ultimate II`, `Ultimate II+`, `Ultimate II+L`, `Ultimate 64`, `Ultimate 64 Elite`, `Ultimate 64-II`, `C64 Ultimate`, or known future variants;
- preferably `hostname` and `unique_id`.

The direct-IP scan should store the IP address as the connection host by default, because it is the address that was proven reachable. If the `/v1/info` hostname is also reachable through normal resolution from the same device, the app can offer or prefer the hostname, but it should not replace a working IP with an unverified name.

## Integration Recommendation

Add a new discovery layer without replacing the current connection manager:

- `src/lib/deviceDiscovery/` for pure orchestration, candidate normalization, ranking, and dedupe;
- `src/lib/native/deviceDiscovery.ts` and `.web.ts` as the Capacitor facade;
- Android `DeviceDiscoveryPlugin.kt` for interface enumeration and bounded HTTP probing;
- iOS `DeviceDiscoveryPlugin.swift` for bounded HTTP probing if iOS discovery is added later;
- a web implementation that returns unsupported for browser-only builds, and a separate server-side path if the Docker web server should support LAN discovery from the server host.

Suggested candidate model:

```ts
type DiscoveryCandidate = {
  address: string;
  host?: string;
  httpPort: number;
  source: Array<"saved" | "hostname" | "lan-scan">;
  product?: string;
  firmwareVersion?: string;
  hostname?: string;
  uniqueId?: string;
  confidence: "verified" | "probable";
  lastSeenAt: string;
};
```

Candidate dedupe should prefer `unique_id`, then `(hostname, product)`, then IP address.

Startup behavior:

- If no saved device exists beyond the initial default, or the selected saved device cannot be reached, start discovery automatically.
- Do not show a blocking screen while discovery is in progress. Keep the app usable and show a concise connection state in the existing badge/diagnostics surfaces.
- If exactly one verified candidate is found, add/update a saved device, select it, and connect.
- If multiple verified candidates are found, select the best ranked candidate only when it clearly matches the previous selected identity. Otherwise surface a picker.
- If no candidates are found, keep the current offline/demo behavior.

Settings behavior:

- Add a "Discover devices" action near the existing Connection controls.
- Present results as a bottom-sheet workflow, not a confirmation modal, because discovery is exploratory and stateful.
- Each result should show product, hostname, unique ID, IP address, firmware version, and whether it is already saved.
- Selecting a result should populate/update a saved device and then call the existing Save & Connect or saved-device switch verification path.

Ranking:

1. Current selected saved device identity match.
2. Saved device with matching `unique_id`.
3. Saved device with matching hostname/product.
4. Single discovered device.
5. Most recently seen verified device.
6. Otherwise require user choice.

Device safety:

- Treat discovery as background/system intent only.
- Use `GET /v1/info` only during broad scans.
- Bound total request count and concurrency.
- Respect existing circuit-breaker/backoff concepts.
- Do not scan continuously in the background. Re-run only on startup failure, resume after offline state, explicit Settings action, or a long backoff interval.
- Log discovery results without exposing passwords. Host/IP values already need normal diagnostic redaction.

## UX Recommendation

The user suggestion is the right product shape:

- automatic on app start when no real configured device exists or the configured device cannot be reached;
- manually triggerable from Settings where devices are currently entered manually.

The automatic path should be quiet when it succeeds and transparent when it does not. The Settings path should be explicit and inspectable.

Recommended visible states:

- `Searching for devices` in the connection badge/diagnostics details while the scan runs;
- `Found U64 Elite at 192.168.1.13` as a non-intrusive success toast only for manual Settings discovery;
- no repeated foreground toasts during startup/background scans;
- a Settings result list for multiple devices or ambiguous identities.

## Risks

- LAN scanning can look noisy on managed networks. Keep it native-only, private-subnet-only, bounded, and user-triggered except when the configured target is missing/offline.
- DHCP hostname discovery is router-dependent.
- mDNS cannot be relied on until firmware advertises usable records and services.
- iOS local network permission can become a user-visible blocker; the prompt should be tied to an obvious user action where possible.
- Web discovery needs a separate server-side design and should not be assumed equivalent to native mobile discovery.

## Bottom Line

The best overall design is not "mDNS discovery"; it is verified candidate discovery with multiple inputs.

Use `/v1/info` as the authoritative identity check, because it returns product, firmware, hostname, and unique ID. For today's tested firmware, the automatic path needs a bounded native LAN scan plus low-cost hostname probes, then it should integrate discovered devices into the existing saved-device model and reuse the current Save & Connect / switch verification flow. mDNS should remain a documented future option, not active code.
