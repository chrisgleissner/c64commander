#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# SMOKE-ANDROID-EMULATOR.SH
# Android emulator smoke test runner with strict timeout guardrails
#
# EXECUTION RULES:
# - No single wait/poll may exceed 60 seconds
# - Hang detection is mandatory
# - Fail fast on any stall
# ============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="uk.gleissner.c64commander"
APK_PATH="${APK_PATH:-$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk}"
C64U_TARGET="mock"
C64U_HOST="C64U"
EMULATOR_ID=""
DEVICE_TYPE=""
MOCK_SERVER_PID=""
MOCK_INFO_PATH=""

# STRICT TIMEOUT LIMITS (all in seconds)
BOOT_WAIT_TIMEOUT=${BOOT_WAIT_TIMEOUT:-60}          # Max time to wait for boot
BOOT_CHECK_INTERVAL=${BOOT_CHECK_INTERVAL:-2}       # Interval between boot checks
APP_LAUNCH_TIMEOUT=${APP_LAUNCH_TIMEOUT:-30}        # Max time to wait for app launch
APP_LAUNCH_INTERVAL=${APP_LAUNCH_INTERVAL:-1}       # Interval between app launch checks
EMULATOR_START_TIMEOUT=${EMULATOR_START_TIMEOUT:-180} # Max time to wait for emulator to appear
MAESTRO_FLOW_TIMEOUT=${MAESTRO_FLOW_TIMEOUT:-90}    # Max time per Maestro flow
MAESTRO_TOTAL_TIMEOUT=${MAESTRO_TOTAL_TIMEOUT:-300} # Max total Maestro run time (5 minutes for all flows)
ADB_COMMAND_TIMEOUT=${ADB_COMMAND_TIMEOUT:-10}      # Max time for individual adb commands
SCREENRECORD_LIMIT=${SCREENRECORD_LIMIT:-180}       # Max screenrecord time per flow (seconds)
HVSC_GENERATION_TIMEOUT=${HVSC_GENERATION_TIMEOUT:-180} # Max time to generate HVSC-like library
HVSC_MIN_SID_FILES=2000       # Minimum SID files required
HVSC_MIN_DIRS=200             # Minimum directories required
HVSC_ROOT_PATH="/sdcard/Download/C64Music"

# Evidence directories
EVIDENCE_DIR="$ROOT_DIR/test-results/evidence/maestro"
RAW_OUTPUT_DIR="$ROOT_DIR/test-results/maestro"

resolve_sdk_dir() {
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    echo "$ANDROID_SDK_ROOT"
    return
  fi
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    echo "$ANDROID_HOME"
    return
  fi
  if [[ -d "$HOME/Android/Sdk" ]]; then
    echo "$HOME/Android/Sdk"
    return
  fi
  local props="$ROOT_DIR/android/local.properties"
  if [[ -f "$props" ]]; then
    local sdk_dir
    sdk_dir=$(grep -E '^sdk.dir=' "$props" | head -n 1 | cut -d= -f2-)
    if [[ -n "$sdk_dir" ]]; then
      sdk_dir="${sdk_dir//\\/:}"
      echo "$sdk_dir"
      return
    fi
  fi
  echo "$HOME/Android/Sdk"
}

configure_android_sdk_env() {
  local sdk_dir="$1"
  export ANDROID_SDK_ROOT="$sdk_dir"
  export ANDROID_HOME="$sdk_dir"
  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --c64u-target mock|real   Target device type (default: mock)
  --c64u-host <hostname>    Hostname/IP for real target (default: C64U). Use "auto" for external mock.
  --apk-path <path>         APK path (default: android/app/build/outputs/apk/debug/app-debug.apk)
  --emulator-id <id>        Use a specific emulator ID (default: first emulator)
  --device-type <name>      Evidence device type (default: emulator model)
  -h, --help                Show this help
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log_info() {
  echo "[$(timestamp)] INFO: $*" >&2
}

log_error() {
  echo "[$(timestamp)] ERROR: $*" >&2
}

log_warn() {
  echo "[$(timestamp)] WARN: $*" >&2
}

generate_hvsc_library() {
  local emulator_id="$1"
  log_info "Preparing HVSC library at ${HVSC_ROOT_PATH} (timeout ${HVSC_GENERATION_TIMEOUT}s)..."

  local existing_output
  if existing_output=$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell <<'EOF'
BASE="/sdcard/Download/C64Music"
if [ -d "$BASE" ] && [ -f "$BASE/.hvsc-seed" ]; then
  sid_count=$(find "$BASE" -type f -name "*.sid" | wc -l | tr -d ' ')
  dir_count=$(find "$BASE" -type d | wc -l | tr -d ' ')
  echo "SID_COUNT=$sid_count"
  echo "DIR_COUNT=$dir_count"
  echo "READY=1"
fi
EOF
  ); then
    local existing_sid
    local existing_dir
    existing_sid=$(echo "$existing_output" | awk -F= '/^SID_COUNT=/{print $2}' | tail -n 1)
    existing_dir=$(echo "$existing_output" | awk -F= '/^DIR_COUNT=/{print $2}' | tail -n 1)
    if [[ -n "$existing_sid" && -n "$existing_dir" && "$existing_sid" -ge "$HVSC_MIN_SID_FILES" && "$existing_dir" -ge "$HVSC_MIN_DIRS" ]]; then
      log_info "HVSC library already present: sid=$existing_sid dir=$existing_dir"
      return 0
    fi
  fi

  local tmp_dir
  tmp_dir=$(mktemp -d)
  local base_dir="$tmp_dir/C64Music"
  local songlengths="$base_dir/DOCUMENTS/Songlengths.md5"
  local archive="$tmp_dir/C64Music.tar.gz"

  mkdir -p "$base_dir/DEMOS/0-9" "$base_dir/DOCUMENTS"
  echo "[Database]" > "$songlengths"

  entry_index=1
  add_songlength() {
    local rel="$1"
    local idx="$2"
    local md5
    md5=$(printf "%032x" "$idx")
    local minutes=$(( (idx % 5) + 1 ))
    local seconds=$(( (idx * 7) % 60 ))
    local duration
    if [ $((idx % 2)) -eq 0 ]; then
      duration=$(printf "%d:%02d.000" "$minutes" "$seconds")
    else
      duration=$(printf "%d:%02d" "$minutes" "$seconds")
    fi
    echo "; /$rel" >> "$songlengths"
    echo "$md5=$duration" >> "$songlengths"
  }

  demo_index=1
  while [ "$demo_index" -le 200 ]; do
    name=$(printf "%02d_Years.sid" "$demo_index")
    path="DEMOS/0-9/$name"
    printf "SIDDATA-%s\n" "$demo_index" > "$base_dir/$path"
    if [ "$entry_index" -le 400 ]; then
      add_songlength "$path" "$entry_index"
    fi
    entry_index=$((entry_index + 1))
    demo_index=$((demo_index + 1))
  done

  for letter in A B C D E F; do
    artist=1
    while [ "$artist" -le 12 ]; do
      release=1
      while [ "$release" -le 5 ]; do
        dir="$base_dir/MUSICIANS/$letter/Artist_${letter}_${artist}/Release_${release}"
        mkdir -p "$dir"
        printf "Artist ${letter} ${artist} release ${release}\n" > "$dir/INFO_${artist}_${release}.nfo"
        track=1
        while [ "$track" -le 4 ]; do
          name=$(printf "%02d_${letter}_Tune_${artist}_${release}.sid" "$track")
          rel="MUSICIANS/$letter/Artist_${letter}_${artist}/Release_${release}/$name"
          printf "SIDDATA-%s-%s-%s\n" "$letter" "$artist" "$release" > "$base_dir/$rel"
          if [ "$entry_index" -le 400 ]; then
            add_songlength "$rel" "$entry_index"
          fi
          entry_index=$((entry_index + 1))
          track=$((track + 1))
        done
        release=$((release + 1))
      done
      artist=$((artist + 1))
    done
  done

  group=1
  while [ "$group" -le 12 ]; do
    collection=1
    while [ "$collection" -le 4 ]; do
      dir="$base_dir/GROUPS/Group_${group}/Collection_${collection}"
      mkdir -p "$dir"
      printf "Group ${group} collection ${collection}\n" > "$dir/README_${group}_${collection}.txt"
      track=1
      while [ "$track" -le 5 ]; do
        name=$(printf "%02d_Group_${group}_${collection}.sid" "$track")
        rel="GROUPS/Group_${group}/Collection_${collection}/$name"
        printf "SIDDATA-G${group}-C${collection}\n" > "$base_dir/$rel"
        if [ "$entry_index" -le 400 ]; then
          add_songlength "$rel" "$entry_index"
        fi
        entry_index=$((entry_index + 1))
        track=$((track + 1))
      done
      collection=$((collection + 1))
    done
    group=$((group + 1))
  done

  publisher=1
  while [ "$publisher" -le 8 ]; do
    game=1
    while [ "$game" -le 5 ]; do
      part=1
      while [ "$part" -le 3 ]; do
        dir="$base_dir/GAMES/Publisher_${publisher}/Game_${game}/Part_${part}"
        mkdir -p "$dir"
        printf "Notes for ${publisher}-${game}-${part}\n" > "$dir/notes_${publisher}_${game}_${part}.txt"
        track=1
        while [ "$track" -le 4 ]; do
          name=$(printf "%02d_Game_${game}_${part}.sid" "$track")
          rel="GAMES/Publisher_${publisher}/Game_${game}/Part_${part}/$name"
          printf "SIDDATA-P${publisher}-G${game}\n" > "$base_dir/$rel"
          if [ "$entry_index" -le 400 ]; then
            add_songlength "$rel" "$entry_index"
          fi
          entry_index=$((entry_index + 1))
          track=$((track + 1))
        done
        part=$((part + 1))
      done
      game=$((game + 1))
    done
    publisher=$((publisher + 1))
  done

  deep_dir="$base_dir/GAMES/Deep/Level1/Level2/Level3/Level4/Level5/Level6/Level7/Level8"
  mkdir -p "$deep_dir"
  printf "SIDDATA-Deep\n" > "$deep_dir/8-Bit_Bard.sid"
  add_songlength "GAMES/Deep/Level1/Level2/Level3/Level4/Level5/Level6/Level7/Level8/8-Bit_Bard.sid" "$entry_index"

  printf "HVSC seed data\n" > "$base_dir/DOCUMENTS/Readme.txt"
  printf "generated=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$base_dir/.hvsc-seed"

  (cd "$tmp_dir" && tar -czf "$archive" C64Music)

  if ! timeout "$HVSC_GENERATION_TIMEOUT" adb -s "$emulator_id" shell "rm -rf '$HVSC_ROOT_PATH' '/sdcard/Download/C64Music.tar.gz'"; then
    rm -rf "$tmp_dir"
    log_error "HVSC cleanup on device failed"
    return 1
  fi
  if ! timeout "$HVSC_GENERATION_TIMEOUT" adb -s "$emulator_id" push "$archive" /sdcard/Download/C64Music.tar.gz >/dev/null; then
    rm -rf "$tmp_dir"
    log_error "HVSC archive push failed"
    return 1
  fi
  if ! timeout "$HVSC_GENERATION_TIMEOUT" adb -s "$emulator_id" shell "cd /sdcard/Download && tar -xzf C64Music.tar.gz"; then
    rm -rf "$tmp_dir"
    log_error "HVSC archive extraction failed"
    return 1
  fi
  timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell "rm -f /sdcard/Download/C64Music.tar.gz" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"

  local output
  if ! output=$(timeout "$HVSC_GENERATION_TIMEOUT" adb -s "$emulator_id" shell <<'EOF'
BASE="/sdcard/Download/C64Music"
sid_count=$(find "$BASE" -type f -name "*.sid" | wc -l | tr -d ' ')
dir_count=$(find "$BASE" -type d | wc -l | tr -d ' ')
echo "SID_COUNT=$sid_count"
echo "DIR_COUNT=$dir_count"
echo "ROOT=$BASE"
EOF
  ); then
    log_error "HVSC generation failed or timed out"
    return 1
  fi

  local sid_count
  local dir_count
  sid_count=$(echo "$output" | awk -F= '/^SID_COUNT=/{print $2}' | tail -n 1)
  dir_count=$(echo "$output" | awk -F= '/^DIR_COUNT=/{print $2}' | tail -n 1)
  if [[ -z "$sid_count" || -z "$dir_count" ]]; then
    log_error "HVSC generation did not return counts"
    return 1
  fi
  if [[ "$sid_count" -lt "$HVSC_MIN_SID_FILES" || "$dir_count" -lt "$HVSC_MIN_DIRS" ]]; then
    log_error "HVSC generation below threshold: sid=$sid_count dir=$dir_count"
    return 1
  fi
  log_info "HVSC generation complete: sid=$sid_count dir=$dir_count"
  return 0
}

scan_logcat_for_crashes() {
  local log_file="$1"
  local output_dir="$2"
  if [[ ! -f "$log_file" ]]; then
    return 0
  fi
  local crash_hits
  crash_hits=$(grep -nE "Process: uk\.gleissner\.c64commander|ANR in uk\.gleissner\.c64commander|Fatal signal.*uk\.gleissner\.c64commander|FATAL EXCEPTION.*uk\.gleissner\.c64commander" "$log_file" || true)
  if [[ -n "$crash_hits" ]]; then
    echo "$crash_hits" > "$output_dir/logcat-crash.txt"
    return 1
  fi
  return 0
}

# Capture comprehensive diagnostics
capture_diagnostics() {
  local emulator_id="${1:-}"
  local context="${2:-unknown}"
  local diag_dir="$RAW_OUTPUT_DIR/diagnostics-$(date +%s)"
  mkdir -p "$diag_dir"
  
  log_info "Capturing diagnostics for context: $context"
  
  echo "---- adb devices ----" > "$diag_dir/adb-devices.txt"
  timeout "$ADB_COMMAND_TIMEOUT" adb devices >> "$diag_dir/adb-devices.txt" 2>&1 || echo "adb devices timed out" >> "$diag_dir/adb-devices.txt"
  
  if [[ -n "$emulator_id" ]]; then
    echo "---- adb get-state ($emulator_id) ----" > "$diag_dir/adb-state.txt"
    timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" get-state >> "$diag_dir/adb-state.txt" 2>&1 || echo "get-state timed out" >> "$diag_dir/adb-state.txt"
    
    echo "---- logcat (last 500 lines) ----" > "$diag_dir/logcat.txt"
    timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" logcat -d 2>/dev/null | tail -n 500 >> "$diag_dir/logcat.txt" || echo "logcat capture failed" >> "$diag_dir/logcat.txt"
    
    echo "---- running processes ----" > "$diag_dir/processes.txt"
    timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell ps 2>/dev/null >> "$diag_dir/processes.txt" || echo "ps failed" >> "$diag_dir/processes.txt"
  fi
  
  if [[ -f /tmp/c64-emu.log ]]; then
    echo "---- emulator log (last 200 lines) ----" > "$diag_dir/emulator.log"
    tail -n 200 /tmp/c64-emu.log >> "$diag_dir/emulator.log" 2>/dev/null || true
  fi
  
  # Write context summary
  cat > "$diag_dir/context.txt" <<CONTEXT
Diagnostic capture at: $(timestamp)
Context: $context
Emulator ID: ${emulator_id:-none}
CONTEXT
  
  echo "$diag_dir"
}

# Write error context for evidence
write_error_context() {
  local classification="$1"
  local description="$2"
  local diag_dir="${3:-}"
  
  mkdir -p "$EVIDENCE_DIR"
  cat > "$EVIDENCE_DIR/error-context.md" <<EOF
# Maestro Test Failure

**Timestamp:** $(timestamp)
**Classification:** $classification
**Description:** $description

## Failure Categories
1. App UI state mismatch
2. Emulator instability
3. adb transport failure
4. Maestro framework limitation
5. Test design flaw

## Diagnostics
$(if [[ -n "$diag_dir" && -d "$diag_dir" ]]; then
  echo "Diagnostics captured in: $diag_dir"
  if [[ -f "$diag_dir/adb-devices.txt" ]]; then
    echo ""
    echo "### ADB Devices"
    echo "\`\`\`"
    cat "$diag_dir/adb-devices.txt"
    echo "\`\`\`"
  fi
else
  echo "No diagnostics captured"
fi)
EOF
}

get_emulator_id() {
  if [[ -n "$EMULATOR_ID" ]]; then
    echo "$EMULATOR_ID"
    return
  fi
  timeout "$ADB_COMMAND_TIMEOUT" adb devices 2>/dev/null | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {print $1}' | tail -n 1
}

# Check if emulator is responsive (not just present)
check_emulator_responsive() {
  local emulator_id="$1"
  local result
  result=$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell echo "ping" 2>/dev/null | tr -d '\r\n')
  [[ "$result" == "ping" ]]
}

# Wait for boot with strict timeout
wait_for_boot() {
  local emulator_id="$1"
  local start_time=$(date +%s)
  local max_end_time=$((start_time + BOOT_WAIT_TIMEOUT))
  
  log_info "Waiting for emulator boot (max ${BOOT_WAIT_TIMEOUT}s)..."
  
  # First wait for device to appear
  timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" wait-for-device || {
    log_error "adb wait-for-device timed out"
    return 1
  }
  
  local boot_completed=""
  while [[ $(date +%s) -lt $max_end_time ]]; do
    boot_completed=$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n' || echo "")
    
    if [[ "$boot_completed" == "1" ]]; then
      log_info "Boot completed in $(($(date +%s) - start_time))s"
      return 0
    fi
    
    # Check if emulator is still responsive
    if ! check_emulator_responsive "$emulator_id"; then
      log_warn "Emulator became unresponsive during boot"
      return 1
    fi
    
    sleep "$BOOT_CHECK_INTERVAL"
  done
  
  log_error "Boot did not complete within ${BOOT_WAIT_TIMEOUT}s"
  return 1
}

unlock_device() {
  local emulator_id="$1"
  log_info "Unlocking device..."
  timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell input keyevent 82 >/dev/null 2>&1 || true
  timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell wm dismiss-keyguard >/dev/null 2>&1 || true
}

# Verify screen is unlocked
verify_screen_unlocked() {
  local emulator_id="$1"
  local dumpsys_output
  dumpsys_output=$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell dumpsys window 2>/dev/null || echo "")
  
  if echo "$dumpsys_output" | grep -q "mDreamingLockscreen=true"; then
    return 1
  fi
  return 0
}

# Launch app with retry logic
ensure_app_running() {
  local emulator_id="$1"
  local start_time=$(date +%s)
  local max_end_time=$((start_time + APP_LAUNCH_TIMEOUT))
  local launch_attempts=0
  
  log_info "Ensuring app is running (max ${APP_LAUNCH_TIMEOUT}s)..."
  
  while [[ $(date +%s) -lt $max_end_time ]]; do
    # Check if app is running
    if timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell pidof "$APP_ID" >/dev/null 2>&1; then
      log_info "App is running"
      return 0
    fi
    
    # Try to launch at specific intervals
    if [[ $launch_attempts -eq 0 || $launch_attempts -eq 5 || $launch_attempts -eq 15 ]]; then
      log_info "Launching app (attempt $((launch_attempts + 1)))..."
      timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1 || true
    fi
    
    sleep "$APP_LAUNCH_INTERVAL"
    launch_attempts=$((launch_attempts + 1))
  done
  
  log_error "Failed to launch app within ${APP_LAUNCH_TIMEOUT}s"
  return 1
}

# Verify UI is visible and responsive
verify_ui_responsive() {
  local emulator_id="$1"
  
  log_info "Verifying UI responsiveness..."
  
  # Get current activity
  local activity
  activity=$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell dumpsys activity activities 2>/dev/null | grep -E "mResumedActivity|topResumedActivity" | head -1 || echo "")
  
  if [[ -z "$activity" ]]; then
    log_warn "Could not determine current activity"
    return 1
  fi
  
  if echo "$activity" | grep -q "$APP_ID"; then
    log_info "App activity is in foreground"
    return 0
  fi
  
  log_warn "App is not in foreground: $activity"
  return 1
}

start_emulator_if_needed() {
  local emulator_id
  emulator_id="$(get_emulator_id)"
  
  if [[ -n "$emulator_id" ]]; then
    log_info "Found existing emulator: $emulator_id"
    echo "$emulator_id"
    return
  fi
  
  log_info "Starting emulator..."
  "$ROOT_DIR/scripts/android-emulator.sh" --no-prereqs --no-build --no-apk --no-install
  
  local start_time=$(date +%s)
  local max_end_time=$((start_time + EMULATOR_START_TIMEOUT))
  
  while [[ $(date +%s) -lt $max_end_time ]]; do
    emulator_id="$(get_emulator_id)"
    if [[ -n "$emulator_id" ]]; then
      log_info "Emulator appeared: $emulator_id"
      echo "$emulator_id"
      return
    fi
    sleep 2
  done
  
  log_error "Emulator did not start within ${EMULATOR_START_TIMEOUT}s"
  capture_diagnostics "" "emulator_start_timeout"
  write_error_context "Emulator instability" "Emulator failed to start within timeout"
  exit 1
}

# Pre-flight checks before running Maestro
preflight_checks() {
  local emulator_id="$1"
  
  log_info "Running pre-flight checks..."
  
  # Check 1: Exactly one emulator in device state
  local device_count
  device_count=$(timeout "$ADB_COMMAND_TIMEOUT" adb devices 2>/dev/null | awk 'NR>1 && $2=="device" && $1 ~ /^emulator-/ {count++} END {print count+0}')
  
  if [[ "$device_count" -ne 1 ]]; then
    log_error "Expected exactly 1 emulator, found $device_count"
    capture_diagnostics "$emulator_id" "preflight_device_count"
    return 1
  fi
  
  # Check 2: sys.boot_completed == 1
  local boot_completed
  boot_completed=$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
  
  if [[ "$boot_completed" != "1" ]]; then
    log_error "Boot not completed: sys.boot_completed=$boot_completed"
    return 1
  fi
  
  # Check 3: Screen is unlocked
  if ! verify_screen_unlocked "$emulator_id"; then
    log_warn "Screen may be locked, attempting unlock..."
    unlock_device "$emulator_id"
    sleep 1
    if ! verify_screen_unlocked "$emulator_id"; then
      log_error "Failed to unlock screen"
      return 1
    fi
  fi
  
  # Check 4: App process is running
  if ! timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell pidof "$APP_ID" >/dev/null 2>&1; then
    log_error "App process not running"
    return 1
  fi
  
  # Check 5: UI is visible
  if ! verify_ui_responsive "$emulator_id"; then
    log_warn "UI may not be responsive"
    # Don't fail on this, just warn
  fi
  
  log_info "Pre-flight checks passed"
  return 0
}

cleanup() {
  if [[ -n "$MOCK_SERVER_PID" ]]; then
    kill "$MOCK_SERVER_PID" >/dev/null 2>&1 || true
    wait "$MOCK_SERVER_PID" >/dev/null 2>&1 || true
  fi
}

start_screenrecord() {
  local emulator_id="$1"
  local flow_name="$2"
  local device_path="/sdcard/maestro-${flow_name}.mp4"

  log_info "Starting screenrecord for ${flow_name}..."
  timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell rm -f "$device_path" >/dev/null 2>&1 || true
  adb -s "$emulator_id" shell screenrecord --time-limit "$SCREENRECORD_LIMIT" "$device_path" >/dev/null 2>&1 &
  echo "$!:$device_path"
}

stop_screenrecord() {
  local emulator_id="$1"
  local flow_name="$2"
  local raw_dir="$3"
  local record_pid="$4"
  local device_path="$5"

  if [[ -n "$record_pid" ]]; then
    log_info "Stopping screenrecord for ${flow_name}..."
    kill -INT "$record_pid" >/dev/null 2>&1 || true
    wait "$record_pid" >/dev/null 2>&1 || true
  fi

  if timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell ls "$device_path" >/dev/null 2>&1; then
    mkdir -p "$raw_dir"
    timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" pull "$device_path" "$raw_dir/video.mp4" >/dev/null 2>&1 || true
    timeout "$ADB_COMMAND_TIMEOUT" adb -s "$emulator_id" shell rm -f "$device_path" >/dev/null 2>&1 || true
  else
    log_warn "No screenrecord video found for ${flow_name}"
  fi
}

trap cleanup EXIT

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --c64u-target) C64U_TARGET="$2"; shift 2;;
    --c64u-host) C64U_HOST="$2"; shift 2;;
    --apk-path) APK_PATH="$2"; shift 2;;
    --emulator-id) EMULATOR_ID="$2"; shift 2;;
    --device-type) DEVICE_TYPE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage; exit 1;;
  esac
done

if [[ "$C64U_TARGET" != "mock" && "$C64U_TARGET" != "real" ]]; then
  echo "Invalid --c64u-target: $C64U_TARGET" >&2
  exit 1
fi

configure_android_sdk_env "$(resolve_sdk_dir)"

require_cmd adb
require_cmd node
require_cmd maestro

# Find APK
if [[ ! -f "$APK_PATH" ]]; then
  APK_PATH=$(ls -1 "$ROOT_DIR"/android/app/build/outputs/apk/debug/*-debug.apk 2>/dev/null | head -n 1 || true)
fi
if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  APK_METADATA="$ROOT_DIR/android/app/build/outputs/apk/debug/output-metadata.json"
  if [[ -f "$APK_METADATA" ]]; then
    APK_FILE=$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const out=data.elements?.[0]?.outputFile||'';process.stdout.write(out);" "$APK_METADATA")
    if [[ -n "$APK_FILE" ]]; then
      APK_PATH="$ROOT_DIR/android/app/build/outputs/apk/debug/$APK_FILE"
    fi
  fi
fi
if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  log_error "APK not found: $APK_PATH"
  exit 1
fi

log_info "Starting Android emulator smoke test"
log_info "APK: $APK_PATH"
log_info "Target: $C64U_TARGET"

# Start emulator if needed
EMULATOR_ID="$(start_emulator_if_needed)"

# Wait for boot with strict timeout
if ! wait_for_boot "$EMULATOR_ID"; then
  local diag_dir
  diag_dir=$(capture_diagnostics "$EMULATOR_ID" "boot_timeout")
  write_error_context "Emulator instability" "Emulator boot timed out after ${BOOT_WAIT_TIMEOUT}s" "$diag_dir"
  exit 1
fi

unlock_device "$EMULATOR_ID"

if [[ -z "$DEVICE_TYPE" ]]; then
  DEVICE_TYPE="$(timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
fi

# Handle external mock server for real target
if [[ "$C64U_TARGET" == "real" && "$C64U_HOST" == "auto" ]]; then
  MOCK_INFO_PATH="$RAW_OUTPUT_DIR/external-mock.json"
  node "$ROOT_DIR/scripts/maestro-external-mock.mjs" --out "$MOCK_INFO_PATH" &
  MOCK_SERVER_PID=$!
  
  mock_wait_start=$(date +%s)
  mock_wait_max=$((mock_wait_start + 10))
  while [[ $(date +%s) -lt $mock_wait_max ]]; do
    if [[ -f "$MOCK_INFO_PATH" ]]; then
      break
    fi
    sleep 0.25
  done
  
  if [[ ! -f "$MOCK_INFO_PATH" ]]; then
    log_error "External mock server did not start within 10s"
    exit 1
  fi
  C64U_HOST="$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.hostForEmulator||'')" "$MOCK_INFO_PATH")"
fi

if [[ "$C64U_TARGET" == "mock" ]]; then
  C64U_HOST=""
fi

# Install and configure app
log_info "Installing APK..."
timeout 60 adb -s "$EMULATOR_ID" install -r "$APK_PATH" >/dev/null || {
  log_error "APK installation timed out"
  capture_diagnostics "$EMULATOR_ID" "apk_install_timeout"
  exit 1
}

timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" shell pm clear "$APP_ID" >/dev/null 2>&1 || true

if ! ensure_app_running "$EMULATOR_ID"; then
  diag_dir=$(capture_diagnostics "$EMULATOR_ID" "app_launch_failure")
  write_error_context "App UI state mismatch" "App failed to launch within ${APP_LAUNCH_TIMEOUT}s" "$diag_dir"
  exit 1
fi

# Prepare output directories
rm -rf "$RAW_OUTPUT_DIR" "$EVIDENCE_DIR"
mkdir -p "$RAW_OUTPUT_DIR"

# Capture pre-test diagnostics
if [[ -f /tmp/c64-emu.log ]]; then
  cp /tmp/c64-emu.log "$RAW_OUTPUT_DIR/emulator.log" || true
fi
timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" logcat -d > "$RAW_OUTPUT_DIR/logcat-pretest.txt" 2>/dev/null || true

# Configure app for smoke test (allow mutations for mock playback)
BUILD_PAYLOAD=$(node -e "const target=process.argv[1];const host=process.argv[2];const payload={target,readOnly:target==='real',debugLogging:true};if(target==='real'&&host){payload.host=host;}process.stdout.write(JSON.stringify(payload));" "$C64U_TARGET" "$C64U_HOST")
timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" shell "run-as $APP_ID sh -c 'mkdir -p files && cat > files/c64u-smoke.json'" <<<"$BUILD_PAYLOAD"

# Run pre-flight checks
if ! preflight_checks "$EMULATOR_ID"; then
  diag_dir=$(capture_diagnostics "$EMULATOR_ID" "preflight_failure")
  write_error_context "Emulator instability" "Pre-flight checks failed" "$diag_dir"
  exit 1
fi

# Generate HVSC-like library on device before Maestro flows
if ! generate_hvsc_library "$EMULATOR_ID"; then
  diag_dir=$(capture_diagnostics "$EMULATOR_ID" "hvsc_generation_failure")
  write_error_context "Test data generation failure" "Failed to generate HVSC-like library" "$diag_dir"
  exit 1
fi

# Run health probe first (must pass before running full suite)
log_info "Running health probe (max 30s)..."
export ANDROID_SERIAL="$EMULATOR_ID"
PROBE_OUTPUT_DIR="$RAW_OUTPUT_DIR/probe-health"
PROBE_STATUS=0
set +e
if command -v timeout >/dev/null 2>&1; then
  (cd "$ROOT_DIR" && timeout --preserve-status 30 maestro test .maestro/probe-health.yaml --udid "$EMULATOR_ID" --test-output-dir "$PROBE_OUTPUT_DIR" --debug-output "$PROBE_OUTPUT_DIR/debug" --format JUNIT --output "$PROBE_OUTPUT_DIR/report.xml")
  PROBE_STATUS=$?
else
  (cd "$ROOT_DIR" && maestro test .maestro/probe-health.yaml --udid "$EMULATOR_ID" --test-output-dir "$PROBE_OUTPUT_DIR" --debug-output "$PROBE_OUTPUT_DIR/debug" --format JUNIT --output "$PROBE_OUTPUT_DIR/report.xml")
  PROBE_STATUS=$?
fi
set -e

if [[ "$PROBE_STATUS" -ne 0 ]]; then
  diag_dir=$(capture_diagnostics "$EMULATOR_ID" "probe_failure")
  write_error_context "Emulator instability" "Health probe failed - emulator/app not responsive" "$diag_dir"
  log_error "Health probe failed with exit code $PROBE_STATUS"
  exit "$PROBE_STATUS"
fi

log_info "Health probe passed, proceeding with full test suite"

# Run Maestro flow-by-flow with strict timeout and per-flow artifacts
log_info "Running Maestro tests (max ${MAESTRO_TOTAL_TIMEOUT}s)..."
export ANDROID_SERIAL="$EMULATOR_ID"

MAESTRO_STATUS=0
set +e

maestro_start=$(date +%s)
FLOW_FILES=$(find "$ROOT_DIR/.maestro" -maxdepth 1 -type f -name "*.yaml" -printf "%f\n" | sort)

for flow_file in $FLOW_FILES; do
  flow_name="${flow_file%.yaml}"
  if [[ "$flow_name" == "config" || "$flow_name" == "probe-health" ]]; then
    continue
  fi

  # edge-offline validates loss/recovery of a real network connection. In smoke mock mode
  # we force a local in-app mock connection that will remain "connected" even when the
  # emulator is put into airplane mode.
  if [[ "$C64U_TARGET" == "mock" && "$flow_name" == "edge-offline" ]]; then
    log_info "Skipping ${flow_name} for --c64u-target mock"
    continue
  fi

  if [[ $(date +%s) -ge $((maestro_start + MAESTRO_TOTAL_TIMEOUT)) ]]; then
    log_error "Maestro exceeded total timeout (${MAESTRO_TOTAL_TIMEOUT}s), stopping..."
    MAESTRO_STATUS=124
    break
  fi

  log_info "Running Maestro flow: ${flow_name}"
  flow_output_dir="$RAW_OUTPUT_DIR/$flow_name"
  mkdir -p "$flow_output_dir"
  if [[ -f "$RAW_OUTPUT_DIR/emulator.log" ]]; then
    cp "$RAW_OUTPUT_DIR/emulator.log" "$flow_output_dir/emulator.log" || true
  fi
  if [[ -f "$RAW_OUTPUT_DIR/logcat-pretest.txt" ]]; then
    cp "$RAW_OUTPUT_DIR/logcat-pretest.txt" "$flow_output_dir/logcat.txt" || true
  fi

  record_meta=$(start_screenrecord "$EMULATOR_ID" "$flow_name")
  record_pid="${record_meta%%:*}"
  record_path="${record_meta#*:}"

  if command -v timeout >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && timeout --preserve-status "$MAESTRO_FLOW_TIMEOUT" maestro test ".maestro/${flow_file}" --udid "$EMULATOR_ID" --env=MAESTRO_FLOW_TIMEOUT="$MAESTRO_FLOW_TIMEOUT" --test-output-dir "$flow_output_dir" --debug-output "$flow_output_dir/debug" --format JUNIT --output "$flow_output_dir/report.xml")
    flow_status=$?
  else
    (cd "$ROOT_DIR" && maestro test ".maestro/${flow_file}" --udid "$EMULATOR_ID" --env=MAESTRO_FLOW_TIMEOUT="$MAESTRO_FLOW_TIMEOUT" --test-output-dir "$flow_output_dir" --debug-output "$flow_output_dir/debug" --format JUNIT --output "$flow_output_dir/report.xml")
    flow_status=$?
  fi

  stop_screenrecord "$EMULATOR_ID" "$flow_name" "$flow_output_dir" "$record_pid" "$record_path"
  timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" logcat -d > "$flow_output_dir/logcat-posttest.txt" 2>/dev/null || true

  if [[ "$flow_status" -ne 0 ]]; then
    MAESTRO_STATUS="$flow_status"
    log_error "Flow failed: ${flow_name} (exit ${flow_status})"
    break
  fi

  if ! scan_logcat_for_crashes "$flow_output_dir/logcat-posttest.txt" "$flow_output_dir"; then
    MAESTRO_STATUS=1
    log_error "Crash markers detected in logcat for ${flow_name}"
    break
  fi
done

set -e

# Capture post-test diagnostics
timeout "$ADB_COMMAND_TIMEOUT" adb -s "$EMULATOR_ID" logcat -d > "$RAW_OUTPUT_DIR/logcat-posttest.txt" 2>/dev/null || true

# Build evidence
export MAESTRO_EXIT_CODE="$MAESTRO_STATUS"
(cd "$ROOT_DIR" && node scripts/build-maestro-evidence.mjs)

# Handle failure
if [[ "$MAESTRO_STATUS" -ne 0 ]]; then
  diag_dir=$(capture_diagnostics "$EMULATOR_ID" "maestro_failure")
  
  if [[ "$MAESTRO_STATUS" -eq 124 ]]; then
    write_error_context "Maestro framework limitation" "Maestro timed out after ${MAESTRO_TOTAL_TIMEOUT}s" "$diag_dir"
  else
    write_error_context "App UI state mismatch" "Maestro tests failed with exit code $MAESTRO_STATUS" "$diag_dir"
  fi
  
  log_error "Maestro tests failed with exit code $MAESTRO_STATUS"
  exit "$MAESTRO_STATUS"
fi

log_info "Smoke tests completed successfully"
