# Telnet Integration Specification — Addendum 1

## Commoserve Direct HTTP and Firmware Divergence

This addendum extends the Telnet Integration Specification (sections 10b, 11.9, and 12) with:

1. Verified Commoserve HTTP protocol findings from real traffic interception and API validation
2. Full REST API surface for Commoserve (4 endpoints) enabling direct app-driven search without Telnet
3. Firmware divergences between 1541 Ultimate source and observed C64 Ultimate behavior
4. Platform feasibility analysis for direct HTTP integration
5. Full non-Telnet architecture: direct HTTP for search/browse, device REST for run/mount

This document is **non-duplicative**. It does not repeat content from the base specification. Section references (e.g., "base spec §10b") point to the existing integration spec.

---

## 1. Scope of Addendum

### 1.1 What This Adds

- Complete Commoserve HTTP API specification (4 endpoints, verified against live server)
- AQL query grammar (confirmed from firmware source and live validation)
- Firmware divergence documentation (hostname, Client-Id, branding, backend)
- Platform feasibility matrix for direct HTTP from Android, iOS, and Web
- Full non-Telnet architecture: direct HTTP for search/browse, device REST API for run/mount
- Concurrency model for direct HTTP (zero device contention) and REST run/mount

### 1.2 What This Does Not Change

- Action menu Telnet integration (base spec §4–§10) — unchanged
- Telnet transport, parser, navigator, mock (base spec §6–§9) — unchanged
- Scheduling model for Telnet actions (base spec §5) — unchanged
- UI placement for non-CommoServe features (base spec §11.1–§11.8, §18.1–§18.6) — unchanged

### 1.3 Relationship to Base Spec

Base spec §10b defines CommoServe integration entirely via Telnet (F6 → form → results → file actions). This addendum replaces that path entirely: **direct HTTP for search/browse** and **device REST API for run/mount**. No Telnet is needed for any CommoServe operation.

The device REST API provides runner endpoints (`POST /v1/runners:run_prg`, `POST /v1/runners:run_crt`, `POST /v1/runners:load_prg`) and mount endpoints (`POST /v1/drives/{drive}:mount`) that accept binary uploads. The app downloads from Commoserve via direct HTTP, then uploads to the device via REST.

The Telnet-based CommoServe path defined in base spec §10b remains valid as a fallback when direct HTTP is unavailable (e.g., web platform with proxy, or future firmware changes).

---

## 2. Verified Protocol Findings

### 2.1 Authoritative Endpoint

All findings are verified against the live Commoserve server as of 2026-03-25.

| Property     | Value                                              |
| ------------ | -------------------------------------------------- |
| Protocol     | HTTP (unencrypted, port 80)                        |
| Host         | `commoserve.files.commodore.net`                   |
| Backend      | Cloudflare edge-terminated                         |
| Transfer     | Chunked encoding                                   |
| Content-Type | `application/json`                                 |
| CORS         | **None** (no `Access-Control-Allow-Origin` header) |

### 2.2 Required Headers

All requests MUST include these headers. Without them, the server returns `{"errorCode":464}`.

```http
Accept-Encoding: identity
User-Agent: Assembly Query
Client-Id: Commodore
```

The `Client-Id` value `Ultimate` (used by 1541 Ultimate firmware) is also accepted and returns identical results on this endpoint. The value `Commodore` is observed from C64 Ultimate device traffic and is the canonical value for this integration.

### 2.3 Result Cap

The server returns a maximum of **20 results** per search query, regardless of how many matches exist. This is a server-side limit, not configurable by the client.

---

## 3. Full Commoserve HTTP API

### 3.1 Endpoint Overview

| #   | Endpoint                                   | Method | Purpose                | Source           |
| --- | ------------------------------------------ | ------ | ---------------------- | ---------------- |
| 1   | `/leet/search/aql?query={aql}`             | GET    | Search for content     | `assembly.cc:9`  |
| 2   | `/leet/search/aql/presets`                 | GET    | Fetch dropdown presets | `assembly.cc:10` |
| 3   | `/leet/search/entries/{id}/{category}`     | GET    | List files in a result | `assembly.cc:11` |
| 4   | `/leet/search/bin/{id}/{category}/{index}` | GET    | Download a binary file | `assembly.cc:12` |

All endpoints require the headers from §2.2. All JSON endpoints return `Content-Type: application/json`.

### 3.2 Search Endpoint

**Path:** `GET /leet/search/aql?query={url_encoded_aql}`

**Request:**

```http
GET /leet/search/aql?query=%28category%3Aapps%29 HTTP/1.1
Host: commoserve.files.commodore.net
Accept-Encoding: identity
User-Agent: Assembly Query
Client-Id: Commodore
```

**Response:** JSON array of result objects. Empty array `[]` when no matches.

```typescript
interface CommoserveSearchResult {
  /** Release name (always present) */
  name: string;
  /** Unique ID string (always present) */
  id: string;
  /** Numeric category code (always present, e.g. 40 for apps) */
  category: number;
  /** Site-assigned category (always present, typically 0) */
  siteCategory: number;
  /** Site-assigned rating (always present, typically 0.0) */
  siteRating: number;
  /** Release year (0 when unknown) */
  year: number;
  /** User rating (0 when unrated) */
  rating: number;
  /** Last updated date, YYYY-MM-DD */
  updated: string;
  /** Release group name (optional) */
  group?: string;
  /** Author handle (optional) */
  handle?: string;
  /** Release date, YYYY-MM-DD (optional) */
  released?: string;
}
```

**Validated behavior:**

- `(category:apps)` → 6 results
- `(category:games) & (sort:name) & (order:asc)` → 20 results, alphabetically sorted
- `(name:"joyride") & (category:apps)` → 1 result
- `(name:"xyznonexistent999")` → `[]`
- `(category:games) & (date:2024) & (type:d64) & (sort:year) & (order:desc)` → 1 result

### 3.3 Presets Endpoint

**Path:** `GET /leet/search/aql/presets`

**Response:** JSON array of preset type objects.

```typescript
interface CommoservePresetType {
  /** Preset type identifier: "category" | "date" | "type" | "sort" | "order" */
  type: string;
  /** Display label for the preset group */
  description: string;
  /** Available values for this preset */
  values: CommoservePresetValue[];
}

interface CommoservePresetValue {
  /** AQL key used in query construction (always present) */
  aqlKey: string;
  /** Display name (optional; when absent, use aqlKey as display name) */
  name?: string;
}
```

**Verified preset data (2026-03-25):**

| Type       | Description | Values                              |
| ---------- | ----------- | ----------------------------------- |
| `category` | Category    | Apps, Demos, Games, Graphics, Music |
| `date`     | Date        | 1980–2025 (46 year values)          |
| `type`     | Type        | crt, d64, d71, d81, sid, t64, tap   |
| `sort`     | Sort by     | Name, Year                          |
| `order`    | Sort Order  | Ascending, Descending               |

**Note:** Date values have no `name` field — only `aqlKey`. Category, sort, and order values have both `aqlKey` and `name`. Type values have only `aqlKey`.

### 3.4 Entries Endpoint

**Path:** `GET /leet/search/entries/{id}/{category}`

- `{id}`: The `id` string from a search result
- `{category}`: The `category` integer from a search result

**Response:** JSON object with `contentEntry` array.

```typescript
interface CommoserveEntriesResponse {
  contentEntry: CommoserveFileEntry[];
}

interface CommoserveFileEntry {
  /** Filename (e.g., "joyride.d64") */
  path: string;
  /** Zero-based index within the result */
  id: number;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp in milliseconds since epoch */
  date: number;
}
```

**Example:** `GET /leet/search/entries/2567969688/40`

```json
{
  "contentEntry": [
    { "path": "joyride.d64", "id": 0, "size": 174848, "date": 1773676443000 },
    { "path": "joyride_license.txt", "id": 1, "size": 1282, "date": 1773676444000 }
  ]
}
```

### 3.5 Binary Download Endpoint

**Path:** `GET /leet/search/bin/{id}/{category}/{index}`

- `{id}`: The `id` string from a search result
- `{category}`: The `category` integer from a search result
- `{index}`: The `id` integer from a file entry

**Response:** Raw binary file data. Not JSON.

**Example:** `GET /leet/search/bin/2567969688/40/0` → 174848 bytes (joyride.d64)

**Alternative path format:** The firmware also supports `GET /leet/search/bin/{id}/{category}/{filename}` where `{filename}` is URL-encoded. Confirmed from `assembly.cc:276-283`.

---

## 4. Full AQL Query Grammar

### 4.1 Grammar (BNF-like)

```
query     = clause ( " & " clause )*
clause    = "(" field ":" value ")"
field     = "name" | "group" | "handle" | "event"
          | "category" | "date" | "type" | "sort" | "order"
value     = quoted_string | bare_value
quoted_string = '"' text '"'    // for text fields: name, group, handle, event
bare_value    = identifier      // for dropdown fields: category, date, type, sort, order
```

### 4.2 Field Rules

| Field      | Input Type      | Value Format  | Example            |
| ---------- | --------------- | ------------- | ------------------ |
| `name`     | Free text       | Quoted string | `(name:"joyride")` |
| `group`    | Free text       | Quoted string | `(group:"TRIAD")`  |
| `handle`   | Free text       | Quoted string | `(handle:"Tasco")` |
| `event`    | Free text       | Quoted string | `(event:"X'2024")` |
| `category` | Preset dropdown | Bare aqlKey   | `(category:apps)`  |
| `date`     | Preset dropdown | Bare aqlKey   | `(date:2024)`      |
| `type`     | Preset dropdown | Bare aqlKey   | `(type:d64)`       |
| `sort`     | Preset dropdown | Bare aqlKey   | `(sort:name)`      |
| `order`    | Preset dropdown | Bare aqlKey   | `(order:asc)`      |

### 4.3 Construction Rules

1. Empty fields are omitted entirely (confirmed: `assembly_search.cc:210`)
2. Text fields are always double-quoted (confirmed: `assembly_search.cc:222-229`)
3. Dropdown fields use bare `aqlKey` values, never quoted (confirmed: `assembly_search.cc:222-229`)
4. Clauses are joined with `&` (space-ampersand-space) (confirmed: `assembly_search.cc:217`)
5. An empty query (all fields blank) is rejected by firmware with popup "Queries cannot be empty!" (confirmed: `assembly_search.cc:235-237`)
6. The entire query string is URL-encoded before being appended to the search path (confirmed: `assembly.cc:178-179`)

### 4.4 URL Encoding

The firmware's `url_encode()` function (confirmed: `assembly.cc:16-35`) encodes all characters except:

- `a-z`, `A-Z`, `0-9`
- `_`, `-`, `.`, `*`

All other characters (including spaces, parentheses, colons, quotes, ampersands) are percent-encoded.

### 4.5 TypeScript Query Builder

```typescript
function buildAqlQuery(params: {
  name?: string;
  group?: string;
  handle?: string;
  event?: string;
  category?: string;
  date?: string;
  type?: string;
  sort?: string;
  order?: string;
}): string {
  const textFields = ["name", "group", "handle", "event"] as const;
  const dropdownFields = ["category", "date", "type", "sort", "order"] as const;
  const clauses: string[] = [];

  for (const field of textFields) {
    const value = params[field];
    if (value) {
      clauses.push(`(${field}:"${value}")`);
    }
  }

  for (const field of dropdownFields) {
    const value = params[field];
    if (value) {
      clauses.push(`(${field}:${value})`);
    }
  }

  return clauses.join(" & ");
}
```

---

## 5. Firmware Divergence Notes

### 5.1 Hostname Divergence

| Property | 1541 Ultimate Firmware                                     | C64 Ultimate (Observed)                 |
| -------- | ---------------------------------------------------------- | --------------------------------------- |
| Hostname | `hackerswithstyle.se`                                      | `commoserve.files.commodore.net`        |
| Source   | `assembly.cc:7` — `#define HOSTNAME "hackerswithstyle.se"` | Network traffic interception (ARP MITM) |

The C64 Ultimate firmware modifies the hostname constant at build time. Both hostnames accept the same API contract, but they serve **different content databases**:

- `hackerswithstyle.se` with `(category:apps)` → 0 results (empty array)
- `commoserve.files.commodore.net` with `(category:apps)` → 6 results

The app MUST use `commoserve.files.commodore.net` as the authoritative hostname for C64 Ultimate devices.

### 5.2 Client-Id Divergence

| Property  | 1541 Ultimate Firmware                                    | C64 Ultimate (Observed)      |
| --------- | --------------------------------------------------------- | ---------------------------- |
| Client-Id | `Ultimate`                                                | `Commodore`                  |
| Source    | `assembly.cc:155,188,237,286` — hardcoded in HTTP headers | Network traffic interception |

Both values are accepted by the `commoserve.files.commodore.net` endpoint and return identical results. The app SHOULD use `Commodore` to match observed C64U behavior.

### 5.3 Backend Divergence

| Property | hackerswithstyle.se              | commoserve.files.commodore.net |
| -------- | -------------------------------- | ------------------------------ |
| Server   | nginx/1.24.0 (Ubuntu)            | Cloudflare                     |
| CORS     | `Access-Control-Allow-Origin: *` | None                           |
| TLS      | Not tested                       | None (HTTP only)               |

The presence of CORS headers on `hackerswithstyle.se` would theoretically allow browser-based access, but the different content database makes this unsuitable for C64 Ultimate users.

### 5.4 UI Branding Divergence

| Property          | 1541 Ultimate / Ultimate 64 | C64 Ultimate                            |
| ----------------- | --------------------------- | --------------------------------------- |
| Search form title | "Assembly 64 Query Form"    | "CommoServe File Search"                |
| Feature name      | "Assembly 64"               | "CommoServe"                            |
| Source            | `assembly_search.h:243`     | `c64u-telnet-commoserve-walkthrough.md` |

The parser already handles both title strings (base spec §7.3). The app UI uses the device-appropriate branding based on the title line in the Telnet session (base spec §13.4).

### 5.5 Implication

Observed network traffic from the C64 Ultimate device is **authoritative**. Firmware source is used only to explain behavior and identify the API contract. When firmware source and observed behavior diverge, observed behavior wins.

---

## 6. Telnet Feature Classification

This section classifies every CommoServe operation from base spec §10b by whether it requires Telnet, can use direct HTTP, device REST, or a combination.

### 6.1 Classification Table

| Operation              | Telnet Required | Direct HTTP Possible                        | Device REST Possible                              | Recommended               |
| ---------------------- | --------------- | ------------------------------------------- | ------------------------------------------------- | ------------------------- |
| Fetch dropdown presets | No              | **Yes** — `/leet/search/aql/presets`        | No                                                | Direct HTTP               |
| Search (submit query)  | No              | **Yes** — `/leet/search/aql?query=`         | No                                                | Direct HTTP               |
| List file entries      | No              | **Yes** — `/leet/search/entries/{id}/{cat}` | No                                                | Direct HTTP               |
| Download binary        | No              | **Yes** — `/leet/search/bin/{id}/{cat}/{i}` | No                                                | Direct HTTP               |
| Run PRG                | No              | No                                          | **Yes** — `POST /v1/runners:run_prg`              | Direct HTTP + Device REST |
| Load PRG               | No              | No                                          | **Yes** — `POST /v1/runners:load_prg`             | Direct HTTP + Device REST |
| Run CRT                | No              | No                                          | **Yes** — `POST /v1/runners:run_crt`              | Direct HTTP + Device REST |
| Mount Disk             | No              | No                                          | **Yes** — `POST /v1/drives/{drive}:mount`         | Direct HTTP + Device REST |
| Play SID               | No              | No                                          | **Yes** — `POST /v1/runners:sidplay`              | Direct HTTP + Device REST |
| View file              | No              | **Yes** — binary download                   | No (no viewer endpoint)                           | Direct HTTP (app-side)    |
| Close search           | N/A             | N/A                                         | N/A                                               | N/A                       |

### 6.2 Rationale

**Why direct HTTP for search/browse:**

1. **Eliminates Telnet fragility**: No VT100 parsing, no form navigation, no screen synchronization for the search phase
2. **Faster**: Direct HTTP round-trip vs. multi-step Telnet form fill + submit + screen parse
3. **Richer data**: HTTP responses include `size`, `date`, `group`, `handle` — more than what the Telnet UI displays
4. **No device contention**: HTTP to commoserve.files.commodore.net does not touch the C64U device at all
5. **Presets fetched once**: Cache locally, no need to re-fetch on every search session

**Why device REST for run/mount:**

The device REST API provides POST endpoints that accept binary uploads:

- `POST /v1/runners:run_prg` — upload PRG file and run it
- `POST /v1/runners:load_prg` — upload PRG file and load it
- `POST /v1/runners:run_crt` — upload CRT file and run it as cartridge
- `POST /v1/drives/{drive}:mount` — upload disk image and mount to drive (supports d64, g64, d71, g71, d81)
- `POST /v1/runners:sidplay` — upload SID file and play it

The PUT variants of these endpoints operate on files already on the device filesystem and accept a `?file=` path parameter. The POST variants accept `application/octet-stream` binary uploads directly.

**Complete non-Telnet pipeline for CommoServe run/mount:**

1. App downloads binary from Commoserve via direct HTTP (`GET /leet/search/bin/{id}/{cat}/{idx}`)
2. App determines the appropriate REST endpoint based on file extension (`.prg` → `run_prg`, `.d64`/`.d71`/`.d81` → `drives/{drive}:mount`, `.crt` → `run_crt`, `.sid` → `sidplay`)
3. App uploads the binary to the device via REST POST
4. Device executes the file action immediately

No Telnet session, no VT100 parsing, no menu navigation required.

### 6.3 File Extension to REST Endpoint Mapping

| Extension      | REST Endpoint                    | Method | Content-Type               |
| -------------- | -------------------------------- | ------ | -------------------------- |
| `.prg`         | `/v1/runners:run_prg`            | POST   | `application/octet-stream` |
| `.crt`         | `/v1/runners:run_crt`            | POST   | `application/octet-stream` |
| `.d64`, `.g64` | `/v1/drives/{drive}:mount`       | POST   | `application/octet-stream` |
| `.d71`, `.g71` | `/v1/drives/{drive}:mount`       | POST   | `application/octet-stream` |
| `.d81`         | `/v1/drives/{drive}:mount`       | POST   | `application/octet-stream` |
| `.sid`         | `/v1/runners:sidplay`            | POST   | `multipart/form-data`      |
| `.t64`         | `/v1/runners:run_prg` (fallback) | POST   | `application/octet-stream` |
| `.tap`         | Not runnable via REST            | —      | —                          |

For disk image mounts, the `{drive}` path parameter defaults to `a`. The optional `?type=` and `?mode=` query parameters can be specified when the extension alone is ambiguous.

---

## 7. Direct HTTP Integration Strategy

### 7.1 New Module: `commoserveApi.ts`

A new module under `src/lib/` (not `src/lib/telnet/`) handles direct HTTP communication with the Commoserve server. This is deliberately separated from the Telnet module because it does not use Telnet.

```typescript
/** Commoserve API client for direct HTTP access */
interface CommoserveApi {
  /** Fetch dropdown presets (cached after first call) */
  getPresets(): Promise<CommoservePresetType[]>;

  /** Search for content */
  search(query: CommoserveSearchParams): Promise<CommoserveSearchResult[]>;

  /** Get file entries for a search result */
  getEntries(id: string, category: number): Promise<CommoserveFileEntry[]>;

  /** Get a download URL for a binary file (does not download) */
  getBinaryUrl(id: string, category: number, index: number): string;
}

interface CommoserveSearchParams {
  name?: string;
  group?: string;
  handle?: string;
  event?: string;
  category?: string; // aqlKey
  date?: string; // aqlKey
  type?: string; // aqlKey
  sort?: string; // aqlKey
  order?: string; // aqlKey
}
```

### 7.2 HTTP Client Implementation

```typescript
const COMMOSERVE_HOST = "commoserve.files.commodore.net";
const COMMOSERVE_BASE = `http://${COMMOSERVE_HOST}`;
const REQUIRED_HEADERS = {
  "Accept-Encoding": "identity",
  "User-Agent": "Assembly Query",
  "Client-Id": "Commodore",
};
```

The client uses `fetch()` with the required headers. On native platforms (Android/iOS), `fetch()` works for cleartext HTTP with the appropriate platform configuration (§8).

### 7.3 Preset Caching

Presets are fetched once per app session and cached in memory. They change rarely (server-side content database updates). The cache is invalidated:

- On app cold start
- On explicit user refresh (pull-to-refresh on search page)
- After 1 hour (TTL)

### 7.4 Error Handling

| HTTP Status               | Meaning                  | App Behavior                                        |
| ------------------------- | ------------------------ | --------------------------------------------------- |
| 200 + JSON array          | Success                  | Parse and display                                   |
| 200 + `[]`                | No results               | Show empty state                                    |
| 200 + `{"errorCode":464}` | Missing required headers | Bug — fix headers                                   |
| Network error             | DNS/TCP failure          | Show "Cannot reach online content server"           |
| Timeout (>15s)            | Server slow              | Show "Search timed out. Try a more specific query." |

### 7.5 Interaction with Existing `useCommoServe` Hook

Base spec §11.9.5 defines a `useCommoServe` hook. The direct HTTP + device REST strategy changes its internal implementation but not its public interface:

- `search()`: Now uses `commoserveApi.search()` instead of Telnet F6 → form fill → submit
- `selectResult()`: Now uses `commoserveApi.getEntries()` instead of Telnet ENTER on result
- `executeFileAction()`: Now uses direct HTTP binary download + device REST upload (e.g., `POST /v1/runners:run_prg`). No Telnet needed.
- `close()`: No-op (no Telnet session to close)
- `isAvailable`: True when HTTP is reachable (all native platforms) and device REST is reachable

---

## 8. Platform Constraints and Workarounds

### 8.1 Feasibility Matrix

| Platform         | Direct HTTP to Commoserve | Constraint                                                   | Workaround                              | Status                  |
| ---------------- | ------------------------- | ------------------------------------------------------------ | --------------------------------------- | ----------------------- |
| Android          | Blocked by default        | Cleartext traffic policy                                     | `network_security_config.xml` exception | **Supported**           |
| iOS              | Blocked by default        | App Transport Security                                       | `Info.plist` exception                  | **Supported**           |
| Web (production) | Blocked                   | No CORS headers on server; mixed content if served via HTTPS | None available                          | **Blocked**             |
| Web (dev)        | Blocked                   | Same as production                                           | Vite dev proxy                          | **Dev-only workaround** |

### 8.2 Android Configuration

Add to `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">commoserve.files.commodore.net</domain>
</domain-config>
```

This is the same pattern already used for the C64U device hostname. No new security risk — the Commoserve server only serves HTTP.

### 8.3 iOS Configuration

Add to `ios/App/App/Info.plist` under `NSAppTransportSecurity > NSExceptionDomains`:

```xml
<key>commoserve.files.commodore.net</key>
<dict>
    <key>NSTemporaryExceptionAllowsInsecureHTTPLoads</key>
    <true/>
</dict>
```

### 8.4 Web Platform

Direct HTTP to Commoserve is not possible from browsers:

1. **CORS**: `commoserve.files.commodore.net` returns no CORS headers. Browser `fetch()` will fail with a CORS error.
2. **Mixed content**: If the app is served via HTTPS (e.g., Vercel, Netlify), HTTP requests to Commoserve are blocked.

On web, CommoServe search/browse via direct HTTP is blocked by CORS. The run/mount step uses device REST which is available on all platforms, but is useless without search results. The CommoServe entry point is hidden on web platform per base spec §11.9.4.

### 8.5 Custom Header Verification

The `User-Agent` header requires special attention:

- **Android**: `fetch()` allows setting custom `User-Agent` without restriction.
- **iOS**: `URLSession` allows setting custom `User-Agent`. Capacitor's HTTP plugin may override it — verify at integration time.
- **Web**: Browsers restrict `User-Agent` modification in `fetch()`. This is moot since web is blocked by CORS anyway.

---

## 9. Unified Interaction Model

### 9.1 Protocol Responsibilities

This section extends the protocol responsibility model from base spec §2.4 with direct HTTP:

| Protocol    | Responsibilities                                 | Contention with Device     |
| ----------- | ------------------------------------------------ | -------------------------- |
| REST        | Device control, config read/write, streaming     | Yes — per-subsystem mutex  |
| REST        | CommoServe run/mount (binary upload to device)   | Yes — per-subsystem mutex  |
| FTP         | File browsing, upload/download on device storage | Yes — per-subsystem mutex  |
| Telnet      | Menu-only actions (no CommoServe)                | Yes — per-subsystem mutex  |
| Direct HTTP | CommoServe search, browse, preset fetch, binary  | **None** — external server |

### 9.2 CommoServe Data Flow

```text
┌──────────┐     Direct HTTP           ┌──────────────────────────┐
│          │ ──────────────────────── │ commoserve.files.         │
│   App    │   search/presets/entries  │ commodore.net             │
│          │   + binary download      │ (Cloudflare)              │
│          │ ◄────────────────────── │                           │
│          │   JSON + raw binary      └──────────────────────────┘
│          │
│          │     REST (run/mount binary upload)
│          │ ──────────────────────── ┌──────────────────────────┐
│          │   POST /v1/runners:*     │ C64 Ultimate              │
│          │   POST /v1/drives/*:mount│ (REST API)                │
│          │ ◄────────────────────── │                           │
│          │   JSON response          │   device runs/mounts file │
└──────────┘                          └──────────────────────────┘
```

### 9.3 Module Placement

```text
src/lib/
  commoserve/
    commoserveApi.ts           # Direct HTTP client (search, presets, entries, binary)
    commoserveTypes.ts         # Shared types (results, entries, presets, params)
    commoserveQueryBuilder.ts  # AQL query construction
    commoserveFileRunner.ts    # File extension → REST endpoint mapping + upload

src/hooks/
    useCommoServe.ts           # React hook combining HTTP search + REST run/mount
```

The `commoserve/` module has **no dependency on the telnet module**. The entire CommoServe feature is implemented via direct HTTP + device REST.

---

## 10. Concurrency and Safety Model

### 10.1 Direct HTTP Concurrency

Direct HTTP requests to the Commoserve server:

- Do NOT touch the C64U device
- Do NOT contend with REST, FTP, or Telnet
- Do NOT require the Telnet scheduler slot
- CAN run concurrently with any device operation
- CAN be cancelled without side effects

### 10.2 Run/Mount Concurrency

When a user triggers "Run Disk" on a Commoserve result:

1. App downloads the binary from Commoserve via direct HTTP (no device contention)
2. App sends the binary to the device via REST POST (e.g., `POST /v1/runners:run_prg`)
3. Device executes the file action (run, mount, etc.)

Step 1 has no device contention. Step 2 contends with other REST operations via per-subsystem mutex (base spec §2.3). **No Telnet scheduler slot is needed** — the entire flow uses REST.

### 10.3 Timeout Budget

| Operation        | Timeout | Rationale                              |
| ---------------- | ------- | -------------------------------------- |
| Preset fetch     | 10s     | One-time fetch, cached thereafter      |
| Search query     | 15s     | Server-side search can be slow         |
| Entry listing    | 10s     | Fetches file metadata                  |
| Binary download  | 30s     | File sizes vary (up to ~800KB for d81) |
| REST upload+run  | 15s     | Device-side binary upload and dispatch |

All timeouts are app-side. No Telnet timeout budget applies to CommoServe operations.

---

## 11. Parsing and State Model

### 11.1 Direct HTTP Parsing

Direct HTTP responses are standard JSON. No VT100 parsing required. The `commoserveApi` client parses JSON responses directly into typed objects (§3.2–§3.5).

### 11.2 State Model

```typescript
type CommoserveSessionState =
  | { phase: "idle" }
  | { phase: "searching"; abortController: AbortController }
  | { phase: "results"; results: CommoserveSearchResult[] }
  | { phase: "entries"; result: CommoserveSearchResult; entries: CommoserveFileEntry[] }
  | { phase: "downloading"; result: CommoserveSearchResult; entry: CommoserveFileEntry }
  | { phase: "executing"; result: CommoserveSearchResult; entry: CommoserveFileEntry; action: string }
  | { phase: "error"; error: CommoserveError };
```

State transitions:

- `idle → searching`: User submits search form. Direct HTTP `fetch()` initiated.
- `searching → results`: HTTP response received and parsed.
- `results → entries`: User taps a result. Direct HTTP `fetch()` for entries.
- `entries → downloading`: User taps "Run Disk." App downloads binary from Commoserve via direct HTTP.
- `downloading → executing`: Binary downloaded. App uploads to device via REST POST.
- `executing → idle`: Device REST response confirms execution.
- `any → error`: HTTP or REST failure.

### 11.3 Run/Mount via REST

When the user triggers a run/mount action on a Commoserve result:

1. App knows: result id, category, file index, file path/extension (from HTTP data)
2. App downloads binary from Commoserve: `GET /leet/search/bin/{id}/{category}/{index}`
3. App determines REST endpoint from file extension (§6.3)
4. App uploads binary to device: `POST /v1/runners:run_prg` (or appropriate endpoint)
5. Device REST API returns success/error response

No Telnet session, no VT100 parsing, no menu navigation. The entire flow is HTTP + REST.

---

## 12. Forward Compatibility Strategy

### 12.1 Hostname Configuration

The Commoserve hostname SHOULD be configurable (default: `commoserve.files.commodore.net`). If future firmware updates change the hostname, the app can adapt without a code release. Store in app config alongside the C64U device hostname.

### 12.2 Preset Versioning

Presets are fetched dynamically from the server. If the server adds new categories, date ranges, types, or sort options, the app adapts automatically — dropdown options are populated from the fetched data, not hardcoded.

### 12.3 REST Coverage

The current firmware already provides REST endpoints for all file actions needed by CommoServe (§6.1, §6.3). If a future firmware version adds a dedicated CommoServe search endpoint (e.g., `GET /v1/commoserve/search?query=...`), the `commoserveApi` client can be updated to prefer the local REST endpoint over remote direct HTTP, eliminating the external server dependency for search. The `useCommoServe` hook interface remains unchanged.

### 12.4 HTTPS Migration

If the Commoserve server migrates to HTTPS:

- Android/iOS: No config change needed (HTTPS is always allowed)
- Web: Mixed content constraint removed. If CORS headers are added, web support becomes possible.
- App: Update `COMMOSERVE_BASE` URL. No other changes.

---

## 13. Explicit Non-Goals

1. **Telnet for CommoServe**: The entire CommoServe feature is implemented via direct HTTP + device REST. No Telnet is used. The Telnet path from base spec §10b is retained as documentation only, not as a recommended implementation path.
2. **Browser-based Commoserve access**: No CORS headers on the server. Not achievable without a proxy.
3. **Alternative hostname support**: The app targets `commoserve.files.commodore.net` only. The `hackerswithstyle.se` endpoint serves different content and is not used.
4. **Pagination**: The server caps results at 20. No pagination API has been observed. The app does not attempt to work around this limit.
5. **Local file caching**: Downloaded binaries are uploaded directly to the device via REST and not persisted on the app's local filesystem. Each run/mount re-downloads the binary from Commoserve.
6. **Caching search results**: Search results are not cached. Each search executes a fresh HTTP request. Presets are cached (§7.3).
7. **Proxy for web platform**: A Commoserve proxy (WebSocket, dev server, or cloud function) is not part of this specification. It may be considered in a future addendum.
