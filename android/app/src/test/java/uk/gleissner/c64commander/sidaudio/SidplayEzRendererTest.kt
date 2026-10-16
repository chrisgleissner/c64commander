/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.sidplayez.SidplayEzNative

class SidplayEzRendererTest {
  private val store = PcmStore()
  private val tune = File(System.getProperty("c64c.sidplayez.toneLadder")!!).readBytes()
  private val renderers = mutableListOf<SidplayEzRenderer>()

  private fun renderer(background: Boolean = false) = SidplayEzRenderer(renderers.size + 1, store, background).also { renderers.add(it) }

  @After fun tearDown() = renderers.forEach { it.dispose() }

  private fun <T> await(block: (EzCallbacks<T>) -> Unit): T {
    val future = CompletableFuture<T>()
    block(
        object : EzCallbacks<T> {
          override fun success(value: T) {
            future.complete(value)
          }

          override fun failure(error: Exception) {
            future.completeExceptionally(error)
          }
        })
    return future.get(60, TimeUnit.SECONDS)
  }

  private fun request(sid: ByteArray = tune) = EzTuneRequest(sid, 0, 48000, null, null, SidplayEzNative.MODEL_8580)

  private fun bytesOf(id: Long): ByteArray {
    val buffer = store.get(id)!!
    val out = ByteArray(buffer.frames.toInt() * 4)
    buffer.read(0, out, 0, buffer.frames.toInt())
    return out
  }

  @Test
  fun `opens, renders chunks into the store, and the chunks continue one another`() {
    val r = renderer()
    val opened = await<EzOpened> { r.open(request(), it) }
    assertEquals(48000, opened.sampleRate)
    assertEquals(2, opened.channels)
    assertTrue(opened.tuneInfoJson!!.contains("libSidplayEZ"))
    val first = await<EzRendered> { r.render(0.5, it) }
    val second = await<EzRendered> { r.render(0.5, it) }
    assertEquals(24000, first.frames)
    assertEquals(24000, second.frames)

    val straight = renderer()
    await<EzOpened> { straight.open(request(), it) }
    val whole = await<EzRendered> { straight.render(1.0, it) }
    assertArrayEquals(bytesOf(whole.bufferId), bytesOf(first.bufferId) + bytesOf(second.bufferId))
  }

  @Test
  fun `a seek lands exactly where a straight render would be`() {
    val r = renderer()
    await<EzOpened> { r.open(request(), it) }
    await<EzRendered> { r.render(0.25, it) }
    val landed = await<Double> { r.seek(1.0, it) }
    assertEquals(1.0, landed, 1e-6)
    val afterSeek = await<EzRendered> { r.render(0.5, it) }
    val straight = renderer()
    await<EzOpened> { straight.open(request(), it) }
    val whole = await<EzRendered> { straight.render(1.5, it) }
    assertArrayEquals(bytesOf(whole.bufferId).copyOfRange(48000 * 4, 72000 * 4), bytesOf(afterSeek.bufferId))
  }

  @Test
  fun `a tune that cannot be loaded fails the open, and the renderer stays usable`() {
    val r = renderer()
    val failed = runCatching { await<EzOpened> { r.open(request(ByteArray(64) { 3 }), it) } }
    assertTrue(failed.isFailure)
    await<EzOpened> { r.open(request(), it) }
    assertEquals(4800, await<EzRendered> { r.render(0.1, it) }.frames)
  }

  @Test
  fun `render without a tune reports the end rather than failing`() {
    val r = renderer()
    assertEquals(0, await<EzRendered> { r.render(0.5, it) }.frames)
  }

  @Test
  fun `a pre-render streams slices into one retained buffer that matches a live render`() {
    val r = renderer(background = true)
    val chunks = mutableListOf<Long>()
    val done = CompletableFuture<Pair<Long, Long>>()
    r.prerender(
        request(),
        12.0,
        object : SidplayEzRenderer.PrerenderListener {
          override fun chunk(bufferId: Long, frames: Long, seconds: Double) {
            chunks.add(frames)
          }

          override fun done(bufferId: Long, frames: Long, seconds: Double) {
            done.complete(bufferId to frames)
          }

          override fun cancelled(bufferId: Long, frames: Long, seconds: Double) {
            done.completeExceptionally(IllegalStateException("cancelled"))
          }

          override fun failed(error: Exception) {
            done.completeExceptionally(error)
          }
        })
    val (bufferId, frames) = done.get(60, TimeUnit.SECONDS)
    assertEquals(12L * 48000, frames)
    assertEquals(listOf(240000L, 480000L, 576000L), chunks)
    val live = renderer()
    await<EzOpened> { live.open(request(), it) }
    val chunk = await<EzRendered> { live.render(2.0, it) }
    assertArrayEquals(bytesOf(chunk.bufferId), bytesOf(bufferId).copyOf(96000 * 4))
  }

  @Test
  fun `disposing stops a pre-render, which keeps its buffer for the web layer to release`() {
    val r = renderer(background = true)
    val outcome = CompletableFuture<String>()
    r.prerender(
        request(),
        60.0,
        object : SidplayEzRenderer.PrerenderListener {
          override fun chunk(bufferId: Long, frames: Long, seconds: Double) {
            if (frames >= 240000) r.dispose()
          }

          override fun done(bufferId: Long, frames: Long, seconds: Double) {
            outcome.complete("done")
          }

          override fun cancelled(bufferId: Long, frames: Long, seconds: Double) {
            outcome.complete("cancelled")
          }

          override fun failed(error: Exception) {
            outcome.complete("failed")
          }
        })
    assertEquals("cancelled", outcome.get(30, TimeUnit.SECONDS))
    assertEquals(1, store.size)
  }

  @Test
  fun `cancelling a pre-render reports how far it got`() {
    val r = renderer(background = true)
    val outcome = CompletableFuture<Long>()
    r.prerender(
        request(),
        60.0,
        object : SidplayEzRenderer.PrerenderListener {
          override fun chunk(bufferId: Long, frames: Long, seconds: Double) {
            r.cancelPrerender()
          }

          override fun done(bufferId: Long, frames: Long, seconds: Double) {
            outcome.completeExceptionally(IllegalStateException("ran to the end"))
          }

          override fun cancelled(bufferId: Long, frames: Long, seconds: Double) {
            outcome.complete(frames)
          }

          override fun failed(error: Exception) {
            outcome.completeExceptionally(error)
          }
        })
    assertEquals(240000L, outcome.get(30, TimeUnit.SECONDS))
  }

  @Test
  fun `a pre-render longer than the retained budget is refused before it renders anything`() {
    val smallStore = PcmStore(retainedBudgetBytes = 10L * 48000 * 4)
    val r = SidplayEzRenderer(renderers.size + 1, smallStore, background = true).also { renderers.add(it) }
    val outcome = CompletableFuture<String>()
    r.prerender(
        request(),
        11.0,
        object : SidplayEzRenderer.PrerenderListener {
          override fun chunk(bufferId: Long, frames: Long, seconds: Double) {
            outcome.complete("chunk")
          }

          override fun done(bufferId: Long, frames: Long, seconds: Double) {
            outcome.complete("done")
          }

          override fun cancelled(bufferId: Long, frames: Long, seconds: Double) {
            outcome.complete("cancelled")
          }

          override fun failed(error: Exception) {
            outcome.complete("failed: ${error.message}")
          }
        })
    assertTrue(outcome.get(30, TimeUnit.SECONDS).startsWith("failed: Pre-render of 11 s needs more than"))
    assertEquals(0, smallStore.size)
  }

  @Test
  fun `work submitted after dispose fails instead of hanging`() {
    val r = renderer()
    r.dispose()
    assertTrue(runCatching { await<EzRendered> { r.render(0.5, it) } }.isFailure)
  }
}
