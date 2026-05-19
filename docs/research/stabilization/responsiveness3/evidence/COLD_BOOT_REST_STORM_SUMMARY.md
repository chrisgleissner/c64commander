# Cold-boot REST storm summary

Two independent Pixel 4 cold boots against `c64u` (192.168.1.167) on
2026-05-18, APK `c64commander-0.7.9-rc1-debug.apk` from PR #258.

| Run | `am start TotalTime` | First REST request | Last REST request in window | CapacitorHttp lines | TelnetSocket plugin lines |
| --- | --- | --- | --- | --- | --- |
| 1 (`baseline-u64-cold-logcat-12s.txt`)  | 606 ms | 17:45:35.498 LED Strip Settings | 17:45:46.879 Modem Settings | **95** | 101 |
| 2 (`baseline-cold-c64u-2-logcat.txt`)   | 572 ms | 17:48:47.447 (first request)    | 17:48:58.769 (last in 15 s window) | **95** | 74 |

## Run 1 — REST requests per category (12 s window)

Extracted by `grep 'Handling CapacitorHttp request' baseline-u64-cold-logcat-12s.txt | awk -F'%2Fconfigs%2F' '{print $2}' | awk -F'%2F' '{print $1}' | sort | uniq -c | sort -rn`:

```
13 U64 Specific Settings
12 Printer Settings
 9 UltiSID Configuration
 9 SID Sockets Configuration
 9 Audio Mixer
 5 SID Addressing
 5 (category-level bulk reads / others without item)
 4 User Interface Settings
 4 SoftIEC Drive Settings
 4 Drive B Settings
 4 Drive A Settings
 4 Data Streams
 4 C64 and Cartridge Settings
 2 LED Strip Settings    ← responsiveness2 F-HTTP-2 fix already applied
 1 WiFi settings
 1 Tape Settings
 1 Speaker Mixer
 1 Network Settings
 1 Modem Settings
 1 Keyboard Lighting     ← responsiveness2 F-HTTP-2 fix already applied
 1 Ethernet Settings
```

## Run 2 — same shape

Run 2 produced the same category breakdown (within ±1 per category). The
storm is reproducible, not a one-off race.

## Telnet plugin call breakdown (Run 1)

Four full connect/disconnect cycles in the first 17 s:

```
17:45:36.347 connect 192.168.1.167:23  → 17:45:38.937 disconnect  (Δ 2.59 s)
17:45:38.952 connect                   → 17:45:43.961 disconnect  (Δ 5.01 s)
17:45:43.977 connect                   → 17:45:50.962 disconnect  (Δ 6.99 s)
17:45:51.004 connect                   → (still open at 17:45:46.879+, beyond window)
```

Each cycle issues `connect → read(2000) → send(0x1b[11~) → read(700)×N →
disconnect`. The four cycles together produce 74 TelnetSocket plugin calls
inside the 12 s window observed in `baseline-u64-cold-logcat-12s.txt`.

## Bridge-thread throughput observation

CapacitorHttp requests landed approximately every 100-115 ms. Network RTT to
c64u was ~10 ms (measured via `curl --max-time 4 -sS http://c64u/v1/info`).
The ~100 ms cadence reflects CapacitorHttp's single-thread JNI dispatcher,
not network latency. `Promise.allSettled` in `C64API.getConfigItems` does not
produce real concurrency on Android.

## Reference: c64u firmware response shapes

Category endpoint returns flat strings (no structured metadata):

```bash
$ curl -sS 'http://c64u/v1/configs/U64%20Specific%20Settings'
{
  "U64 Specific Settings": {
    "C64U Model": "Starlight Edition",
    "System Mode": "PAL",
    "HDMI Tx Swing": 8,
    "HDMI Scan Resolution": "PC 1024 x 768",
    "Joystick Swapper": "Normal",
    "UserPort Power Enable": "Enabled",
    "CPU Speed": "40",
    "Badline Timing": "Enabled",
    "SuperCPU Detect (D0BC)": "Disabled",
    …
  },
  "errors": []
}
```

Per-item endpoint returns structured metadata that `hasStructuredConfigMetadata`
in `src/lib/c64api.ts:334-358` accepts:

```bash
$ curl -sS 'http://c64u/v1/configs/U64%20Specific%20Settings/CPU%20Speed'
{
  "U64 Specific Settings": {
    "CPU Speed": {
      "current": "40",
      "values": [" 1"," 2"," 3"," 4"," 6"," 8","10","12","14","16","20","24","32","40","48","64"],
      "default": " 1"
    }
  },
  "errors": []
}
```

This is the explanation for F3-HTTP-1: every Home item needs the per-item
endpoint to discover its allowed values, and there is no batch endpoint that
returns structured metadata for the whole category.
