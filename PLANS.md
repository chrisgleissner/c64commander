# Connection Status Pop-up Layout Correction Plan

## Layout contracts

### Row rhythm contract
- Status, Host, and Last request rows share `min-h-5` (1.25 rem = 20 px).
- Host row uses `flex items-center` so the Change button does not alter row height.
- Change button uses `h-auto py-0 leading-5` to keep its height within the 20 px row height.
- Intra-group spacing: `space-y-2` (0.5 rem) between Status / Host / Last request.
- Inter-group spacing: `space-y-4` between group 1 and the Diagnostics section.

### Time formatting contract
- Formatter: `formatRelative(timestampMs: number | null)`.
- Uses `Math.floor` exclusively (no rounding).
- No "just now" branch.
- `elapsed < 60 s` → `{s}s ago` (e.g. `0s ago`, `3s ago`, `59s ago`).
- `elapsed ≥ 60 s` → `{m}m {s}s ago` (e.g. `1m 0s ago`, `2m 3s ago`).
- `null` timestamp → `"unknown"`.
- Negative elapsed (future timestamp) → clamped to 0 via `Math.max(0, …)` → `"0s ago"`.

### Group separation rules
- Two groups separated by increased spacing (`space-y-4` vs `space-y-2`).
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
