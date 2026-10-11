/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidplayez

import android.util.Log

/**
 * The JNI surface of `libc64sidplayez.so` (android/app/src/main/cpp/sidplayez).
 *
 * Sessions are opaque ids. A destroyed id is reported as an [IllegalStateException] rather than
 * dereferenced, and the native side serialises calls per session, so a stale or concurrent call can
 * fail but cannot corrupt a player. [SidplayEzSession] adds the ownership rules on top.
 */
internal object SidplayEzNative {
  private const val TAG = "SidplayEzNative"
  private const val LIBRARY = "c64sidplayez"

  /** Set by the JVM tests to load the host build instead of the packaged one. */
  private const val HOST_LIBRARY_PROPERTY = "c64c.sidplayez.hostLibrary"

  /** Why the library is unavailable, or null when it loaded and this CPU can run it. */
  val unavailableReason: String? by lazy { load() }

  val isAvailable: Boolean
    get() = unavailableReason == null

  private fun load(): String? {
    try {
      val hostLibrary = System.getProperty(HOST_LIBRARY_PROPERTY)
      if (!hostLibrary.isNullOrEmpty()) System.load(hostLibrary) else System.loadLibrary(LIBRARY)
    } catch (error: UnsatisfiedLinkError) {
      Log.w(TAG, "libSidplayEZ could not be loaded", error)
      return "The native library could not be loaded: ${error.message}"
    } catch (error: SecurityException) {
      Log.w(TAG, "libSidplayEZ could not be loaded", error)
      return "The native library could not be loaded: ${error.message}"
    }
    return if (nativeCpuSupported()) null else "This CPU lacks SSE4.1, which the x86 build needs"
  }

  external fun nativeCpuSupported(): Boolean

  external fun nativeRevision(): String

  external fun nativeCreate(sampleRate: Int): Long

  external fun nativeDestroy(id: Long)

  external fun nativeLiveSessions(): Int

  external fun nativeSetRoms(id: Long, kernal: ByteArray?, basic: ByteArray?, chargen: ByteArray?)

  /** Null on success, otherwise why the tune could not be loaded. */
  external fun nativeLoad(id: Long, sid: ByteArray, songIndex: Int, fallbackModel: Int): String?

  external fun nativeReload(id: Long): String?

  /** Frames written into [out] (stereo S16LE) at [offsetBytes]; 0 once the emulated CPU has jammed. */
  external fun nativeRender(id: Long, out: ByteArray, offsetBytes: Int, frames: Int): Int

  external fun nativeSkip(id: Long, frames: Long): Long

  external fun nativeTuneInfo(id: Long): String?

  external fun nativeChips(id: Long): Int

  external fun nativeSampleRate(id: Long): Int

  external fun nativeSongIndex(id: Long): Int

  const val MODEL_6581 = 0
  const val MODEL_8580 = 1
  const val CHANNELS = 2
  const val BYTES_PER_FRAME = 4
}
