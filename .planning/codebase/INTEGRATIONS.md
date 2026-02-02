# External Integrations

**Analysis Date:** 2026-02-02

## APIs & External Services

**C64 Ultimate REST API:**
- **Purpose**: Core device control (Reset, Reboot, Play SID, Mount Disk) and configuration.
- **Client**: Custom implementation in `src/lib/c64api.ts`.
- **Endpoints**: `/v1/info`, `/v1/configs`, `/v1/machine:*`, `/v1/drives`, `/v1/runners:*`.
- **Auth**: Custom `X-Password` header (stored in SecureStorage).
- **Discovery**: Custom discovery logic via `src/lib/deviceInteraction/`.

**HVSC (High Voltage SID Collection):**
- **Purpose**: Fetching latest SID music database.
- **Service**: `https://hvsc.brona.dk/HVSC/` (Configurable via `c64u_hvsc_base_url`).
- **Implementation**: Web scraping and `.7z` archive download in `src/lib/hvsc/hvscReleaseService.ts`.
- **Parsing**: Client-side extraction using `7z-wasm`.

**FTP:**
- **Purpose**: File system access on the C64 Ultimate device.
- **Implementation**: Native plugin wrapper `src/lib/ftp/ftpClient.ts` using `src/lib/native/ftpClient.ts`.
- **Native**: Custom Kotlin plugin `FtpClientPlugin.kt`.

## Data Storage

**Local Persistence:**
- **Local Storage**: Used for:
  - App configuration (`src/lib/config/`)
  - Connection settings
  - HVSC state (`src/lib/hvsc/hvscStateStore.ts`)
  - Media Index (`src/lib/media-index/localStorageMediaIndex.ts`)
- **Secure Storage**: Used for:
  - Network passwords
  - Implementation: `src/lib/secureStorage.ts` wrapping native `SecureStoragePlugin`.

**File Storage:**
- **Device Filesystem**: Used via `@capacitor/filesystem` for caching HVSC files.
- **Virtual Filesystem**: Browser-based VFS for HVSC ingestion (`src/lib/hvsc/hvscFilesystem.ts`).

**Caching:**
- **React Query**: In-memory caching of API responses (DeviceInfo, Configs).
- **Browser Cache**: Standard HTTP caching.

## Authentication & Identity

**Device Authentication:**
- **Method**: Simple password protection on the C64 Ultimate device.
- **Storage**: Securely stored via `SecureStorage` plugin.
- **Transmission**: `X-Password` header on REST and FTP requests.

## Monitoring & Observability

**Internal Tracing:**
- **Purpose**: detailed session tracing for debugging and E2E test validation.
- **Implementation**: `src/lib/tracing/`.
- **Storage**: In-memory ring buffer (`traceSession.ts`).
- **Export**: Can be zipped and exported (e.g. for Golden Traces in Playwright).

## CI/CD & Deployment

**CI Pipeline:**
- **GitHub Actions**: Implied by `.github` reference in `AGENTS.md`.
- **Testing**: Playwright E2E tests generate traces and screenshots.
- **Coverage**: Codecov integration (`codecov.yml`).

## Environment Configuration

**Required env vars:**
- `VITE_APP_VERSION`: App version string.
- `VITE_GIT_SHA`: Git commit hash.
- `VITE_BUILD_TIME`: Build timestamp.

## Webhooks & Callbacks

**Incoming:**
- None detected.

**Outgoing:**
- None detected.

---

*Integration audit: 2026-02-02*
