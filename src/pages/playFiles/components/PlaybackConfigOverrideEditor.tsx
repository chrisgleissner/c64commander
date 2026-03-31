/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { ConfigItemRow } from "@/components/ConfigItemRow";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useC64Categories, useC64Category, VISIBLE_C64_QUERY_OPTIONS } from "@/hooks/useC64Connection";
import {
  groupConfigOverrides,
  removeConfigOverride,
  upsertConfigOverride,
  type ConfigValueOverride,
} from "@/lib/config/playbackConfig";
import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import type { PlaylistItem } from "@/pages/playFiles/types";

type PlaybackConfigOverrideEditorProps = {
  item: PlaylistItem;
  onChangeOverrides: (item: PlaylistItem, overrides: ConfigValueOverride[] | null) => void;
};

type CategoryItem = {
  name: string;
  value: string | number;
  options?: string[];
  details?: ReturnType<typeof normalizeConfigItem>["details"];
};

export const PlaybackConfigOverrideEditor = ({ item, onChangeOverrides }: PlaybackConfigOverrideEditorProps) => {
  const { data: categoriesData } = useC64Categories(VISIBLE_C64_QUERY_OPTIONS);
  const categories = categoriesData?.categories ?? [];
  const groupedOverrides = useMemo(() => groupConfigOverrides(item.configOverrides ?? null), [item.configOverrides]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedItemName, setSelectedItemName] = useState<string>("");
  const { data: categoryData, isLoading: categoryLoading } = useC64Category(
    selectedCategory,
    Boolean(selectedCategory),
    VISIBLE_C64_QUERY_OPTIONS,
  );

  const categoryItems = useMemo(() => {
    if (!selectedCategory || !categoryData) return [] as CategoryItem[];
    const categoryBlock = categoryData[selectedCategory] as { items?: Record<string, unknown> } | undefined;
    const itemsBlock = categoryBlock?.items ?? (categoryBlock as Record<string, unknown> | undefined);
    if (!itemsBlock || typeof itemsBlock !== "object") return [] as CategoryItem[];
    return Object.entries(itemsBlock)
      .filter(([name]) => name !== "errors")
      .map(([name, config]) => ({
        name,
        ...normalizeConfigItem(config),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [categoryData, selectedCategory]);

  useEffect(() => {
    if (!categories.length) return;
    if (selectedCategory && categories.includes(selectedCategory)) return;
    const firstOverrideCategory = item.configOverrides?.[0]?.category;
    setSelectedCategory(
      firstOverrideCategory && categories.includes(firstOverrideCategory) ? firstOverrideCategory : categories[0],
    );
  }, [categories, item.configOverrides, selectedCategory]);

  useEffect(() => {
    if (!categoryItems.length) {
      setSelectedItemName("");
      return;
    }
    if (selectedItemName && categoryItems.some((entry) => entry.name === selectedItemName)) return;
    const firstOverrideItem = item.configOverrides?.find((override) => override.category === selectedCategory)?.item;
    setSelectedItemName(
      firstOverrideItem && categoryItems.some((entry) => entry.name === firstOverrideItem)
        ? firstOverrideItem
        : (categoryItems[0]?.name ?? ""),
    );
  }, [categoryItems, item.configOverrides, selectedCategory, selectedItemName]);

  const selectedItem = useMemo(
    () => categoryItems.find((entry) => entry.name === selectedItemName) ?? null,
    [categoryItems, selectedItemName],
  );
  const selectedOverride = useMemo(
    () =>
      (item.configOverrides ?? []).find(
        (override) => override.category === selectedCategory && override.item === selectedItemName,
      ) ?? null,
    [item.configOverrides, selectedCategory, selectedItemName],
  );
  const [pendingValue, setPendingValue] = useState<string | number>(
    selectedOverride?.value ?? selectedItem?.value ?? "",
  );

  useEffect(() => {
    setPendingValue(selectedOverride?.value ?? selectedItem?.value ?? "");
  }, [selectedItem, selectedOverride]);

  const handleSaveOverride = () => {
    if (!selectedCategory || !selectedItemName) return;
    onChangeOverrides(
      item,
      upsertConfigOverride(item.configOverrides ?? null, {
        category: selectedCategory,
        item: selectedItemName,
        value: pendingValue,
      }),
    );
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card/60 p-3">
      <div>
        <div className="text-sm font-medium text-foreground">Value overrides</div>
        <div className="text-xs text-muted-foreground">
          Apply item-specific playback config edits without changing the original .cfg file.
        </div>
      </div>

      {Object.keys(groupedOverrides).length ? (
        <div className="space-y-2">
          {Object.entries(groupedOverrides)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([category, overrides]) => (
              <div key={category} className="rounded-md border border-border px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{category}</div>
                <div className="mt-2 space-y-2">
                  {overrides.map((override) => (
                    <div
                      key={`${override.category}:${override.item}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() => {
                          setSelectedCategory(override.category);
                          setSelectedItemName(override.item);
                        }}
                      >
                        <div className="text-sm text-foreground">{override.item}</div>
                        <div className="text-xs text-muted-foreground">{String(override.value)}</div>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onChangeOverrides(
                            item,
                            removeConfigOverride(item.configOverrides ?? null, {
                              category: override.category,
                              item: override.item,
                            }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          No overrides yet. Choose a category and item below to add one.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="playback-config-override-category">Category</Label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger id="playback-config-override-category">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="playback-config-override-item">Item</Label>
          <Select
            value={selectedItemName}
            onValueChange={setSelectedItemName}
            disabled={!selectedCategory || !categoryItems.length}
          >
            <SelectTrigger id="playback-config-override-item">
              <SelectValue placeholder={categoryLoading ? "Loading items…" : "Select item"} />
            </SelectTrigger>
            <SelectContent>
              {categoryItems.map((entry) => (
                <SelectItem key={entry.name} value={entry.name}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedItem ? (
        <div className="space-y-3 rounded-md border border-border px-3 py-3">
          <ConfigItemRow
            category={selectedCategory}
            name={selectedItem.name}
            value={pendingValue}
            options={selectedItem.options}
            details={selectedItem.details}
            onValueChange={setPendingValue}
            className="border-0 p-0"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleSaveOverride} disabled={!selectedCategory || !selectedItemName}>
              {selectedOverride ? "Update override" : "Add override"}
            </Button>
            {selectedOverride ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onChangeOverrides(
                    item,
                    removeConfigOverride(item.configOverrides ?? null, {
                      category: selectedOverride.category,
                      item: selectedOverride.item,
                    }),
                  )
                }
              >
                Clear override
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
};
