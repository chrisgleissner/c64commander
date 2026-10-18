# Long screen-off local playback: battery and thermal measurements

Issue #505 asks whether long screen-off playback drains the battery or heats the phone. This page records one 30 minute
run and what it can and cannot show.

## Run 1: local engine, SID Radio Chill / Ambient, screen off, 30 minutes (2026-10-17)

Setup:

- Pixel 4 (API 36), default edition build, media volume left at 8 of 25. The engine was set to "Here", playback was
  started from the SID Radio tile (Chill / Ambient), then the screen was turned off with `KEYCODE_SLEEP`. Playback ran
  through several tunes for the whole 30 minutes (the screen was woken afterwards and the player was still playing).
- The phone was on USB power and the battery was at 100 % ("Full"). To let `batterystats` account for the app,
  `dumpsys battery unplug` (software override) and `dumpsys batterystats --reset` were issued at the start, and
  `dumpsys battery reset` at the end (afterwards `USB powered: true` again). The phone was never physically unplugged.
- Because the phone stayed on the charger, the drain figures below are `batterystats` model estimates, not measured
  current. `current_now` in sysfs (-2.8 to +32.8 mA, noise around zero, status "Full") reflects the charger, not the app.
- While the override is active, `dumpsys battery` froze its temperature at 33.5 C and level at 100. Battery
  temperature was therefore read from `/sys/class/power_supply/battery/temp`, which kept updating. This may also explain
  the constant 34.0 C in the earlier soak samples quoted in #505, if those used `dumpsys battery`.

| Time (min) | Battery temp (sysfs) | cpu-0-0 | Other zones (sdm-therm / pa-therm) | App CPU time since start (user + system) | batterystats app estimate (mAh) | Partial wakelock | RSS (MB) |
| ---------- | -------------------- | ------- | ---------------------------------- | ---------------------------------------- | ------------------------------- | ---------------- | -------- |
| 0          | 33.5 C (dumpsys)    | n/a     | n/a                                | 0 s                                     | 0.16                            | 4 s              | n/a      |
| 5          | 32.4 C               | 40.7 C  | 35.0 / 32.9 C                      | 121 s                                    | 0.49                            | 5 m 29 s         | 364      |
| 10         | 31.6 C               | 39.5 C  | 34.2 / 32.0 C                      | 251 s                                    | 0.78                            | 10 m 23 s        | 399      |
| 15         | 30.7 C               | 39.1 C  | 33.9 / 31.7 C                      | 396 s                                    | 1.12                            | 15 m 22 s        | 371      |
| 20         | 30.2 C               | 38.0 C  | 32.9 / 31.0 C                      | 505 s                                    | 1.57                            | 20 m 21 s        | 354      |
| 25         | 29.8 C               | 37.6 C  | 33.0 / 30.8 C                      | 645 s                                    | 2.02                            | 25 m 21 s        | 377      |
| 30         | 29.6 C               | 37.2 C  | 32.7 / 30.5 C                      | 762 s                                    | 2.46                            | 30 m 10 s        | 370      |

Notes on the columns: CPU time is `utime + stime` from `/proc/<pid>/stat` (10 ms ticks) of the app process, which
stayed the same PID (9174) throughout, minus the sample taken at screen-off. The 0 minute row's thermal zones were not
read (the first `thermalservice` query returned stale cached values of about 62 C, which were discarded). The 0 minute
estimate of 0.16 mAh was taken just after the reset, before the screen turned off. `dumpsys cpuinfo` was not used
because it reports a stale averaged percentage.

What the numbers show:

- Average app CPU use over the 30 minutes: 762 s of CPU in 1800 s, about 42 % of one core, ranging from 109 to 145 s per
  5 minute interval (first interval 4.5 minutes). No upward trend.
- `batterystats` attributes about 2.3 mAh to the app over the 30 minutes, about 4.6 mAh per hour, nearly all of it to the
  foreground service (2.29 mAh), which held a partial wakelock for the whole 30 minutes (30 m 10 s). On the 2200 mAh
  estimated capacity that is about 0.2 % of the battery per hour. The model probably under-reports the cost of audio
  output and the CPU load, so treat this as a lower bound.
- Temperatures fell throughout: battery 32.4 to 29.6 C, cpu-0-0 40.7 to 37.2 C. The screen going off, not the playback,
  dominates the trend. There was no heating.
- Memory was stable between 354 and 399 MB resident.

## Not measured

- Real battery drain. The phone was charging; no unplugged run was made, so no percentage-per-hour figure exists.
- Playback on the Ultimate (engine "C64") for comparison. It was not run for lack of time.
- Runs longer than 30 minutes (the issue asks for 2 hours).
- The keypad handset. This run used the Pixel 4 only.

## Decision

On the thermal data, no power-saving option is needed: nothing heated up, CPU time per interval was flat and memory was
flat. On drain, this run cannot support a decision either way: the estimate is small, but it is a model estimate on a
charging phone, and the app does use about 42 % of a core with a foreground-service wakelock held. #505 should stay open
until an unplugged run (wireless debugging, or the physical cable removed) records percentage and temperature at 30
minutes and 2 hours, local engine against the Ultimate. If that run shows more than a few percent per hour, the CPU
load of the local render path is the first thing to reduce.

## How to complete the unplugged measurement

An unplugged run needs a person to remove the cable, so it has not been done. `tools/hil/battery_soak_hil.mjs` records
battery capacity, charge counter, status, battery temperature, the app's CPU time and memory every 30 seconds, and
reports a drain figure only when at least 90 % of the samples read "Discharging".

1. Enable wireless debugging on the phone (Developer options) and pair it with the host, so that droidctl lists the phone
   under an `ip:port` serial. Keep the USB cable attached.
2. Charge to at least 80 %, start the app, select the engine ("Here" for the local engine, "C64" for the Ultimate),
   start SID Radio (Chill / Ambient) and turn the screen off.
3. Start `node tools/hil/battery_soak_hil.mjs --serial <ip:port> --minutes 30 --label local-engine`, then unplug the cable.
4. Repeat with the other engine, and with `--minutes 120` once the 30 minute figures are known.

## Runs 2 and 3: unplugged measurement without touching the cable (2026-10-18)

The Pixel 4 here is a userdebug build, so `adb root` followed by `echo 1 > /sys/class/power_supply/charger/charge_disable`
stops charging while the USB cable stays attached. The battery status keeps reading "Charging" (it follows the USB port),
so `tools/hil/battery_soak_hil.mjs` now also counts a sample as off the charger when `charge_disable` reads 1. The
fuel gauge reports `charge_counter` in steps of about 12 mAh, so a 30 minute run resolves the drain to one step. Charging was
switched on again after the runs (`echo 0`).

Both runs: default edition build, screen off from the start, SID Radio Chill / Ambient, media volume 3 of 25, c64u as the
Ultimate, 30 minutes, 60 samples, all 60 off the charger. A first attempt was discarded because a person used the phone
during it.

| Engine         | Drain over 30 min | Rate        | App CPU time in 30 min | Battery temperature    |
| -------------- | ----------------- | ----------- | ---------------------- | ---------------------- |
| Here (local)   | 1 step (6 mAh)    | 2.0 %/h     | 704 s (39 % of a core) | 30.2 C to 29.3 C       |
| C64 (Ultimate) | 0 steps           | below 0.5 %/h | 240 s (13 % of a core) | 29.2 C to 27.4 C       |

The local engine renders the tune on the phone and costs about three times the CPU of the C64 engine, which only
receives control traffic. At 2 % per hour a full battery lasts about 50 hours of screen-off local playback, and the
battery did not warm up in either run. The question in #505 was whether more than a few percent per hour needs a
power-saving option: it does not, so no option is added.

Not measured: the keypad handset (its battery gauge is not exposed over droidctl), and runs longer than 30 minutes.
CPU time per 5 minute interval was flat in the earlier run, so a longer run is not expected to differ.

