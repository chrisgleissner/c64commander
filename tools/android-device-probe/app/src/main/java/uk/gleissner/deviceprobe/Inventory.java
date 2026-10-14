package uk.gleissner.deviceprobe;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.FeatureInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.AudioFormat;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONObject;

/** Public Android API inventory. A denied query is recorded as an error, never as absence. */
final class Inventory {
    interface Query { Object read() throws Exception; }

    static JSONObject object(Object... pairs) {
        JSONObject result = new JSONObject();
        try {
            for (int i = 0; i < pairs.length; i += 2) {
                result.put((String) pairs[i], pairs[i + 1] == null ? JSONObject.NULL : pairs[i + 1]);
            }
        } catch (Exception error) { throw new IllegalArgumentException("Cannot encode probe record", error); }
        return result;
    }

    private static void section(JSONObject report, String name, Query query) {
        try { report.put(name, query.read()); }
        catch (Exception error) {
            Log.e("DeviceProbe", "Inventory query failed: " + name, error);
            try { report.put(name, object("status", "error", "exception", error.toString())); }
            catch (Exception encodingError) { throw new IllegalStateException("Cannot record failed " + name, encodingError); }
        }
    }

    static JSONObject collect(Activity activity) {
        JSONObject report = object("schemaVersion", 1, "collectedAtMs", System.currentTimeMillis(),
            "scope", "Android compatibility environment; hardware claims require physical verification");
        section(report, "build", () -> object("manufacturer", Build.MANUFACTURER, "model", Build.MODEL,
            "device", Build.DEVICE, "product", Build.PRODUCT, "hardware", Build.HARDWARE,
            "release", Build.VERSION.RELEASE, "sdk", Build.VERSION.SDK_INT,
            "securityPatch", Build.VERSION.SECURITY_PATCH, "fingerprint", Build.FINGERPRINT,
            "abis", new JSONArray(Arrays.asList(Build.SUPPORTED_ABIS)),
            "probeVersion", activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName));
        section(report, "display", () -> {
            Display display = activity.getWindowManager().getDefaultDisplay();
            DisplayMetrics real = new DisplayMetrics(); display.getRealMetrics(real);
            DisplayMetrics app = activity.getResources().getDisplayMetrics();
            JSONArray modes = new JSONArray();
            for (Display.Mode mode : display.getSupportedModes()) {
                modes.put(object("id", mode.getModeId(), "width", mode.getPhysicalWidth(),
                    "height", mode.getPhysicalHeight(), "refreshHz", mode.getRefreshRate()));
            }
            Configuration config = activity.getResources().getConfiguration();
            return object("realWidthPx", real.widthPixels, "realHeightPx", real.heightPixels,
                "appWidthPx", app.widthPixels, "appHeightPx", app.heightPixels,
                "densityDpi", app.densityDpi, "density", app.density, "scaledDensity", app.scaledDensity,
                "xdpi", real.xdpi, "ydpi", real.ydpi, "fontScale", config.fontScale,
                "widthDp", config.screenWidthDp, "heightDp", config.screenHeightDp,
                "smallestWidthDp", config.smallestScreenWidthDp, "rotation", display.getRotation(),
                "orientation", config.orientation, "keyboard", config.keyboard,
                "keyboardHidden", config.keyboardHidden, "hardKeyboardHidden", config.hardKeyboardHidden,
                "navigation", config.navigation, "touchscreen", config.touchscreen,
                "locales", config.getLocales().toLanguageTags(), "uiMode", config.uiMode, "modes", modes);
        });
        section(report, "features", () -> {
            JSONArray array = new JSONArray();
            for (FeatureInfo feature : activity.getPackageManager().getSystemAvailableFeatures()) {
                array.put(object("name", feature.name, "version", feature.version,
                    "requiredGlEsVersion", feature.reqGlEsVersion));
            }
            return array;
        });
        section(report, "input", () -> {
            JSONArray devices = new JSONArray();
            for (int id : InputDevice.getDeviceIds()) {
                InputDevice device = InputDevice.getDevice(id);
                if (device == null) continue;
                JSONArray ranges = new JSONArray();
                for (InputDevice.MotionRange range : device.getMotionRanges()) {
                    ranges.put(object("axis", range.getAxis(), "source", range.getSource(),
                        "min", range.getMin(), "max", range.getMax(), "flat", range.getFlat(),
                        "fuzz", range.getFuzz(), "resolution", range.getResolution()));
                }
                int[] keys = new int[KeyEvent.getMaxKeyCode() + 1];
                for (int i = 0; i < keys.length; i++) keys[i] = i;
                boolean[] supported = device.hasKeys(keys);
                JSONArray names = new JSONArray();
                for (int i = 0; i < keys.length; i++) if (supported[i]) names.put(KeyEvent.keyCodeToString(i));
                devices.put(object("id", id, "name", device.getName(), "descriptor", device.getDescriptor(),
                    "vendorId", device.getVendorId(), "productId", device.getProductId(),
                    "sources", device.getSources(), "keyboardType", device.getKeyboardType(),
                    "virtual", device.isVirtual(), "external", Build.VERSION.SDK_INT >= 29 ? device.isExternal() : null,
                    "motionRanges", ranges, "advertisedKeys", names));
            }
            InputMethodManager manager = (InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
            JSONArray methods = new JSONArray();
            for (InputMethodInfo method : manager.getEnabledInputMethodList()) {
                methods.put(object("id", method.getId(), "package", method.getPackageName()));
            }
            return object("devices", devices, "enabledInputMethods", methods,
                "defaultInputMethod", android.provider.Settings.Secure.getString(activity.getContentResolver(), "default_input_method"));
        });
        section(report, "memory", () -> {
            ActivityManager manager = (ActivityManager) activity.getSystemService(Activity.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo(); manager.getMemoryInfo(info);
            return object("totalBytes", info.totalMem, "availableBytes", info.availMem,
                "lowMemory", info.lowMemory, "thresholdBytes", info.threshold,
                "memoryClassMb", manager.getMemoryClass(), "largeMemoryClassMb", manager.getLargeMemoryClass(),
                "lowRamDevice", manager.isLowRamDevice(), "cpuCount", Runtime.getRuntime().availableProcessors(),
                "maxHeapBytes", Runtime.getRuntime().maxMemory());
        });
        section(report, "cpu", () -> new String(Files.readAllBytes(Paths.get("/proc/cpuinfo")), java.nio.charset.StandardCharsets.UTF_8));
        section(report, "storage", () -> {
            StatFs data = new StatFs(activity.getFilesDir().getAbsolutePath());
            JSONArray external = new JSONArray();
            for (java.io.File directory : activity.getExternalFilesDirs(null)) {
                if (directory != null) {
                    StatFs fs = new StatFs(directory.getAbsolutePath());
                    external.put(object("path", directory.toString(), "totalBytes", fs.getTotalBytes(),
                        "availableBytes", fs.getAvailableBytes(), "removable", android.os.Environment.isExternalStorageRemovable(directory)));
                }
            }
            return object("privateTotalBytes", data.getTotalBytes(), "privateAvailableBytes", data.getAvailableBytes(),
                "externalVolumes", external,
                "folderPickerAvailable", new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).resolveActivity(activity.getPackageManager()) != null,
                "filePickerAvailable", new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").resolveActivity(activity.getPackageManager()) != null);
        });
        section(report, "sensors", () -> {
            JSONArray sensors = new JSONArray();
            SensorManager manager = (SensorManager) activity.getSystemService(Activity.SENSOR_SERVICE);
            for (Sensor sensor : manager.getSensorList(Sensor.TYPE_ALL)) {
                sensors.put(object("name", sensor.getName(), "vendor", sensor.getVendor(), "type", sensor.getStringType(),
                    "version", sensor.getVersion(), "range", sensor.getMaximumRange(), "resolution", sensor.getResolution(),
                    "powerMa", sensor.getPower(), "minDelayUs", sensor.getMinDelay(), "wakeUp", sensor.isWakeUpSensor()));
            }
            return sensors;
        });
        section(report, "audio", () -> {
            AudioManager manager = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
            JSONArray devices = new JSONArray();
            for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_INPUTS | AudioManager.GET_DEVICES_OUTPUTS)) {
                devices.put(object("id", device.getId(), "name", device.getProductName().toString(),
                    "type", device.getType(), "source", device.isSource(), "sink", device.isSink(),
                    "sampleRates", new JSONArray(device.getSampleRates()),
                    "channelCounts", new JSONArray(device.getChannelCounts()), "encodings", new JSONArray(device.getEncodings())));
            }
            JSONArray buffers = new JSONArray();
            for (int hz : new int[]{22050, 44100, 48000}) buffers.put(object("hz", hz,
                "stereoPcm16MinBufferBytes", AudioTrack.getMinBufferSize(hz, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)));
            return object("outputSampleRate", manager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE),
                "outputFramesPerBuffer", manager.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER),
                "musicVolume", manager.getStreamVolume(AudioManager.STREAM_MUSIC),
                "musicMaxVolume", manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC),
                "devices", devices, "bufferQueries", buffers, "audibleTestPerformed", false);
        });
        section(report, "codecs", () -> {
            JSONArray codecs = new JSONArray();
            for (MediaCodecInfo codec : new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos()) {
                codecs.put(object("name", codec.getName(), "encoder", codec.isEncoder(),
                    "types", new JSONArray(Arrays.asList(codec.getSupportedTypes()))));
            }
            return codecs;
        });
        section(report, "network", () -> {
            ConnectivityManager manager = (ConnectivityManager) activity.getSystemService(Activity.CONNECTIVITY_SERVICE);
            JSONArray networks = new JSONArray();
            for (Network network : manager.getAllNetworks()) {
                NetworkCapabilities cap = manager.getNetworkCapabilities(network);
                LinkProperties link = manager.getLinkProperties(network);
                networks.put(object("id", network.toString(), "capabilities", cap == null ? null : cap.toString(),
                    "interface", link == null ? null : link.getInterfaceName(),
                    "addresses", link == null ? null : link.getLinkAddresses().toString(),
                    "dns", link == null ? null : link.getDnsServers().toString(),
                    "routes", link == null ? null : link.getRoutes().toString(),
                    "mtu", link == null || Build.VERSION.SDK_INT < 29 ? null : link.getMtu()));
            }
            return object("activeNetwork", String.valueOf(manager.getActiveNetwork()), "networks", networks,
                "activeMetered", manager.isActiveNetworkMetered(), "restrictBackgroundStatus", manager.getRestrictBackgroundStatus());
        });
        section(report, "power", () -> {
            Intent battery = activity.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            PowerManager manager = (PowerManager) activity.getSystemService(Activity.POWER_SERVICE);
            return object("powerSave", manager.isPowerSaveMode(), "interactive", manager.isInteractive(),
                "deviceIdle", manager.isDeviceIdleMode(), "ignoringBatteryOptimizations", manager.isIgnoringBatteryOptimizations(activity.getPackageName()),
                "batteryLevel", battery == null ? null : battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
                "batteryScale", battery == null ? null : battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
                "temperatureTenthsC", battery == null ? null : battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1),
                "plugged", battery == null ? null : battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1));
        });
        section(report, "webview", () -> {
            android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
            return info == null ? object("status", "unavailable") : object("package", info.packageName, "version", info.versionName);
        });
        return report;
    }
}
