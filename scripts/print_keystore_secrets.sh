#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env at $ENV_FILE" >&2
  exit 1
fi

get_env_value() {
  local key="$1"
  local value
  value=$(grep -E "^${key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)
  echo "$value"
}

STORE_PASSWORD="$(get_env_value KEYSTORE_STORE_PASSWORD)"
KEY_PASSWORD="$(get_env_value KEYSTORE_KEY_PASSWORD)"
STORE_FILE="$(get_env_value KEYSTORE_STORE_FILE)"

if [[ -z "$STORE_PASSWORD" || -z "$KEY_PASSWORD" ]]; then
  echo "Missing KEYSTORE_STORE_PASSWORD or KEYSTORE_KEY_PASSWORD in .env" >&2
  exit 1
fi

if [[ -z "$STORE_FILE" ]]; then
  STORE_FILE="$ROOT_DIR/android/keystore/release.keystore"
fi

if [[ ! -f "$STORE_FILE" ]]; then
  echo "Keystore not found at $STORE_FILE" >&2
  exit 1
fi

ANDROID_KEYSTORE_BASE64=$(base64 -w 0 "$STORE_FILE")

printf "ANDROID_KEYSTORE_BASE64=%s\n" "$ANDROID_KEYSTORE_BASE64"
printf "KEYSTORE_STORE_PASSWORD=%s\n" "$STORE_PASSWORD"
printf "KEYSTORE_KEY_PASSWORD=%s\n" "$KEY_PASSWORD"
printf "KEYSTORE_KEY_ALIAS=c64commander\n"
