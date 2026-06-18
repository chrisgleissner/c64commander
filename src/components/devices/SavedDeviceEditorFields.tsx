import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
}: Props) {
  // Physical T9 / keypad fallback so the device name and host/IP can be entered
  // without the on-screen keyboard (Commodore Callback 8020 is keypad-first).
  // The host field uses "hostname" mode (digits insert directly; star inserts
  // separators like "." and ":"); the name field uses multi-tap text mode.
  const nameT9 = useT9Input({
    value: draft.name,
    setValue: (next) => onChange(applySavedDeviceDraftNameInput(draft, next)),
    mode: "multitap",
  });
  const hostT9 = useT9Input({
    value: draft.host,
    setValue: (next) => onChange(applySavedDeviceDraftHostInput(draft, next)),
    mode: "hostname",
  });
  return (
    <div className="space-y-3">
      <div className="space-y-2">
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
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(event) => onChange(applySavedDeviceDraftNameInput(draft, event.target.value))}
          onKeyDown={nameT9.onKeyDown}
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

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-host`} className="text-sm">
          {hostLabel}
        </Label>
        <Input
          id={`${idPrefix}-host`}
          value={draft.host}
          onChange={(event) => onChange(applySavedDeviceDraftHostInput(draft, event.target.value))}
          onKeyDown={hostT9.onKeyDown}
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
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-http`} className="text-xs text-muted-foreground">
              HTTP Port
            </Label>
            <Input
              id={`${idPrefix}-http`}
              inputMode="numeric"
              value={draft.httpPort}
              onChange={(event) => onChange({ ...draft, httpPort: sanitizeSavedDevicePortInput(event.target.value) })}
              className="font-sans"
              data-testid={`${idPrefix}-http`}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-ftp`} className="text-xs text-muted-foreground">
              FTP Port
            </Label>
            <Input
              id={`${idPrefix}-ftp`}
              inputMode="numeric"
              value={draft.ftpPort}
              onChange={(event) => onChange({ ...draft, ftpPort: sanitizeSavedDevicePortInput(event.target.value) })}
              className="font-sans"
              data-testid={`${idPrefix}-ftp`}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-telnet`} className="text-xs text-muted-foreground">
              Telnet Port
            </Label>
            <Input
              id={`${idPrefix}-telnet`}
              inputMode="numeric"
              value={draft.telnetPort}
              onChange={(event) => onChange({ ...draft, telnetPort: sanitizeSavedDevicePortInput(event.target.value) })}
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
