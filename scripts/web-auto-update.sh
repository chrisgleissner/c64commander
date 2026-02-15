#!/usr/bin/env bash
set -euo pipefail

OWNER="${OWNER:-chrisgleissner}"
REPO="${REPO:-c64commander}"
TRACK_MODE="${TRACK_MODE:-tags}" # tags | ref
TRACK_REF="${TRACK_REF:-main}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-300}"
CONTAINER_NAME="${CONTAINER_NAME:-c64commander}"
CONFIG_DIR="${CONFIG_DIR:-$PWD/c64commander-config}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/chrisgleissner/c64commander}"
DEV_CHECKOUT_DIR="${DEV_CHECKOUT_DIR:-$PWD/.tmp/c64commander-updater/repo}"
DEV_IMAGE_NAME="${DEV_IMAGE_NAME:-c64commander:dev-auto}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

usage() {
    cat <<'EOF'
Usage: web-auto-update.sh [options]

Modes:
  --track tags           Track latest GitHub release tag (recommended for production)
  --track ref            Track latest commit on --ref and rebuild Docker image locally

Options:
  --owner <owner>                GitHub owner (default: chrisgleissner)
  --repo <repo>                  GitHub repository (default: c64commander)
  --track <tags|ref>             Update tracking mode (default: tags)
  --ref <branch-or-ref>          Ref to monitor in ref mode (default: main)
  --interval <seconds>           Poll interval (default: 300)
  --container-name <name>        Docker container name (default: c64commander)
  --config-dir <path>            Host config directory mounted to /config
  --host-port <port>             Host port to publish (default: 8080)
  --container-port <port>        Container port (default: 8080)
  --image-repo <repo>            Image repository for tags mode (default: ghcr.io/chrisgleissner/c64commander)
  --dev-checkout-dir <path>      Checkout directory for ref mode local builds
  --dev-image-name <image:tag>   Local image tag for ref mode builds
  --help                         Show help

Environment variables:
  OWNER, REPO, TRACK_MODE, TRACK_REF, POLL_INTERVAL_SECONDS, CONTAINER_NAME,
  CONFIG_DIR, HOST_PORT, CONTAINER_PORT, IMAGE_REPO, DEV_CHECKOUT_DIR,
  DEV_IMAGE_NAME, GITHUB_TOKEN
EOF
}

log() {
    printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

api_get() {
    local url="$1"
    if [[ -n "$GITHUB_TOKEN" ]]; then
        curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$url"
    else
        curl -fsSL -H "Accept: application/vnd.github+json" "$url"
    fi
}

latest_release_tag() {
    api_get "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" \
        | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("tag_name","").strip())'
}

latest_head_sha() {
    api_get "https://api.github.com/repos/${OWNER}/${REPO}/commits/${TRACK_REF}" \
        | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("sha") or "").strip())'
}

ensure_checkout() {
    if [[ ! -d "$DEV_CHECKOUT_DIR/.git" ]]; then
        mkdir -p "$(dirname "$DEV_CHECKOUT_DIR")"
        git clone --branch "$TRACK_REF" --single-branch "https://github.com/${OWNER}/${REPO}.git" "$DEV_CHECKOUT_DIR"
        return
    fi

    git -C "$DEV_CHECKOUT_DIR" fetch origin "$TRACK_REF"
    git -C "$DEV_CHECKOUT_DIR" checkout "$TRACK_REF"
    git -C "$DEV_CHECKOUT_DIR" reset --hard "origin/${TRACK_REF}"
}

restart_container_with_image() {
    local image="$1"
    mkdir -p "$CONFIG_DIR"

    if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
        log "Stopping existing container: ${CONTAINER_NAME}"
        docker rm -f "$CONTAINER_NAME" >/dev/null
    fi

    log "Starting container ${CONTAINER_NAME} with image ${image}"
    docker run -d \
        --name "$CONTAINER_NAME" \
        -p "${HOST_PORT}:${CONTAINER_PORT}" \
        -v "${CONFIG_DIR}:/config" \
        --restart unless-stopped \
        "$image" >/dev/null
}

deploy_latest_tag() {
    local tag="$1"
    local image="${IMAGE_REPO}:${tag}"

    log "Pulling ${image}"
    docker pull "$image" >/dev/null
    restart_container_with_image "$image"
}

deploy_latest_ref() {
    local sha="$1"

    ensure_checkout
    log "Building ${DEV_IMAGE_NAME} from ${TRACK_REF} (${sha:0:12})"
    docker build -f "$DEV_CHECKOUT_DIR/web/Dockerfile" -t "$DEV_IMAGE_NAME" "$DEV_CHECKOUT_DIR" >/dev/null
    restart_container_with_image "$DEV_IMAGE_NAME"
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --owner) OWNER="$2"; shift 2 ;;
            --repo) REPO="$2"; shift 2 ;;
            --track) TRACK_MODE="$2"; shift 2 ;;
            --ref) TRACK_REF="$2"; shift 2 ;;
            --interval) POLL_INTERVAL_SECONDS="$2"; shift 2 ;;
            --container-name) CONTAINER_NAME="$2"; shift 2 ;;
            --config-dir) CONFIG_DIR="$2"; shift 2 ;;
            --host-port) HOST_PORT="$2"; shift 2 ;;
            --container-port) CONTAINER_PORT="$2"; shift 2 ;;
            --image-repo) IMAGE_REPO="$2"; shift 2 ;;
            --dev-checkout-dir) DEV_CHECKOUT_DIR="$2"; shift 2 ;;
            --dev-image-name) DEV_IMAGE_NAME="$2"; shift 2 ;;
            --help|-h) usage; exit 0 ;;
            *)
                echo "Unknown option: $1" >&2
                usage
                exit 1
                ;;
        esac
    done
}

main() {
    parse_args "$@"

    require_cmd curl
    require_cmd docker
    require_cmd python3
    require_cmd git

    case "$TRACK_MODE" in
        tags|ref) ;;
        *)
            echo "Invalid --track value: $TRACK_MODE (expected tags or ref)" >&2
            exit 1
            ;;
    esac

    local state_dir
    state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/c64commander"
    mkdir -p "$state_dir"
    local state_file
    state_file="${state_dir}/web-auto-update.${OWNER}.${REPO}.${TRACK_MODE}.${TRACK_REF}.state"

    log "Starting updater: owner=${OWNER} repo=${REPO} track=${TRACK_MODE} ref=${TRACK_REF} interval=${POLL_INTERVAL_SECONDS}s"
    log "Container: name=${CONTAINER_NAME} ports=${HOST_PORT}:${CONTAINER_PORT} config=${CONFIG_DIR}"

    while true; do
        if [[ "$TRACK_MODE" == "tags" ]]; then
            current="$(latest_release_tag)"
            if [[ -z "$current" ]]; then
                log "No release tag found yet; retrying"
            else
                previous=""
                if [[ -f "$state_file" ]]; then
                    previous="$(cat "$state_file")"
                fi

                if [[ "$current" != "$previous" ]]; then
                    log "Detected new release tag: ${current} (previous: ${previous:-<none>})"
                    deploy_latest_tag "$current"
                    printf '%s' "$current" > "$state_file"
                    log "Updated and restarted container for release tag ${current}"
                else
                    log "No new release tag (current=${current})"
                fi
            fi
        else
            current="$(latest_head_sha)"
            if [[ -z "$current" ]]; then
                log "No commit SHA returned for ref ${TRACK_REF}; retrying"
            else
                previous=""
                if [[ -f "$state_file" ]]; then
                    previous="$(cat "$state_file")"
                fi

                if [[ "$current" != "$previous" ]]; then
                    log "Detected new ref SHA on ${TRACK_REF}: ${current:0:12} (previous: ${previous:0:12})"
                    deploy_latest_ref "$current"
                    printf '%s' "$current" > "$state_file"
                    log "Updated and restarted container for ref ${TRACK_REF} (${current:0:12})"
                else
                    log "No new SHA on ${TRACK_REF} (current=${current:0:12})"
                fi
            fi
        fi

        sleep "$POLL_INTERVAL_SECONDS"
    done
}

main "$@"
