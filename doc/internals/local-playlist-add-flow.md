# Local Device Playlist Add Flow (Android Picker -> Playlist)

This document enumerates the exact file/line ranges that participate in the local-folder add flow and explains how control moves from the Android native picker to playlist population. It is intentionally explicit for peer review.

## Flow Overview (Mermaid)

```mermaid
flowchart TD
  A[Play Files page<br/>User taps "Add more items"] --> B[ItemSelectionDialog opens]
  B --> C[User taps "Add folder"]
  C --> D[ItemSelectionDialog.handleAddLocalSource]
  D --> E[useLocalSources.addSourceFromPicker]
  E --> F[localSourcesStore.createLocalSourceFromPicker]
  F --> G[FolderPicker.pickDirectory (Capacitor SAF)]
  G --> H[LocalSourceRecord stores SAF treeUri + permission timestamp]
  H --> I[LocalSourceRecord created + persisted (entries empty)]
  I --> J[ItemSelectionDialog auto-confirm local source]
  J --> K[PlayFilesPage.handleAutoConfirmStart]
  K --> L[PlayFilesPage.handleAddFileSelections]
  L --> M[localSourceAdapter.listEntries + recursive scan]
  M --> N[Playlist items created]
  N --> O[AddItemsProgressOverlay shows on page]
  O --> P[Playlist updated + toast]
```

## `src/pages/PlayFilesPage.tsx` (auto-confirm + scan + playlist update)

**Lines:** 444-700, 1704-1714  
**Role:** Owns the add-items workflow, shows the page overlay during scans, recursively walks local sources, and appends playlist items.

```tsx
// src/pages/PlayFilesPage.tsx:444-700
const handleAutoConfirmStart = useCallback(() => {
  setAddItemsSurface('page');
  setIsAddingItems(true);
  setShowAddItemsOverlay(true);
  addItemsOverlayStartedAtRef.current = Date.now();
  addItemsOverlayActiveRef.current = true;
}, []);

const handleAddFileSelections = useCallback(async (source, selections) => {
  // Start overlay + progress state.
  setAddItemsProgress({ status: 'scanning', count: 0, elapsedMs: 0, total: null, message: 'Scanning...' });
  ...
  const collectRecursive = async (rootPath: string) => { ... };
  ...
  // Convert scanned files to PlaylistItem and update playlist.
  setPlaylist((prev) => [...prev, ...playlistItems]);
  ...
}, [...]);
```

```tsx
// src/pages/PlayFilesPage.tsx:1704-1714
<ItemSelectionDialog
  ...
  onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
  onConfirm={handleAddFileSelections}
  autoConfirmCloseBefore={isAndroid}
  onAutoConfirmStart={handleAutoConfirmStart}
  autoConfirmLocalSource
/>
{!browserOpen ? (
  <AddItemsProgressOverlay ... visible={showAddItemsOverlay || addItemsProgress.status === 'scanning'} />
) : null}
```

## `src/components/itemSelection/ItemSelectionDialog.tsx` (picker + auto-confirm)

**Lines:** 97-211, 255-259  
**Role:** Handles the "Add folder" click, invokes the native picker, and auto-confirms the newly added local source on Android.

```tsx
// src/components/itemSelection/ItemSelectionDialog.tsx:97-139
const confirmLocalSource = useCallback(async (target) => {
  onAutoConfirmStart?.(target);
  if (autoConfirmCloseBefore) {
    onOpenChange(false);
  }
  const success = await onConfirm(target, selections);
  ...
}, [...]);

useEffect(() => {
  if (!open || !pendingLocalSource || selectedSourceId) return;
  ...
  if (autoConfirmLocalSource) {
    void confirmLocalSource(targetSource);
  }
}, [...]);
```

```tsx
// src/components/itemSelection/ItemSelectionDialog.tsx:193-211, 255-259
const handleAddLocalSource = async () => {
  setPendingLocalSource(true);
  ...
  const newSourceId = await onAddLocalSource();
  ...
};

{group.label === 'This device' && (
  <Button variant="secondary" onClick={() => void handleAddLocalSource()} ...>
    <FolderPlus ... /> <span className="truncate">Add folder</span>
  </Button>
)}
```

## `src/hooks/useLocalSources.ts` (persist local source)

**Lines:** 31-37  
**Role:** Calls the picker pipeline and persists the resulting local source in storage.

```ts
// src/hooks/useLocalSources.ts:31-37
const addSourceFromPicker = useCallback(async (input) => {
  const result = await createLocalSourceFromPicker(input);
  if (!result) return null;
  setLocalSourceRuntimeFiles(result.source.id, result.runtimeFiles);
  persist([result.source, ...sources]);
  return result.source;
}, [...]);
```

## `src/lib/sourceNavigation/localSourcesStore.ts` (Android SAF picker ingestion)

**Lines:** 122-167  
**Role:** Android-native path that calls the Capacitor SAF picker, stores the tree URI + permission timestamp, and creates a LocalSourceRecord rooted at `/` without file entries.

```ts
// src/lib/sourceNavigation/localSourcesStore.ts:122-167
if (getPlatform() === 'android') {
  const result = await FolderPicker.pickDirectory();
  const treeUri = result?.treeUri;
  const rootName = normalizeRootName(result?.rootName);
  const source = {
    ...,
    entries: [],
    android: {
      treeUri,
      rootName,
      permissionGrantedAt: createdAt,
    },
  };
  return { source, runtimeFiles: {} };
}
```

## `src/lib/native/folderPicker.ts` (Capacitor bridge)

**Lines:** 44-92  
**Role:** Invokes the native Android SAF picker. Test overrides are blocked on Android unless test probes explicitly enable them.

```ts
// src/lib/native/folderPicker.ts:44-92
const resolveOverrideMethod = <K extends keyof FolderPickerPlugin>(method: K) => {
  const override = resolveOverride();
  const candidate = override?.[method];
  if (!candidate) return null;
  if (getPlatform() !== 'android' || allowAndroidOverride()) return candidate;
  addLog('debug', 'Android SAF override blocked', { method });
  throw new Error('Android SAF picker is required.');
};

export const FolderPicker: FolderPickerPlugin = {
  pickDirectory: (options) => {
    const override = resolveOverrideMethod('pickDirectory');
    if (override) return override(options);
    return plugin.pickDirectory(options);
  },
  ...
};
```

## `src/lib/sourceNavigation/localSourceAdapter.ts` (local file listing + SAF enumeration)

**Lines:** 23-127  
**Role:** Resolves the effective root path for local sources and provides `listEntries` used by the scan. On Android SAF sources it calls the native `listChildren` API per directory.

```ts
// src/lib/sourceNavigation/localSourceAdapter.ts:23-102
const resolveRootPath = (source) => {
  if (source.android?.treeUri) return '/';
  const normalizedRoot = normalizeSourcePath(source.rootPath || '/');
  if (!source.entries.length || normalizedRoot === '/') return '/';
  ...
};

const listEntries = async (path: string): Promise<SourceEntry[]> => {
  if (source.android?.treeUri) {
    return listSafEntries(source, path);
  }
  ...
};
```

## `src/components/itemSelection/AddItemsProgressOverlay.tsx` (page overlay)

**Lines:** 25-53  
**Role:** Renders the page-level progress overlay shown during the scan, respecting safe-area insets.

```tsx
// src/components/itemSelection/AddItemsProgressOverlay.tsx:25-53
export const AddItemsProgressOverlay = ({ progress, ... }) => {
  if (visible !== true && progress.status !== 'scanning') return null;
  return (
    <div className="fixed inset-0 ...">
      <div className="w-full max-w-sm ...">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {progress.message || 'Scanning files'} - {progress.count} found
        </p>
      </div>
    </div>
  );
};
```

## Control Transfer Notes

- The Android picker returns a SAF tree URI + root name; the LocalSourceRecord stores the SAF handle and does not store entries.
- `ItemSelectionDialog` auto-selects and auto-confirms the new local source on Android, closing the dialog before scanning.
- `PlayFilesPage` owns the recursive scan and playlist insert. It enumerates folders dynamically via SAF list calls.
- The progress overlay is always safe-area-aware and bounded by viewport size.
