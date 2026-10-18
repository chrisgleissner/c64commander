# Tab switch cost on the keypad phone

Issue #503 reported tab switches of about 500 ms on the keypad phone (compact profile, 320x427 CSS px). This page records
what a switch costs after the changes in #500 and what is left.

## Method

`tools/hil/tab_switch_profile.mjs` presses the keypad keys 1 to 6 in turn on the phone, waits for the route to change
and for two animation frames, then keeps a CPU profile for 700 ms after the key. It records the long tasks
(over 50 ms) of each switch through a `PerformanceObserver`, and the heap before and after, with a forced collection
before each reading. The app was a debug build with minification switched off for the run (a temporary
`build.minify: false` that is not committed), so the profile names the app's own functions. The phone was on Wi-Fi with
the app connected to the c64u, on the Home page at the start of each run.

## Results

| Run                                  | Switches | Switches with a task over 200 ms | Worst task | Heap after collection |
| ------------------------------------ | -------- | -------------------------------- | ---------- | --------------------- |
| 1, first launch after install        | 20       | 4                                | 473 ms     | 15 MiB before, 98 MiB after |
| 2, same process                      | 24       | 0                                | 181 ms     | 97 MiB before, 99 MiB after |
| 3, same process                      | 36       | 0                                | 172 ms     | 98 MiB before, 99 MiB after |

The three runs lasted from the first cycle of a freshly started app to a warm app. All four tasks over 200 ms in run 1
fell in the first visit to Play and Disks (473, 239 and 202 ms) and on Config (279 and 258 ms in the following cycles).
In the warm runs only Config produced tasks above 150 ms.

## Where the time goes

First visit to Play or Disks: the HVSC browse index is read and parsed (`parseMediaIndexSnapshotSliced`,
`buildFoldersFromSongsSliced`, `fill`, `intern`), and each caller of `loadHvscBrowseIndexSnapshot` copies the song and
folder maps of the remembered snapshot (`copySnapshot`, about 260 ms of the profile of run 1). This is also where the
heap grows from 15 to about 98 MiB: the index of a full HVSC library is held in memory. It does not grow further in
runs 2 and 3, so it is the index and not a leak.

Config, per switch, as inclusive time averaged over four switches:

| Work                                                       | Time per switch |
| ---------------------------------------------------------- | --------------- |
| Focus ring rescan slices (`step`, `refresh`, scan warmer)  | about 95 ms     |
| `AppBar` height measurement (`offsetHeight` forces layout) | about 81 ms     |
| Scroll indicator `draw` (reads scroll geometry)            | about 76 ms     |
| `useHealthState`                                           | about 11 ms     |

The layout work is the layout of the Config page itself: the three measurements read geometry after the page became
active and each pays for the same layout of a large DOM. Reducing it further means rendering fewer rows at once, which
is the structural change tracked in #502.

## Status

Acceptance for #503 was no task over 200 ms in 20 consecutive switches. A warm app meets it (0 of 24 and 0 of 36). The
first visits to Play and Disks after a launch do not (up to 473 ms), because of the HVSC index load and the snapshot
copies. The Config floor is about 170 ms with a layout of the Config page as the largest part.
