/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import android.os.Process
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicInteger
import uk.gleissner.c64commander.sidplayez.SidplayEzNative

/** The tune and settings one open (or pre-render) needs. */
internal class EzTuneRequest(
    val sid: ByteArray,
    val songIndex: Int,
    val sampleRate: Int,
    val kernal: ByteArray?,
    val basic: ByteArray?,
    /** [SidplayEzNative.MODEL_6581] or [SidplayEzNative.MODEL_8580]: the fallback, never forced. */
    val fallbackModel: Int,
)

internal data class EzOpened(
    val sampleRate: Int,
    val channels: Int,
    val tuneInfoJson: String?,
    val constructMs: Double,
    val loadMs: Double,
)

/** A rendered chunk held in [PcmStore] under [bufferId], or the end of the tune when [frames] is 0. */
internal data class EzRendered(val bufferId: Long, val frames: Int, val renderMs: Double)

internal interface EzCallbacks<T> {
  fun success(value: T)

  fun failure(error: Exception)
}

/**
 * One libSidplayEZ renderer, and the one thread it runs on.
 *
 * The web layer creates one of these per role — playback, the whole-tune pre-render and the
 * lead-in warmer — exactly as it creates one worker per role for the WASM engines, so the three
 * never wait on one another. Every call against the native session happens on [executor], which
 * is what makes the session safe to drive without locks of its own.
 *
 * Seeks and pre-renders can run for seconds. Both stop between blocks when the renderer is disposed
 * or when a newer tune is opened, so a superseded request never holds up the one after it.
 */
internal class SidplayEzRenderer(
    val id: Int,
    private val store: PcmStore,
    background: Boolean,
    private val native: SidplayEzNative = SidplayEzNative,
) {
  init {
    SidplayEzNative.unavailableReason?.let { throw IllegalStateException("libSidplayEZ is not available: $it") }
  }

  private val executor: ExecutorService =
      Executors.newSingleThreadExecutor { runnable ->
        Thread(
                {
                  Process.setThreadPriority(
                      if (background) Process.THREAD_PRIORITY_BACKGROUND else Process.THREAD_PRIORITY_DEFAULT,
                  )
                  runnable.run()
                },
                "c64u-sidplayez-$id",
            )
            .apply { isDaemon = true }
      }

  @Volatile private var disposed = false
  /** Bumped by every open, read by long-running work to notice it has been superseded. */
  private val generation = AtomicInteger(0)
  private var session = 0L
  private var sampleRate = 0

  private fun <T> submit(callbacks: EzCallbacks<T>, work: () -> T) {
    try {
      executor.execute {
        try {
          if (disposed) throw IllegalStateException("libSidplayEZ renderer $id has been disposed")
          callbacks.success(work())
        } catch (error: Exception) {
          callbacks.failure(error)
        } catch (error: LinkageError) {
          // A missing or mismatched native library must fail the request, not leave its caller waiting.
          Log.e(TAG, "libSidplayEZ renderer $id hit a native linkage error", error)
          callbacks.failure(IllegalStateException("libSidplayEZ is not usable: ${error.message}", error))
        }
      }
    } catch (error: RejectedExecutionException) {
      callbacks.failure(IllegalStateException("libSidplayEZ renderer $id has been disposed", error))
    }
  }

  private fun destroySession() {
    if (session != 0L) native.nativeDestroy(session)
    session = 0L
  }

  private fun loadInto(target: Long, request: EzTuneRequest) {
    native.nativeSetRoms(target, request.kernal, request.basic, null)
    val error = native.nativeLoad(target, request.sid, request.songIndex, request.fallbackModel)
    if (error != null) throw IllegalArgumentException(error)
  }

  fun open(request: EzTuneRequest, callbacks: EzCallbacks<EzOpened>) {
    generation.incrementAndGet()
    submit(callbacks) {
      destroySession()
      val startedAt = System.nanoTime()
      val created = native.nativeCreate(request.sampleRate)
      val constructedAt = System.nanoTime()
      try {
        loadInto(created, request)
      } catch (error: Exception) {
        native.nativeDestroy(created)
        throw error
      }
      session = created
      sampleRate = native.nativeSampleRate(created)
      EzOpened(
          sampleRate = sampleRate,
          channels = SidplayEzNative.CHANNELS,
          tuneInfoJson = native.nativeTuneInfo(created),
          constructMs = (constructedAt - startedAt) / 1e6,
          loadMs = (System.nanoTime() - constructedAt) / 1e6,
      )
    }
  }

  /** Render [seconds] into a fresh ephemeral buffer. A tune with nothing left returns 0 frames. */
  fun render(seconds: Double, callbacks: EzCallbacks<EzRendered>) {
    submit(callbacks) {
      if (session == 0L) return@submit EzRendered(0, 0, 0.0)
      val frames = (seconds * sampleRate).toInt().coerceAtLeast(1)
      val startedAt = System.nanoTime()
      val buffer = store.create(sampleRate, retained = false, blockFrames = frames)
      renderInto(session, buffer, frames.toLong()) { false }
      val renderMs = (System.nanoTime() - startedAt) / 1e6
      if (buffer.frames == 0L) {
        store.release(buffer.id)
        EzRendered(0, 0, renderMs)
      } else {
        EzRendered(buffer.id, buffer.frames.toInt(), renderMs)
      }
    }
  }

  private fun renderInto(target: Long, buffer: PcmBuffer, frames: Long, stop: () -> Boolean) {
    val goal = buffer.frames + frames
    while (buffer.frames < goal && !stop()) {
      val want = minOf(RENDER_BLOCK_FRAMES.toLong(), goal - buffer.frames).toInt()
      val produced = buffer.appendWith(want) { block, offset, count -> native.nativeRender(target, block, offset, count) }
      if (produced <= 0) break
    }
  }

  /**
   * Move to [seconds] from the tune's start: reload, then render and discard everything before it,
   * because the emulation cannot rewind. Returns where it landed.
   */
  fun seek(seconds: Double, callbacks: EzCallbacks<Double>) {
    val seekGeneration = generation.get()
    submit(callbacks) {
      if (session == 0L) return@submit seconds.coerceAtLeast(0.0)
      native.nativeReload(session)?.let { throw IllegalStateException(it) }
      val target = (seconds.coerceAtLeast(0.0) * sampleRate).toLong()
      var skipped = 0L
      while (skipped < target && !disposed && generation.get() == seekGeneration) {
        val step = native.nativeSkip(session, minOf(SEEK_BLOCK_FRAMES, target - skipped))
        if (step <= 0) break
        skipped += step
      }
      skipped.toDouble() / sampleRate
    }
  }

  /** Progress of a pre-render, as each slice lands in its retained buffer. */
  interface PrerenderListener {
    fun chunk(bufferId: Long, frames: Long, seconds: Double)

    fun done(bufferId: Long, frames: Long, seconds: Double)

    fun failed(error: Exception)
  }

  /**
   * Render a whole tune into one retained buffer on this renderer's thread, reporting each slice.
   *
   * Its own session, so the renderer's playback session (if any) is untouched. Cancelled by
   * [dispose] or by the next [open]/[prerender] on this renderer.
   */
  fun prerender(request: EzTuneRequest, seconds: Double, listener: PrerenderListener) {
    val myGeneration = generation.incrementAndGet()
    val callbacks =
        object : EzCallbacks<Unit> {
          override fun success(value: Unit) = Unit

          override fun failure(error: Exception) = listener.failed(error)
        }
    submit(callbacks) {
      val offline = native.nativeCreate(request.sampleRate)
      try {
        loadInto(offline, request)
        val rate = native.nativeSampleRate(offline)
        val buffer = store.create(rate, retained = true)
        val total = (seconds * rate).toLong()
        val superseded = { disposed || generation.get() != myGeneration }
        while (buffer.frames < total && !superseded()) {
          val before = buffer.frames
          renderInto(offline, buffer, minOf(PRERENDER_SLICE_FRAMES_PER_SECOND * rate, total - buffer.frames), superseded)
          if (buffer.frames == before) break
          listener.chunk(buffer.id, buffer.frames, buffer.frames.toDouble() / rate)
        }
        if (superseded()) {
          store.release(buffer.id)
          return@submit
        }
        listener.done(buffer.id, buffer.frames, buffer.frames.toDouble() / rate)
      } finally {
        native.nativeDestroy(offline)
      }
    }
  }

  fun close(callbacks: EzCallbacks<Unit>) {
    generation.incrementAndGet()
    submit(callbacks) { destroySession() }
  }

  /** Stop everything and free the native sessions; nothing runs on this renderer afterwards. */
  fun dispose() {
    if (disposed) return
    disposed = true
    generation.incrementAndGet()
    try {
      executor.execute { destroySession() }
    } catch (error: RejectedExecutionException) {
      Log.d(TAG, "Renderer $id was already shut down", error)
    }
    executor.shutdown()
  }

  companion object {
    private const val TAG = "SidplayEzRenderer"
    /** Frames per native call; small enough that cancellation is noticed quickly. */
    const val RENDER_BLOCK_FRAMES = 12_000
    const val SEEK_BLOCK_FRAMES = 12_000L
    /** Seconds per reported pre-render slice, as the WASM worker reports them. */
    const val PRERENDER_SLICE_FRAMES_PER_SECOND = 5L
  }
}
