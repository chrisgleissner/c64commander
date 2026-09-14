# droidctl

MCP server that deploys and drives the Android application under test. It is the device-driving peer
that `c64scope` calls: `c64scope` owns sessions, evidence timelines and assertion records, `droidctl`
owns install, lifecycle, raw input, capture, logs and the WebView port forward.

## Quick start

```bash
cd droidctl
npm install
npm run check          # build + test
npm run mcp            # start MCP server (stdio transport)
node scripts/start.mjs # bootstrap deps if needed, then start from TypeScript
```

## Repository scripts (from root)

```bash
npm run droid:build          # compile TypeScript
npm run droid:test           # run unit tests
npm run droid:test:coverage  # run tests with coverage
npm run droid:check          # build + test
npm run droid:mcp            # start MCP server
```

`.mcp.json` starts `droidctl/scripts/start.mjs`, which installs the package's own dependencies on first
start. `scripts/setup-agentic-mcp.mjs` is the single writer of MCP configuration across `.mcp.json`,
`~/.codex/config.toml` and `~/.claude.json`; `droidctl` is registered there.

## Target selection

**Every tool takes an explicit `targetId` and refuses to guess.** There is no default target, no "the
only connected device" fallback and no prefix that resolves to a single candidate. A target id that
matches nothing is `target_not_found`; one that matches more than one device is `ambiguous_target`
listing the candidates. Call `droid_target.list_targets` first and pass an id it returned.

Every tool that names an application takes an explicit `package`, because two application ids can be
installed at once and both open a WebView DevTools socket.

`droidctl://reference/targeting-rules` serves the full rule list as an MCP resource.

Resolution is deliberately not cached. Every tool call lists the devices again, which is the server's
only check that the target is still attached: a device that disconnected or became ambiguous since the
previous call is refused rather than acted on. Measured against the Pixel 4 on USB, that listing costs
3.6 ms median, against a 14.9 ms floor for any single `adb shell` round trip the tool must then make —
18.5% of the cheapest possible call (`run_shell ["true"]`, 19.2 ms) and 5.5% of a tap-shaped one
(64.2 ms). `tests/targeting.test.ts` fails if a resolution cache is introduced.

`apiLevel` is populated by reading `ro.build.version.sdk`. That read is cached per connection rather
than per listing: the cache is keyed on the serial plus adb's transport id, which changes whenever a
device reattaches, and entries for devices absent from a listing are dropped. So a device is read once
when it attaches and never again, which keeps the per-call listing at 3.6 ms; the first listing after a
device attaches costs 23.5 ms. A target not in state `device` is never queried and reports a null
`apiLevel`.

## Tool surface

| Domain          | Tools                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `droid_target`  | `list_targets`, `describe_target`                                                                             |
| `droid_app`     | `install_app`, `uninstall_app`, `start_app`, `stop_app`, `clear_app_data`, `write_app_file`, `read_app_file` |
| `droid_input`   | `tap`, `swipe`, `type_text`, `press_key`                                                                      |
| `droid_capture` | `screenshot`, `ui_hierarchy`, `start_recording`, `stop_recording`, `logcat`                                   |
| `droid_assert`  | `assert_visible`, `assert_not_visible`                                                                        |
| `droid_device`  | `prepare_device`, `run_shell`, `forward_webview`, `push_file`, `pull_file`                                    |

The JSON Schema advertised over `tools/list` is derived from each tool's zod schema by
`src/tools/jsonSchema.ts`, so there is no second declaration to drift: a constraint enforced at execute
time is advertised, and a construct the derivation cannot express fails at import instead of quietly
understating the validator. The one thing it cannot carry is a zod `.refine()`, which is a runtime-only
predicate; `tests/contract.test.ts` lists each of those explicitly and asserts the disagreement is real.
`tests/fixtures/advertisedSurface.json` locks the surface callers see, so a change to it is deliberate.

## Transports

One interface, two backends, so a caller does not branch on which is in use.

- **`adb`** — the physical handset on USB, Android emulators, and containers reached with
  `adb connect`. Every invocation carries `-s <serial>`; only enumeration runs without one.
- **`ssh`** — a Linux phone whose Android apps run inside an Android compatibility container, reached
  over SSH on the phone's USB network link. It is listed as `ssh:<user>@<host>` beside the adb targets
  and uses one of two routes into the container, chosen at runtime.

`droidctl://reference/transport-support` serves the per-tool support matrix, with one column for adb
and one for each ssh route.

## Linux phone with an Android compatibility container

### Routes

- **`container-adb`** (preferred). droidctl opens an SSH port forward from `127.0.0.1:<free port>` on
  this computer to the container's adb daemon, runs `adb connect` on it, and hands every operation to
  the adb backend with that serial. Every tool is supported and its results match an ordinary adb
  target; `tests/sshParity.test.ts` runs the same tool calls through both and compares them. The adb
  transport leaves the tunnel's `127.0.0.1:<port>` serial out of its own listing, so the phone appears
  under one target id.
- **`container-attach`** (fallback). droidctl runs commands inside the container as root through a
  container attach command over SSH. App lifecycle, install (`pm install` with the APK on stdin),
  app files, logcat, screenshot, `run_shell`, `prepare_device` and file transfer work. Input
  injection, UI hierarchy and assertions, screen recording and `forward_webview` are refused with
  `unsupported_on_transport`, because a UI-session command run that way can exit 0 without effect, and
  the message names what is missing for the `container-adb` route. The probe also checks that the
  attach command passes stdin into the container; where it does not, `install_app`, `write_app_file`
  and `push_file` are refused there too.

### Detection order

Nothing needs to be passed to droidctl. Every listing runs these steps per host, and each step gates
the next; `droidctl://reference/ssh-transport` serves the same list.

1. Read `DROIDCTL_SSH_*` and the optional `ssh.json` (see [Configuration](#configuration)).
2. For each USB network interface bound to a USB gadget driver (`rndis_host`, `cdc_ether`, `cdc_ncm`,
   `cdc_eem`, `cdc_subset`), take `192.168.2.15` when it is inside the interface's subnet, plus any
   neighbour with a locally administered MAC address. Configured hosts are always added. A USB
   Ethernet adapter binds a chipset driver and is never probed. A neighbour that does not answer on
   the SSH port, such as a phone sharing its connection over USB, is left out of the listing; the
   conventional address and configured hosts are listed with the prerequisite instead.
3. Connect to the SSH port.
4. Log in with a key (`BatchMode=yes`, so a missing key fails instead of prompting) and run one probe
   script that reports uid, passwordless sudo, whether `system_server` is running, listening TCP
   sockets and candidate attach helpers.
5. Require a running Android container (`system_server` process on the host). If `/proc` hides other
   users' processes, the state is unknown and detection continues.
6. `container-adb`, first pass: check the adb client, then forward the configured endpoint or a port
   5555 listening on the phone, `adb connect`, and wait until adb lists it as `device` or
   `unauthorized`.
7. Root for the attach route: login user is uid 0, or `sudo -n` works, or `root@<host>` accepts the
   same key.
8. Attach command: the configured one, otherwise each `*-attach` helper in the phone's `bin`
   directories, each LXC container found through its `[lxc monitor]` process (attached with that
   container's lxcpath), and each container `lxc-ls --running` lists. Each is verified by running
   `getprop` inside the container and reading an integer SDK level.
9. `container-adb`, second pass: adb ports the container announces in `service.adb.tcp.port` or
   `persist.adb.tcp.port`.
10. Route: `container-adb` if adb lists the tunnel as `device`, otherwise `container-attach`,
    otherwise none.

`droid_target.list_targets` reports `route` and `missingPrerequisites` for each ssh target, and
`droid_target.describe_target` adds a `connection` block with the host, how it was found, the route,
the tunnel serial or attach command, and per route `usable`, `unavailable` or `not-checked` with its
missing prerequisites. A target with no route is still listed; every tool on it fails with
`transport_unavailable`, the prerequisites in detection order in the message, and the same list under
`details.prerequisites`.

A host with a working tunnel is not probed again while adb lists the tunnel. A host on the attach route
is re-checked after 60 s or when its SSH connection ends, and a blocked host after 10 s, so a fixed
prerequisite is picked up by a later call without restarting droidctl. Tunnels are closed when the MCP
client disconnects.

### Missing prerequisites

| id                           | Reported when                                                              |
| ---------------------------- | -------------------------------------------------------------------------- |
| `ssh-config`                 | `ssh.json` or a `DROIDCTL_SSH_*` variable is invalid.                      |
| `usb-network-address`        | A USB gadget network interface has no IPv4 address.                        |
| `usb-network-peer`           | No phone address can be derived from that interface.                       |
| `ssh-client`                 | `ssh` cannot be started on this computer.                                  |
| `developer-mode`             | The SSH port refuses connections: developer mode or remote login is off.   |
| `host-unreachable`           | The SSH port does not answer, or ssh times out.                            |
| `ssh-host-key`               | The phone's host key differs from `~/.ssh/known_hosts`, typically after a reset. |
| `ssh-key`                    | The phone refuses key authentication for the login user.                   |
| `ssh-failed`                 | ssh fails in a way not listed here; its output is quoted.                  |
| `android-container`          | SSH works but the Android container is not running.                        |
| `adb-client`                 | `adb` cannot be run on this computer.                                      |
| `container-adb-disabled`     | No adb daemon accepts a connection inside the container.                   |
| `container-adb-unauthorized` | adb reached the container but this computer's key is not authorised yet.   |
| `container-adb-connect`      | adb could not complete a connection through the tunnel.                    |
| `ssh-forwarding`             | The phone's SSH server refused the port forward.                           |
| `root-access`                | No root without a password for the attach route.                           |
| `attach-command`             | No command that runs a program inside the container was found or worked.  |

Each message states the step that supplies the prerequisite, for example the exact `ssh-copy-id` or
`nmcli` command.

### Setup on Kubuntu 24.04

1. **Packages on this computer.**

   ```bash
   sudo apt install openssh-client adb
   ```

2. **On the phone.** Enable developer mode, turn on remote (SSH) login, and set the developer
   password. Connect the phone with a USB-C data cable, select the developer USB mode that provides
   networking, and keep the phone unlocked: a locked phone refuses SSH. If the phone's USB IP address
   setting is not `192.168.2.15`, set `DROIDCTL_SSH_HOSTS` to the address it shows.

3. **USB networking.** No udev rule is needed: the Ubuntu kernel binds `cdc_ncm`, `cdc_ether` or
   `rndis_host` to the phone's network gadget, and droidctl finds the interface by that driver. Check
   that the interface exists and has an address in the phone's subnet:

   ```bash
   ip -br addr                                            # a new usb0 or enx... interface
   readlink /sys/class/net/<interface>/device/driver      # ends in cdc_ncm, cdc_ether or rndis_host
   nc -vz 192.168.2.15 22                                 # succeeded = SSH is listening
   ```

   If the interface has no IPv4 address after a few seconds, the phone is not handing one out; give
   it a static address in the phone's subnet and keep it for later connections:

   ```bash
   nmcli connection add type ethernet ifname <interface> con-name phone-usb \
     ipv4.method manual ipv4.addresses 192.168.2.14/24 ipv6.method disabled
   nmcli connection up phone-usb
   ```

4. **SSH key.** droidctl never types a password. Install a key once, entering the developer password
   when `ssh-copy-id` asks, and confirm a non-interactive login works:

   ```bash
   ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519
   ssh-copy-id defaultuser@192.168.2.15
   ssh -o BatchMode=yes defaultuser@192.168.2.15 true && echo key-ok
   ```

   The first connection records the phone's host key with `StrictHostKeyChecking=accept-new`. After a
   phone reset, remove the old key with `ssh-keygen -R 192.168.2.15`.

5. **Container adb route (recommended).** Start any Android app so the container is running, then open
   the container's Android Settings, tap About phone > Build number seven times, and enable Developer
   options > USB debugging and Wireless debugging. Check that adbd listens on port 5555 and connect by
   hand, using local port 15555 so an emulator on 5555 is not disturbed:

   ```bash
   ssh defaultuser@192.168.2.15 "grep -i ':15B3 ' /proc/net/tcp /proc/net/tcp6"   # a line = adbd listens on 5555
   ssh -N -L 127.0.0.1:15555:127.0.0.1:5555 defaultuser@192.168.2.15 &
   adb connect 127.0.0.1:15555           # accept the Allow debugging prompt on the phone, Always allow
   adb -s 127.0.0.1:15555 shell getprop ro.build.version.sdk
   adb disconnect 127.0.0.1:15555; kill %1
   ```

   If no authorization prompt appears, add this computer's key through the attach route instead:
   append `~/.android/adbkey.pub` to `/data/misc/adb/adb_keys` inside the container. If the container
   only offers wireless debugging with a pairing code, forward the pairing port the dialog shows, pair
   once with `adb pair 127.0.0.1:<local port> <code>`, and set
   `DROIDCTL_SSH_CONTAINER_ADB=127.0.0.1:<connect port>`.

6. **Container attach route (fallback, needs root).** droidctl uses the login user when it is root or
   has passwordless sudo; otherwise it logs in as root with the same key. Install the key for root once
   from a root shell:

   ```bash
   ssh -t defaultuser@192.168.2.15 devel-su
   # in the root shell:
   mkdir -p /root/.ssh && cat /home/defaultuser/.ssh/authorized_keys >> /root/.ssh/authorized_keys
   chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
   ```

   Check with `ssh -o BatchMode=yes root@192.168.2.15 true`. If the attach command is not found
   automatically, set `DROIDCTL_SSH_ATTACH_COMMAND`, for example `lxc-attach -n <container> --`.

7. **Verify in droidctl.** Call `droid_target.list_targets`: the phone appears as
   `ssh:defaultuser@192.168.2.15` with `state: "device"` and a `route`. If it does not, its
   `missingPrerequisites` names the step to repeat. `droid_target.describe_target` shows which route is
   in use and why the other is unavailable.

### Configuration

Optional. Environment variables override the file's `defaults`; a host listed in the file keeps its own
fields.

| Variable                      | Effect                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `DROIDCTL_SSH_CONFIG`         | JSON file to read. Default `$XDG_CONFIG_HOME/droidctl/ssh.json`, else `~/.config/droidctl/ssh.json`. |
| `DROIDCTL_SSH_DISCOVERY`      | `off` stops discovery over USB network interfaces; configured hosts are still probed. |
| `DROIDCTL_SSH_HOSTS`          | Comma-separated `[user@]host[:port]` entries to probe as well.                      |
| `DROIDCTL_SSH_USER`           | Login user. Default `defaultuser`.                                                  |
| `DROIDCTL_SSH_PORT`           | SSH port. Default 22.                                                               |
| `DROIDCTL_SSH_IDENTITY`       | Private key file, passed with `IdentitiesOnly=yes`.                                 |
| `DROIDCTL_SSH_ATTACH_COMMAND` | Command that runs a program inside the container. Replaces detection.              |
| `DROIDCTL_SSH_CONTAINER_ADB`  | `address:port` of the container's adbd as seen from the phone. Tried first.        |

```json
{
  "discovery": true,
  "defaults": { "user": "defaultuser", "identityFile": "~/.ssh/id_ed25519" },
  "hosts": [{ "host": "192.168.2.15", "containerAdb": "127.0.0.1:5555" }]
}
```

SSH connections are multiplexed through sockets in `$TMPDIR/droidctl-ssh`, which must be private to
this user; otherwise each call opens a new connection. Every ssh and adb invocation, including the
tunnel process, is journalled in `commands.jsonl`.

## Assertions

`droid_assert.assert_visible` decides visibility from the uiautomator hierarchy — the same
accessibility tree Maestro uses — and never from image comparison. `requireOnScreen` defaults to true
and intersects the node's bounds with the screen rectangle, so a node scrolled off the viewport does
not count as visible. A false assertion is a result with `passed: false` and an evidence pair, not an
exception; each candidate node carries the `rejectedBy` predicate, which keeps "not there", "there but
disabled" and "there but off-screen" apart.

`resourceId` matches the accessibility `resource-id`, which for a WebView element is its HTML `id`
attribute and **not** its `data-testid`. A harness that needs a testid keeps using CDP, over the port
forward from `droid_device.forward_webview`.

## Artifacts

Written under `artifacts/droidctl/<runId>/`, overridable per call with `runRoot` and by
`DROIDCTL_ARTIFACT_ROOT`:

```
artifacts/droidctl/dc-20260831T142530Z/
  index.json          # every artifact this run produced, with tool, timestamp and target
  raw/<name>.png      # screenshots at native resolution
  review/<name>-review.png
  hierarchies/<name>.xml
  video/<name>.mp4
  logs/logcat/<name>.log
  commands.jsonl      # every transport invocation: argv, exit code, duration, target id
```

PNG and MP4 signatures are checked at capture time, so a zero-byte capture fails where it happened
rather than at evidence validation later.

## Hardware check

Unit tests run against a faked transport and need no device. The ssh transport is tested against a
scripted phone (`tests/support/sshFakes.ts`) that answers the ssh, adb and tunnel traffic; the shell
scripts it sends are also run through a local `sh` with stand-in commands, so their quoting is checked
by a shell. The operations that genuinely need hardware are covered by one manual script, which is not
wired into any gate:

```bash
node droidctl/scripts/smoke-device.mjs --target <targetId> --package <applicationId>
```

Set `DROIDCTL_DEBUG=1` for debug logging on stderr.
