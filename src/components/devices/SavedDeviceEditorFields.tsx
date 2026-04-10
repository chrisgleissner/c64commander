import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizeSavedDevicePortInput, type SavedDeviceEditorDraft } from "@/lib/savedDevices/deviceEditor";

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
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-sm">
          Device name
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="Defaults to the detected device type"
          className="font-sans"
          aria-describedby={nameError ? `${idPrefix}-name-error` : `${idPrefix}-name-help`}
          aria-invalid={nameError ? true : undefined}
        />
        {nameError ? (
          <p id={`${idPrefix}-name-error`} className="text-xs text-destructive" role="alert">
            {nameError}
          </p>
        ) : (
          <p id={`${idPrefix}-name-help`} className="text-xs text-muted-foreground">
            Leave blank to use the detected device type, with a suffix added automatically for duplicates.
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
          onChange={(event) => onChange({ ...draft, host: event.target.value })}
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
