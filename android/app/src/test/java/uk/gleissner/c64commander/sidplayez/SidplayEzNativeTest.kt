/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidplayez

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The JNI layer against the real library, built for this machine by `buildLibSidplayEzHost`.
 *
 * These are the native contract tests: lifecycle, invalid input, bounds, destroyed handles and
 * independent concurrent sessions, through exactly the entry points the app calls.
 */
class SidplayEzNativeTest {
  private lateinit var tune: ByteArray

  @Before
  fun setUp() {
    assertNull("host library must load: ${SidplayEzNative.unavailableReason}", SidplayEzNative.unavailableReason)
    tune = File(System.getProperty("c64c.sidplayez.toneLadder")!!).readBytes()
  }

  private fun render(id: Long, frames: Int): ByteArray {
    val out = ByteArray(frames * 4)
    var done = 0
    while (done < frames) {
      val got = SidplayEzNative.nativeRender(id, out, done * 4, minOf(4800, frames - done))
      if (got <= 0) break
      done += got
    }
    return out.copyOf(done * 4)
  }

  @Test
  fun `reports the pinned revision`() {
    assertEquals("4c8664c80df8d363049e1a3eadf59cd9e52afd1f", SidplayEzNative.nativeRevision())
  }

  @Test
  fun `loads, renders audible and deterministic stereo, and describes the tune`() {
    val a = SidplayEzNative.nativeCreate(48000)
    val b = SidplayEzNative.nativeCreate(48000)
    try {
      assertNull(SidplayEzNative.nativeLoad(a, tune, 0, SidplayEzNative.MODEL_8580))
      assertNull(SidplayEzNative.nativeLoad(b, tune, 0, SidplayEzNative.MODEL_8580))
      val first = render(a, 48000)
      assertEquals(48000 * 4, first.size)
      assertTrue(first.any { it.toInt() != 0 })
      assertArrayEquals(first, render(b, 48000))
      assertEquals(1, SidplayEzNative.nativeChips(a))
      assertEquals(48000, SidplayEzNative.nativeSampleRate(a))
      assertTrue(SidplayEzNative.nativeTuneInfo(a)!!.contains("\"songs\":1"))
      assertNull(SidplayEzNative.nativeReload(a))
      assertArrayEquals(first, render(a, 48000))
    } finally {
      SidplayEzNative.nativeDestroy(a)
      SidplayEzNative.nativeDestroy(b)
    }
  }

  @Test
  fun `rejects what is not a tune, with a reason`() {
    val id = SidplayEzNative.nativeCreate(48000)
    try {
      assertNotNull(SidplayEzNative.nativeLoad(id, ByteArray(100) { 7 }, 0, SidplayEzNative.MODEL_8580))
      assertNotNull(SidplayEzNative.nativeLoad(id, ByteArray(0), 0, SidplayEzNative.MODEL_8580))
      assertEquals(0, SidplayEzNative.nativeRender(id, ByteArray(400), 0, 100))
    } finally {
      SidplayEzNative.nativeDestroy(id)
    }
  }

  @Test
  fun `refuses a render target too small for the request, or at a negative offset`() {
    val id = SidplayEzNative.nativeCreate(48000)
    try {
      assertNull(SidplayEzNative.nativeLoad(id, tune, 0, SidplayEzNative.MODEL_8580))
      assertThrows(IllegalStateException::class.java) { SidplayEzNative.nativeRender(id, ByteArray(399), 0, 100) }
      assertThrows(IllegalStateException::class.java) { SidplayEzNative.nativeRender(id, ByteArray(400), 4, 100) }
      assertThrows(IllegalStateException::class.java) { SidplayEzNative.nativeRender(id, ByteArray(400), -4, 10) }
      assertEquals(50, SidplayEzNative.nativeRender(id, ByteArray(400), 200, 50))
    } finally {
      SidplayEzNative.nativeDestroy(id)
    }
  }

  @Test
  fun `a destroyed session is an error, never a dereference`() {
    val id = SidplayEzNative.nativeCreate(48000)
    SidplayEzNative.nativeDestroy(id)
    SidplayEzNative.nativeDestroy(id)
    assertThrows(IllegalStateException::class.java) { SidplayEzNative.nativeRender(id, ByteArray(400), 0, 100) }
    assertThrows(IllegalStateException::class.java) { SidplayEzNative.nativeLoad(id, tune, 0, 1) }
    assertThrows(IllegalStateException::class.java) { SidplayEzNative.nativeSkip(id, 10) }
  }

  @Test
  fun `repeated create and destroy leaves no session behind`() {
    val before = SidplayEzNative.nativeLiveSessions()
    repeat(25) {
      val id = SidplayEzNative.nativeCreate(if (it % 2 == 0) 48000 else 44100)
      assertNull(SidplayEzNative.nativeLoad(id, tune, 0, SidplayEzNative.MODEL_6581))
      render(id, 256)
      SidplayEzNative.nativeDestroy(id)
    }
    assertEquals(before, SidplayEzNative.nativeLiveSessions())
  }

  @Test
  fun `independent sessions render concurrently without disturbing one another`() {
    val reference = SidplayEzNative.nativeCreate(48000)
    val expected =
        try {
          assertNull(SidplayEzNative.nativeLoad(reference, tune, 0, SidplayEzNative.MODEL_8580))
          render(reference, 24000)
        } finally {
          SidplayEzNative.nativeDestroy(reference)
        }
    val pool = Executors.newFixedThreadPool(4)
    val results = arrayOfNulls<ByteArray>(8)
    val done = CountDownLatch(8)
    repeat(8) { index ->
      pool.execute {
        val id = SidplayEzNative.nativeCreate(48000)
        try {
          SidplayEzNative.nativeLoad(id, tune, 0, SidplayEzNative.MODEL_8580)
          results[index] = render(id, 24000)
        } finally {
          SidplayEzNative.nativeDestroy(id)
          done.countDown()
        }
      }
    }
    assertTrue(done.await(60, TimeUnit.SECONDS))
    pool.shutdown()
    results.forEach { assertArrayEquals(expected, it) }
  }

  @Test
  fun `a destroy racing a render waits for it instead of freeing the player under it`() {
    repeat(20) {
      val id = SidplayEzNative.nativeCreate(48000)
      assertNull(SidplayEzNative.nativeLoad(id, tune, 0, SidplayEzNative.MODEL_8580))
      val started = CountDownLatch(1)
      val renderer = Thread {
        started.countDown()
        try {
          while (true) SidplayEzNative.nativeRender(id, ByteArray(48000 * 4), 0, 48000)
        } catch (expected: IllegalStateException) {
          // The session was destroyed between two renders, which is exactly what is being tested.
          assertTrue(expected.message!!.contains("destroyed"))
        }
      }
      renderer.start()
      started.await()
      Thread.sleep(2)
      SidplayEzNative.nativeDestroy(id)
      renderer.join(10_000)
      assertTrue(!renderer.isAlive)
    }
  }
}
