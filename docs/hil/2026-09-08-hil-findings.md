# HIL findings — 2026-09-08, C64 Commander 1.0.3 on Pixel 4 against real hardware

Bench: `c64u` C64 Ultimate fw 1.2RC (5D0464, 192.168.1.146), `u64` Ultimate 64 Elite fw 3.15
(38C1BA, 192.168.1.13), `u2` Ultimate II+L fw 3.15 (F13E69, 192.168.1.97). App:
`uk.gleissner.c64uremote` 1.0.3, the published build. Phone on Wi-Fi at 192.168.1.206.

## Passes

**Flight-mode to live reconnect.** The phone was in airplane mode from the release recording.
With Wi-Fi restored and the app relaunched it reached `REAL_CONNECTED` against the real device,
badge "Connected to c64u, system healthy", app log recording `verifiedUniqueId 5D0464`,
`verifiedProduct C64U`. The stale-socket wedge that has bitten this path before did not occur.

**Discovery enumerates the LAN.** "Discover devices" listed all three, each with product, IP,
firmware and unique id, and a Use button: C64 Ultimate at .146 fw 1.2RC (marked "Already saved"),
Ultimate 64 Elite at .13 fw 3.15, Ultimate II+L at .97 fw 3.15.

**Device switching works from discovery.** Selecting the Elite and then the II+L each connected
and verified the right hardware — `U64E`/38C1BA and `U2`/F13E69 — with the saved-device record
updated to match.

**Config renders each device's whole surface, and the three surfaces differ.**

| Device | Categories | Items | Rendered |
|---|---|---|---|
| c64u (1.2RC) | 22 | 222 | all |
| u64 (3.15) | 20 | 214 | all |
| u2 (3.15) | 13 | 148 | all |

Counted by pulling every category from `/v1/configs` on each device and checking each item name
against the fully expanded page. The only names that do not match literally are ones the app
deliberately relabels, and each was confirmed present under its friendlier name with the device's
own value: `Char ROM` as "Character ROM", `REU Size` as "Size", `Map Ultimate Audio $DF20-DFFF` as
"Ultimate audio", `Auto Address Mirroring` as "Auto addr mirroring", `Joystick Swapper` as
"Joystick input", `LED Select Top`/`Bot` as "Output 1"/"Output 2", and the `LedStrip *` family as
Mode / Music detect / Pattern / Brightness / Color / Tint.

Two structural points worth recording, because a page built from a fixed list would fail both:

- The c64u renders a menu-page hierarchy; the u64 and u2 render a flat category list. The app
  follows what each firmware reports rather than imposing one shape.
- The c64u exposes `LED Strip Settings` and `Keyboard Lighting` as two categories with identical
  item names and different values (intensity 4 / Amber against intensity 2 / Orange). Both are
  rendered, as "Case lights" and "Keyboard lights", each with its own values.

**Live View streams from the real machine.** "Watch" on the c64u brought up the actual C64 screen —
"**** COMMODORE 64 BASIC V2 ****  64K RAM SYSTEM  38911 BASIC BYTES FREE  READY." — at PAL 51 fps,
over multicast, and again inside the Remote Input sheet at 43-50 fps.

**Remote input reaches the real keyboard matrix.** With the sheet open and the picture live, eight
presses of SPACE moved the C64's cursor eight columns to the right, visible in the returned video.
That is the whole path proven end to end on real hardware: a tap on the phone, the REST call, the
CIA keyboard matrix, the VIC output, the multicast stream, and back to the phone's screen.

## Finding 1 — the II+L is reported unhealthy because the app asks it for categories it never advertised

Severity: high. Reproducible on every connection to the II+L.

Connecting to the Ultimate II+L gives a red badge: **"Connected to 192.168.1.97, system unhealthy,
4 problems"** on a device that is working correctly.

The app's own log shows the cause — it requests config categories that this product does not have:

    C64 API request failed  /v1/configs/SID%20Sockets%20Configuration
    C64 API request failed  /v1/configs/U64%20Specific%20Settings/Palette%20Definition

Both return HTTP 404 from the device, confirmed directly with curl. The II+L advertises 13
categories in `/v1/configs` and neither of these is among them — it is a cartridge, with no SID
sockets and no U64-specific hardware.

So the app asks for a category set it decided on rather than the set the device reported, and then
counts the resulting 404s as device problems. A II+L owner sees their healthy device described as
unhealthy from the moment they connect.

This sits directly against the rule the project already holds elsewhere, that config options come
from the device and are never hardcoded. The Config page itself honours that rule — it renders
exactly the 13 categories. Whatever issues these two requests is working from a different list.

Fix direction: derive every config request from the category list the connected device returned.
Failing that, a 404 for a category the device never advertised is not a problem and must not reach
the health count.

## Finding 2 — search finds settings by a name the app never shows

Severity: medium. Reproducible on demand, on all three devices.

The Config page relabels settings for readability, but search indexes only the raw device label, so
a setting a person can see cannot be found by the name they can see.

| Searched | On screen? | Result |
|---|---|---|
| `Brightness` | yes, under Case lights | "Nothing matches" |
| `Strip Intensity` | never displayed | found, in both lighting categories |
| `Music detect` | yes, under Case lights | "Nothing matches" |
| `LedStrip Auto SID Mode` | never displayed | found |
| `Kernal` | yes, "Kernal ROM" | found |

The tour states "Search finds any page, setting, action, tune or disk by name", so the promise is
explicit. The failing cases are exactly the settings the app took trouble to name more clearly.

Fix direction: index the displayed label as well as the device label. Nothing needs removing.

## Finding 3 — the Config page's own search box matches only category names

Severity: low. Separate control from Finding 2.

The field labelled "Search categories..." matches category names and descriptions only. `Kernal`
returns nothing there although "Kernal ROM" is the first row on the first page. The placeholder
does say "categories", so this may be intended; it is recorded because someone who has just been
told search finds any setting is likely to try it here first.

## Finding 4 — the page title scrolls under the status bar and collides with the clock

Severity: low. Reproduced on Settings and on Home, at the phone's native 1080x2280.

The app bar is `position: relative` with `padding-top: 30px`, matching
`--safe-area-inset-top`, so at the top of a page the title clears the status bar correctly. Once
the page is scrolled the bar rides up with it — measured at `-40` CSS px — and the title is then
painted across the status-bar strip, on top of the clock. Captured on Settings at 21:22
(`hil/settings-now.png`) and on Home at 21:31 (`hil/liveview.png`), where "HOME" sits over "21:31".

This is edge-to-edge behaviour rather than a broken inset: content is meant to scroll under a
translucent bar. What makes it a defect is that the title is large opaque text landing exactly on
the clock, so both become hard to read. It did not show up in the release recording because that
runs at 480x640, where the bar and the title do not meet in the same way.

## Not defects, checked and dismissed

**`u64` as a hostname.** Setting the host field to `u64` fails to connect. The phone cannot resolve
that name — it exists only in the host machine's `/etc/hosts`. The app's message was exactly right:
"Couldn't resolve 'u64'. Check the device's hostname, or use its IP address." I nearly recorded
this as a persistence bug before checking DNS from the phone.

**Empty `Audio Output Settings` on the II+L.** A capture showed the section with no rows and 32
items missing. It was still loading; a spinner was on screen and the rows appeared shortly after.
The device answers that endpoint in 43 ms, so the section is slower to populate in the app than the
device is to serve it, but it does populate and nothing is lost.
