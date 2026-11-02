/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log

/**
 * The Wi-Fi locks a Live View stream holds while it runs: one that stops the driver filtering
 * multicast, and one that asks Wi-Fi to stop batching real-time packets.
 */
internal class StreamWifiLocks(private val context: Context) {
  private val logTag = "StreamWifiLocks"
  private var multicastLock: WifiManager.MulticastLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  private fun wifiManager(): WifiManager? =
      try {
        context.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      } catch (error: Exception) {
        Log.w(logTag, "WifiManager unavailable", error)
        null
      }

  /** Both locks, for a stream joining a multicast group. */
  fun acquireForMulticast() {
    // Independently, both of them: the mirror binds two streams, and guarding the pair behind one
    // "already held" check meant the second lock was silently skipped whenever the first was up.
    if (multicastLock?.isHeld != true) {
      try {
        multicastLock =
          wifiManager()?.createMulticastLock("c64commander-avmirror")?.apply {
            setReferenceCounted(false)
            acquire()
          }
      } catch (error: Exception) {
        Log.w(logTag, "MulticastLock acquire failed", error)
      }
    }
    acquireLowLatency()
  }

  /**
   * Ask Wi-Fi to stop batching our packets for the duration of the mirror.
   *
   * A `MulticastLock` only stops the driver *filtering* multicast; it says nothing about when the
   * packets are handed up. In power-save the chip parks multicast at the access point and releases it
   * in a clump after a beacon, and that is precisely what was measured on this rig: a stream that
   * left the Ultimate every 4.00 ms (p99 4.14 ms, no loss, no clumping — sampled on the wire from a
   * host) reached the phone with **119 ms gaps and 29-packet bursts**. No jitter buffer sized for a
   * 4 ms cadence survives that, and the listener hears it as crackling.
   *
   * `WIFI_MODE_FULL_LOW_LATENCY` is the platform's way to say "this is real-time traffic". It only
   * takes effect while the screen is on and the app is in the foreground, which is exactly the window
   * Live View is used in, and it is released the moment the last stream closes so it cannot quietly
   * cost battery afterwards.
   */
  fun acquireLowLatency() {
    if (wifiLock?.isHeld == true) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    try {
      wifiLock =
        wifiManager()?.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "c64commander-avmirror")?.apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (error: Exception) {
      Log.w(logTag, "Low-latency Wi-Fi lock unavailable; streams may arrive in bursts", error)
    }
  }

  fun release() {
    try {
      multicastLock?.let { if (it.isHeld) it.release() }
    } catch (error: Exception) {
      Log.d(logTag, "MulticastLock release ignored", error)
    }
    multicastLock = null
    try {
      wifiLock?.let { if (it.isHeld) it.release() }
    } catch (error: Exception) {
      Log.d(logTag, "Wi-Fi lock release ignored", error)
    }
    wifiLock = null
  }
}
