# Architecture

**Analysis Date:** 2026-02-02

## Pattern Overview

**Overall:** React Single Page Application (SPA) wrapped in Capacitor for mobile deployment.

**Key Characteristics:**
- **Mobile-First:** UI designed for touch interaction (tab bar, large touch targets).
- **Service-Oriented Frontend:** Heavy logic encapsulated in `src/lib/` services (HVSC, C64API).
- **Query-Driven State:** Extensive use of TanStack Query for server state management.
- **Hybrid Native:** Uses Capacitor for native device features (filesystem, intents) while keeping core logic in TypeScript.

## Layers

**UI Layer:**
- Purpose: Presentation and user interaction.
- Location: `src/pages/`, `src/components/`
- Contains: React components, Tailwind styling.
- Depends on: Hooks, Domain Logic.
- Used by: React Router (`src/App.tsx`).

**Logic Layer (Hooks):**
- Purpose: Glues UI to data/services, manages local state.
- Location: `src/hooks/`
- Contains: Custom React hooks (e.g., `useSidPlayer.tsx`, `useAppConfigState.ts`).
- Depends on: Services (`src/lib/`), Contexts.
- Used by: UI Components.

**Domain Services:**
- Purpose: Core business logic and external system integration.
- Location: `src/lib/`
- Contains:
    - API Client: `src/lib/c64api.ts`
    - HVSC Engine: `src/lib/hvsc/`
    - Playback Logic: `src/lib/sid/`
    - Configuration: `src/lib/config/`
- Depends on: Utilities, Native Bridges.
- Used by: Hooks.

**Native Bridge:**
- Purpose: Interface with Android/iOS capabilities.
- Location: `src/lib/native/`
- Contains: Capacitor plugin wrappers, file system helpers.
- Depends on: Capacitor Core.
- Used by: Services.

## Data Flow

**Remote Data (C64 Ultimate):**
1. **Trigger:** Component mounts or user action.
2. **Fetch:** Component calls hook (e.g., `useDiskLibrary`).
3. **Query:** Hook uses `useQuery` from TanStack Query.
4. **Network:** Query function calls `src/lib/c64api.ts`.
5. **Device:** Request sent to C64 Ultimate REST API.

**Command Execution:**
1. **User Action:** Button click (e.g., "Mount Disk").
2. **Mutation:** Component calls mutation hook.
3. **API Call:** `c64api` sends POST/PUT request.
4. **Invalidation:** Query cache invalidated to refresh UI.

**State Management:**
- **Server State:** TanStack Query (`queryClient` in `src/App.tsx`).
- **Global App State:** React Context (e.g., `SidPlayerProvider` in `src/hooks/useSidPlayer.tsx`).
- **URL State:** React Router (`useLocation` in `src/components/TabBar.tsx`).

## Key Abstractions

**C64 API Client:**
- Purpose: Centralized interface for C64 Ultimate device communication.
- Examples: `src/lib/c64api.ts`
- Pattern: Module with exported async functions.

**HVSC Engine:**
- Purpose: Manages High Voltage SID Collection (download, index, search).
- Examples: `src/lib/hvsc/`
- Pattern: Service module with ingestion runtime.

**SID Player:**
- Purpose: Controls music playback state and queue.
- Examples: `src/hooks/useSidPlayer.tsx`, `src/lib/sid/`
- Pattern: Provider/Context + Hook.

## Entry Points

**Web/App Root:**
- Location: `src/main.tsx`
- Triggers: Browser load or App launch.
- Responsibilities: Bootstraps React, mounts `App`, initializes providers.

**Android Native:**
- Location: `android/app/src/main/java/`
- Triggers: Android OS.
- Responsibilities: Capacitor bridge initialization, intent handling.

## Error Handling

**Strategy:** Global error boundaries + Toast notifications for user feedback.

**Patterns:**
- **Global Boundary:** `AppErrorBoundary` in `src/App.tsx`.
- **API Errors:** Caught in `c64api.ts`, logged via `src/lib/logging.ts`.
- **UI Feedback:** `use-toast.ts` used to display transient error messages.

## Cross-Cutting Concerns

**Logging:**
- Approach: Centralized logging utility.
- File: `src/lib/logging.ts`

**Tracing/Observability:**
- Approach: Custom action tracing and fetch instrumentation.
- Files: `src/lib/tracing/`, `src/hooks/useActionTrace.ts`

**Configuration:**
- Approach: Feature flags and app settings.
- Files: `src/lib/config/`, `src/hooks/useFeatureFlags.tsx`

---
*Architecture analysis: 2026-02-02*
