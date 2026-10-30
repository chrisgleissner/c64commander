# Variant configuration

`variants/variants.yaml` declares each edition of the app. `scripts/generate-variant.mjs` validates it and
writes `src/generated/variant.json`, `src/generated/variant.ts` and the web server copy. The generated
files are checked in; `npm run variant:check` fails when they differ from the YAML.

## Key labels (`runtime.key_labels`)

The physical keys of a handset do not always carry the names the app uses for them. The keypad edition has
two unlabeled soft keys under the screen, for example, and no key called Back or Menu. `runtime.key_labels`
sets the names the in-app guide, the generated manual and the keypad guidance bar use. It changes text only.
Which key does what is decided elsewhere and is not affected.

All fields are optional. Each missing field takes the generic value in the table. Every value is a non-empty
string of at most 24 characters. An unknown field name fails generation.

| Field         | Used by                                          | Generic default |
| ------------- | ------------------------------------------------ | --------------- |
| `left_soft`   | Guide and manual: the key that leaves or closes  | `Back key`      |
| `center`      | Manual: the key that goes in or presses          | `OK`            |
| `right_soft`  | Guide and manual: the key that opens the menu    | `Menu key`      |
| `left_cap`    | Guidance bar: the chip drawn for the left key    | `Back`          |
| `center_cap`  | Guidance bar: the chip drawn for the center key  | `OK`            |
| `right_cap`   | Guidance bar: the chip drawn for the right key   | `Menu`          |
| `back_word`   | Guidance bar: the left key at a page root        | `Back`          |
| `close_word`  | Guidance bar: the left key in a dialog or menu   | `Close`         |
| `menu_word`   | Guidance bar: the right key when a menu exists   | `Menu`          |
| `delete_word` | Guidance bar and manual: the right key in a field | `Delete`        |

The `c64u-remote` entry in `variants.yaml` sets all ten explicitly (`Left Soft Key`, `D-pad Center / OK`,
`Right Soft Key`, and the generic caps and words), which is the text the keypad manual has always used.

In code, read the labels through `getKeyLabels()` in `src/lib/variant/keyLabels.ts`. The manual generator
reads the same values from the parsed `variants.yaml`. After changing a label, run
`node scripts/generate-variant.mjs` and `npm run manuals:build` and commit the results.

### Overriding labels from a downstream build

A repository that builds the app from this one, such as the c64u-remote-dist release repository, can set
labels without editing `variants.yaml`. Point `APP_KEY_LABELS_FILE` at a YAML file that maps a variant id
to the fields to replace:

```yaml
# brand/key-labels.yaml
c64u-remote:
  left_soft: Soft Left
  right_soft: Soft Right
  center: Select
```

```bash
APP_KEY_LABELS_FILE=$PWD/brand/key-labels.yaml APP_VARIANT=c64u-remote npm run variant:generate
APP_KEY_LABELS_FILE=$PWD/brand/key-labels.yaml npm run manuals:build
```

The file is validated by the same rules as `variants.yaml`. A variant id that does not exist fails.

## Start-up mode (`runtime.startup_mode`)

`runtime.startup_mode` selects what the app does at launch: `default` (search for a device, as always), `demo`
(Demo Mode without a search) or `sid-player` (SID Player, no device traffic). Absent means `default`. The value
is only the initial one: a choice the user makes in the app is stored on the phone and wins. The field is
independent of the edition, so any edition can start in any mode. It is read in one place,
`src/lib/appMode/appModeStore.ts`.
