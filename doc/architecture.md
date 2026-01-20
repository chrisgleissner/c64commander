# Architecture Overview

C64 Commander is a React + Vite + Capacitor app that controls a C64 Ultimate device via its REST API. It runs as a web app in a Capacitor shell on Android with optional native bridges (FTP, HVSC ingestion).

## Stack and Layers

- **UI**: React pages in [src/pages](../src/pages) with shared components in [src/components](../src/components).
- **State + data fetching**: React hooks in [src/hooks](../src/hooks) backed by TanStack Query.
- **API client**: REST client in [src/lib/c64api.ts](../src/lib/c64api.ts).
- **Domain modules**: playback, disks, HVSC, config, and logging in [src/lib](../src/lib).
- **Native bridges**: Capacitor plugins in [src/lib/native](../src/lib/native) and Android implementations under [android/app/src/main/java](../android/app/src/main/java).

## High-level data flow

```mermaid
flowchart TD
  UI[Pages & Components] --> Hooks[Hooks + Query]
  Hooks --> API[c64api REST client]
  API --> C64U[C64 Ultimate REST API]
  Hooks --> Storage[LocalStorage/SessionStorage]
  Hooks --> Domain[Domain modules: disks/playback/HVSC]
  Domain --> Native[Capacitor native bridges]
  Native --> Android[Android Java/Kotlin plugins]
```

## Playback flow (Play page)

```mermaid
sequenceDiagram
  participant UI as PlayFilesPage
  participant Router as Playback Router
  participant C64U as C64U REST API
  participant HVSC as HVSC Bridge

  UI->>Router: Build play plan (file type + source)
  Router->>C64U: Upload or mount (PRG/CRT/D64)
  Router->>C64U: Start runner (SID/MOD/PRG/CRT)
  UI-->>HVSC: (Optional) browse/update HVSC library
```

## Disk management flow

```mermaid
sequenceDiagram
  participant UI as Disks page
  participant DiskLib as Disk library (local storage)
  participant C64U as C64U REST API

  UI->>DiskLib: Add or edit disk entries
  UI->>C64U: Mount/unmount drive
  DiskLib-->>UI: Drive status + disk tree
```

## Configuration flow

```mermaid
sequenceDiagram
  participant UI as Config page
  participant Hooks as Config hooks
  participant C64U as C64U REST API

  UI->>Hooks: Fetch categories & items
  Hooks->>C64U: GET categories/items
  UI->>Hooks: Update setting
  Hooks->>C64U: PUT/POST config update
```

## Crash reporting

- **Android production crashes** are surfaced via **Google Play Console** (Android Vitals) once distributed through Play.
- **In-app diagnostics** are available in Settings, allowing users to share logs via email without sending automatic crash traces to external services.
