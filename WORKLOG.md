# Telnet Integration Addendum — Worklog

Date: 2026-03-25

---

## Phase 1 — Document Audit

### Documents Read

| Document               | Path                                                   | Key Findings                                                                      |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Telnet Spec            | `doc/c64/telnet/c64u-telnet-spec.md`                   | 8 menu categories, 42 actions, CommoServe via F6, REST vs Telnet capability table |
| Integration Spec       | `doc/c64/telnet/c64u-telnet-integration-spec.md`       | Full architecture, concurrency model, VT100 parser, CommoServe executor API       |
| Action Walkthrough     | `doc/c64/telnet/c64u-telnet-action-walkthrough.md`     | All 8 submenus with screen captures                                               |
| Commoserve Walkthrough | `doc/c64/telnet/c64u-telnet-commoserve-walkthrough.md` | Full F6 flow with field population and result selection                           |
| OpenAPI Spec           | `doc/c64/c64u-openapi.yaml`                            | REST surface — machine, drives, configs, streams, files, memory                   |

### Source Files Read

| File                      | Key Findings                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- |
| `telnetTypes.ts`          | 11 TELNET_ACTIONS defined, screen/menu/form types, transport abstraction        |
| `telnetClient.ts`         | Capacitor-backed transport via TelnetSocket plugin                              |
| `telnetSession.ts`        | Connect, auth, idle timeout (5m), reconnect (2 retries), screen buffer assembly |
| `telnetScreenParser.ts`   | VT100 parser, menu detection via line-draw chars, screen classification         |
| `telnetMenuNavigator.ts`  | Label-based navigation, 10s action timeout, desync recovery via LEFT            |
| `telnetActionExecutor.ts` | Generic execute(actionId) delegating to navigator                               |
| `telnetMock.ts`           | Not read in detail (exists)                                                     |

### Gaps Identified

1. **CommoServe direct HTTP**: No exploration of bypassing Telnet for search/browse via direct HTTP to Commoserve API
2. **Missing endpoints**: Presets, entries, and binary download endpoints undocumented in app specs
3. **Hostname divergence**: Not documented — firmware uses `hackerswithstyle.se`, observed traffic uses `commoserve.files.commodore.net`
4. **Client-Id divergence**: Not documented — firmware hardcodes `Ultimate`, observed C64U traffic shows `Commodore`
5. **Result cap**: Not documented — server returns max 20 results per query
6. **Entry metadata**: Entries endpoint returns `size` and `date` fields not documented

---

## Phase 2 — Firmware Analysis

### Firmware Location

`/home/chris/dev/c64/1541ultimate/` — 1541 Ultimate / Ultimate 64 firmware source

### Key Firmware Files

| File                 | Path                                        | Findings                                                                                       |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `assembly.h`         | `software/network/assembly.h`               | Assembly class: `get_presets()`, `send_query()`, `request_entries()`, `request_binary()`       |
| `assembly.cc`        | `software/network/assembly.cc`              | **HOSTNAME**: `hackerswithstyle.se` port 80. **Client-Id**: `Ultimate`. 4 URL paths confirmed. |
| `assembly_search.h`  | `software/userinterface/assembly_search.h`  | Form fields, query result browsing, preset handling, file entry wrapping                       |
| `assembly_search.cc` | `software/userinterface/assembly_search.cc` | Query construction: `send_query()` at line 201-267. AQL grammar confirmed.                     |

### Firmware Endpoint Constants (from `assembly.cc`)

```c
#define HOSTNAME      "hackerswithstyle.se"
#define HOSTPORT      80
#define URL_SEARCH    "/leet/search/aql?query="
#define URL_PATTERNS  "/leet/search/aql/presets"
#define URL_ENTRIES   "/leet/search/entries"
#define URL_DOWNLOAD  "/leet/search/bin"
```

### AQL Query Construction (from `assembly_search.cc:201-234`)

- Iterates all `BrowsableQueryField` instances
- Skips empty fields and `$` (submit button)
- Text fields: `(name:"value")`
- Dropdown fields: `(category:apps)` (no quotes)
- Joins with `&`
- Special case: `rating` field prefixes `>=` (not exposed in C64U UI)

### Divergences: C64 Ultimate vs 1541 Ultimate Firmware

| Property  | 1541 Ultimate Firmware                      | C64 Ultimate (Observed)          |
| --------- | ------------------------------------------- | -------------------------------- |
| Hostname  | `hackerswithstyle.se`                       | `commoserve.files.commodore.net` |
| Client-Id | `Ultimate`                                  | `Commodore`                      |
| UI Title  | "Assembly 64 Query Form"                    | "CommoServe File Search"         |
| Menu Key  | F5 → KEY_TASKS                              | F1 opens action menu directly    |
| Backend   | nginx/1.24.0 (Ubuntu), direct               | Cloudflare edge-terminated       |
| CORS      | `Access-Control-Allow-Origin: *`            | None                             |
| Results   | Empty for `category:apps` (different data?) | 6 results for `category:apps`    |

### Conclusion

The C64 Ultimate firmware forks the Assembly64 client with a different hostname, Client-Id, and branding. Both backends share the same API contract but serve different (or overlapping) content databases. The `commoserve.files.commodore.net` endpoint is authoritative for C64 Ultimate devices.

---

## Phase 3 — Protocol Normalization Evidence

### Endpoint 1: Search (`/leet/search/aql`)

**Request:**

```
GET /leet/search/aql?query=(category:apps) HTTP/1.1
Host: commoserve.files.commodore.net
Accept-Encoding: identity
User-Agent: Assembly Query
Client-Id: Commodore
```

**Response:**

```json
[
  {"name":"JollyDisk","id":"2555659515","category":40,...},
  {"name":"GUI64","id":"2555659417","category":40,...},
  {"name":"UltimateTerm","id":"2555659516","category":40,"year":2023,...},
  {"name":"Joyride","id":"2567969688","category":40,"year":2024,...},
  {"name":"CCGMS Ultimate","id":"2555665468","category":40,"year":2017,...},
  {"name":"Anykey","id":"2567906031","category":40,"year":2024,...}
]
```

**Response fields (per result):**

- `name` (string, always present)
- `id` (string, always present)
- `category` (integer, always present)
- `siteCategory` (integer)
- `siteRating` (float)
- `year` (integer, 0 when unknown)
- `rating` (integer)
- `updated` (date string, YYYY-MM-DD)
- `group` (string, optional)
- `handle` (string, optional)
- `released` (date string, optional)

### Endpoint 2: Presets (`/leet/search/aql/presets`)

**Response (summarized):**

```json
[
  {"type":"category","description":"Category","values":[
    {"aqlKey":"apps","name":"Apps"},
    {"aqlKey":"demos","name":"Demos"},
    {"aqlKey":"games","name":"Games"},
    {"aqlKey":"graphics","name":"Graphics"},
    {"aqlKey":"music","name":"Music"}
  ]},
  {"type":"date","description":"Date","values":[
    {"aqlKey":"1980"},{"aqlKey":"1981"},...,{"aqlKey":"2025"}
  ]},
  {"type":"type","description":"Type","values":[
    {"aqlKey":"crt"},{"aqlKey":"d64"},{"aqlKey":"d71"},
    {"aqlKey":"d81"},{"aqlKey":"sid"},{"aqlKey":"t64"},{"aqlKey":"tap"}
  ]},
  {"type":"sort","description":"Sort by","values":[
    {"aqlKey":"name","name":"Name"},{"aqlKey":"year","name":"Year"}
  ]},
  {"type":"order","description":"Sort Order","values":[
    {"aqlKey":"asc","name":"Ascending"},{"aqlKey":"desc","name":"Descending"}
  ]}
]
```

**Preset value structure:**

- Always has `aqlKey` (string)
- Optionally has `name` (display label); when absent, `aqlKey` is the display name

### Endpoint 3: Entries (`/leet/search/entries/{id}/{category}`)

**Request:**

```
GET /leet/search/entries/2567969688/40
```

**Response:**

```json
{
  "contentEntry": [
    { "path": "joyride.d64", "id": 0, "size": 174848, "date": 1773676443000 },
    { "path": "joyride_license.txt", "id": 1, "size": 1282, "date": 1773676444000 }
  ]
}
```

**Entry fields:**

- `path` (string, filename)
- `id` (integer, zero-based index)
- `size` (integer, bytes)
- `date` (integer, Unix timestamp in milliseconds)

### Endpoint 4: Binary Download (`/leet/search/bin/{id}/{category}/{index}`)

**Request:**

```
GET /leet/search/bin/2567969688/40/0
```

**Response:** Raw binary file (174848 bytes for joyride.d64). No JSON wrapper.

### Header Enforcement

Without required headers, server returns:

```json
{ "errorCode": 464, "timestamp": 1774429952017 }
```

Both `Client-Id: Ultimate` and `Client-Id: Commodore` are accepted.

### Result Cap

Server returns maximum 20 results per search query. Confirmed with `(category:games)` which has far more than 20 entries.

---

## Phase 4 — Platform Feasibility

### Feasibility Matrix

| Platform        | HTTP to commoserve                                         | Custom Headers                            | CORS                                       | Verdict                               |
| --------------- | ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------- |
| Android         | Requires `network_security_config.xml` cleartext exception | Yes, via `fetch()` or `HttpURLConnection` | N/A (native)                               | **Supported** with config             |
| iOS             | Requires `NSAppTransportSecurity` Info.plist exception     | Yes, via `URLSession`                     | N/A (native)                               | **Supported** with config             |
| Web (browser)   | Mixed content blocked (if served via HTTPS)                | Yes, but CORS blocks cross-origin         | **No CORS headers** on commoserve endpoint | **Blocked**                           |
| Web (dev proxy) | Vite dev proxy can forward                                 | Yes                                       | Bypassed                                   | **Workaround available** for dev only |

### CORS Observation

- `commoserve.files.commodore.net`: No `Access-Control-Allow-Origin` header → blocked by browsers
- `hackerswithstyle.se`: Has `Access-Control-Allow-Origin: *` → but returns empty/different data for C64U categories

### Android Config Required

Add to existing `network_security_config.xml`:

```xml
<domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">commoserve.files.commodore.net</domain>
</domain-config>
```

### iOS Config Required

Add to `Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>commoserve.files.commodore.net</key>
        <dict>
            <key>NSTemporaryExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```

---

## Phase 5 — Validation Log

### Query 1: Canonical (category=apps)

- **Request**: `GET /leet/search/aql?query=(category:apps)`
- **Result**: 6 items — JollyDisk, GUI64, UltimateTerm, Joyride, CCGMS Ultimate, Anykey
- **Status**: ✅ Matches intercepted traffic exactly

### Query 2: Games + sort=name + order=asc

- **Request**: `GET /leet/search/aql?query=(category:games) & (sort:name) & (order:asc)`
- **Result**: 20 items, alphabetically sorted (Acid Runner → Green Felt Classics)
- **Status**: ✅ Sort and order confirmed

### Query 3: Demos + type=sid

- **Request**: `GET /leet/search/aql?query=(category:demos) & (type:sid)`
- **Result**: 20 items (cap hit)
- **Status**: ✅ Type filtering works

### Query 4: Games + date=2024 + type=d64 + sort=year + order=desc

- **Request**: `GET /leet/search/aql?query=(category:games) & (date:2024) & (type:d64) & (sort:year) & (order:desc)`
- **Result**: 1 item — Timos Castle
- **Status**: ✅ Multi-parameter filtering works

### Query 5: Name search + category

- **Request**: `GET /leet/search/aql?query=(name:"joyride") & (category:apps)`
- **Result**: 1 item — Joyride (id=2567969688, category=40, year=2024)
- **Status**: ✅ Name search with quotes works

### Query 6: Music + sid + sort

- **Request**: `GET /leet/search/aql?query=(category:music) & (type:sid) & (sort:name) & (order:asc)`
- **Result**: 20 items, alphabetically sorted
- **Status**: ✅

### Query 7: Nonexistent name

- **Request**: `GET /leet/search/aql?query=(name:"xyznonexistent999")`
- **Result**: `[]`
- **Status**: ✅ Empty array returned

### Query 8: No headers

- **Request**: `GET /leet/search/aql?query=(category:apps)` (no special headers)
- **Result**: `{"errorCode":464,"timestamp":...}`
- **Status**: ✅ Server enforces required headers

### Query 9: Client-Id comparison

- `Client-Id: Ultimate`: 6 results (same)
- `Client-Id: Commodore`: 6 results (same)
- **Status**: ✅ Both accepted, identical results on commoserve endpoint

### Query 10: Firmware hostname

- **Request**: Same query to `hackerswithstyle.se`
- **Result**: `[]` (empty)
- **Status**: ✅ Confirms hostname divergence — different content database

### Query 11: Presets

- **Request**: `GET /leet/search/aql/presets`
- **Result**: 5 preset types with full values (category: 5, date: 46 years, type: 7, sort: 2, order: 2)
- **Status**: ✅

### Query 12: Entries + Binary

- **Request**: `GET /leet/search/entries/2567969688/40`
- **Result**: 2 entries (joyride.d64: 174848 bytes, joyride_license.txt: 1282 bytes)
- **Binary**: `GET /leet/search/bin/2567969688/40/0` → 174848 bytes
- **Status**: ✅

---

## Phase 6 — Architecture Classification

### Telnet Feature Classification

| Feature                     | Classification  | Rationale                                                 |
| --------------------------- | --------------- | --------------------------------------------------------- |
| Power Cycle                 | Must-Telnet     | No REST endpoint                                          |
| Reboot (Clear Memory)       | Must-Telnet     | No REST endpoint                                          |
| Save C64 Memory             | Must-Telnet     | No REST endpoint                                          |
| Save REU Memory             | Must-Telnet     | No REST endpoint                                          |
| IEC Turn On/Reset/Set Dir   | Must-Telnet     | No REST endpoint                                          |
| Printer Flush/Reset/Turn On | Must-Telnet     | No REST endpoint                                          |
| Save Config to File         | Must-Telnet     | No REST endpoint                                          |
| Clear Flash Config          | Must-Telnet     | No REST endpoint                                          |
| Developer actions           | Must-Telnet     | No REST endpoint                                          |
| CommoServe Search           | **Direct HTTP** | Search via direct HTTP to commoserve server               |
| CommoServe Browse entries   | **Direct HTTP** | Entry listing via direct HTTP to commoserve server        |
| CommoServe Run/Mount        | **REST**        | Download via direct HTTP + upload to device via REST POST |

### CommoServe Architecture (Corrected)

```
                Direct HTTP (search/browse/download)
App ─────────────────────────────────────────→ commoserve.files.commodore.net
  │                                                      │
  │  REST (run/mount uploaded binary)                    │
  └─────────→ C64U REST API (POST /v1/runners:* etc.)   │
```

1. **Search**: App sends HTTP directly to commoserve API → no Telnet needed
2. **Browse entries**: App fetches entries via HTTP → no Telnet needed
3. **Download binary**: App downloads from commoserve via HTTP → no Telnet needed
4. **Run/Mount**: App uploads binary to device via REST POST → no Telnet needed

**Correction (2026-03-25)**: Originally classified Run/Mount as Must-Telnet. The OpenAPI spec
(`doc/c64/c64u-openapi.yaml`) provides REST POST endpoints that accept binary uploads:
`POST /v1/runners:run_prg`, `POST /v1/runners:run_crt`, `POST /v1/runners:load_prg`,
`POST /v1/drives/{drive}:mount`, `POST /v1/runners:sidplay`. This eliminates the Telnet
requirement for all CommoServe operations.

---

## Phase 7 — Addendum Spec Created

Output: `doc/c64/telnet/c64u-telnet-integration-spec-addendum-1.md`
