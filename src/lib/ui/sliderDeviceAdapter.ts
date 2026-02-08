/**
 * Centralized slider-to-device adapter.
 *
 * Ensures:
 * - `onValueChange` updates local UI state immediately (synchronous)
 * - During movement, fires best-effort async REST updates (non-blocking)
 * - On release (`onValueCommit`), guarantees a final REST update
 *
 * All handler functions returned are synchronous — they enqueue async work
 * but never block the pointer/render thread.
 */

type ApplyFn = (value: number) => void;

export type SliderDeviceAdapterOptions = {
  /** Synchronous callback to update local UI state. */
  setLocalValue: (value: number) => void;
  /** Async function to apply value to device (REST call). Fire-and-forget. */
  applyToDevice: ApplyFn;
  /** Optional transform before applying (e.g., snapping, clamping). */
  transform?: (value: number) => number;
};

export type SliderDeviceAdapter = {
  /** Call from onValueChange — updates UI, enqueues best-effort REST. */
  onChange: (rawValue: number) => void;
  /** Call from onValueCommit — guarantees final REST with committed value. */
  onCommit: (rawValue: number) => void;
};

/**
 * Creates a slider adapter that decouples UI updates from REST calls.
 *
 * Usage:
 * ```ts
 * const adapter = createSliderDeviceAdapter({
 *   setLocalValue: (v) => setDraft(v),
 *   applyToDevice: (v) => void updateConfigValue(..., v, ...),
 *   transform: (v) => clamp(v, 0, max),
 * });
 * // In JSX:
 * <Slider onValueChange={vals => adapter.onChange(vals[0])}
 *         onValueCommit={vals => adapter.onCommit(vals[0])} />
 * ```
 */
export const createSliderDeviceAdapter = (options: SliderDeviceAdapterOptions): SliderDeviceAdapter => {
  const { setLocalValue, applyToDevice, transform } = options;
  let pendingApply = false;
  let latestValue: number | null = null;

  const scheduleApply = (value: number) => {
    latestValue = value;
    if (pendingApply) return;
    pendingApply = true;
    queueMicrotask(() => {
      pendingApply = false;
      const v = latestValue;
      if (v !== null) {
        latestValue = null;
        applyToDevice(v);
      }
    });
  };

  return {
    onChange(rawValue: number) {
      const value = transform ? transform(rawValue) : rawValue;
      setLocalValue(value);
      scheduleApply(value);
    },
    onCommit(rawValue: number) {
      const value = transform ? transform(rawValue) : rawValue;
      // Cancel any pending intermediate apply
      latestValue = null;
      pendingApply = false;
      setLocalValue(value);
      applyToDevice(value);
    },
  };
};
