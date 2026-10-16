/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import android.util.Log
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Interleaved stereo S16LE PCM that lives on the native side, addressed from JavaScript by id.
 *
 * libSidplayEZ renders into these, so its audio never crosses into JavaScript: the web layer holds
 * ids and frame ranges, and [LocalAudioFeed] reads the samples straight out of here. Storage is a
 * list of fixed-size blocks, so a pre-render that grows to a whole tune never reallocates or copies
 * what it already holds.
 *
 * One writer and any number of readers. Frames are published through [frames] only after their
 * bytes are in place, so a reader never sees a half-written frame.
 */
internal class PcmBuffer(
    val id: Long,
    val sampleRate: Int,
    val retained: Boolean,
    private val blockFrames: Int,
    private val nanoTime: () -> Long = System::nanoTime,
    /** Called after each new block, so the store can hold a growing buffer to its budget. */
    private val onGrow: (PcmBuffer) -> Unit = {},
) {
  // Direct, so a whole pre-rendered tune lives outside the Java heap and the renderer can write
  // into it in place.
  private val blocks = ArrayList<ByteBuffer>()

  @Volatile
  var frames: Long = 0
    private set

  @Volatile var lastTouchedNanos: Long = nanoTime()

  val byteSize: Long
    get() = synchronized(blocks) { blocks.size.toLong() * blockFrames * BYTES_PER_FRAME }

  private fun blockFor(frame: Long): ByteBuffer {
    val index = (frame / blockFrames).toInt()
    var grew = false
    val block =
        synchronized(blocks) {
          while (blocks.size <= index) {
            blocks.add(ByteBuffer.allocateDirect(blockFrames * BYTES_PER_FRAME))
            grew = true
          }
          blocks[index]
        }
    if (grew) onGrow(this)
    return block
  }

  /**
   * Append by letting [produce] write into the block in place, at most [maxFrames] at a time and
   * never across a block boundary. Returns the frames appended; 0 when [produce] produced nothing.
   */
  fun appendWith(maxFrames: Int, produce: (block: ByteBuffer, offsetBytes: Int, frames: Int) -> Int): Int {
    val start = frames
    val within = (start % blockFrames).toInt()
    val room = minOf(maxFrames, blockFrames - within)
    if (room <= 0) return 0
    val produced = produce(blockFor(start), within * BYTES_PER_FRAME, room).coerceIn(0, room)
    frames = start + produced
    lastTouchedNanos = nanoTime()
    return produced
  }

  fun appendBytes(data: ByteArray, offset: Int, length: Int) {
    var position = offset
    val end = offset + (length / BYTES_PER_FRAME) * BYTES_PER_FRAME
    while (position < end) {
      val appended =
          appendWith((end - position) / BYTES_PER_FRAME) { block, at, count ->
            block.duplicate().apply { position(at) }.put(data, position, count * BYTES_PER_FRAME)
            count
          }
      position += appended * BYTES_PER_FRAME
    }
  }

  /** Copy up to [count] frames from [startFrame] into [dst]; returns the frames copied. */
  fun read(startFrame: Long, dst: ByteArray, dstOffset: Int, count: Int): Int {
    val available = (frames - startFrame).coerceAtLeast(0).coerceAtMost(count.toLong()).toInt()
    var copied = 0
    while (copied < available) {
      val frame = startFrame + copied
      val within = (frame % blockFrames).toInt()
      val run = minOf(available - copied, blockFrames - within)
      val block = synchronized(blocks) { blocks[(frame / blockFrames).toInt()] }
      block.duplicate().apply { position(within * BYTES_PER_FRAME) }.get(dst, dstOffset + copied * BYTES_PER_FRAME, run * BYTES_PER_FRAME)
      copied += run
    }
    return copied
  }

  companion object {
    const val BYTES_PER_FRAME = 4
  }
}

/**
 * The buffers JavaScript holds ids for.
 *
 * Two kinds, with different lifetimes:
 *  - **ephemeral**: one live render chunk. The feed takes it over when the chunk is enqueued, so it
 *    leaves the store at that moment; one the web layer drops is released explicitly.
 *  - **retained**: a pre-rendered tune or lead-in, kept until the web layer's cache evicts it.
 *
 * Both are bounded here as well, because a leaked id must cost a log line rather than the process:
 * an ephemeral buffer nobody consumed expires, and retained buffers beyond the budget are dropped
 * least recently used first. The budget is checked whenever a retained buffer grows, so a pre-render
 * that keeps growing is held to it too; the growing buffer itself is never the one dropped.
 */
internal class PcmStore(
    val retainedBudgetBytes: Long = retainedBudgetFor(Runtime.getRuntime().maxMemory()),
    private val ephemeralTtlNanos: Long = DEFAULT_EPHEMERAL_TTL_NANOS,
    private val nanoTime: () -> Long = System::nanoTime,
) {
  private val buffers = ConcurrentHashMap<Long, PcmBuffer>()
  private val nextId = AtomicLong(1)

  fun create(sampleRate: Int, retained: Boolean, blockFrames: Int = DEFAULT_BLOCK_FRAMES): PcmBuffer {
    expireEphemeral()
    val buffer =
        PcmBuffer(nextId.getAndIncrement(), sampleRate, retained, blockFrames, nanoTime) { grown ->
          if (grown.retained) enforceRetainedBudget(grown.id)
        }
    buffer.lastTouchedNanos = nanoTime()
    buffers[buffer.id] = buffer
    if (retained) enforceRetainedBudget(buffer.id)
    return buffer
  }

  fun get(id: Long): PcmBuffer? = buffers[id]?.also { it.lastTouchedNanos = nanoTime() }

  /** Remove an ephemeral buffer for the feed to own. Retained buffers stay in the store. */
  fun take(id: Long): PcmBuffer? {
    val buffer = buffers[id] ?: return null
    if (!buffer.retained) buffers.remove(id)
    buffer.lastTouchedNanos = nanoTime()
    return buffer
  }

  fun release(id: Long): Boolean = buffers.remove(id) != null

  fun clear() = buffers.clear()

  val size: Int
    get() = buffers.size

  fun retainedFramesThatFit(): Long = retainedBudgetBytes / PcmBuffer.BYTES_PER_FRAME

  val retainedBytes: Long
    get() = buffers.values.filter { it.retained }.sumOf { it.byteSize }

  private fun expireEphemeral() {
    val now = nanoTime()
    for (buffer in buffers.values) {
      if (!buffer.retained && now - buffer.lastTouchedNanos > ephemeralTtlNanos && buffers.remove(buffer.id) != null) {
        Log.w(TAG, "Expired PCM buffer ${buffer.id} (${buffer.frames} frames) that was never enqueued or released")
      }
    }
  }

  private fun enforceRetainedBudget(keepId: Long) {
    while (retainedBytes > retainedBudgetBytes) {
      val oldest =
          buffers.values.filter { it.retained && it.id != keepId }.minByOrNull { it.lastTouchedNanos } ?: return
      if (buffers.remove(oldest.id) != null) {
        Log.e(TAG, "Retained PCM over budget; dropped buffer ${oldest.id} (${oldest.byteSize} bytes)")
      }
    }
  }

  companion object {
    private const val TAG = "PcmStore"
    /** One second at 48 kHz: big enough that a whole tune is a short list, small enough to waste little. */
    const val DEFAULT_BLOCK_FRAMES = 48_000
    /** Above the web cache's own 128 MB, so this only fires when an id has leaked. */
    private const val MIN_RETAINED_BUDGET_BYTES = 48L * 1024 * 1024
    private const val MAX_RETAINED_BUDGET_BYTES = 64L * 1024 * 1024

    /**
     * A direct ByteBuffer on Android is a non-movable array on the Java heap, so retained PCM is
     * counted against the heap limit. Android asks the system to destroy the app's background
     * activities once the heap in use passes three quarters of that limit, and a dropped buffer stays
     * on the heap while the feed still plays from it. A quarter of the limit leaves room for both: it
     * is 64 MB with the 256 MB large heap, and never less than the 48 MB one pre-render needs.
     */
    fun retainedBudgetFor(maxHeapBytes: Long): Long =
        (maxHeapBytes / 4).coerceIn(MIN_RETAINED_BUDGET_BYTES, MAX_RETAINED_BUDGET_BYTES)
    const val DEFAULT_EPHEMERAL_TTL_NANOS = 120_000_000_000L
  }
}
