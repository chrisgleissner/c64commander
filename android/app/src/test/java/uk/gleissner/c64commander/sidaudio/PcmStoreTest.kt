/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PcmStoreTest {
  private var now = 0L
  private val store = PcmStore(retainedBudgetBytes = 3 * 64 * 4, ephemeralTtlNanos = 1_000, nanoTime = { now })

  private fun frames(count: Int, base: Int) = ByteArray(count * 4) { ((base + it / 4) and 0x7F).toByte() }

  @Test
  fun `appends across block boundaries and reads back any range unchanged`() {
    val buffer = store.create(48000, retained = true, blockFrames = 64)
    val data = frames(150, 0)
    buffer.appendBytes(data, 0, data.size)
    assertEquals(150L, buffer.frames)
    val out = ByteArray(100 * 4)
    assertEquals(100, buffer.read(30, out, 0, 100))
    assertArrayEquals(data.copyOfRange(30 * 4, 130 * 4), out)
    assertEquals(20, buffer.read(130, out, 0, 100))
    assertEquals(0, buffer.read(500, out, 0, 10))
  }

  @Test
  fun `appendWith never crosses a block and publishes only what was produced`() {
    val buffer = store.create(48000, retained = false, blockFrames = 10)
    assertEquals(10, buffer.appendWith(25) { _, _, count -> count })
    assertEquals(4, buffer.appendWith(25) { _, _, _ -> 4 })
    assertEquals(14L, buffer.frames)
    assertEquals(0, buffer.appendWith(25) { _, _, _ -> 0 })
    assertEquals(14L, buffer.frames)
  }

  @Test
  fun `the feed takes over an ephemeral buffer, while a retained one stays until released`() {
    val chunk = store.create(48000, retained = false)
    val tune = store.create(48000, retained = true, blockFrames = 64)
    assertNotNull(store.take(chunk.id))
    assertNull(store.get(chunk.id))
    assertNotNull(store.take(tune.id))
    assertNotNull(store.get(tune.id))
    assertEquals(true, store.release(tune.id))
    assertEquals(false, store.release(tune.id))
  }

  @Test
  fun `an ephemeral buffer nobody consumed expires instead of leaking`() {
    val chunk = store.create(48000, retained = false)
    now += 2_000
    store.create(48000, retained = false)
    assertNull(store.get(chunk.id))
  }

  @Test
  fun `retained buffers over budget are dropped oldest first, never the one just made`() {
    val first = store.create(48000, retained = true, blockFrames = 64)
    first.appendBytes(frames(64, 0), 0, 256)
    now += 1
    val second = store.create(48000, retained = true, blockFrames = 64)
    second.appendBytes(frames(128, 0), 0, 512)
    now += 1
    val third = store.create(48000, retained = true, blockFrames = 64)
    third.appendBytes(frames(64, 0), 0, 256)
    store.create(48000, retained = true, blockFrames = 64)
    assertNull(store.get(first.id))
    assertNotNull(store.get(third.id))
  }

  @Test
  fun `a retained buffer that grows past the budget drops the least recently used other one`() {
    // The budget used to be checked only when a buffer was created, while it was still empty, so a
    // pre-render that grew afterwards was never held to it.
    val older = store.create(48000, retained = true, blockFrames = 64)
    older.appendBytes(frames(64, 0), 0, 256)
    now += 1
    val growing = store.create(48000, retained = true, blockFrames = 64)
    growing.appendBytes(frames(64, 0), 0, 256)
    assertNotNull(store.get(older.id))
    now += 1
    growing.appendBytes(frames(128, 0), 0, 512)
    assertNull(store.get(older.id))
    assertNotNull(store.get(growing.id))
    assertEquals(192L, growing.frames)
  }

  @Test
  fun `a buffer that alone exceeds the budget keeps growing rather than dropping itself`() {
    val only = store.create(48000, retained = true, blockFrames = 64)
    only.appendBytes(frames(320, 0), 0, 1280)
    assertNotNull(store.get(only.id))
    assertEquals(320L, only.frames)
  }

  @Test
  fun `writing a buffer counts as using it`() {
    val first = store.create(48000, retained = true, blockFrames = 64)
    now += 1
    val second = store.create(48000, retained = true, blockFrames = 64)
    now += 1
    first.appendBytes(frames(64, 0), 0, 256)
    assertEquals(now, first.lastTouchedNanos)
    assertEquals(true, second.lastTouchedNanos < first.lastTouchedNanos)
  }

  @Test
  fun `the retained budget is a quarter of the heap limit, between 48 and 64 MB`() {
    val mb = 1024L * 1024
    assertEquals(48 * mb, PcmStore.retainedBudgetFor(128 * mb))
    assertEquals(64 * mb, PcmStore.retainedBudgetFor(256 * mb))
    assertEquals(64 * mb, PcmStore.retainedBudgetFor(4096 * mb))
    assertEquals(48 * mb, PcmStore.retainedBudgetFor(16 * mb))
  }
}
