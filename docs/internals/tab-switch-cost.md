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

The three runs lasted from the first cycle of a freshly started app to a warm app. The four switches over 200 ms in run 1
were the first visit to Disks (tasks of 202, 239 and 473 ms) and three visits to Config (207, 279 and 258 ms). In the
warm runs only Config and one Play switch (152 ms) produced tasks above 150 ms.

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
first visit to Disks after a launch does not (up to 473 ms), because of the HVSC index load and the snapshot copies,
and Config produced three of the four switches over 200 ms in run 1. The Config floor is about 170 ms with a layout of the Config page as the largest part.

## Run 4: first launch after the media index stopped copying its maps

The media index now loads the remembered browse snapshot through `loadHvscBrowseIndexSnapshotReadOnly`, which returns the
remembered maps without copying them; the copy of the song and folder maps (about 260 ms in run 1) was the largest single
cost of the first visit to Play or Disks. The keypad phone, app freshly started after installing the build, 24 switches:
2 switches had a task over 200 ms (the first Disks visit, 267 ms, and one Config visit, 242 ms), the worst task was 267 ms,
and the heap after collection was 97 MiB. Run 1 had 4 of 20 and a worst task of 473 ms. The Config visit is the layout
floor described above; reducing it further needs fewer rows rendered at once (#502).
