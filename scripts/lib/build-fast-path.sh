#!/usr/bin/env bash

build_fast_local_apk_install_enabled() {
  local primary_action="$1"
  local skip_tests="$2"
  local install_apk="$3"

  [[ "$primary_action" == "build" && "$skip_tests" == "true" && "$install_apk" == "true" ]]
}

build_debug_saved_devices_bootstrap_json() {
  cat <<'EOF'
[{"id":"debug-u64","name":"u64","nameSource":"USER","host":"192.168.1.13","httpPort":80,"ftpPort":21,"telnetPort":23,"hasPassword":false},{"id":"debug-c64u","name":"c64u","nameSource":"USER","host":"192.168.1.167","httpPort":80,"ftpPort":21,"telnetPort":23,"hasPassword":false}]
EOF
}

dependencies_are_current() {
  local repo_root="$1"
  local top_snapshot="$repo_root/node_modules/.package-lock.json"

  [[ -d "$repo_root/node_modules" && -f "$top_snapshot" ]] || return 1
  [[ -f "$repo_root/package-lock.json" && "$repo_root/package-lock.json" -nt "$top_snapshot" ]] && return 1
  [[ -f "$repo_root/package.json" && "$repo_root/package.json" -nt "$top_snapshot" ]] && return 1

  if [[ -d "$repo_root/patches" ]]; then
    while IFS= read -r patch_file; do
      [[ "$patch_file" -nt "$top_snapshot" ]] && return 1
    done < <(find "$repo_root/patches" -type f -name '*.patch' -print)
  fi

  if [[ -f "$repo_root/c64scope/package.json" ]]; then
    local scope_snapshot="$repo_root/c64scope/node_modules/.package-lock.json"
    [[ -d "$repo_root/c64scope/node_modules" && -f "$scope_snapshot" ]] || return 1
    [[ -f "$repo_root/c64scope/package-lock.json" && "$repo_root/c64scope/package-lock.json" -nt "$scope_snapshot" ]] && return 1
    [[ "$repo_root/c64scope/package.json" -nt "$scope_snapshot" ]] && return 1
  fi

  return 0
}

apply_fast_local_apk_install_defaults() {
  local repo_root="$1"
  local explicit_skip_install="$2"

  FAST_LOCAL_APK_INSTALL=true
  RUN_FORMAT=false

  if [[ "$explicit_skip_install" == "true" ]]; then
    RUN_INSTALL=false
    return 0
  fi

  if [[ -n "${BUILD_FORCE_NPM_INSTALL:-}" ]]; then
    return 0
  fi

  if dependencies_are_current "$repo_root"; then
    RUN_INSTALL=false
  fi
}

resolve_adb_device_id() {
  local explicit_device_id="$1"
  local adb_devices_output="${2:-}"
  local -a preferred_devices=()
  local -a online_devices=()
  local serial=""
  local state=""
  local rest=""

  if [[ -n "$explicit_device_id" ]]; then
    printf '%s\n' "$explicit_device_id"
    return 0
  fi

  if [[ -z "$adb_devices_output" ]]; then
    adb_devices_output="$(adb devices)"
  fi

  while read -r serial state rest; do
    [[ -z "$serial" || "$serial" == "List" ]] && continue
    [[ "$state" != "device" ]] && continue
    [[ "$serial" == emulator-* ]] && continue
    online_devices+=("$serial")
    if [[ "$serial" == 9B0* ]]; then
      preferred_devices+=("$serial")
    fi
  done <<< "$adb_devices_output"

  if [[ ${#preferred_devices[@]} -eq 1 ]]; then
    printf '%s\n' "${preferred_devices[0]}"
    return 0
  fi

  if [[ ${#online_devices[@]} -eq 1 ]]; then
    printf '%s\n' "${online_devices[0]}"
    return 0
  fi

  if [[ ${#preferred_devices[@]} -gt 1 ]]; then
    echo "Multiple preferred adb devices found (${preferred_devices[*]}). Pass --device-id <id>." >&2
    return 1
  fi

  if [[ ${#online_devices[@]} -eq 0 ]]; then
    echo "No adb devices found. Connect a device or pass --device-id <id>." >&2
    return 1
  fi

  echo "Multiple adb devices found (${online_devices[*]}). Pass --device-id <id>." >&2
  return 1
}
