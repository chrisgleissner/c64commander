# Technology Stack

**Analysis Date:** 2026-02-02

## Languages

**Primary:**
- TypeScript 5.8 - Used for all web application logic, hooks, and components (`src/`)

**Secondary:**
- Kotlin - Used for Android custom plugins (`android/app/src/main/java/uk/gleissner/c64commander/**/*.kt`)
- Java - Used for Android plugins (`android/app/src/main/java`)

## Runtime

**Environment:**
- Web Browser - Production runtime (SPA)
- Capacitor Webview - Android/iOS runtime
- Node.js - Development and build environment

**Package Manager:**
- npm - Used for dependency management
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- React 18.3 - UI Component library
- Capacitor 6.2 - Native bridge and runtime container
- React Router DOM 6.30 - Client-side routing

**State & Data:**
- @tanstack/react-query 5.83 - Server state management and data fetching
- React Hook Form 7.61 - Form state management
- Zod 3.25 - Schema validation

**UI & Styling:**
- Tailwind CSS 3.4 - Utility-first CSS framework
- Radix UI - Headless UI primitives (via shadcn/ui patterns)
- Framer Motion 12.26 - Animations
- Lucide React - Icons

**Testing:**
- Vitest 3.2 - Unit and integration testing
- Playwright 1.48 - E2E testing
- Testing Library - Component testing utilities

**Build/Dev:**
- Vite 5.4 - Build tool and dev server
- ESLint 9.32 - Linting (using flat config)
- TypeScript - Static analysis

## Key Dependencies

**Critical:**
- `7z-wasm`, `fflate` - Handling HVSC archives and compression in browser
- `@capacitor/core`, `@capacitor/android`, `@capacitor/ios` - Native platform integration
- `openapi-client-axios` - API client generation (referenced in devDependencies)

**Infrastructure:**
- `@capacitor/filesystem` - Access to device filesystem
- `basic-ftp` - FTP client (likely used in dev/scripts or wrapped)

## Configuration

**Environment:**
- `.env` files - Vite environment variables
- `window.__C64U_*` - Runtime injection for native/test modes
- Key vars: `VITE_APP_VERSION`, `VITE_GIT_SHA`, `VITE_BUILD_TIME`

**Build:**
- `vite.config.ts` - Vite configuration (includes Istanbul coverage, aliases)
- `capacitor.config.ts` - Capacitor configuration (App ID: `uk.gleissner.c64commander`)
- `playwright.config.ts` - E2E test configuration
- `tailwind.config.ts` - Tailwind styling config

## Platform Requirements

**Development:**
- Node.js >= 18 (implied)
- Android Studio (for Android builds)

**Production:**
- Modern Web Browser (Chrome/Firefox/Safari)
- Android 7.0+ (implied by Capacitor defaults)
- iOS 13+ (implied by Capacitor defaults)

---

*Stack analysis: 2026-02-02*
