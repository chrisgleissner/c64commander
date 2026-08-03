/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.hardware.SensorManager
import android.view.OrientationEventListener
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Reports how far the chassis is turned away from upright, so the physical keys
 * can steer the joystick the way the player is holding the handset.
 *
 * A portrait-locked activity receives no configuration change when the device is
 * turned, so neither `orientationchange` nor `Display.getRotation()` sees the
 * movement — an [OrientationEventListener] reads the accelerometer directly and
 * does. The sensor is registered only while a consumer is subscribed, so nothing
 * is spent on it when no surface is watching.
 */
@CapacitorPlugin(name = "DeviceRotation")
open class DeviceRotationPlugin : Plugin() {
  private var orientationListener: OrientationEventListener? = null

  /**
   * Whether the activity is in the foreground.
   *
   * Starts true: `load()` runs while the activity is coming up, and on some paths no
   * `handleOnResume` arrives before the first `addListener`. Starting false there would leave
   * the sensor off with a listener waiting on it, and Game Mode would never see a turn.
   */
  internal var resumed: Boolean = true
    private set

  internal var publishedRotation: Int = 0
    private set

  companion object {
    const val ROTATION_EVENT = "deviceRotation"

    /** How far past a sector boundary the chassis must travel before the value follows it. */
    const val HYSTERESIS_DEGREES = 20

    private const val SECTOR_HALF_WIDTH = 45

    private fun circularDistance(a: Int, b: Int): Int {
      val delta = ((a - b) % 360 + 360) % 360
      return min(delta, 360 - delta)
    }

    /**
     * Mirrors `quantiseRotation` in `src/lib/remoteInput/deviceRotation.ts`: the
     * same sectors and the same hysteresis band, so the native and web paths
     * cannot disagree about which orientation the handset is in.
     */
    @JvmStatic
    fun quantiseRotation(degrees: Int, previous: Int): Int {
      if (degrees == OrientationEventListener.ORIENTATION_UNKNOWN || degrees < 0) return previous
      val normalised = ((degrees % 360) + 360) % 360
      if (circularDistance(normalised, previous) <= SECTOR_HALF_WIDTH + HYSTERESIS_DEGREES) return previous
      return ((normalised / 90.0).roundToInt() % 4) * 90
    }
  }

  @PluginMethod
  fun current(call: PluginCall) {
    call.resolve(JSObject().put("rotation", publishedRotation))
  }

  @Suppress("unused")
  @PluginMethod(returnType = PluginMethod.RETURN_NONE)
  override fun addListener(call: PluginCall) {
    super.addListener(call)
    syncSensorRegistration()
  }

  @Suppress("unused")
  @PluginMethod(returnType = PluginMethod.RETURN_NONE)
  override fun removeListener(call: PluginCall) {
    super.removeListener(call)
    syncSensorRegistration()
  }

  @Suppress("unused")
  @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
  override fun removeAllListeners(call: PluginCall) {
    super.removeAllListeners(call)
    syncSensorRegistration()
  }

  /**
   * The sensor is worth its battery only while the UI can act on what it reports.
   *
   * A paused activity — backgrounded WebView, screen off — cannot: the JS listener is not
   * running, so every callback is wasted work on a session that may already be busy with
   * background playback or an HVSC scan. The rotation the app sees on resume is recomputed
   * from the first callback after the sensor comes back, so nothing is lost by stopping.
   */
  override fun handleOnPause() {
    resumed = false
    disableSensor()
    super.handleOnPause()
  }

  override fun handleOnResume() {
    super.handleOnResume()
    resumed = true
    syncSensorRegistration()
  }

  override fun handleOnDestroy() {
    disableSensor()
    super.handleOnDestroy()
  }

  internal fun syncSensorRegistration() {
    if (resumed && hasListeners(ROTATION_EVENT)) enableSensor() else disableSensor()
  }

  internal fun onOrientationDegrees(degrees: Int) {
    val next = quantiseRotation(degrees, publishedRotation)
    if (next == publishedRotation) return
    publishedRotation = next
    notifyListeners(ROTATION_EVENT, JSObject().put("rotation", next))
  }

  private fun enableSensor() {
    if (orientationListener != null) return
    val listenerContext: Context = context ?: return
    val listener =
      object : OrientationEventListener(listenerContext, SensorManager.SENSOR_DELAY_UI) {
        override fun onOrientationChanged(orientation: Int) = onOrientationDegrees(orientation)
      }
    if (!listener.canDetectOrientation()) {
      AppLogger.warn(
        listenerContext,
        "DeviceRotationPlugin",
        "Device cannot report its orientation; Game Mode falls back to the manual override",
        "DeviceRotationPlugin",
      )
      return
    }
    listener.enable()
    orientationListener = listener
  }

  private fun disableSensor() {
    orientationListener?.disable()
    orientationListener = null
  }
}
