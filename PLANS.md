# Modal / Overlay Unification Plan

## Inventory

| Component | File | Primitive | Backdrop | Close X | Focus trap | Scroll lock | Migration status |
|---|---|---|---|---|---|---|---|
| Diagnostics | `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx` | Dialog | ✅ | ✅ (default from DialogContent) | ✅ | ✅ | Already unified |
| Demo Mode Interstitial | `src/components/DemoModeInterstitial.tsx` | Dialog | ✅ | ✅ (default from DialogContent) | ✅ | ✅ | Already unified |
| Item Selection | `src/components/itemSelection/ItemSelectionDialog.tsx` | Dialog | ✅ | ⚠️ Custom ghost Button wrapping DialogClose | ✅ | ✅ | **Step 2**: Replace with ModalCloseButton |
| Connection Status | `src/components/ConnectivityIndicator.tsx` | Popover | ❌ | ⚠️ Custom PopoverPrimitive.Close | ⚠️ | ❌ | **Step 6**: Migrate to Dialog |
| Load Config | `src/pages/home/dialogs/LoadConfigDialog.tsx` | Dialog | ✅ | ✅ (default from DialogContent) | ✅ | ✅ | Already unified |
| Manage Config | `src/pages/home/dialogs/ManageConfigDialog.tsx` | Dialog | ✅ | ✅ (default from DialogContent) | ✅ | ✅ | Already unified |
| Power Off | `src/pages/home/dialogs/PowerOffDialog.tsx` | Dialog | ✅ | ✅ (default from DialogContent) | ✅ | ✅ | Already unified |
| Save Config | `src/pages/home/dialogs/SaveConfigDialog.tsx` | Dialog | ✅ | ✅ (default from DialogContent) | ✅ | ✅ | Already unified |

## Steps

1. ✅ Extract shared `ModalCloseButton` in `src/components/ui/modal-close-button.tsx`
2. ✅ Update `dialog.tsx` to use `ModalCloseButton`
3. ✅ Update `ItemSelectionDialog.tsx` to use `ModalCloseButton`
4. ✅ Migrate `ConnectivityIndicator.tsx` from Popover → Dialog with `ModalCloseButton`
5. ✅ Add `--modal-backdrop-duration` CSS variable respecting `c64-motion-reduced`
6. ✅ Add `playwright/modalConsistency.spec.ts`

---

# Connection Status Pop-up Layout Correction Plan

## Layout contracts

### Row rhythm contract
- Status, Host, and Last request rows share `min-h-5` (1.25 rem = 20 px).
- Host row uses `flex items-center` so the Change button does not alter row height.
- Change button uses `h-auto py-0 leading-5` to keep its height within the 20 px row height.
- Intra-group spacing: `space-y-1` (0.25 rem = 4 px) within each group (Group 1: Status / Host / Last request; Group 2: Diagnostics rows). DiagnosticsRow buttons use `py-0` so their height matches the 20 px Group 1 row height.
- Inter-group spacing: `space-y-4` (1 rem = 16 px) between group 1 and the Diagnostics section.

### Time formatting contract
- Formatter: `formatRelative(timestampMs: number | null)`.
- Uses `Math.floor` exclusively (no rounding).
- No "just now" branch.
- `elapsed < 60 s` → `{s}s ago` (e.g. `0s ago`, `3s ago`, `59s ago`).
- `elapsed ≥ 60 s` → `{m}m {s}s ago` (e.g. `1m 0s ago`, `2m 3s ago`).
- `null` timestamp → `"unknown"`.
- Negative elapsed (future timestamp) → clamped to 0 via `Math.max(0, …)` → `"0s ago"`.

### Group separation rules
- Two groups separated by increased spacing (`space-y-4` vs `space-y-1`).
- No indentation, no nested background surfaces, no divider lines.
- All rows flush-left aligned.

### Close behavior contract
- `PopoverPrimitive.Close` button (top-right, `X` icon, `data-testid="connection-status-close"`).
- Escape key closes (Radix Popover default).
- Clicking outside closes (Radix Popover default).

## Implementation checklist
- [x] Fix `formatRelative` – remove "just now", floor math, `Xs ago` / `Xm Ys ago`.
- [x] Fix Host row layout – `min-h-5`, `items-center`, button `h-auto py-0 leading-5`.
- [x] Add `data-testid` to Status, Host, Last request rows.
- [x] Add close icon to PopoverContent (matching Diagnostics Dialog).
- [x] Update unit tests for new time format and new data-testids.
- [x] Add Playwright layout tests (row heights, vertical gaps, close behavior, time format, flush-left alignment, group spacing).
- [x] Update screenshot test with format assertions.
- [x] Run `npm run test:coverage` – global branch coverage 82.4% ≥ 82%.
- [x] Run `npm run lint` and `npm run build` – green.
- [ ] Run `code_review` then `codeql_checker` and address findings.
