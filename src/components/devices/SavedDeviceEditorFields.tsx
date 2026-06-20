import { useCallback, useRef, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFocusItem } from "@/hooks/useFocusNavigation";
import { useT9Input } from "@/hooks/useT9Input";
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
   * Enables the physical T9 / keypad composer on the name and host fields.
   * Off by default so hardware keyboards insert literal letters and digits.
   */
  keypadInput?: boolean;
};

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
  keypadInput = false,
}: Props) {
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
        <Label htmlFor={`${idPrefix}-host`} className="text-sm">
          {hostLabel}
        </Label>
        <Input
          ref={hostFocus.inputRef}
          id={`${idPrefix}-host`}
          value={draft.host}
          onChange={(event) => onChange(applySavedDeviceDraftHostInput(draft, event.target.value))}
          onKeyDown={handleHostKeyDown}
          onBlur={(event) => onHostBlur?.(event.target.value)}
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
