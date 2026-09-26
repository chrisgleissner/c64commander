# Ultimates on Ethernet and Wi-Fi at the same time

Every current Ultimate can be connected to the network over Ethernet and over Wi-Fi at once. It then
has two IP addresses, and the services it offers do not all behave the same way on both. This
document records what was measured on hardware, what the firmware source says, what the app assumes
as a result, and what is still not handled.

Measured on 2026-09-26 with a C64 Ultimate (firmware 1.2RC), an Ultimate 64 Elite (3.15) and an
Ultimate-II+L (3.15), each connected by Ethernet and Wi-Fi to the same /24 LAN, from a Linux host
on that LAN. Firmware references are to `GideonZ/1541ultimate` `master` at `ef9937a73`.

In the tables, **E** is a device's Ethernet address and **W** its Wi-Fi address.

## How to tell the two addresses apart

- `GET /v1/info` returns the same body on both addresses, including `unique_id` and `hostname`. It
  does not list the device's interfaces or addresses. `unique_id` is the only field that ties two
  addresses to one device, and the user can change it (Network Settings, Unique ID), so two devices
  can in principle report the same value.
- The Ethernet MAC address is locally administered and starts with `02:15:41`. The Wi-Fi MAC is the
  radio module's own, with a vendor OUI. The ARP table of a host on the same LAN therefore shows
  which address is which. The app cannot read the ARP table, so it does not use this.
- A local DNS server usually returns one address per host name, and which one depends on the order
  in which the device's DHCP leases were registered. On the bench, `c64u` and `u64` resolved to E
  and `u2` resolved to W.
- mDNS does not answer on either address.

## Per-service behavior

| Service | Answers on E | Answers on W | Leaves from | Notes |
| --- | --- | --- | --- | --- |
| REST (`http://…/v1/…`, port 80) | yes | yes | the address the request reached | Identical responses on both. Stream state belongs to the device, so a stream started through one address is stopped through the other. |
| FTP control (21) | yes | yes | the address the request reached | Banner: `IP = <address connected to>. Hello <client address>:<port>`. |
| FTP passive data | yes | yes | the address the control connection reached | `PASV` (227) advertises the control connection's own address. `EPSV` returns `502 Command not implemented`. |
| Telnet (23) | yes | yes | the address the request reached | |
| A/V streams (audio, video) | — | — | **always E** | See below. |
| Syslog | — | — | W on the bench | Routed per packet; see below. |
| Ident (UDP 64) | yes | yes | **W on all three devices**, also for a request sent to E; see below | A `json` request is answered with product, hostname and `unique_id`, without the password. A broadcast gets one reply per interface. |

### A/V streams leave from Ethernet only

`PUT /v1/streams/{audio|video}:start?ip=<destination>` was sent to each address with a multicast
destination and with a unicast destination on the host. For both the C64 Ultimate and the Ultimate 64
Elite, every combination produced packets from **E** only, including when the start request was sent
to **W**:

| Device | Request to | Destination | Packets from |
| --- | --- | --- | --- |
| C64 Ultimate | W | audio group `239.0.1.65:11001` | E (500 in 2 s) |
| C64 Ultimate | W | unicast host `:11701` | E (501 in 2 s) |
| C64 Ultimate | W | video group `239.0.1.64:11000` | E (6808 in 2 s) |
| C64 Ultimate | E | each of the above | E |
| Ultimate 64 Elite | W or E | each of the above | E |

The Ultimate-II+L has no streams (`/v1/streams/audio:stop` returns 404).

The firmware explains this. `DataStreamer::S_startStream` (`software/io/network/data_streamer.cc`)
always takes `NetworkInterface::getInterface(0)` (line 95), which is the Ethernet interface, and
caches its IP and MAC address for the life of the stream (lines 115–117). If that interface has no
link or no address, the start fails with `SSRET_NO_NETWORK`, which the REST API returns as
`500 No Operational Network Interface`, even when Wi-Fi is connected (line 119). Live View therefore
needs the Ethernet cable.

For a unicast destination outside interface 0's subnet, the firmware resolves the MAC address of
interface 0's gateway instead of the destination's (lines 176–179), so unicast streams are routed. A
multicast stream is sent to the Ethernet segment only.

### UDP replies leave from the interface lwIP routes through

TCP replies always carry the address the connection was made to. A UDP reply does not: lwIP picks
the outgoing interface per packet. `ip4_route` (`software/lwip/src/core/ipv4/ip4.c`, lines 170–181)
returns the first interface in `netif_list` that is up and on the destination's subnet, and only
falls back to the default interface for other subnets. `netif_add` puts each new interface at the
head of that list (`software/lwip/src/core/netif.c`, lines 429–430), so when both interfaces are on
the client's subnet, the one registered last wins. On all three devices that was Wi-Fi: an ident
request sent to E was answered from W, and syslog left from W. A client that `connect()`s its UDP
socket to E discards such a reply.

When the two interfaces are on different subnets, each reply leaves through the interface on the
client's subnet, so the asymmetry only appears on a shared subnet.

The same lookup applies to TCP: `software/network/config/lwipopts.h` does not define
`LWIP_HOOK_IP4_ROUTE_SRC`, so lwIP chooses the interface by destination alone. A TCP reply keeps E as
its source address, which is why clients see no difference, but on a shared subnet it can be sent
through the Wi-Fi interface. This follows from the source and was not measured: capturing which
interface sent a frame needs root on the bench host.

### There is no Wi-Fi stream route

`wifi=true` on stream start is rejected with
`400 "Function start does not have parameter wifi"` on both devices. The start route in
`software/api/route_streams.cc` declares only `ip`. A pull request that added a `wifi` parameter
(GideonZ/1541ultimate #732) was closed without being merged.

## Consequences for a client

1. **The stream sender is not the address the client talks to.** A client that connects to W and
   accepts stream packets only from W sees no audio or video, although the device is streaming
   normally from E. This is what happened in the app when a device was added by its Wi-Fi address.
2. **One device, two identities.** A device found by a subnet scan appears twice. A device saved by
   one address and later reached, or discovered, by the other looks like a different device unless
   the client compares `unique_id`.
3. **Per-device state keyed by address splits in two.** Anything a client remembers per device (disk
   registries, mounted-disk names, cached drive state) is lost or duplicated when the address
   changes, which happens whenever DNS or DHCP hands out the other interface.
4. **Either address can disappear.** Unplugging the cable removes E and stops streams; Wi-Fi dropping
   removes W. A client that knows both can fall back from one to the other for REST, FTP and Telnet.
5. **UDP replies can come from the other address.** A UDP client must use an unconnected socket and
   identify the device from the reply's content, not its source address.
6. **FTP passive mode stays on the connected address**, so passive transfers work over either
   interface without special handling. A client must use `PASV`, because `EPSV` is not implemented.

## What the app does

### Live View

- The native receiver (`StreamSenderFilter.kt`) accepts packets only from the selected device's
  address. When nothing has arrived about two seconds after a start, or a live stream goes silent for
  eight seconds, and the filter has refused packets, the controllers report the refused sender
  (`streams/senderMismatch.ts`, `streams/streamArrivalWatchdog.ts`).
- The session then checks whether that sender is the selected device (`streams/sameDeviceSender.ts`).
  It reads the sender's `unique_id` over ident (`StreamUdp.identify`, native `UltimateIdent.kt`),
  which needs no password, so the selected device's password is never sent to another address. The
  ident socket is unconnected, because the reply comes from the other interface. When ident does not
  answer, a REST lookup without a password is tried. The selected device's own id is read through the
  normal, authenticated connection.
- The check answers "same", "different" or "unknown". Two identities are the same machine only when
  both the `unique_id` and the hostname are known and equal, because the unique id is user-editable
  and default hostnames carry a MAC-derived suffix. A failed lookup is "unknown", never "different".
- On "same", the session accepts that address for both streams (`avMirrorSession.adoptSender`) and
  remembers it for the selected host, so the next start filters on the Ethernet address directly.
  Other answers are not remembered, so a later refusal is checked again.
- The guard that stops uninvited senders in the audio group (`streams/foreignSenderGuard.ts`) stops a
  sender only when the check answers "different", so it never stops the device's own stream, even
  when ident times out.
- The native filter resolves a new target in the background and installs it
  only if no newer target was set in the meantime, so a slow host-name lookup cannot undo an
  adoption.
- A stream start that fails with HTTP 500 means the Ethernet port has no link. The card says so
  (`streams/streamStartFailure.ts`) instead of the general "Could not tell the device to start
  streaming".
- The app no longer offers a Wi-Fi stream route and never sends `wifi=true`.

### FTP and Telnet

- A host name is resolved to all its addresses, IPv4 first, and each address is tried in turn within
  the configured connect timeout. Each attempt gets the remaining time divided by the addresses not
  yet tried, so the total never exceeds the timeout (`HostAddressConnector.kt`,
  `FtpControlConnection.kt`; `HostAddressCandidates` in `IOSFtp.swift` on iOS). A literal address is
  used as given.
- Passive data connections go to the address the control connection reached, not to the address in
  the 227 reply. On Android this is commons-net's `ipAddressFromPasvResponse = false`, set on every
  client; on iOS, `openPassiveDataChannel` uses the control connection's address and the 227 port.

### Disks

- Disk write-back state is matched by device identity rather than host string
  (`disks/diskDeviceIdentity.ts`, `disks/materializedDiskMounts.ts`). Two hosts are the same machine
  under the shared rule in `savedDevices/machineIdentity.ts`: the `unique_id` and the hostname are
  both known and equal. Otherwise the hosts are compared, and two different hosts whose identity is
  unknown are treated as possibly the same machine: a write-back that could read another disk's work
  file is refused instead of risking an overwrite of the local disk.
- The upload mount registry keys records by machine identity when it is known, so a disk mounted through
  one address keeps its name when the app is connected through the other.
- A mount in progress continues when the app switches to the same device's other address, and sends
  nothing more when it switches to a different device (`disks/deviceBoundCalls.ts`).

### Saved devices and discovery

- Discovery groups the addresses that answer with the same `unique_id` and hostname into one candidate and keeps
  every address (`DeviceDiscoveryPlugin.kt`, `deviceDiscovery/discoveryManager.ts`). A saved entry
  keeps its host when that host answered; a saved host name is kept while the app still reaches the
  device through it.
- A password-protected device found at two addresses is saved once: before saving, the app reads
  `/v1/info` with the typed password and matches the result against saved entries.
- Switching between two saved entries of the same machine changes the address only. The C64 is not
  reset, playback is not stopped and input is not released (`savedDevices/sameDevice.ts`). Live View
  is still restarted, because its sender filter changes.
- Files on the connected machine count as local on either of its saved entries, using the
  `unique_id` and hostname the connected device reports (`connection/connectedDeviceIdentity.ts`).
- The web server adds the configured password to requests for the configured host name, and for an
  IP literal that the configured name resolves to, so a client can use the device's other address.
  It never resolves another name for this, and gives up on a lookup after two seconds
  (`web/server/src/hostPolicy.ts`).

## Not handled

- **Different subnets.** When Ethernet and Wi-Fi are on different subnets and the phone is only on
  the Wi-Fi one, multicast from the Ethernet port does not reach the phone. The firmware would route
  a unicast stream through the Ethernet gateway, but the app streams only to the multicast groups, so
  Live View does not work in that setup.
- **No Ethernet cable.** Live View cannot work at all; the app now says why.
- **Duplicate identities.** Two devices given the same custom `unique_id` and the same hostname are
  treated as one machine by the identity checks above.
- **Unidentifiable sender.** When ident does not answer and the sender requires a password, the app
  cannot tell whether the sender is the selected device. It then shows the sender's address and a
  "Use <address>" button, and the user decides.
- **Web build.** The Docker web build receives streams through its server's UDP bridge, which has
  no sender filter and no identity check.
- **TCP egress.** On a shared subnet, TCP replies probably leave through the Wi-Fi interface (see
  above). This has no visible effect while both links work, and was not measured.

## Reproducing the measurements

`tools/hil/dual_homing_probe.py` repeats every measurement above for any set of devices. It groups
addresses by `unique_id`, so it needs no knowledge of a particular network:

```bash
# find every Ultimate on a subnet and measure all of them
python3 tools/hil/dual_homing_probe.py --scan <subnet>/24 --iface <this host's address> --json out.json

# or name the addresses directly
python3 tools/hil/dual_homing_probe.py --device u64=<addr1>,<addr2> --iface <this host's address>
```

It starts and stops each device's audio and video streams, so run it only when no one is using Live
View. `--no-streams` skips that part. Add `--password` if the devices have a network password.
