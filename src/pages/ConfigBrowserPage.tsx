/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState, useMemo, useEffect, useReducer, useRef, useCallback } from "react";
import { wrapUserEvent } from "@/lib/tracing/userTrace";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronDown, Loader2, RefreshCw, FolderOpen } from "lucide-react";
import {
  useC64Categories,
  useC64Category,
  useC64SetConfig,
  useC64Connection,
  useConnectionRoutingEpoch,
  VISIBLE_C64_QUERY_OPTIONS,
} from "@/hooks/useC64Connection";
import { ConfigItemRow } from "@/components/ConfigItemRow";
import { useC64UpdateConfigBatch } from "@/hooks/useC64Connection";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { reportUserError } from "@/lib/uiErrors";
import { addErrorLog, addLog } from "@/lib/logging";
import { resolveAudioMixerResetValue } from "@/lib/config/audioMixer";
import { useRefreshControl } from "@/hooks/useRefreshControl";
import { isAudioMixerValueEqual } from "@/lib/config/audioMixer";
import { BACKGROUND_REQUEST_TIMEOUT_MS, type ConfigCategory, type ConfigResponse } from "@/lib/c64api";
import { cn } from "@/lib/utils";
import { buildSoloRoutingUpdates, isSidVolumeName, soloReducer } from "@/lib/config/audioMixerSolo";
import { normalizeConfigItem, type NormalizedConfigItem } from "@/lib/config/normalizeConfigItem";
import { AppBar } from "@/components/AppBar";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { updateHasChanges } from "@/lib/config/appConfigStore";
import { PageContainer, PageStack } from "@/components/layout/PageContainer";
import {
  canonicalConfigKey,
  useAuthoritativeConfigValueState,
  type AuthoritativeConfigValueState,
} from "@/hooks/useAuthoritativeConfigValueState";
import { resolveCanonicalProductFamilyCode } from "@/lib/savedDevices/store";
import {
  getMenuValueFormatter,
  lookupOverlay,
  resolveMenuMapping,
  TERMINOLOGY_OVERLAY,
  unroutedCategories,
  type MenuHierarchy,
  type MenuNode,
  type TerminologyOverlay,
} from "@/lib/config/menuMapping";
import { MenuPageSection } from "@/pages/config/MenuPageSection";
import { AdvancedFallbackSection } from "@/pages/config/AdvancedFallbackSection";

type ConfigListItem = {
  name: string;
  value: string | number;
  options?: string[];
  details?: NormalizedConfigItem["details"];
};

// A solo-mode snapshot older than this is discarded instead of auto-restored:
// it likely belongs to an interrupted previous session (crash, force-close
// before the unmount cleanup ran), and volumes may have changed on the device
// since it was written - restoring it would silently clobber current settings.
// See HARD9-054.
const AUDIO_MIXER_SOLO_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

type StoredAudioMixerSoloSnapshot = {
  savedAtMs: number;
  items: ConfigListItem[];
};

// Extract the normalized item list for a category from a raw config response.
// Shared between the `items` memo and the post-refetch re-sync in
// resetAudioMixer/handleRefresh so the latter reads the FRESH device values
// straight from the refetch result instead of a possibly-lagging ref (BUG-033).
function extractConfigItems(categoryData: ConfigResponse | undefined, categoryName: string): ConfigListItem[] {
  if (!categoryData) return [];
  const catData = categoryData[categoryName] as ConfigCategory | undefined;
  if (!catData || typeof catData !== "object" || Array.isArray(catData)) return [];
  const itemsData = (catData as ConfigCategory & { items?: ConfigCategory }).items ?? catData;
  return Object.entries(itemsData)
    .filter(([key]) => key !== "errors")
    .map(([name, config]) => ({
      name,
      ...normalizeConfigItem(config),
    }));
}

// Value-equality for configured-item snapshots. extractConfigItems rebuilds a
// fresh array (new object identities) on every render, so when the upstream
// config data is not referentially stable, feeding `items` straight into
// setAudioConfiguredItems would re-render forever during a re-sync (the snapshot
// effect's `items` dep changes each render). The arrays are small and built from
// a single normalizer, so a per-item serialized compare is deterministic and
// lets syncAudioConfiguredItems bail on redundant identical-content updates.
function configListItemsEqual(a: ConfigListItem[], b: ConfigListItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

// Keypad focus-ring ordering for the Config page (C64U Remote). Each category
// header toggle registers at CONFIG_CATEGORY_FOCUS_ORDER_BASE + index * STEP so
// the keypad ring walks the collapsible categories top→bottom (this route's only
// band); the STEP gap leaves room for a category's group actions (Refresh / Reset
// / Sync clock) to slot in just after its header in a later slice. Inert in the
// default variant (no FocusNavigationProvider listener).
const CONFIG_CATEGORY_FOCUS_ORDER_BASE = 100;
const CONFIG_CATEGORY_FOCUS_ORDER_STEP = 10;
const CONFIG_BROWSER_QUERY_OPTIONS = {
  ...VISIBLE_C64_QUERY_OPTIONS,
  timeoutMs: BACKGROUND_REQUEST_TIMEOUT_MS,
};

const DHCP_STATIC_FIELDS = new Set(["Static IP", "Static Netmask", "Static Gateway", "Static DNS"]);
const CLOCK_MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const resolveClockSyncValue = (item: ConfigListItem, numericValue: number): string | number => {
  if (typeof item.value !== "string") {
    return numericValue;
  }

  if (!item.options?.length) {
    if (item.name.toLowerCase().includes("month")) {
      return CLOCK_MONTH_OPTIONS[numericValue - 1] ?? numericValue;
    }
    return numericValue;
  }

  const exactOption = item.options.find((option) => option === String(numericValue));
  if (exactOption) {
    return exactOption;
  }

  const oneBasedOption = item.options[numericValue - 1];
  return oneBasedOption ?? numericValue;
};

function CategorySection({
  categoryName,
  displayTitle,
  groupLabel,
  overlay,
  authoritativeValues,
  onOpenChange,
  markChanged,
  focusOrder,
}: {
  categoryName: string;
  /** Header label override (e.g. menu page name "Audio mixer"); defaults to categoryName. */
  displayTitle?: string;
  /** Parent menu group shown above the title (hierarchy mode), e.g. "Audio setup". */
  groupLabel?: string | null;
  /** Layer A terminology overlay — relabels item rows + formats values. */
  overlay?: TerminologyOverlay;
  /** Page-shared optimistic/echo store, keyed by canonical `category::item`. */
  authoritativeValues: AuthoritativeConfigValueState;
  onOpenChange: (isOpen: boolean) => void;
  markChanged: () => void;
  focusOrder: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // Register this category's collapsible header into the keypad focus ring so the
  // touch-off C64U Remote can reach and expand/collapse every config category by
  // d-pad + center. No-op in the default variant (no provider) and unchanged for
  // pointer/touch. The header `<button>` activates by click, toggling the section.
  const categoryHeaderFocusRef = useFocusItem<HTMLButtonElement>({
    id: `config-category-${categoryName.toLowerCase().replace(/\s+/g, "-")}`,
    order: focusOrder,
    group: "config-categories",
  });
  const [isResetting, setIsResetting] = useState(false);
  const { data: categoryData, isLoading, refetch } = useC64Category(categoryName, isOpen, CONFIG_BROWSER_QUERY_OPTIONS);
  const setConfig = useC64SetConfig();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const isAudioMixer = categoryName === "Audio Mixer";
  const isClockSettings = categoryName === "Clock Settings";
  // Only Audio Mixer (Reset) and Clock Settings (Sync clock) expose a leading
  // group action; every open section also shows Refresh. Used to gate keypad
  // focus-ring registration of those CTAs below.
  const hasCategoryGroupAction = isAudioMixer || isClockSettings;
  const categorySlug = categoryName.toLowerCase().replace(/\s+/g, "-");
  const [soloState, dispatchSolo] = useReducer(soloReducer, { soloItem: null });
  const [audioConfiguredItems, setAudioConfiguredItems] = useState<ConfigListItem[]>([]);
  const audioConfiguredRef = useRef<ConfigListItem[]>([]);
  const soloSnapshotRef = useRef<ConfigListItem[]>([]);
  const wasSoloActiveRef = useRef(false);
  const [isEditingVolumes, setIsEditingVolumes] = useState(false);
  const editTimeoutRef = useRef<number | null>(null);
  const skipSoloRoutingRef = useRef(false);
  // True while an explicit device re-sync (Reset/Refresh) is awaiting its
  // refetch. Suppresses the snapshot effect's stale-snapshot short-circuit so an
  // out-of-band device change reconciles instead of being masked (BUG-033).
  const resyncPendingRef = useRef(false);
  const soloSnapshotKey = "c64u_audio_mixer_solo_snapshot";

  useEffect(() => {
    if (isOpen) {
      refetch();
    }
  }, [isOpen, refetch]);

  useEffect(() => {
    onOpenChange(isOpen);
  }, [isOpen, onOpenChange]);

  const items = useMemo<ConfigListItem[]>(
    () => extractConfigItems(categoryData, categoryName),
    [categoryData, categoryName],
  );

  // Register this category's group-action CTAs into the keypad focus ring so the
  // touch-off C64U Remote can reach them just after the category header. They mount
  // only inside an open section, so the ids are empty (opt-out) while collapsed and
  // the ring register/unregisters as the section expands/collapses. They slot into
  // the STEP gap reserved after the header's `focusOrder`: the leading action
  // (Audio Mixer Reset / Clock Settings Sync clock — mutually exclusive) at +1, then
  // Refresh at +2, matching their left→right DOM order. No-op in the default variant
  // (no provider) and unchanged for pointer/touch (the buttons keep their onClick).
  const categoryActionDisabled = isAudioMixer
    ? isResetting || isLoading || items.length === 0
    : isLoading || items.length === 0 || updateConfigBatch.isPending;
  const categoryActionFocusRef = useFocusItem<HTMLButtonElement>({
    id: isOpen && hasCategoryGroupAction ? `config-category-action-${categorySlug}` : "",
    order: focusOrder + 1,
    group: "config-group-actions",
    disabled: categoryActionDisabled,
  });
  const refreshFocusRef = useFocusItem<HTMLButtonElement>({
    id: isOpen ? `config-refresh-${categorySlug}` : "",
    order: focusOrder + 2,
    group: "config-group-actions",
  });

  const itemsRef = useRef<ConfigListItem[]>(items);
  const soloItemRef = useRef<string | null>(soloState.soloItem);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    soloItemRef.current = soloState.soloItem;
  }, [soloState.soloItem]);

  const dhcpStatus = useMemo(() => {
    if (categoryName !== "Ethernet Settings" && categoryName !== "WiFi settings") return null;
    const dhcpItem = items.find((item) => item.name === "Use DHCP");
    if (!dhcpItem) return null;
    return String(dhcpItem.value).trim().toLowerCase();
  }, [categoryName, items]);

  const isDhcpEnabled = dhcpStatus ? ["enabled", "on", "true", "yes", "1"].includes(dhcpStatus) : false;

  const syncAudioConfiguredItems = useCallback((next: ConfigListItem[]) => {
    // Bail on value-equal updates: the snapshot effect re-runs whenever `items`
    // changes identity, and during a Reset/Refresh re-sync it feeds `items`
    // directly. Without this guard a referentially-unstable (but value-equal)
    // upstream would loop the effect forever (BUG-033 follow-up).
    if (configListItemsEqual(audioConfiguredRef.current, next)) return;
    audioConfiguredRef.current = next;
    setAudioConfiguredItems(next);
  }, []);

  useEffect(() => {
    if (!isAudioMixer) return;
    if (items.length === 0) {
      // Bail on value-equality: `items` can be referentially unstable (a fresh
      // empty array each render) while staying value-equal, and `setState([])`
      // would otherwise create a new array every time, re-render, re-run this
      // effect (its `items` dep just changed identity), and loop forever. Reusing
      // the previous empty array when already empty lets React's Object.is bail
      // out (same guard rationale as `syncAudioConfiguredItems`, BUG-033).
      setAudioConfiguredItems((prev) => (prev.length === 0 ? prev : []));
      audioConfiguredRef.current = [];
      soloSnapshotRef.current = [];
      return;
    }
    if (soloState.soloItem) {
      if (!audioConfiguredItems.length) {
        syncAudioConfiguredItems(items);
      }
      return;
    }
    // During an explicit device re-sync (Reset/Refresh) always adopt the freshest
    // `items` and do NOT cache them into soloSnapshotRef: an intermediate render
    // still carries the pre-refetch (stale) values, and latching those into the
    // snapshot is exactly what made Reset/Refresh fail to reconcile (BUG-033).
    // The triggering handler performs the authoritative re-sync from the refetch
    // result once it resolves.
    if (resyncPendingRef.current) {
      syncAudioConfiguredItems(items);
      return;
    }
    const snapshot = soloSnapshotRef.current.length ? soloSnapshotRef.current : items;
    syncAudioConfiguredItems(snapshot);
    soloSnapshotRef.current = snapshot;
  }, [audioConfiguredItems.length, isAudioMixer, items, soloState.soloItem, syncAudioConfiguredItems]);

  useEffect(() => {
    if (!isAudioMixer) return;
    audioConfiguredRef.current = audioConfiguredItems;
  }, [isAudioMixer, audioConfiguredItems]);

  useEffect(
    () => () => {
      if (editTimeoutRef.current) {
        window.clearTimeout(editTimeoutRef.current);
      }
    },
    [],
  );

  // Reads the solo snapshot from sessionStorage, discarding (and logging) it
  // instead of returning it if it is older than the freshness window - it
  // likely belongs to an interrupted previous session and current device
  // volumes may no longer match it. See HARD9-054.
  const readFreshSoloSnapshot = useCallback((): ConfigListItem[] | null => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(soloSnapshotKey);
    } catch (error) {
      addErrorLog("Solo snapshot read failed", {
        error: (error as Error).message,
      });
      return null;
    }
    if (!stored) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch (error) {
      addErrorLog("Solo snapshot parse failed", {
        error: (error as Error).message,
      });
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { savedAtMs, items } = parsed as Partial<StoredAudioMixerSoloSnapshot>;
    if (typeof savedAtMs !== "number" || !Array.isArray(items) || items.length === 0) return null;
    const ageMs = Date.now() - savedAtMs;
    if (ageMs > AUDIO_MIXER_SOLO_SNAPSHOT_MAX_AGE_MS) {
      addLog("info", "Discarding stale Audio Mixer solo snapshot instead of restoring it", {
        ageMs,
        maxAgeMs: AUDIO_MIXER_SOLO_SNAPSHOT_MAX_AGE_MS,
      });
      try {
        sessionStorage.removeItem(soloSnapshotKey);
      } catch (error) {
        addErrorLog("Stale solo snapshot cleanup failed", {
          error: (error as Error).message,
        });
      }
      return null;
    }
    return items;
  }, [soloSnapshotKey]);

  const updateAudioMixerBatch = updateConfigBatch.mutateAsync;

  const applySoloRouting = useCallback(
    async (soloItem: string | null, configuredOverride?: ConfigListItem[]) => {
      if (!isAudioMixer) return;
      const configured =
        configuredOverride && configuredOverride.length > 0 ? configuredOverride : audioConfiguredRef.current;
      if (!configured.length) return;
      if (soloItem) {
        soloSnapshotRef.current = configured;
        try {
          sessionStorage.setItem(
            soloSnapshotKey,
            JSON.stringify({ savedAtMs: Date.now(), items: configured } satisfies StoredAudioMixerSoloSnapshot),
          );
        } catch (error) {
          addErrorLog("Solo snapshot save failed", {
            error: (error as Error).message,
          });
        }
      }
      const updates = buildSoloRoutingUpdates(configured, soloItem);
      if (Object.keys(updates).length === 0) return;
      try {
        // Routes through the shared mutation (not a direct api.updateConfigBatch
        // call) so a solo/unsolo write invalidates c64-config-items/c64-category
        // and marks hasChanges, same as every other config write - Home no
        // longer kept showing pre-solo volumes after a solo toggle. See
        // HARD9-054.
        await updateAudioMixerBatch({ category: categoryName, updates });
        if (!soloItem) {
          try {
            sessionStorage.removeItem(soloSnapshotKey);
          } catch (error) {
            addErrorLog("Solo snapshot cleanup failed", {
              error: (error as Error).message,
            });
          }
        }
      } catch (error) {
        reportUserError({
          operation: "AUDIO_ROUTING",
          title: "Audio routing error",
          description: (error as Error).message,
          error,
          context: {
            category: categoryName,
            soloItem: soloItem ?? "none",
          },
        });
      }
    },
    // audioConfiguredRef is intentionally omitted from deps: refs have stable identity
    // and audioConfiguredRef.current is read at call time, not at dependency capture time.
    [isAudioMixer, categoryName, reportUserError, updateAudioMixerBatch],
  );

  useEffect(() => {
    if (!isAudioMixer) return;
    const isActive = Boolean(soloState.soloItem);
    if (skipSoloRoutingRef.current && !isActive) {
      skipSoloRoutingRef.current = false;
      wasSoloActiveRef.current = false;
      return;
    }
    if (isActive || wasSoloActiveRef.current) {
      void applySoloRouting(soloState.soloItem);
    }
    wasSoloActiveRef.current = wasSoloActiveRef.current || isActive;
  }, [isAudioMixer, soloState.soloItem, applySoloRouting]);

  const restoredSnapshotRef = useRef(false);

  useEffect(() => {
    if (!isAudioMixer) return;
    if (soloState.soloItem) return;
    if (restoredSnapshotRef.current) return;
    // readFreshSoloSnapshot already discards (and logs) a stale snapshot
    // instead of returning it - a snapshot from an interrupted previous
    // session must not silently overwrite volumes that may have changed on
    // the device since. See HARD9-054.
    const snapshot = readFreshSoloSnapshot();
    restoredSnapshotRef.current = true;
    if (snapshot) {
      void applySoloRouting(null, snapshot);
    }
  }, [applySoloRouting, isAudioMixer, readFreshSoloSnapshot, soloState.soloItem]);

  const restoreSoloRouting = useCallback(
    (reason: "close" | "unmount") => {
      if (!isAudioMixer) return;
      if (!wasSoloActiveRef.current && !soloItemRef.current) return;
      const configured = audioConfiguredRef.current.length ? audioConfiguredRef.current : itemsRef.current;
      const fallbackSnapshot = soloSnapshotRef.current.length ? soloSnapshotRef.current : configured;
      // readFreshSoloSnapshot discards a stale snapshot instead of returning
      // it; fall back to the in-memory ref/current items in that case
      // (normally this snapshot was just written moments ago when solo was
      // toggled on, so it is fresh - the fallback only matters if the tab
      // was backgrounded for a long time while solo was active). See
      // HARD9-054.
      const snapshot = readFreshSoloSnapshot() ?? fallbackSnapshot;
      if (snapshot.length) {
        void applySoloRouting(null, snapshot);
      }
      wasSoloActiveRef.current = false;
      if (reason === "close") {
        skipSoloRoutingRef.current = true;
        dispatchSolo({ type: "reset" });
      }
    },
    [applySoloRouting, isAudioMixer, readFreshSoloSnapshot],
  );

  useEffect(() => {
    if (!isAudioMixer || isOpen) return;
    restoreSoloRouting("close");
  }, [isAudioMixer, isOpen, restoreSoloRouting]);

  useEffect(() => {
    if (!isAudioMixer) return undefined;
    return () => restoreSoloRouting("unmount");
  }, [isAudioMixer, restoreSoloRouting]);

  const handleValueChange = async (itemName: string, value: string | number) => {
    const key = canonicalConfigKey(categoryName, itemName);
    const previousEntry = authoritativeValues.entriesRef.current[key];
    authoritativeValues.replaceEntry(key, value);
    try {
      await setConfig.mutateAsync({
        category: categoryName,
        item: itemName,
        value,
      });
      toast({ title: `${itemName} updated` });
      return true;
    } catch (error) {
      reportUserError({
        operation: "CONFIG_UPDATE",
        title: "Error",
        description: (error as Error).message,
        error,
        context: {
          category: categoryName,
          item: itemName,
        },
      });
      authoritativeValues.restoreEntry(key, previousEntry, value);
      return false;
    }
  };

  const updateAudioConfiguredValue = useCallback(
    (itemName: string, value: string | number) => {
      setAudioConfiguredItems((prev) => {
        const source = prev.length ? prev : items;
        const next = source.map((item) => (item.name === itemName ? { ...item, value } : item));
        audioConfiguredRef.current = next;
        return next;
      });
    },
    [items],
  );

  const handleAudioValueChange = async (itemName: string, value: string | number) => {
    const previousConfiguredItems = audioConfiguredRef.current.length ? audioConfiguredRef.current : items;
    const wasSoloActive = Boolean(soloState.soloItem);
    if (wasSoloActive) {
      skipSoloRoutingRef.current = true;
      dispatchSolo({ type: "reset" });
    }
    setIsEditingVolumes(true);
    if (editTimeoutRef.current) {
      window.clearTimeout(editTimeoutRef.current);
    }
    editTimeoutRef.current = window.setTimeout(() => setIsEditingVolumes(false), 800);
    updateAudioConfiguredValue(itemName, value);
    if (wasSoloActive) {
      const snapshot = soloSnapshotRef.current.length
        ? soloSnapshotRef.current
        : audioConfiguredRef.current.length
          ? audioConfiguredRef.current
          : items;
      const updates = buildSoloRoutingUpdates(snapshot, null);
      updates[itemName] = value;
      try {
        await updateConfigBatch.mutateAsync({
          category: categoryName,
          updates,
        });
        soloSnapshotRef.current = audioConfiguredRef.current.length ? audioConfiguredRef.current : items;
      } catch (error) {
        reportUserError({
          operation: "AUDIO_MIXER_UPDATE",
          title: "Error",
          description: (error as Error).message,
          error,
          context: {
            category: categoryName,
          },
        });
        syncAudioConfiguredItems(previousConfiguredItems);
      }
      return;
    }
    const success = await handleValueChange(itemName, value);
    if (!success) {
      syncAudioConfiguredItems(previousConfiguredItems);
      return;
    }
    if (!soloState.soloItem) {
      soloSnapshotRef.current = audioConfiguredRef.current.length ? audioConfiguredRef.current : items;
    }
  };

  const handleSyncClock = async () => {
    if (categoryName !== "Clock Settings") return;
    const now = new Date();
    const updates: Record<string, string | number> = {};
    const normalizedItems = items.map((item) => ({
      item,
      name: item.name.toLowerCase(),
    }));

    const setIfMatch = (matcher: (name: string) => boolean, value: number) => {
      normalizedItems
        .filter((entry) => matcher(entry.name))
        .forEach((entry) => {
          updates[entry.item.name] = resolveClockSyncValue(entry.item, value);
        });
    };

    setIfMatch((name) => name.includes("year"), now.getFullYear());
    setIfMatch((name) => name.includes("month"), now.getMonth() + 1);
    setIfMatch((name) => name.includes("day"), now.getDate());
    setIfMatch((name) => name.includes("hour"), now.getHours());
    setIfMatch((name) => name.includes("minute"), now.getMinutes());
    setIfMatch((name) => name.includes("second"), now.getSeconds());

    if (Object.keys(updates).length === 0) {
      reportUserError({
        operation: "CLOCK_SYNC",
        title: "Clock sync unavailable",
        description: "No matching clock fields found in this section.",
        context: { category: categoryName },
      });
      return;
    }

    try {
      await updateConfigBatch.mutateAsync({ category: categoryName, updates });
      markChanged();
      toast({
        title: "Clock synced",
        description: "C64U clock updated from device time.",
      });
    } catch (error) {
      reportUserError({
        operation: "CLOCK_SYNC",
        title: "Clock sync failed",
        description: (error as Error).message,
        error,
        context: { category: categoryName },
      });
    }
  };

  const resetAudioMixer = async () => {
    if (categoryName !== "Audio Mixer") return;
    skipSoloRoutingRef.current = true;
    dispatchSolo({ type: "reset" });
    soloSnapshotRef.current = [];
    resyncPendingRef.current = true;
    setIsResetting(true);
    try {
      const updates: Record<string, string | number> = {};
      for (const item of items) {
        const target = await resolveAudioMixerResetValue(categoryName, item.name, item.options);
        if (target === undefined) continue;
        if (isAudioMixerValueEqual(item.value, target)) continue;
        updates[item.name] = target;
      }

      if (Object.keys(updates).length === 0) {
        toast({
          title: "Audio Mixer already at defaults",
          description: "No changes needed.",
        });
        return;
      }

      await updateConfigBatch.mutateAsync({ category: categoryName, updates });
      const refreshed = await refetch();
      // The batch reset changes device values out-of-band relative to any
      // optimistic override left by an earlier user edit. Those overrides will
      // never echo their pinned value back, so drop them and let the freshly
      // refetched device values show through (BUG-033).
      authoritativeValues.clearMatching(`${categoryName}::`);
      // Re-sync the Audio Mixer snapshot straight from the refetch result. The
      // snapshot effect may have re-captured stale pre-refetch values during the
      // await window; this authoritative write reconciles the rendered values
      // (and the solo snapshot) to the post-reset device truth (BUG-033).
      const fresh = extractConfigItems(refreshed?.data, categoryName);
      if (fresh.length) {
        syncAudioConfiguredItems(fresh);
        soloSnapshotRef.current = fresh;
      }
      markChanged();
      toast({
        title: "Audio Mixer reset",
        description: "Volumes set to 0 dB, pans centered.",
      });
    } catch (error) {
      reportUserError({
        operation: "AUDIO_MIXER_RESET",
        title: "Error",
        description: (error as Error).message,
        error,
        context: { category: categoryName },
      });
    } finally {
      resyncPendingRef.current = false;
      setIsResetting(false);
    }
  };

  const handleRefresh = async () => {
    if (isAudioMixer) {
      skipSoloRoutingRef.current = true;
      dispatchSolo({ type: "reset" });
      soloSnapshotRef.current = [];
      resyncPendingRef.current = true;
      syncAudioConfiguredItems([]);
    }
    try {
      const refreshed = await refetch();
      // Refresh is an explicit "re-sync from device truth" affordance: drop any
      // optimistic overrides so a value changed out-of-band (e.g. a stale pin
      // that will never echo its pinned value) reconciles to the device value
      // instead of staying latched until unmount (BUG-033).
      authoritativeValues.clearMatching(`${categoryName}::`);
      // Re-sync the Audio Mixer snapshot from the fresh refetch result so the
      // rendered values (and the solo snapshot) reconcile to device truth even
      // if the snapshot effect re-captured stale values mid-refetch (BUG-033).
      if (isAudioMixer) {
        const fresh = extractConfigItems(refreshed?.data, categoryName);
        if (fresh.length) {
          syncAudioConfiguredItems(fresh);
          soloSnapshotRef.current = fresh;
        }
      }
    } finally {
      resyncPendingRef.current = false;
    }
  };

  const displayItems = useMemo(
    () =>
      (isAudioMixer && audioConfiguredItems.length ? audioConfiguredItems : items).map((item) => ({
        ...item,
        value: authoritativeValues.resolveValue(canonicalConfigKey(categoryName, item.name), item.value, item.value),
      })),
    [audioConfiguredItems, authoritativeValues, categoryName, isAudioMixer, items],
  );
  const sectionId = `config-section-${categoryName.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      <button
        ref={categoryHeaderFocusRef}
        onClick={wrapUserEvent(
          () => setIsOpen(!isOpen),
          "toggle",
          "ConfigSection",
          { title: categoryName },
          "ConfigHeader",
        )}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        data-testid={`config-category-${categoryName.toLowerCase().replace(/\s+/g, "-")}`}
        aria-expanded={isOpen}
        aria-controls={sectionId}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col">
            {groupLabel ? (
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{groupLabel}</span>
            ) : null}
            <span className="font-medium text-sm">{displayTitle ?? categoryName}</span>
          </div>
        </div>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={sectionId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-border px-4 pt-2 pb-3">
              <div className="flex items-center justify-between gap-2 py-2" data-testid="config-group-actions">
                <div className="flex items-center gap-2">
                  {categoryName === "Audio Mixer" && (
                    <Button
                      ref={categoryActionFocusRef}
                      variant="outline"
                      size="sm"
                      onClick={resetAudioMixer}
                      disabled={isResetting || isLoading || items.length === 0}
                      className="text-xs"
                    >
                      Reset
                    </Button>
                  )}
                  {categoryName === "Clock Settings" && (
                    <Button
                      ref={categoryActionFocusRef}
                      variant="outline"
                      size="sm"
                      onClick={handleSyncClock}
                      disabled={isLoading || items.length === 0 || updateConfigBatch.isPending}
                      className="text-xs"
                    >
                      Sync clock
                    </Button>
                  )}
                </div>
                <Button ref={refreshFocusRef} variant="ghost" size="sm" onClick={handleRefresh} className="text-xs">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh
                </Button>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : items.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">No settings available</div>
              ) : (
                <div className="divide-y divide-border" data-testid="config-group-list">
                  {displayItems.map((item) => {
                    const isSidVolume = isAudioMixer && isSidVolumeName(item.name);
                    const isSoloed = isSidVolume && soloState.soloItem === item.name;
                    const isMutedBySolo = isSidVolume && soloState.soloItem && soloState.soloItem !== item.name;
                    const isDhcpStaticField =
                      (categoryName === "Ethernet Settings" || categoryName === "WiFi settings") &&
                      DHCP_STATIC_FIELDS.has(item.name);
                    const isReadOnly = isDhcpEnabled && isDhcpStaticField;
                    const testIdBase = item.name.toLowerCase().replace(/\s+/g, "-");
                    const overlayEntry = overlay ? lookupOverlay(overlay, categoryName, item.name) : undefined;
                    const rowClassName = cn(
                      isSidVolume && "rounded-md px-3",
                      isSoloed && "bg-primary/10",
                      isMutedBySolo && "bg-muted/20",
                    );

                    const rightAccessory = isSidVolume ? (
                      <div className="flex items-center gap-3">
                        {isMutedBySolo && <span className="text-[11px] font-medium text-muted-foreground">Muted</span>}
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`solo-${item.name}`} className="text-[11px] uppercase tracking-wide">
                            Solo
                          </Label>
                          <Switch
                            id={`solo-${item.name}`}
                            checked={isSoloed}
                            aria-label={`Solo ${item.name}`}
                            onCheckedChange={() => dispatchSolo({ type: "toggle", item: item.name })}
                            disabled={isEditingVolumes}
                            data-testid={`audio-mixer-solo-${testIdBase}`}
                          />
                        </div>
                      </div>
                    ) : undefined;

                    return (
                      <ConfigItemRow
                        key={item.name}
                        category={categoryName}
                        name={item.name}
                        label={overlayEntry?.label}
                        formatOptionLabel={getMenuValueFormatter(overlayEntry?.formatterId)}
                        value={item.value}
                        options={item.options}
                        details={item.details}
                        onValueChange={(v) =>
                          isSidVolume ? handleAudioValueChange(item.name, v) : handleValueChange(item.name, v)
                        }
                        isLoading={
                          setConfig.isPending ||
                          Boolean(authoritativeValues.pending[canonicalConfigKey(categoryName, item.name)])
                        }
                        readOnly={isReadOnly}
                        className={rowClassName}
                        rightAccessory={rightAccessory}
                        valueTestId={isSidVolume ? `audio-mixer-value-${testIdBase}` : undefined}
                        sliderTestId={isSidVolume ? `audio-mixer-slider-${testIdBase}` : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// A flattened menu page entry for hierarchy-mode rendering: a settings page plus the
// parent menu group it belongs to (e.g. "Audio setup" › "Audio mixer").
type MenuPageEntry = { page: MenuNode; groupLabel: string | null };

const flattenMenuPages = (hierarchy: MenuHierarchy): MenuPageEntry[] => {
  const entries: MenuPageEntry[] = [];
  for (const node of hierarchy.nodes) {
    if (node.kind === "group") {
      for (const child of node.children ?? []) entries.push({ page: child, groupLabel: node.label });
    } else {
      entries.push({ page: node, groupLabel: null });
    }
  }
  return entries;
};

// The single REST category a page reads from when it is a flat, single-category page
// (used to delegate the Audio Mixer page to the specialized CategorySection).
const soleRestCategory = (page: MenuNode): string | null => {
  const categories = new Set<string>();
  const walk = (node: MenuNode) => {
    if (node.kind === "item" && node.rest) categories.add(node.rest.category);
    for (const child of node.children ?? []) walk(child);
  };
  walk(page);
  return categories.size === 1 ? [...categories][0] : null;
};

export default function ConfigBrowserPage() {
  const { status, runtimeBaseUrl } = useC64Connection();
  const { data: categoriesData, isLoading, isError, error, refetch } = useC64Categories(CONFIG_BROWSER_QUERY_OPTIONS);
  const [searchQuery, setSearchQuery] = useState("");
  const { setConfigExpanded } = useRefreshControl();
  const markChanged = useCallback(() => {
    updateHasChanges(runtimeBaseUrl, true);
  }, [runtimeBaseUrl]);

  // Page-shared optimistic/echo store keyed by canonical `category::item`, so aliases
  // share one pending cell and multi-category menu pages never collide (see Hazards).
  const authoritativeValues = useAuthoritativeConfigValueState();

  // The store now outlives any single CategorySection/MenuPageSection (it is page-scoped,
  // not per-section), so it no longer unmounts on a device switch. Drop every pin whenever
  // the connection generation changes — a device switch or reconnect bumps `routingEpoch`
  // and re-keys every config query against the new device. A pin from the previous device
  // would otherwise stay latched (its pinned value will never echo back from a different
  // device) and `resolveValue` would keep painting the stale value over the new device's
  // data (BUG-033). `clearAll` is a no-op when empty, so the initial mount is harmless.
  const routingEpoch = useConnectionRoutingEpoch();
  const clearAllAuthoritative = authoritativeValues.clearAll;
  useEffect(() => {
    clearAllAuthoritative();
  }, [routingEpoch, clearAllAuthoritative]);

  // Layer B: select the captured menu hierarchy for this device (or null → REST-grouped).
  // `family` is a display/labels selector only; it never gates WHICH items render — that
  // follows live `GET /v1/configs` (the fallback section catches everything unclaimed).
  const deviceInfo = status.deviceInfo;
  const family = resolveCanonicalProductFamilyCode(deviceInfo?.product ?? null) ?? "unknown";
  const firmwareVersion = deviceInfo?.firmware_version ?? null;
  const hierarchy = useMemo(() => resolveMenuMapping({ family, firmwareVersion }), [family, firmwareVersion]);

  const menuPages = useMemo(() => (hierarchy ? flattenMenuPages(hierarchy) : []), [hierarchy]);
  const filteredMenuPages = useMemo(() => {
    if (!searchQuery) return menuPages;
    const query = searchQuery.toLowerCase();
    return menuPages.filter(
      (entry) =>
        entry.page.label.toLowerCase().includes(query) || (entry.groupLabel ?? "").toLowerCase().includes(query),
    );
  }, [menuPages, searchQuery]);

  const liveCategories = categoriesData?.categories ?? [];
  // Categories whose unclaimed items smart-routing cannot place on any menu page (an
  // unknown/future category with no owner, keyword, or default). The residual Advanced
  // section renders ONLY these; when there are none it is omitted entirely (no junk drawer).
  const residualCategories = useMemo(
    () => (hierarchy ? unroutedCategories(hierarchy, family, liveCategories) : []),
    [hierarchy, family, liveCategories],
  );
  const filteredCategories = useMemo(() => {
    if (!searchQuery) return liveCategories;
    return liveCategories.filter((cat) => cat.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [liveCategories, searchQuery]);
  const pageShellClassName = usePrimaryPageShellClassName();

  return (
    <div className={pageShellClassName}>
      <AppBar title="Config">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search categories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </AppBar>

      <PageContainer size="reading">
        <PageStack className="gap-3">
          {!status.isConnected ? (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
              <p className="text-sm text-destructive font-medium">Not connected</p>
              <p className="text-xs text-muted-foreground mt-1">Configure connection in Settings</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError && !categoriesData?.categories ? (
            <div className="space-y-3 py-8 text-center text-sm text-muted-foreground" data-testid="config-load-error">
              <p>Config categories could not be loaded.</p>
              <p className="text-xs">{(error as Error | null)?.message ?? "Retry the device request."}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()} data-testid="config-retry">
                Retry
              </Button>
            </div>
          ) : hierarchy ? (
            filteredMenuPages.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No settings match your search</div>
            ) : (
              <>
                {filteredMenuPages.map((entry, index) => {
                  const focusOrder = CONFIG_CATEGORY_FOCUS_ORDER_BASE + index * CONFIG_CATEGORY_FOCUS_ORDER_STEP;
                  // The Audio Mixer page keeps the specialized renderer (solo/reset).
                  const audioMixerPage = soleRestCategory(entry.page) === "Audio Mixer";
                  return (
                    <motion.div
                      key={entry.page.label}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(index, 8) * 0.03 }}
                    >
                      {audioMixerPage ? (
                        <CategorySection
                          categoryName="Audio Mixer"
                          displayTitle={entry.page.label}
                          groupLabel={entry.groupLabel}
                          overlay={TERMINOLOGY_OVERLAY}
                          authoritativeValues={authoritativeValues}
                          onOpenChange={(isOpen) => setConfigExpanded(entry.page.label, isOpen)}
                          markChanged={markChanged}
                          focusOrder={focusOrder}
                        />
                      ) : (
                        <MenuPageSection
                          page={entry.page}
                          groupLabel={entry.groupLabel}
                          hierarchy={hierarchy}
                          family={family}
                          authoritativeValues={authoritativeValues}
                          markChanged={markChanged}
                          focusOrder={focusOrder}
                        />
                      )}
                    </motion.div>
                  );
                })}
                {residualCategories.length > 0 ? (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <AdvancedFallbackSection
                      categories={residualCategories}
                      hierarchy={hierarchy}
                      family={family}
                      authoritativeValues={authoritativeValues}
                      markChanged={markChanged}
                      focusOrder={
                        CONFIG_CATEGORY_FOCUS_ORDER_BASE +
                        (filteredMenuPages.length + 1) * CONFIG_CATEGORY_FOCUS_ORDER_STEP
                      }
                    />
                  </motion.div>
                ) : null}
              </>
            )
          ) : filteredCategories.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {searchQuery ? "No categories match your search" : "No categories available"}
            </div>
          ) : (
            filteredCategories.map((category, index) => (
              <motion.div
                key={category}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <CategorySection
                  categoryName={category}
                  overlay={TERMINOLOGY_OVERLAY}
                  authoritativeValues={authoritativeValues}
                  onOpenChange={(isOpen) => setConfigExpanded(category, isOpen)}
                  markChanged={markChanged}
                  focusOrder={CONFIG_CATEGORY_FOCUS_ORDER_BASE + index * CONFIG_CATEGORY_FOCUS_ORDER_STEP}
                />
              </motion.div>
            ))
          )}
        </PageStack>
      </PageContainer>
    </div>
  );
}
