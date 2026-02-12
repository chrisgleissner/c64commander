# Database Schema (App-Owned Tables)

## Scope

This document defines the persistent relational schema owned by C64 Commander for large playlist and HVSC workflows.

- Architecture alignment: [architecture.md](architecture.md), section "Play Page Browsing and Playlist Spec".
- Source transparency requirement: source origin is storage detail, not playlist UX identity.
- SID metadata requirement: PSID/RSID header metadata is parsed and persisted for query/display.

## Current State vs Target State

- Current runtime state (today): playlist/query/session persistence runs through TypeScript repository interfaces with IndexedDB (durable) and localStorage fallback adapters.
- Target runtime state (planned): app-owned relational tables with explicit migration management and FTS-backed querying as defined below.

## Conventions

- IDs: `TEXT` (UUID/ULID).
- Timestamps: ISO-8601 UTC text.
- Paths: normalized, leading `/`, case-preserving.
- Enums are stored as `TEXT` with explicit allowed values documented below.
- All schema migrations are app-owned and versioned in `schema_migrations`.

Terminology (used throughout this schema):

- SID file: raw `.sid` binary container.
- SID track: canonical app record for one SID file (`tracks` row).
- SID song: one subsong in a SID track (`track_subsongs.song_nr`).

## Table Inventory

## `schema_migrations`

Tracks applied migrations.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| version | INTEGER | PK | Monotonic migration number |
| applied_at | TEXT | NOT NULL | ISO-8601 UTC |

## `playlists`

Logical playlist containers.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| playlist_id | TEXT | PK | |
| name | TEXT | NOT NULL | Default playlist supported |
| created_at | TEXT | NOT NULL | |
| updated_at | TEXT | NOT NULL | |

## `tracks`

Canonical track records shared across all sources.
For SID content, one row represents one SID track (one SID file).

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| track_id | TEXT | PK | Canonical SID track id when category is SID |
| source_kind | TEXT | NOT NULL | `local \| ultimate \| hvsc` |
| source_locator | TEXT | NOT NULL | Source-specific stable locator (virtual path, FTP path, SAF/entry path) |
| title | TEXT | NOT NULL | Canonical display title |
| author | TEXT | NULL | Canonical author/composer |
| released | TEXT | NULL | Canonical release/date text from SID header when available |
| path | TEXT | NOT NULL | Normalized path shown in playlist details |
| size_bytes | INTEGER | NULL | |
| modified_at | TEXT | NULL | Source mtime when available |
| default_duration_ms | INTEGER | NULL | Primary/default song duration |
| subsong_count | INTEGER | NULL | |
| stars | INTEGER | NULL | Optional user rating |
| created_at | TEXT | NOT NULL | |
| updated_at | TEXT | NOT NULL | |

Constraints and indexes:

- Unique: `(source_kind, source_locator)`.
- Index: `(title)`.
- Index: `(author)`.
- Index: `(released)`.
- Index: `(path)`.

## `sid_metadata`

One row per SID track (`tracks.track_id`) with parsed PSID/RSID header fields.
Metadata in this table is SID-file/SID-track level, not per subsong.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| track_id | TEXT | PK, FK -> tracks(track_id) | 1:1 with SID track |
| magic_id | TEXT | NOT NULL | `PSID \| RSID` |
| version | INTEGER | NOT NULL | 1, 2, 3, 4 |
| data_offset | INTEGER | NOT NULL | Header data offset |
| load_address | INTEGER | NOT NULL | 16-bit value |
| init_address | INTEGER | NOT NULL | 16-bit value |
| play_address | INTEGER | NOT NULL | 16-bit value |
| songs | INTEGER | NOT NULL | 1..256 |
| start_song | INTEGER | NOT NULL | 1..songs |
| speed_bits | INTEGER | NOT NULL | 32-bit speed field |
| flags | INTEGER | NULL | v2+ flags field |
| clock | TEXT | NOT NULL | `unknown \| pal \| ntsc \| pal_ntsc` |
| sid1_model | TEXT | NOT NULL | `unknown \| mos6581 \| mos8580 \| both` |
| sid2_model | TEXT | NULL | Same enum, nullable when absent |
| sid3_model | TEXT | NULL | Same enum, nullable when absent |
| sid2_adress | INTEGER | NULL | Middle-byte encoding from SID spec |
| sid2_address | INTEGER | NULL | Middle-byte encoding from SID spec |
| sid_chip_count | INTEGER | NOT NULL | 1..3 |
| mus_player | INTEGER | NOT NULL | 0/1 |
| psid_specific | INTEGER | NULL | 0/1, PSID semantics |
| c64_basic_flag | INTEGER | NULL | 0/1, RSID semantics |
| name_raw | TEXT | NULL | Windows-1252 decoded string |
| author_raw | TEXT | NULL | Windows-1252 decoded string |
| released_raw | TEXT | NULL | Windows-1252 decoded string |
| rsid_valid | INTEGER | NULL | 0/1, RSID strict validation outcome |
| parser_warnings_json | TEXT | NULL | JSON array of warnings |
| parsed_at | TEXT | NOT NULL | |

Indexes:

- Index: `(clock)`.
- Index: `(sid1_model, sid2_model, sid3_model)`.
- Index: `(songs, start_song)`.

## `track_subsongs`

Per-subsong metadata and durations.
Each row represents one SID song (subsong) inside one SID track.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| track_id | TEXT | PK(part), FK -> tracks(track_id) | |
| song_nr | INTEGER | PK(part) | 1-based SID song number |
| duration_ms | INTEGER | NULL | Duration for this subsong |
| speed_mode | TEXT | NULL | `vbi \| cia \| unknown` |
| is_default | INTEGER | NOT NULL | 0/1 |

Indexes:

- Index: `(track_id, song_nr)`.
- Index: `(is_default)`.

## `playlist_items`

Playlist membership and order.
For SID entries, `song_nr` selects the SID song (subsong) from the SID track.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| playlist_item_id | TEXT | PK | |
| playlist_id | TEXT | NOT NULL, FK -> playlists(playlist_id) | |
| track_id | TEXT | NOT NULL, FK -> tracks(track_id) | |
| song_nr | INTEGER | NOT NULL | Selected SID song/subsong |
| sort_key | TEXT | NOT NULL | Stable ordering key for large-list reorder |
| duration_override_ms | INTEGER | NULL | User override |
| status | TEXT | NOT NULL | `ready \| unavailable` |
| unavailable_reason | TEXT | NULL | `source-revoked \| file-inaccessible \| hvsc-unavailable` |
| added_at | TEXT | NOT NULL | |

Indexes and constraints:

- Unique: `(playlist_id, sort_key)`.
- Index: `(playlist_id, track_id)`.
- Index: `(playlist_id, status)`.

## `playlist_sessions`

Persisted runtime session state for restore/random play.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| playlist_id | TEXT | PK, FK -> playlists(playlist_id) | One active session per playlist |
| current_playlist_item_id | TEXT | NULL, FK -> playlist_items(playlist_item_id) | |
| is_playing | INTEGER | NOT NULL | 0/1 |
| is_paused | INTEGER | NOT NULL | 0/1 |
| elapsed_ms | INTEGER | NOT NULL | |
| played_ms | INTEGER | NOT NULL | |
| shuffle_enabled | INTEGER | NOT NULL | 0/1 |
| repeat_enabled | INTEGER | NOT NULL | 0/1 |
| random_seed | INTEGER | NULL | Deterministic random-play seed |
| random_cursor | INTEGER | NULL | Position in randomized sequence |
| active_query | TEXT | NULL | Current filter string |
| updated_at | TEXT | NOT NULL | |

## `hvsc_folders`

Persistent HVSC folder adjacency index.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| folder_path | TEXT | PK | Normalized HVSC folder path |
| parent_path | TEXT | NULL | Root has NULL |
| folder_name | TEXT | NOT NULL | |
| child_folder_count | INTEGER | NOT NULL | |
| child_track_count | INTEGER | NOT NULL | |
| updated_at | TEXT | NOT NULL | |

Indexes:

- Index: `(parent_path, folder_name)`.

## `hvsc_folder_tracks`

Folder-to-track membership for fast folder listing.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| folder_path | TEXT | PK(part), FK -> hvsc_folders(folder_path) | |
| track_id | TEXT | PK(part), FK -> tracks(track_id) | |
| file_name | TEXT | NOT NULL | Cached for ordered listing |

Indexes:

- Index: `(folder_path, file_name)`.

## `hvsc_ingestion_runs`

Operational telemetry for ingestion completeness and failures.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| ingestion_id | TEXT | PK | |
| started_at | TEXT | NOT NULL | |
| finished_at | TEXT | NULL | |
| baseline_version | INTEGER | NULL | |
| target_version | INTEGER | NULL | |
| state | TEXT | NOT NULL | `in-progress \| ready \| failed \| cancelled` |
| songs_total | INTEGER | NOT NULL | |
| songs_ingested | INTEGER | NOT NULL | |
| songs_failed | INTEGER | NOT NULL | |
| songlength_syntax_errors | INTEGER | NOT NULL | |
| error_summary_json | TEXT | NULL | Structured failure details |

Indexes:

- Index: `(state, started_at)`.

## `tracks_fts` (virtual)

Full-text search index for instant filtering at 100k scale.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| track_id | TEXT | NOT NULL | Mirrors `tracks.track_id` |
| title | TEXT | NOT NULL | |
| author | TEXT | NULL | |
| released | TEXT | NULL | |
| path | TEXT | NOT NULL | |
| sid_facets | TEXT | NULL | Flattened SID metadata facets |

Notes:

- Implemented with SQLite FTS5 (or equivalent for web adapter).
- Updated transactionally with `tracks`/`sid_metadata`.

## Ownership Rules

- Only app migrations may create/drop/alter app-owned tables.
- Repository implementations must treat this document as the schema contract.
- Any schema change must update this file and [PLANS.md](../PLANS.md) tasks.
