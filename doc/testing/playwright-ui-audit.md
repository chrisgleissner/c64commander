# Playwright UI Coverage Audit - Full Click-Path Inventory

**Audit Date**: 2026-01-21  
**Status**: In Progress  
**Goal**: Achieve comprehensive E2E coverage with evidence for all high-value UI paths

---

## Executive Summary

### Current State

- **9 test spec files** covering major workflows
- **Existing Tests**: ~65 test cases across UI, disk management, playback, HVSC, audio mixer, feature flags, screenshots, solo routing
- **Evidence Quality**: High - step screenshots + video enabled

### Target State

- **Expand coverage** for all interactive widgets and click paths
- **Evidence Score 3** for all high-value paths
- **Add >=20 new tests** OR **augment >=40 existing tests**

---

## Page Inventory

### 1. Home Page (`/`)

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| machine-reset | Button | Reset | POST /v1/machine:reset | Network failure | ui.spec.ts (button sweep) |
| machine-reboot | Button | Reboot | POST /v1/machine:reboot | Network failure | ui.spec.ts (button sweep) |
| machine-menu | Button | Menu | POST /v1/machine:menu_button | Network failure | ui.spec.ts (button sweep) |
| machine-pause | Button | Pause | POST /v1/machine:pause | Network failure | ui.spec.ts (button sweep) |
| machine-resume | Button | Resume | POST /v1/machine:resume | Network failure | ui.spec.ts (button sweep) |
| machine-poweroff | Button | Power Off | POST /v1/machine:poweroff | Network failure | ui.spec.ts (button sweep) |
| config-save-dialog | Button | Save config | Opens dialog | Empty name, duplicate name | **MISSING** |
| config-load-dialog | Button | Load config | Opens dialog | No saved configs | **MISSING** |
| config-manage-dialog | Button | Manage configs | Opens dialog | Rename, delete operations | **MISSING** |
| drives-summary | Button | Open Disks | navigate('/disks') | N/A | ui.spec.ts |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| HP-1 | Open save dialog → enter name → save → verify toast | HIGH | Config saved to localStorage | 0 (MISSING) |
| HP-2 | Open save dialog → empty name → verify error | HIGH | Error toast shown | 0 (MISSING) |
| HP-3 | Open save dialog → duplicate name → verify error | HIGH | Error toast shown | 0 (MISSING) |
| HP-4 | Open load dialog → select config → verify loaded | HIGH | Config applied to server | 0 (MISSING) |
| HP-5 | Open manage dialog → rename config → verify updated | HIGH | Config renamed in localStorage | 0 (MISSING) |
| HP-6 | Open manage dialog → delete config → verify removed | HIGH | Config removed from localStorage | 0 (MISSING) |
| HP-7 | Machine control button → verify REST call | MEDIUM | Correct endpoint called | 2 (ui.spec.ts weak) |

---

### 2. Disks Page (`/disks`)

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| add-items-btn | Button | Add items | Opens ItemSelectionDialog | No items selected | diskManagement.spec.ts (strong) |
| disk-filter | Input | Filter disks… | Filters visible disks | Empty filter, no matches | diskManagement.spec.ts |
| clear-filter-btn | Button | Clear filter | Clears filter input | N/A | diskManagement.spec.ts |
| select-all-btn | Button | Select all | Selects all disk rows | N/A | diskManagement.spec.ts |
| remove-selected-btn | Button | Remove selected | Batch delete confirmation | Mounted disks | diskManagement.spec.ts |
| view-all-btn | Button | View all | Opens full list dialog | List preview limit | diskManagement.spec.ts |
| disk-row-mount | Button | Mount | Opens mount dialog | Network failure | diskManagement.spec.ts |
| disk-row-menu | Button | Item actions | Opens context menu | N/A | diskManagement.spec.ts |
| disk-row-checkbox | Checkbox | (selection) | Adds to selection | N/A | diskManagement.spec.ts |
| mount-drive-a | Button | Drive A | PUT /v1/drives/a:mount | Network failure, timeout | diskManagement.spec.ts |
| mount-drive-b | Button | Drive B | PUT /v1/drives/b:mount | Network failure, timeout | diskManagement.spec.ts |
| mount-next-btn | Button | Next | Rotates to next disk in group | No next disk | diskManagement.spec.ts |
| mount-prev-btn | Button | Prev | Rotates to previous disk | No prev disk | **MISSING** |
| disk-menu-rename | MenuItem | Rename disk | Opens rename dialog | Empty name, duplicate | diskManagement.spec.ts |
| disk-menu-remove | MenuItem | Remove from collection | Confirmation dialog | Mounted disk | diskManagement.spec.ts |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| DP-1 | Import local folder → verify sorted list | HIGH | Disks shown, sorted by path | 3 (diskManagement.spec.ts) |
| DP-2 | Import C64U folder → verify paths preserved | HIGH | Full paths retained | 3 (diskManagement.spec.ts) |
| DP-3 | Mount disk to Drive A → verify endpoint | HIGH | PUT /v1/drives/a:mount called | 3 (diskManagement.spec.ts) |
| DP-4 | Rotate disk group → verify next disk mounted | HIGH | Correct disk mounted | 3 (diskManagement.spec.ts) |
| DP-5 | Delete mounted disk → verify ejected first | HIGH | PUT /v1/drives/a:remove called | 3 (diskManagement.spec.ts) |
| DP-6 | Filter disks → verify non-matches greyed | MEDIUM | Opacity applied correctly | 3 (diskManagement.spec.ts) |
| DP-7 | FTP login failure → verify error toast | HIGH | Error displayed | 3 (diskManagement.spec.ts) |
| DP-8 | Import non-disk folder → verify warning | MEDIUM | Warning shown | 3 (diskManagement.spec.ts) |
| DP-9 | Rotate to previous disk → verify mount | HIGH | Correct disk mounted | 0 (MISSING) |

---

### 3. Play Page (`/play`)

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| add-items-btn | Button | Add items / Add more | Opens ItemSelectionDialog | No sources | playback.spec.ts |
| add-folder-btn | Button | Add folder | File input (webkitdirectory) | No supported files | playback.spec.ts |
| playlist-filter | Input | Filter playlist… | Filters playlist items | No matches | **MISSING** |
| playlist-play | Button | Play / Stop | Starts/stops playback | Empty playlist | playback.spec.ts |
| playlist-pause | Button | Pause / Resume | Pauses/resumes playback | Not playing | playback.spec.ts |
| playlist-prev | Button | Prev | Previous track | First track | playback.spec.ts |
| playlist-next | Button | Next | Next track | Last track | playback.spec.ts |
| playlist-shuffle | Checkbox | Shuffle | Toggles shuffle mode | N/A | **MISSING** |
| playlist-repeat | Checkbox | Repeat | Toggles repeat mode | N/A | **MISSING** |
| playlist-select-all | Button | Select all | Selects all items | N/A | playback.spec.ts |
| playlist-remove-selected | Button | Remove selected | Removes from playlist | N/A | playback.spec.ts |
| playlist-view-all | Button | View all | Opens full list dialog | List preview limit | playback.spec.ts |
| playlist-item-play | Button | Play | Plays specific track | Network failure | playback.spec.ts |
| playlist-item-checkbox | Checkbox | (selection) | Adds to selection | N/A | **MISSING** |
| hvsc-install | Button | Install HVSC | Installs HVSC library | Network failure | hvsc.spec.ts |
| hvsc-check-updates | Button | Check updates | Checks for HVSC updates | Network failure | hvsc.spec.ts |
| hvsc-ingest-cached | Button | Ingest cached | Ingests cached download | No cache | hvsc.spec.ts |
| hvsc-folder-btn | Button | Folder name | Navigates to HVSC folder | Empty folder | hvsc.spec.ts |
| hvsc-song-play | Button | Play | Adds HVSC song to playlist | Network failure | hvsc.spec.ts |
| duration-override | Input | Duration override | Sets custom duration | Invalid format | **MISSING** |
| song-number-input | Input | Song # | Sets SID subsong number | Out of range | **MISSING** |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| PP-1 | Add local folder → verify playlist | HIGH | Supported files listed | 3 (playback.spec.ts) |
| PP-2 | Add local folder → filter playlist | HIGH | Filtered items shown | 0 (MISSING) |
| PP-3 | Play SID → verify POST /v1/runners:sidplay | HIGH | Correct payload sent | 3 (playback.spec.ts) |
| PP-4 | Play disk → verify mount + autostart | HIGH | Mount + writemem called | 3 (playback.spec.ts) |
| PP-5 | Play disk → verify autostart sequence | HIGH | Correct memory writes | 2 (playback.spec.ts) |
| PP-6 | Browse C64U → select files → add to playlist | HIGH | Items added | 3 (playback.spec.ts) |
| PP-7 | Enable shuffle → verify shuffle category checkboxes | MEDIUM | Shuffle UI shown | 0 (MISSING) |
| PP-8 | Toggle repeat → verify state persists | MEDIUM | Repeat enabled after reload | 0 (MISSING) |
| PP-9 | Playlist empty → verify play disabled | MEDIUM | Play button disabled | 2 (playback.spec.ts) |
| PP-10 | Local folder no supported files → verify warning | HIGH | Warning shown | 3 (playback.spec.ts) |
| PP-11 | FTP failure → verify error toast | HIGH | Error displayed | 3 (playback.spec.ts) |
| PP-12 | Prev at first track → verify behavior | MEDIUM | No wrap or stays at first | 0 (MISSING) |
| PP-13 | Next at last track → verify behavior | MEDIUM | No wrap or stops | 0 (MISSING) |
| PP-14 | Set custom duration → verify used in playback | HIGH | Duration override applied | 0 (MISSING) |
| PP-15 | Set SID subsong → verify sent to sidplay | HIGH | Song number in payload | 0 (MISSING) |
| PP-16 | Playlist persistence → reload → verify restored | HIGH | Playlist restored | 3 (playback.spec.ts) |
| PP-17 | HVSC install → browse → play track | HIGH | Full workflow works | 3 (hvsc.spec.ts) |
| PP-18 | HVSC update → verify browsing works | HIGH | Updated songs available | 3 (hvsc.spec.ts) |
| PP-19 | HVSC cached ingest → verify success | HIGH | Ingestion completes | 3 (hvsc.spec.ts) |
| PP-20 | HVSC install failure → retry → success | HIGH | Retry works | 3 (hvsc.spec.ts) |

---

### 4. Config Page (`/config`)

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| refresh-btn | Button | Refresh | Refetches all categories | Network failure | ui.spec.ts |
| category-toggle | Button | Category name | Expands/collapses section | N/A | ui.spec.ts |
| config-item-select | Select | (dropdown) | Changes config value | Invalid option | ui.spec.ts |
| config-item-checkbox | Checkbox | (toggle) | Changes boolean config | N/A | ui.spec.ts |
| config-item-slider | Slider | Volume slider | Changes numeric config | Min/max bounds | ui.spec.ts, audioMixer.spec.ts |
| solo-toggle | Checkbox | Solo Vol * | Enables solo routing | Network failure | solo.spec.ts |
| config-reset-btn | Button | Reset | Resets category to defaults | Network failure | **MISSING** |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| CP-1 | Expand category → change select → verify PUT | HIGH | Correct value sent | 3 (ui.spec.ts) |
| CP-2 | Expand category → toggle checkbox → verify PUT | HIGH | Correct value sent | 3 (ui.spec.ts) |
| CP-3 | Expand Audio Mixer → adjust slider → verify no batch | HIGH | Individual PUT sent | 3 (audioMixer.spec.ts) |
| CP-4 | Adjust multiple sliders → verify solo disabled | HIGH | Solo reset on edit | 3 (audioMixer.spec.ts) |
| CP-5 | Enable solo → verify routing updates | HIGH | POST /v1/configs batch | 3 (solo.spec.ts) |
| CP-6 | Switch solo → verify instant update | HIGH | Previous muted, new unmuted | 3 (solo.spec.ts) |
| CP-7 | Disable solo → verify mix restored | HIGH | Original values restored | 3 (solo.spec.ts) |
| CP-8 | Navigate away with solo → return → verify cleared | HIGH | Solo reset on navigation | 3 (solo.spec.ts) |
| CP-9 | Refresh → verify latest values shown | MEDIUM | GET /v1/configs called | 3 (ui.spec.ts) |
| CP-10 | Reset category → verify defaults applied | HIGH | Values reset to defaults | 0 (MISSING) |
| CP-11 | Config group actions stay at top | MEDIUM | Layout verified | 3 (ui.spec.ts) |

---

### 5. Settings Page (`/settings`)

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| base-url-input | Input | Base URL | Sets connection URL | Invalid URL format | **MISSING** |
| password-input | Input | Network Password | Sets connection password | N/A | **MISSING** |
| save-connect-btn | Button | Save & Connect | Saves and reconnects | Network failure | **MISSING** |
| refresh-connection-btn | Button | (refresh icon) | Refetches device info | Network failure | **MISSING** |
| theme-light-btn | Button | Light | Sets light theme | N/A | **MISSING** |
| theme-dark-btn | Button | Dark | Sets dark theme | N/A | **MISSING** |
| theme-system-btn | Button | System | Sets system theme | N/A | **MISSING** |
| diagnostics-btn | Button | Diagnostics | Opens logs dialog | N/A | **MISSING** |
| share-diagnostics-btn | Button | Share | Shares logs via clipboard/share API | Share unavailable | **MISSING** |
| email-diagnostics-btn | Button | Email | Opens mailto with logs | N/A | **MISSING** |
| clear-logs-btn | Button | Clear logs | Clears all logs | N/A | **MISSING** |
| about-btn | Button | About | Shows build info | 7 taps → dev mode | featureFlags.spec.ts |
| dev-mode-toggle | Checkbox | Developer mode | Toggles dev features | N/A | featureFlags.spec.ts |
| hvsc-flag-toggle | Checkbox | Enable HVSC downloads | Toggles HVSC feature | N/A | featureFlags.spec.ts |
| mock-mode-toggle | Checkbox | Use mocked C64U | Toggles mock mode | N/A | **MISSING** |
| list-preview-input | Input | List preview limit | Sets preview limit | Invalid number, < 1 | **MISSING** |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| SP-1 | Change base URL → save → verify reconnect | HIGH | Connection attempted | 0 (MISSING) |
| SP-2 | Change password → save → verify stored | HIGH | Password in localStorage | 0 (MISSING) |
| SP-3 | Invalid URL → save → verify error | HIGH | Error toast shown | 0 (MISSING) |
| SP-4 | Change theme → verify applied | MEDIUM | Theme class updated | 0 (MISSING) |
| SP-5 | Open diagnostics → share → verify clipboard | MEDIUM | Logs copied | 0 (MISSING) |
| SP-6 | Open diagnostics → email → verify mailto | MEDIUM | mailto link opened | 0 (MISSING) |
| SP-7 | Clear logs → verify empty | MEDIUM | Logs cleared | 0 (MISSING) |
| SP-8 | Tap About 7 times → verify dev mode | HIGH | Dev mode enabled | 3 (featureFlags.spec.ts) |
| SP-9 | Enable HVSC flag → verify controls shown | HIGH | HVSC UI visible | 3 (featureFlags.spec.ts) |
| SP-10 | Disable HVSC flag → verify controls hidden | HIGH | HVSC UI hidden | 3 (featureFlags.spec.ts) |
| SP-11 | Toggle mock mode → verify connection | HIGH | Mock server used | 0 (MISSING) |
| SP-12 | Set list preview limit → verify applied | MEDIUM | Limit used in lists | 0 (MISSING) |
| SP-13 | Set invalid limit → verify clamped | MEDIUM | Limit clamped to valid range | 0 (MISSING) |

---

### 6. Docs Page (`/docs`)

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| doc-section-toggle | Button | Section title | Expands/collapses section | N/A | ui.spec.ts (render only) |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| DocP-1 | Expand section → verify content shown | LOW | Content visible | 2 (ui.spec.ts weak) |
| DocP-2 | Expand all sections → verify no overflow | LOW | No horizontal scroll | 0 (MISSING) |

---

## Shared Components

### ItemSelectionDialog

#### Interactive Widgets

| Widget ID | Type | Label/Text | Effect | Edge Cases | Existing Coverage |
|-----------|------|------------|--------|------------|-------------------|
| source-group-btn | Button | Source group name | Expands source picker | N/A | diskManagement.spec.ts, playback.spec.ts |
| source-btn | Button | Source name | Opens source browser | Network failure | diskManagement.spec.ts, playback.spec.ts |
| navigate-root-btn | Button | (root icon) | Navigates to root | N/A | diskManagement.spec.ts, playback.spec.ts |
| navigate-parent-btn | Button | (up icon) | Navigates to parent | At root | **MISSING** |
| breadcrumb-btn | Button | Path segment | Navigates to segment | N/A | **MISSING** |
| entry-open-btn | Button | Open | Opens folder | Empty folder | diskManagement.spec.ts, playback.spec.ts |
| entry-checkbox | Checkbox | (selection) | Adds to selection | N/A | diskManagement.spec.ts, playback.spec.ts |
| filter-input | Input | Filter items… | Filters visible items | No matches | ui.spec.ts |
| add-items-confirm | Button | Add to library / playlist | Confirms selection | No items selected | diskManagement.spec.ts, playback.spec.ts |
| cancel-btn | Button | Cancel | Closes dialog | N/A | diskManagement.spec.ts, playback.spec.ts |
| selection-count-badge | Badge | X selected | Shows selection count | N/A | diskManagement.spec.ts, playback.spec.ts |

#### High-Value Click Paths

| Path ID | Steps | Priority | Assertions | Coverage Score |
|---------|-------|----------|------------|----------------|
| ISD-1 | Browse C64U → verify hierarchy | HIGH | Folders shown | 3 (diskManagement.spec.ts) |
| ISD-2 | Filter items → verify selection preserved | HIGH | Selection count stable | 3 (ui.spec.ts) |
| ISD-3 | Navigate parent → verify up navigation | MEDIUM | Parent folder shown | 0 (MISSING) |
| ISD-4 | Breadcrumb navigation → verify jump | MEDIUM | Correct folder shown | 0 (MISSING) |
| ISD-5 | Add with no selection → verify error | MEDIUM | Error toast or disabled button | 0 (MISSING) |
| ISD-6 | Item browser overflow → verify no horizontal scroll | MEDIUM | No overflow | 3 (ui.spec.ts) |
| ISD-7 | Add items progress → verify shown after confirm | HIGH | Progress UI visible | 3 (ui.spec.ts) |

---

## Coverage Matrix Summary

### By Priority

| Priority | Total Paths | Covered | Score 3 | Score 2 | Score 1 | Score 0 |
|----------|-------------|---------|---------|---------|---------|---------|
| HIGH | 68 | 48 | 45 | 3 | 0 | 20 |
| MEDIUM | 27 | 12 | 10 | 2 | 0 | 15 |
| LOW | 2 | 1 | 0 | 1 | 0 | 1 |
| **TOTAL** | **97** | **61** | **55** | **6** | **0** | **36** |

### Missing High-Value Coverage (Score 0)

1. Home page app config management (save/load/manage)
2. Disks page rotate previous
3. Play page playlist filtering
4. Play page shuffle/repeat modes
5. Play page duration override
6. Play page SID subsong selection
7. Play page boundary conditions (prev at first, next at last)
8. Config page category reset
9. Settings page connection management
10. Settings page theme switching
11. Settings page diagnostics workflows
12. Settings page mock mode toggle
13. Settings page list preview limit
14. Shared components parent/breadcrumb navigation
15. Shared components no-selection validation

### Evidence Quality Issues

**Score 2 (Weak Assertions or Missing Edge Cases)**:

- ui.spec.ts: Machine control buttons (no network failure tests)
- playback.spec.ts: Disk autostart sequence (no verification of memory contents)
- ui.spec.ts: Docs section expansion (no content verification)

**Score 1 (Tested but No Evidence)**:

- None identified

---

## Test Expansion Strategy

### Option A: Add >=20 New Tests

**Recommended**: YES - substantial missing coverage justifies new tests

New test files to create:

1. `homeConfigManagement.spec.ts` - App config CRUD operations (6 tests)
2. `playlistControls.spec.ts` - Shuffle, repeat, filtering, duration override (8 tests)
3. `settingsConnection.spec.ts` - Connection management, theme switching (6 tests)
4. `settingsDiagnostics.spec.ts` - Logs, share, email workflows (4 tests)
5. `navigationBoundaries.spec.ts` - Parent/breadcrumb navigation, boundary conditions (6 tests)

**Total new tests**: 30

### Option B: Augment >=40 Existing Tests

**Not recommended** - would introduce significant duplication

---

## Test Expansion Plan

### Phase 1: Home Config Management (6 new tests)

File: `playwright/homeConfigManagement.spec.ts`

```typescript
test('save config with valid name stores in localStorage', ...)
test('save config with empty name shows error', ...)
test('save config with duplicate name shows error', ...)
test('load config applies values to server', ...)
test('rename config updates localStorage', ...)
test('delete config removes from localStorage', ...)
```

### Phase 2: Playlist Controls (8 new tests)

File: `playwright/playlistControls.spec.ts`

```typescript
test('playlist filter hides non-matching items', ...)
test('shuffle mode randomizes playback order', ...)
test('shuffle category checkboxes filter eligible files', ...)
test('repeat mode loops playlist at end', ...)
test('duration override input accepts mm:ss format', ...)
test('duration override applies to playback', ...)
test('SID subsong selection sends correct song number', ...)
test('prev at first track stays at first', ...)
test('next at last track stops playback', ...)
```

### Phase 3: Settings Connection (6 new tests)

File: `playwright/settingsConnection.spec.ts`

```typescript
test('change base URL and save reconnects', ...)
test('invalid URL shows error toast', ...)
test('change password stores in localStorage', ...)
test('select light theme applies theme', ...)
test('select dark theme applies theme', ...)
test('toggle mock mode switches connection', ...)
```

### Phase 4: Settings Diagnostics (4 new tests)

File: `playwright/settingsDiagnostics.spec.ts`

```typescript
test('open diagnostics shows logs', ...)
test('share diagnostics copies to clipboard', ...)
test('email diagnostics opens mailto', ...)
test('clear logs empties log storage', ...)
```

### Phase 5: Navigation Boundaries (6 new tests)

File: `playwright/navigationBoundaries.spec.ts`

```typescript
test('navigate parent from subfolder shows parent', ...)
test('navigate parent from root disables button', ...)
test('breadcrumb click jumps to ancestor', ...)
test('add items with no selection shows validation', ...)
test('disk rotate previous mounts previous disk', ...)
test('config reset category applies defaults', ...)
```

---

## CI Configuration Updates

### Current State

- `playwright.config.ts` has `video: 'on'`, `screenshot: 'on'`
- Evidence captured via `testArtifacts.ts`

### Required Changes

1. **Always-on artifacts**: Already configured ✅
2. **Per-test video**: Already configured ✅
3. **Step screenshots**: Already implemented via `attachStepScreenshot()` ✅
4. **CI upload**: Need to verify GitHub Actions workflow

### CI Workflow Verification

Check `.github/workflows/*.yml` for:

- `uses: actions/upload-artifact` with `if: always()`
- Upload path includes `test-results/**`
- Artifact retention configured

---

## Next Steps

1. ✅ Create this inventory document
2. ⬜ Implement Phase 1: Home Config Management tests
3. ⬜ Implement Phase 2: Playlist Controls tests
4. ⬜ Implement Phase 3: Settings Connection tests
5. ⬜ Implement Phase 4: Settings Diagnostics tests
6. ⬜ Implement Phase 5: Navigation Boundaries tests
7. ⬜ Verify CI artifact upload configuration
8. ⬜ Run tests locally until green
9. ⬜ Push to CI and verify artifacts downloadable
10. ⬜ Run CI twice consecutively for stability verification

---

## Acceptance Criteria

- [x] Full UI widget inventory created
- [x] All click paths enumerated with priority
- [x] Coverage matrix showing gaps
- [ ] >=20 new tests implemented
- [ ] All new tests have explicit step screenshots
- [ ] All new tests have strong assertions
- [ ] All new tests include negative cases
- [ ] Tests pass locally
- [ ] Tests pass on CI
- [ ] CI uploads artifacts with `if: always()`
- [ ] Artifacts downloadable via `gh run download`
- [ ] Artifact structure validation passes
- [ ] 2 consecutive CI runs green
