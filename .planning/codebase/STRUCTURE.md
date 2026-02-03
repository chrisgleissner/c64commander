# Codebase Structure

**Analysis Date:** 2026-02-02

## Directory Layout

```
/
├── android/            # Android native project and Capacitor configuration
├── src/                # Source code
│   ├── components/     # Reusable React components
│   │   └── ui/         # Generic UI library components (buttons, inputs)
│   ├── hooks/          # React hooks (business logic & state)
│   ├── lib/            # Core logic, services, and utilities
│   │   ├── c64api.ts   # Main API client
│   │   ├── hvsc/       # HVSC management logic
│   │   ├── native/     # Native bridge implementations
│   │   └── sid/        # Audio playback logic
│   ├── pages/          # Top-level route components
│   ├── types/          # TypeScript type definitions
│   ├── App.tsx         # Main component and routing setup
│   └── main.tsx        # Application entry point
├── public/             # Static assets
├── doc/                # Documentation
└── playwright/         # E2E tests
```

## Directory Purposes

**`src/pages/`:**
- Purpose: Full-screen views mapped to routes.
- Contains: React components representing distinct screens.
- Key files: `HomePage.tsx`, `MusicPlayerPage.tsx`, `SettingsPage.tsx`.

**`src/hooks/`:**
- Purpose: Encapsulate stateful logic and side effects.
- Contains: Custom React hooks.
- Key files: `useSidPlayer.tsx` (playback), `useAppConfigState.ts` (settings).

**`src/lib/`:**
- Purpose: Domain-specific logic independent of UI (mostly).
- Contains: API clients, data processing, utility functions.
- Key files: `c64api.ts` (API), `logging.ts` (logger).

**`src/components/`:**
- Purpose: Reusable UI building blocks.
- Contains: Functional React components.
- Key files: `TabBar.tsx` (navigation), `ConnectionController.tsx` (device status).

## Key File Locations

**Entry Points:**
- `src/main.tsx`: React application bootstrap.
- `android/`: Native Android entry point.

**Configuration:**
- `src/lib/config/`: App configuration logic.
- `src/hooks/useFeatureFlags.tsx`: Feature toggles.
- `capacitor.config.ts`: Capacitor project config.

**Core Logic:**
- `src/lib/c64api.ts`: C64 Ultimate communication.
- `src/lib/hvsc/`: HVSC database management.

**Testing:**
- `playwright/`: End-to-end tests.
- `src/**/*.test.ts`: Unit tests (co-located).

## Naming Conventions

**Files:**
- React Components: PascalCase (e.g., `MusicPlayerPage.tsx`).
- Utilities/Hooks: camelCase (e.g., `c64api.ts`, `useSidPlayer.tsx`).
- Types: PascalCase or camelCase (often `*.d.ts` or `types.ts`).

**Directories:**
- standard: camelCase (e.g., `components`, `hooks`, `lib`).
- grouped features: camelCase (e.g., `lib/hvsc`, `lib/sid`).

## Where to Add New Code

**New Page/Route:**
- Implementation: `src/pages/NewFeaturePage.tsx`
- Route definition: Add to `AppRoutes` in `src/App.tsx`.
- Navigation: Add to `TabBar.tsx` if it needs a tab.

**New Reusable Component:**
- Implementation: `src/components/NewComponent.tsx`
- If generic UI: `src/components/ui/`

**New API Interaction:**
- Implementation: Add function to `src/lib/c64api.ts`.
- Hook: Create `src/hooks/useNewFeature.ts` using `useQuery` or `useMutation`.

**New Business Logic:**
- Implementation: Create module in `src/lib/` (e.g., `src/lib/newLogic.ts`).

## Special Directories

**`src/lib/native/`:**
- Purpose: Abstractions over Capacitor plugins or web fallbacks.
- Handling: Ensure platform checks are used if logic differs between Web/Android.

**`src/components/ui/`:**
- Purpose: Shared design system components.
- Note: Likely based on a UI library (shadcn/ui), so follow existing patterns there.

---
*Structure analysis: 2026-02-02*
