#!/usr/bin/env bash

set -euo pipefail

max_attempts="${IOS_CAP_SYNC_MAX_ATTEMPTS:-3}"
base_delay_seconds="${IOS_CAP_SYNC_RETRY_DELAY_SECONDS:-20}"

if ! [[ "$max_attempts" =~ ^[0-9]+$ ]] || (( max_attempts < 1 )); then
  echo "IOS_CAP_SYNC_MAX_ATTEMPTS must be a positive integer" >&2
  exit 2
fi

if ! [[ "$base_delay_seconds" =~ ^[0-9]+$ ]] || (( base_delay_seconds < 0 )); then
  echo "IOS_CAP_SYNC_RETRY_DELAY_SECONDS must be a non-negative integer" >&2
  exit 2
fi

run_cap_sync() {
  local attempt="$1"
  local log_file="$2"

  echo "Running npx cap sync ios (attempt ${attempt}/${max_attempts})"
  if npx cap sync ios 2>&1 | tee "$log_file"; then
    return 0
  fi

  local status=${PIPESTATUS[0]}
  return "$status"
}

for attempt in $(seq 1 "$max_attempts"); do
  log_file="$(mktemp -t cap-sync-ios.XXXXXX.log)"

  if run_cap_sync "$attempt" "$log_file"; then
    rm -f "$log_file"
    exit 0
  fi

  status=$?
  if (( attempt == max_attempts )); then
    echo "npx cap sync ios failed after ${attempt} attempt(s)" >&2
    rm -f "$log_file"
    exit "$status"
  fi

  delay=$(( base_delay_seconds * attempt ))
  if grep -Eq "429|Too Many Requests|CDN: trunk URL couldn't be downloaded" "$log_file"; then
    echo "Detected transient CocoaPods CDN throttling; retrying in ${delay}s" >&2
  else
    echo "npx cap sync ios failed on attempt ${attempt}; retrying in ${delay}s" >&2
  fi

  rm -f "$log_file"
  sleep "$delay"
done