#!/usr/bin/env bash
# Per-thread CPU *rate* for a running app on the device, as a share of one core.
#
# Cumulative /proc counters say which thread has worked hardest since launch; for a
# real-time question ("is anything starving the audio thread right now?") only the rate
# matters. Samples every thread's utime+stime twice and reports the delta.
#
# Usage: thread_cpu.sh <pid> [seconds]
set -uo pipefail
PID="${1:?pid}"
SECS="${2:-10}"
snap() { adb shell "cat /proc/$PID/task/*/stat 2>/dev/null" | awk '{print $2, $14+$15, $18, $19}'; }
A=$(snap); sleep "$SECS"; B=$(snap)
paste <(echo "$A") <(echo "$B") | awk -v s="$SECS" '
  { name=$1; before=$2; after=$6; prio=$7; nice=$8;
    d=(after-before)/100.0;                     # jiffies -> seconds of CPU
    if (d > 0.005) printf "%-24s %6.1f%% of a core   prio=%-4s nice=%s\n", name, 100*d/s, prio, nice }' |
  sort -k2 -rn
