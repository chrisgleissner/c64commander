import { useCallback, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { useT9Input } from "@/hooks/useT9Input";
import { getInputModality, subscribeInputModality, type T9Mode } from "@/lib/input";
import {
  MAX_SAVED_DEVICE_NAME_LENGTH,
  applySavedDeviceDraftHostInput,
  applySavedDeviceDraftNameInput,
  sanitizeSavedDevicePortInput,
  type SavedDeviceEditorDraft,
} from "@/lib/savedDevices/deviceEditor";

type Props = {
  draft: SavedDeviceEditorDraft;
  onChange: (draft: SavedDeviceEditorDraft) => void;
  nameError?: string | null;
  hostError?: string | null;
  portError?: string | null;
  idPrefix: string;
  hostLabel?: string;
  hostHint?: string | null;
  onHostBlur?: (value: string) => void;
  /**
   * Calm, non-invasive hint shown when the entered hostname could not be reached but
   * the device was found on the LAN at this IP. Tapping the action fills in the IP.
   */
  reachabilitySuggestion?: { address: string } | null;
  onUseSuggestedAddress?: (address: string) => void;
  /**
   * Enables the physical T9 / keypad composer on the name and host fields.
   * Off by default so hardware keyboards insert literal letters and digits.
   */
  keypadInput?: boolean;
};

const useInputModalitySnapshot = () => useSyncExternalStore(subscribeInputModality, getInputModality, getInputModality);

function T9ModeIndicator({
  enabled,
  mode,
  testId,
  visible,
}: {
  readonly enabled: boolean;
  readonly mode: T9Mode;
  readonly testId: string;
  readonly visible: boolean;
}) {
  const modality = useInputModalitySnapshot();
  if (!enabled || !visible || modality !== "key-navigation") return null;
  return (
    <span
      className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      data-testid={testId}
    >
      T9 {mode === "hostname" ? "Hostname" : "Multitap"} · #
    </span>
  );
}

const useFieldFocusTarget = (id: string, order: number, group: string) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useFocusItem<HTMLDivElement>({
    id,
    order,
    group,
    onActivate: () => inputRef.current?.focus(),
  });
  const setFrameRef = useCallback(
    (element: HTMLDivElement | null) => {
      frameRef.current = element;
      focusRef(element);
    },
    [focusRef],
  );
  const blurToFrame = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.currentTarget.blur();
    frameRef.current?.focus();
  }, []);
  return { inputRef, setFrameRef, blurToFrame };
};

export function SavedDeviceEditorFields({
  draft,
  onChange,
  nameError = null,
  hostError = null,
  portError = null,
  idPrefix,
  hostLabel = "Host",
  hostHint = null,
  onHostBlur,
  reachabilitySuggestion = null,
  onUseSuggestedAddress,
  keypadInput = false,
}: Props) {
  const [activeT9Field, setActiveT9Field] = useState<"name" | "host" | null>(null);
  // Physical T9 / keypad fallback so the device name and host/IP can be entered
  // without the on-screen keyboard (for keypad-first devices).
  // The host field uses "hostname" mode (digits insert directly; star inserts
  // separators like "." and ":"); the name field uses multi-tap text mode.
  // Inert unless `keypadInput` is enabled — every key then passes through.
  const nameT9 = useT9Input({
    value: draft.name,
    setValue: (next) => onChange(applySavedDeviceDraftNameInput(draft, next)),
    mode: "multitap",
    enabled: keypadInput,
  });
  const hostT9 = useT9Input({
    value: draft.host,
    setValue: (next) => onChange(applySavedDeviceDraftHostInput(draft, next)),
    mode: "hostname",
    enabled: keypadInput,
  });
  const focusGroup = `${idPrefix}-fields`;
  const nameFocus = useFieldFocusTarget(`${idPrefix}-name-field`, 200, focusGroup);
  const hostFocus = useFieldFocusTarget(`${idPrefix}-host-field`, 201, focusGroup);
  const httpFocus = useFieldFocusTarget(`${idPrefix}-http-field`, 202, focusGroup);
  const ftpFocus = useFieldFocusTarget(`${idPrefix}-ftp-field`, 203, focusGroup);
  const telnetFocus = useFieldFocusTarget(`${idPrefix}-telnet-field`, 204, focusGroup);
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    nameT9.onKeyDown(event);
    if (!event.defaultPrevented) nameFocus.blurToFrame(event);
  };
  const handleHostKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    hostT9.onKeyDown(event);
    if (!event.defaultPrevented) hostFocus.blurToFrame(event);
  };
  return (
    <div className="space-y-3">
      <div
        ref={nameFocus.setFrameRef}
        tabIndex={-1}
        className="space-y-2 rounded-md outline-none"
        data-testid={`${idPrefix}-name-field`}
      >
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-name`} className="text-sm">
            Device name
          </Label>
          <T9ModeIndicator
            enabled={keypadInput}
            mode={nameT9.mode}
            testId={`${idPrefix}-name-t9-mode`}
            visible={activeT9Field === "name"}
          />
          {draft.nameSource === "INFERRED" ? (
            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Auto
            </span>
          ) : null}
        </div>
        <Input
          ref={nameFocus.inputRef}
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(event) => onChange(applySavedDeviceDraftNameInput(draft, event.target.value))}
          onKeyDown={handleNameKeyDown}
          onFocus={() => setActiveT9Field("name")}
          onBlur={() => setActiveT9Field(null)}
          placeholder="Defaults to the current host"
          className="font-sans"
          maxLength={MAX_SAVED_DEVICE_NAME_LENGTH}
          aria-describedby={nameError ? `${idPrefix}-name-error` : `${idPrefix}-name-help`}
          aria-invalid={nameError ? true : undefined}
        />
        {nameError ? (
          <p id={`${idPrefix}-name-error`} className="text-xs text-destructive" role="alert">
            {nameError}
          </p>
        ) : (
          <p id={`${idPrefix}-name-help`} className="text-xs text-muted-foreground">
            Clear to follow the host. Max 10 characters.
          </p>
        )}
      </div>

      <div
        ref={hostFocus.setFrameRef}
        tabIndex={-1}
        className="space-y-2 rounded-md outline-none"
        data-testid={`${idPrefix}-host-field`}
      >
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-host`} className="text-sm">
            {hostLabel}
          </Label>
          <T9ModeIndicator
            enabled={keypadInput}
            mode={hostT9.mode}
            testId={`${idPrefix}-host-t9-mode`}
            visible={activeT9Field === "host"}
          />
        </div>
        <Input
          ref={hostFocus.inputRef}
          id={`${idPrefix}-host`}
          value={draft.host}
          onChange={(event) => onChange(applySavedDeviceDraftHostInput(draft, event.target.value))}
          onKeyDown={handleHostKeyDown}
          onFocus={() => setActiveT9Field("host")}
          onBlur={(event) => {
            setActiveT9Field(null);
            onHostBlur?.(event.target.value);
          }}
          className="font-sans"
          aria-describedby={hostError ? `${idPrefix}-host-error` : hostHint ? `${idPrefix}-host-help` : undefined}
          aria-invalid={hostError ? true : undefined}
          data-testid={`${idPrefix}-host`}
        />
        {hostError ? (
          <p id={`${idPrefix}-host-error`} className="text-xs text-destructive" role="alert">
            {hostError}
          </p>
        ) : hostHint ? (
          <p id={`${idPrefix}-host-help`} className="text-xs text-muted-foreground">
            {hostHint}
          </p>
        ) : null}

        {reachabilitySuggestion ? (
          <div
            className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5"
            data-testid={`${idPrefix}-reachability-suggestion`}
            role="status"
          >
            <p className="text-xs text-muted-foreground">
              We couldn’t reach “{draft.host.trim()}”, but we found your device on this network at{" "}
              <span className="font-medium text-foreground">{reachabilitySuggestion.address}</span>. Use that address?
            </p>
            <button
              type="button"
              onClick={() => onUseSuggestedAddress?.(reachabilitySuggestion.address)}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`${idPrefix}-use-suggested-address`}
            >
              Use {reachabilitySuggestion.address}
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          <div
            ref={httpFocus.setFrameRef}
            tabIndex={-1}
            className="space-y-1 rounded-md outline-none"
            data-testid={`${idPrefix}-http-field`}
          >
            <Label htmlFor={`${idPrefix}-http`} className="text-xs text-muted-foreground">
              HTTP Port
            </Label>
            <Input
              ref={httpFocus.inputRef}
              id={`${idPrefix}-http`}
              inputMode="numeric"
              value={draft.httpPort}
              onChange={(event) => onChange({ ...draft, httpPort: sanitizeSavedDevicePortInput(event.target.value) })}
              onKeyDown={httpFocus.blurToFrame}
              className="font-sans"
              data-testid={`${idPrefix}-http`}
            />
          </div>
          <div
            ref={ftpFocus.setFrameRef}
            tabIndex={-1}
            className="space-y-1 rounded-md outline-none"
            data-testid={`${idPrefix}-ftp-field`}
          >
            <Label htmlFor={`${idPrefix}-ftp`} className="text-xs text-muted-foreground">
              FTP Port
            </Label>
            <Input
              ref={ftpFocus.inputRef}
              id={`${idPrefix}-ftp`}
              inputMode="numeric"
              value={draft.ftpPort}
              onChange={(event) => onChange({ ...draft, ftpPort: sanitizeSavedDevicePortInput(event.target.value) })}
              onKeyDown={ftpFocus.blurToFrame}
              className="font-sans"
              data-testid={`${idPrefix}-ftp`}
            />
          </div>
          <div
            ref={telnetFocus.setFrameRef}
            tabIndex={-1}
            className="space-y-1 rounded-md outline-none"
            data-testid={`${idPrefix}-telnet-field`}
          >
            <Label htmlFor={`${idPrefix}-telnet`} className="text-xs text-muted-foreground">
              Telnet Port
            </Label>
            <Input
              ref={telnetFocus.inputRef}
              id={`${idPrefix}-telnet`}
              inputMode="numeric"
              value={draft.telnetPort}
              onChange={(event) => onChange({ ...draft, telnetPort: sanitizeSavedDevicePortInput(event.target.value) })}
              onKeyDown={telnetFocus.blurToFrame}
              className="font-sans"
              data-testid={`${idPrefix}-telnet`}
            />
          </div>
        </div>
        {portError ? (
          <p className="text-xs text-destructive" role="alert">
            {portError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
