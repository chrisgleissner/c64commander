# Third-Party Notices

This project includes third-party components. The notices below are provided to comply with their license requirements.

## Core Framework and Runtime

### React

Project: <https://react.dev/>
License: MIT. The core UI library used throughout the application.

### React Router

Project: <https://reactrouter.com/>
License: MIT. Client-side routing for single-page application navigation.

### Vite

Project: <https://vitejs.dev/>
License: MIT. Build tool and development server.

### Capacitor

Project: <https://capacitorjs.com/>
License: MIT. Cross-platform native runtime for iOS and Android deployment.

## UI Components and Styling

### Radix UI

Project: <https://www.radix-ui.com/>
License: MIT. Accessible, unstyled UI primitives including accordion, alert-dialog, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toast, toggle, toggle-group, and tooltip components.

### Tailwind CSS

Project: <https://tailwindcss.com/>
License: MIT. Utility-first CSS framework for styling.

### Lucide React

Project: <https://lucide.dev/>
License: ISC. Beautiful and consistent icon library.

### Framer Motion

Project: <https://www.framer.com/motion/>
License: MIT. Production-ready animation library for React.

### class-variance-authority (CVA)

Project: <https://cva.style/>
License: Apache-2.0. Type-safe variant styling for component libraries.

### clsx

Project: <https://github.com/lukeed/clsx>
License: MIT. Utility for constructing className strings conditionally.

### tailwind-merge

Project: <https://github.com/dcastil/tailwind-merge>
License: MIT. Utility to merge Tailwind CSS classes without style conflicts.

### tailwindcss-animate

Project: <https://github.com/jamiebuilds/tailwindcss-animate>
License: MIT. Tailwind CSS plugin for animations.

## State Management and Data Fetching

### TanStack Query (React Query)

Project: <https://tanstack.com/query/>
License: MIT. Powerful asynchronous state management for data fetching and caching.

### React Hook Form

Project: <https://react-hook-form.com/>
License: MIT. Performant, flexible form validation library.

### Zod

Project: <https://zod.dev/>
License: MIT. TypeScript-first schema validation library.

### @hookform/resolvers

Project: <https://github.com/react-hook-form/resolvers>
License: MIT. Zod integration for React Hook Form.

## File Handling and Archives

### 7z-wasm

Project: <https://github.com/nickolay/7z-wasm>
License: MIT. WebAssembly-based 7z archive extraction for HVSC update processing.

### fflate

Project: <https://github.com/101arrowz/fflate>
License: MIT. High-performance ZIP compression/decompression.

### Apache Commons Compress

Project: <https://commons.apache.org/proper/commons-compress/>
License: Apache License 2.0. Used for 7z archive parsing in the native HVSC ingestion pipeline.

### XZ for Java

Project: <https://tukaani.org/xz/java.html>
License: Public Domain / BSD-style (see project). Used by Commons Compress for LZMA/XZ decompression.

### basic-ftp

Project: <https://github.com/patrickjuchli/basic-ftp>
License: MIT. FTP client for C64 Ultimate file transfer operations.

## Networking and API

### Axios

Project: <https://axios-http.com/>
License: MIT. HTTP client for REST API communication.

### openapi-client-axios

Project: <https://github.com/anttiviljami/openapi-client-axios>
License: MIT. OpenAPI-based REST client generation.

### js-yaml

Project: <https://github.com/nodeca/js-yaml>
License: MIT. YAML parser for C64 Ultimate configuration files.

## Utilities

### date-fns

Project: <https://date-fns.org/>
License: MIT. Modern date utility library.

### SparkMD5

Project: <https://github.com/satazor/js-spark-md5>
License: MIT. Fast MD5 hash computation for file integrity checks.

### sonner

Project: <https://sonner.emilkowal.ski/>
License: MIT. Toast notification component.

### cmdk

Project: <https://cmdk.paco.me/>
License: MIT. Command menu component for keyboard navigation.

### vaul

Project: <https://vaul.emilkowal.ski/>
License: MIT. Drawer component for mobile interfaces.

### embla-carousel-react

Project: <https://www.embla-carousel.com/>
License: MIT. Carousel/slider component.

### react-virtuoso

Project: <https://virtuoso.dev/>
License: MIT. Virtualized list rendering for large collections.

### recharts

Project: <https://recharts.org/>
License: MIT. Charting library for data visualization.

### react-resizable-panels

Project: <https://github.com/bvaughn/react-resizable-panels>
License: MIT. Resizable panel layouts.

### react-day-picker

Project: <https://react-day-picker.js.org/>
License: MIT. Date picker component.

### input-otp

Project: <https://github.com/guilhermerodz/input-otp>
License: MIT. One-time password input component.

### next-themes

Project: <https://github.com/pacocoursey/next-themes>
License: MIT. Theme management for dark/light mode.

## Testing and Development

### Vitest

Project: <https://vitest.dev/>
License: MIT. Unit testing framework.

### Playwright

Project: <https://playwright.dev/>
License: Apache-2.0. End-to-end testing framework.

### Testing Library

Project: <https://testing-library.com/>
License: MIT. React testing utilities (@testing-library/react, @testing-library/jest-dom).

### ESLint

Project: <https://eslint.org/>
License: MIT. JavaScript/TypeScript linter.

### Prettier

Project: <https://prettier.io/>
License: MIT. Code formatter.

### TypeScript

Project: <https://www.typescriptlang.org/>
License: Apache-2.0. Typed JavaScript superset.

## Android Native Dependencies

The Android APK bundles additional open-source components:

- **Capacitor Android runtime** (MIT) via `@capacitor/android`
- **Cordova bridge** (MIT) via `:capacitor-cordova-android-plugins`
- **AndroidX libraries** (Apache-2.0): `appcompat`, `coordinatorlayout`, `core-splashscreen`, `documentfile`
- **Kotlin standard library** (Apache-2.0) via the Kotlin Android plugin

## iOS Native Dependencies

The iOS app bundles:

- **Capacitor iOS runtime** (MIT) via `@capacitor/ios`

## Full Dependency Lists

The complete lists of dependencies are tracked in:

- JavaScript: `package.json` and `package-lock.json`
- Android: `android/app/build.gradle`
- iOS: `ios/App/Podfile`
