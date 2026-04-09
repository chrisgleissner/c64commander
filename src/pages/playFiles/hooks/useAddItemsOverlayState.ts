/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AddItemsProgressState } from "@/components/itemSelection/AddItemsProgressOverlay";

type AddItemsSurface = "dialog" | "page";

const ACTIVE_PROGRESS_STATES = new Set<AddItemsProgressState["status"]>(["scanning", "ingesting", "committing"]);

export function useAddItemsOverlayState({
  browserOpen,
  addItemsProgressStatus,
}: {
  browserOpen: boolean;
  addItemsProgressStatus: AddItemsProgressState["status"];
}) {
  const [showAddItemsOverlay, setShowAddItemsOverlay] = useState(false);
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [addItemsSurface, setAddItemsSurface] = useState<AddItemsSurface>("dialog");
  const addItemsOverlayStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayActiveRef = useRef(false);
  const isImportNavigationBlocked = isAddingItems || ACTIVE_PROGRESS_STATES.has(addItemsProgressStatus);

  const handleAutoConfirmStart = useCallback(() => {
    setAddItemsSurface("page");
    setIsAddingItems(true);
    setShowAddItemsOverlay(true);
    addItemsOverlayStartedAtRef.current = Date.now();
    addItemsOverlayActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (browserOpen) {
      setAddItemsSurface("dialog");
    }
  }, [browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (!ACTIVE_PROGRESS_STATES.has(addItemsProgressStatus)) return;
    if (addItemsSurface !== "page") {
      setAddItemsSurface("page");
    }
  }, [addItemsProgressStatus, addItemsSurface, browserOpen]);

  useEffect(() => {
    if (ACTIVE_PROGRESS_STATES.has(addItemsProgressStatus)) return;
    if (addItemsSurface === "page" && isAddingItems) return;
    if (addItemsSurface !== "dialog") {
      setAddItemsSurface("dialog");
    }
  }, [addItemsProgressStatus, addItemsSurface, isAddingItems]);

  return {
    addItemsOverlayActiveRef,
    addItemsOverlayStartedAtRef,
    addItemsSurface,
    handleAutoConfirmStart,
    isAddingItems,
    isImportNavigationBlocked,
    setAddItemsSurface,
    setIsAddingItems,
    setShowAddItemsOverlay,
    showAddItemsOverlay,
  };
}
