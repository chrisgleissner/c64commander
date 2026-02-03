# Testing Patterns

**Analysis Date:** 2026-02-02

## Test Framework

**Runner:**
- Vitest (`vitest.config.ts`)
- Environment: `jsdom`

**Assertion Library:**
- Vitest's built-in `expect` (compatible with Jest).
- `@testing-library/jest-dom` matchers loaded in `tests/setup.ts`.

**Run Commands:**
```bash
npm run test              # Run unit tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
npm run test:e2e          # Playwright E2E tests
```

## Test File Organization

**Location:**
- Unit tests located in `tests/unit/`.
- Structure within `tests/unit/` mirrors `src/` (e.g., `tests/unit/components/` tests `src/components/`).

**Naming:**
- `*.test.ts` or `*.test.tsx`

**Structure:**
```
tests/unit/
├── components/
│   └── ConfigItemRow.test.tsx
├── lib/
│   └── c64api.test.ts
└── ...
```

## Test Structure

**Suite Organization:**
```typescript
describe('ComponentName', () => {
  beforeEach(() => {
    // Setup (clearing mocks, local storage)
  });

  it('should do something', () => {
    // Test case
  });
});
```

**Patterns:**
- **Setup:** `beforeEach` used heavily to reset mocks and global state (e.g., `localStorage`).
- **Global Setup:** `tests/setup.ts` polyfills browser APIs (PointerEvent, ResizeObserver) for JSDOM.

## Mocking

**Framework:** `vi` (Vitest)

**Patterns:**
```typescript
// Module mocking
vi.mock('@/lib/c64api', () => ({
  getC64API: vi.fn(),
  // ...
}));

// Global object mocking
Object.defineProperty(globalThis, 'window', { ... });
```

**What to Mock:**
- External dependencies (`@capacitor/core`).
- Internal heavy services (`@/lib/c64api`, `@/lib/logging`).
- Browser globals missing in JSDOM (`window.matchMedia`, `localStorage`).

**What NOT to Mock:**
- Utility functions logic (unless testing consumers).

## Fixtures and Factories

**Test Data:**
- Created inline in tests or setup blocks.
- `MockC64Server` used for integration-style testing of API clients.

**Location:**
- `tests/mocks/` contains reusable mocks (e.g., `mockC64Server.ts`).

## Coverage

**Requirements:**
- Configured in `vitest.config.ts`.
- Current thresholds: Statements 10%, Branches 55%, Functions 35%, Lines 10%.

**View Coverage:**
```bash
npm run test:coverage
```

## Test Types

**Unit Tests:**
- Focus: Individual components and logic modules.
- Location: `tests/unit/`.
- Tools: `@testing-library/react` for components.

**Integration Tests:**
- Focus: API client interaction with mock server (`tests/unit/components/ConfigItemRow.test.tsx` tests full flow).

**E2E Tests:**
- Framework: Playwright.
- Location: `playwright/` (referenced in `package.json`, not deeply analyzed here).

## Common Patterns

**Async Testing:**
```typescript
await waitFor(async () => {
  expect(something).toBe(true);
});
```

**Component Rendering:**
```typescript
// Helper wrapper for React Query
function renderWithQuery(ui: React.ReactElement) {
  // ... wraps with QueryClientProvider
  return render(ui);
}
```

**Event Simulation:**
```typescript
fireEvent.click(screen.getByLabelText('Label'));
fireEvent.change(input, { target: { value: 'val' } });
```

---

*Testing analysis: 2026-02-02*
