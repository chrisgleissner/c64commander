# Coding Conventions

**Analysis Date:** 2026-02-02

## Naming Patterns

**Files:**
- React Components: PascalCase (e.g., `src/components/AppBar.tsx`)
- Logic/Utilities: camelCase (e.g., `src/lib/c64api.ts`)
- Hooks: camelCase, prefixed with `use` (e.g., `src/hooks/useSidPlayer.tsx`)
- Tests: `*.test.ts` or `*.test.tsx`

**Functions:**
- camelCase (e.g., `playTrack`, `getC64API`)
- Event handlers: `handleEvent` or `onEvent` (prop names)

**Variables:**
- camelCase (e.g., `currentIndex`, `isPlaying`)
- Constants: SCREAMING_SNAKE_CASE for top-level constants (e.g., `DEFAULT_BASE_URL` in `src/lib/c64api.ts`)
- Booleans: Prefixed with `is`, `has`, `should` (e.g., `isPlaying`, `isSmokeModeEnabled`)

**Types:**
- PascalCase (e.g., `SidTrack`, `SidPlayerContextValue`)
- Props interfaces: `Props` (locally defined) or `ComponentNameProps`

## Code Style

**Formatting:**
- ESLint configured in `eslint.config.js`
- No dedicated Prettier config observed (likely using default or IDE integration)

**Linting:**
- Tool: ESLint
- Key rules:
  - `no-unused-vars`: off
  - `no-explicit-any`: off
  - `react-hooks/exhaustive-deps`: off (notable relaxation)

## Import Organization

**Order:**
1. External dependencies (e.g., `react`, `@capacitor/core`)
2. Internal aliases (e.g., `@/components/...`, `@/lib/...`)
3. Relative imports (less common due to alias usage)

**Path Aliases:**
- `@/*` maps to `src/*` (configured in `tsconfig.json` and `vitest.config.ts`)

## Error Handling

**Patterns:**
- **API Level:** Methods throw errors (e.g., `HTTP 500`).
- **Logging:** Specialized logging utilities used instead of bare `console`.
  - `addErrorLog(message, context)`
  - `addLog(level, message, context)`
  - See `src/lib/c64api.ts` for usage.
- **UI Level:** Components expected to catch errors or rely on React Query's error states.

## Logging

**Framework:** Custom logging wrapper (`@/lib/logging`)

**Patterns:**
- Structured logging with context objects.
- `addLog('debug', ...)` for traces.
- `addErrorLog(...)` for exceptions.
- `console.info` used conditionally for "Smoke Mode" or specific native bridge tracing.

## Comments

**When to Comment:**
- Minimal inline comments.
- Code intent preferred over explanation.
- Complex logic (e.g., regex, binary handling) has explanatory comments.

**JSDoc/TSDoc:**
- Used for public API methods in `C64API` class (e.g., `tests/unit/c64api.test.ts` shows usage).

## Function Design

**Size:**
- Generally small to medium.
- Large logic blocks (like `C64API` class) are centralized.

**Parameters:**
- Positional for simple functions.
- Object destructuring for components (`{ title, children }: Props`).
- Optional parameters used frequently.

**Return Values:**
- Explicit types often inferred, but API methods return `Promise<T>`.

## Module Design

**Exports:**
- Named exports preferred (e.g., `export function AppBar`).
- `export default` used for page components or config files.

**Barrel Files:**
- Not strictly enforced, but `ui` components often grouped.

---

*Convention analysis: 2026-02-02*
