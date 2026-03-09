# Feature Status Matrix

## Human-Readable Matrix

| Feature ID | Feature Name | Area | Priority | Prompt File | Execution Status | Last Run ID | Evidence Path | Result | Root Cause / Blocker | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F001 | App shell launch + foreground | Shell | P0 | `prompts/F001-app-shell-and-launch.md` | executed-app-first-product | `pt-20260308T113329Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113329Z` | PASS | none | deepen startup assertions |
| F002 | Tab navigation across routes | Navigation | P0 | `prompts/F002-tab-navigation.md` | executed-app-first-product | `pt-20260308T113344Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113344Z` | PASS | none | add route-specific behavior checks |
| F003 | Home machine controls | Home | P0 | `prompts/F003-home-machine-controls.md` | executed-app-first-product | `pt-20260308T113442Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113442Z` | PASS | none | expand to action round-trip checks |
| F004 | Home quick config + LED/SID | Home | P1 | `prompts/F004-home-quick-config-and-led-sid.md` | executed-app-first-product | `pt-20260308T113442Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113442Z` | PASS | none | expand to mutation assertions |
| F005 | Home RAM workflows | Home | P0 | `prompts/F005-home-ram-workflows.md` | executed-app-first-product | `pt-20260308T113442Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113442Z` | PASS | none | add save/load/clear execution checks |
| F006 | Home config snapshots | Home | P1 | `prompts/F006-home-config-snapshots.md` | executed-app-first-product | `pt-20260308T113442Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113442Z` | PASS | none | add dialog persistence assertions |
| F007 | Disks library management | Disks | P0 | `prompts/F007-disks-library-management.md` | executed-app-first-product | `pt-20260308T113458Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113458Z` | PASS | none | add add/rename/delete round-trip checks |
| F008 | Disk mount/eject | Disks | P0 | `prompts/F008-disks-mount-eject.md` | executed-app-first-product | `pt-20260308T113458Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113458Z` | PASS | none | add drive-state API assertions |
| F009 | Drive + Soft IEC controls | Disks | P1 | `prompts/F009-disks-drive-and-softiec.md` | executed-app-first-product | `pt-20260308T113458Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113458Z` | PASS | none | add mutation rollback checks |
| F010 | Play source browsing | Play | P0 | `prompts/F010-play-source-browsing.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add source traversal checks |
| F011 | Playlist lifecycle | Play | P0 | `prompts/F011-playlist-lifecycle.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add create/remove/clear assertions |
| F012 | Playback transport | Play | P0 | `prompts/F012-playback-transport.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add runtime transport checks |
| F013 | Queue + volume controls | Play | P1 | `prompts/F013-playback-queue-and-volume.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add shuffle/repeat/volume state checks |
| F014 | Duration/songlength/subsong | Play | P1 | `prompts/F014-songlength-duration-subsong.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add subsong/duration round-trip checks |
| F015 | HVSC lifecycle | Play/HVSC | P0 | `prompts/F015-hvsc-download-ingest.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add phase transition checks |
| F016 | HVSC cache reuse | Play/HVSC | P0 | `prompts/F016-hvsc-cache-reuse.md` | executed-app-first-product | `pt-20260308T113514Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113514Z` | PASS | none | add cache-hit assertions |
| F017 | Lock-screen auto-advance | Play/Runtime | P0 | `prompts/F017-lock-screen-autoadvance.md` | executed-app-first-product | `pt-20260308T113530Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113530Z` | PASS | none | add due-at progression checks |
| F018 | Config browse/search | Config | P1 | `prompts/F018-config-browse-search.md` | executed-app-first-product | `pt-20260308T113600Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113600Z` | PASS | none | add filter + expansion checks |
| F019 | Config edit + mixer | Config | P0 | `prompts/F019-config-edit-and-audio-mixer.md` | executed-app-first-product | `pt-20260308T113600Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113600Z` | PASS | none | add edit/mixer round-trip checks |
| F020 | Settings connection/preferences | Settings | P0 | `prompts/F020-settings-connection-preferences.md` | executed-app-first-product | `pt-20260308T113616Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113616Z` | PASS | none | add save/reconnect checks |
| F021 | Settings diagnostics/safety | Settings | P0 | `prompts/F021-settings-diagnostics-safety.md` | executed-app-first-product | `pt-20260308T113616Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113616Z` | PASS | none | add export/import safety checks |
| F022 | Docs + licenses | Docs | P2 | `prompts/F022-docs-and-licenses.md` | executed-app-first-product | `pt-20260308T113344Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113344Z` | PASS | none | add content-section assertions |
| F023 | Persistence + reconnect recovery | Cross-cutting | P0 | `prompts/F023-persistence-and-recovery.md` | executed-app-first-product | `pt-20260308T113530Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/pt-20260308T113530Z` | PASS | none | add persisted-state delta checks |

## Machine-Readable Matrix (JSON)

```json
[
  {"id":"F001","result":"PASS","lastRunId":"pt-20260308T113329Z","prompt":"prompts/F001-app-shell-and-launch.md"},
  {"id":"F002","result":"PASS","lastRunId":"pt-20260308T113344Z","prompt":"prompts/F002-tab-navigation.md"},
  {"id":"F003","result":"PASS","lastRunId":"pt-20260308T113442Z","prompt":"prompts/F003-home-machine-controls.md"},
  {"id":"F004","result":"PASS","lastRunId":"pt-20260308T113442Z","prompt":"prompts/F004-home-quick-config-and-led-sid.md"},
  {"id":"F005","result":"PASS","lastRunId":"pt-20260308T113442Z","prompt":"prompts/F005-home-ram-workflows.md"},
  {"id":"F006","result":"PASS","lastRunId":"pt-20260308T113442Z","prompt":"prompts/F006-home-config-snapshots.md"},
  {"id":"F007","result":"PASS","lastRunId":"pt-20260308T113458Z","prompt":"prompts/F007-disks-library-management.md"},
  {"id":"F008","result":"PASS","lastRunId":"pt-20260308T113458Z","prompt":"prompts/F008-disks-mount-eject.md"},
  {"id":"F009","result":"PASS","lastRunId":"pt-20260308T113458Z","prompt":"prompts/F009-disks-drive-and-softiec.md"},
  {"id":"F010","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F010-play-source-browsing.md"},
  {"id":"F011","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F011-playlist-lifecycle.md"},
  {"id":"F012","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F012-playback-transport.md"},
  {"id":"F013","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F013-playback-queue-and-volume.md"},
  {"id":"F014","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F014-songlength-duration-subsong.md"},
  {"id":"F015","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F015-hvsc-download-ingest.md"},
  {"id":"F016","result":"PASS","lastRunId":"pt-20260308T113514Z","prompt":"prompts/F016-hvsc-cache-reuse.md"},
  {"id":"F017","result":"PASS","lastRunId":"pt-20260308T113530Z","prompt":"prompts/F017-lock-screen-autoadvance.md"},
  {"id":"F018","result":"PASS","lastRunId":"pt-20260308T113600Z","prompt":"prompts/F018-config-browse-search.md"},
  {"id":"F019","result":"PASS","lastRunId":"pt-20260308T113600Z","prompt":"prompts/F019-config-edit-and-audio-mixer.md"},
  {"id":"F020","result":"PASS","lastRunId":"pt-20260308T113616Z","prompt":"prompts/F020-settings-connection-preferences.md"},
  {"id":"F021","result":"PASS","lastRunId":"pt-20260308T113616Z","prompt":"prompts/F021-settings-diagnostics-safety.md"},
  {"id":"F022","result":"PASS","lastRunId":"pt-20260308T113344Z","prompt":"prompts/F022-docs-and-licenses.md"},
  {"id":"F023","result":"PASS","lastRunId":"pt-20260308T113530Z","prompt":"prompts/F023-persistence-and-recovery.md"}
]
```
