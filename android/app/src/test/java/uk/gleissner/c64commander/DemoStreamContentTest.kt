/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.io.File
import kotlin.math.abs
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * These read the same committed assets the APK ships, from `src/main/assets`, rather than a
 * fixture built in the test: the thing worth checking is that the picture and the ladder actually
 * on disk produce a decodable stream, not that a hand-made stand-in does.
 */
class DemoStreamContentTest {
  private val assetDir = File("src/main/assets/demo-stream")

  private fun testcard() = File(assetDir, "testcard.vic4").readBytes()

  private fun mask() = File(assetDir, "testcard-surround.mask").readBytes()

  private fun ladderJson() = File(assetDir, "tone-ladder.json").readText()

  private fun content() = DemoStreamContent.from(testcard(), mask(), ladderJson())

  private fun nibbleAt(frame: ByteArray, pixel: Int): Int {
    val byte = frame[pixel ushr 1].toInt() and 0xff
    return if (pixel and 1 == 0) byte and 0x0f else (byte ushr 4) and 0x0f
  }

  @Test
  fun assetsAreTheSizesTheWireFormatRequires() {
    assertEquals(DemoStreamContent.VIC_BYTES_PER_FRAME, testcard().size)
    assertEquals(DemoStreamContent.VIC_FRAME_WIDTH * DemoStreamContent.VIC_PAL_HEIGHT / 8, mask().size)
  }

  @Test
  fun everyNibbleOfTheTestCardIsAValidPaletteIndex() {
    // 4bpp gives no room for an invalid index, so this can only fail if the asset is the wrong
    // size or the wrong format entirely — which is exactly what it is here to catch.
    val frame = testcard()
    assertEquals(DemoStreamContent.VIC_BYTES_PER_FRAME, frame.size)
    for (pixel in 0 until DemoStreamContent.VIC_FRAME_WIDTH * DemoStreamContent.VIC_PAL_HEIGHT) {
      assertTrue(nibbleAt(frame, pixel) in 0..15)
    }
  }

  @Test
  fun theLadderIsEighteenSlotsCoveringAllSixteenColours() {
    val slots = content().slots
    assertEquals(18, slots.size)
    assertEquals(
            "every VIC colour must appear, so the picture identifies the note",
            (0..15).toSet(),
            slots.map { it.colour }.toSet(),
    )
    assertEquals("two silences, sixteen notes", 2, slots.count { it.hz <= 0.0 })
  }

  @Test
  fun aSilentSlotHoldsThePreviousSlotsColour() {
    val slots = content().slots
    val declared = JSONObject(ladderJson()).getJSONArray("slots")

    for (index in 0 until declared.length()) {
      if (!declared.getJSONObject(index).isNull("colour")) continue
      val previous = slots[(index - 1 + slots.size) % slots.size]
      assertEquals(
              "silence at slot $index must hold the colour already on screen, not reset it",
              previous.colour,
              slots[index].colour,
      )
    }
  }

  @Test
  fun tintingReplacesOnlyTheSurround() {
    val frame = testcard()
    val surround = mask()
    val tinted = DemoStreamContent.tintSurround(frame, surround, colour = 2)

    var tintedPixels = 0
    for (pixel in 0 until DemoStreamContent.VIC_FRAME_WIDTH * DemoStreamContent.VIC_PAL_HEIGHT) {
      val inSurround = (surround[pixel ushr 3].toInt() ushr (pixel and 7)) and 1 == 1
      if (inSurround) {
        assertEquals("surround pixel $pixel must take the slot colour", 2, nibbleAt(tinted, pixel))
        tintedPixels += 1
      } else {
        assertEquals("panel pixel $pixel must be left alone", nibbleAt(frame, pixel), nibbleAt(tinted, pixel))
      }
    }
    assertTrue("the mask must actually cover something", tintedPixels > 1000)
  }

  @Test
  fun tintingKeepsTheSixteenColourBarStripIntact() {
    // The strip shows all sixteen indices including light blue, the colour the card draws its
    // surround in. Tinting by colour value rather than by mask would recolour that one bar and
    // quietly turn the palette check into a fifteen-colour check.
    val content = content()
    val distinctPerSlot = content.videoSlotPackets.indices.map { slot ->
      val frame = DemoStreamContent.tintSurround(testcard(), mask(), content.slots[slot].colour)
      (0 until DemoStreamContent.VIC_FRAME_WIDTH * DemoStreamContent.VIC_PAL_HEIGHT)
              .map { nibbleAt(frame, it) }
              .toSet()
    }
    for (colours in distinctPerSlot) {
      assertEquals("all sixteen palette indices must survive every tint", 16, colours.size)
    }
  }

  @Test
  fun everySlotProducesAWholeFrameOfWireFormatPackets() {
    val content = content()
    assertEquals(content.slots.size, content.videoSlotPackets.size)

    for ((slotIndex, packets) in content.videoSlotPackets.withIndex()) {
      assertEquals(DemoStreamContent.VIC_PACKETS_PER_FRAME, packets.size)
      packets.forEachIndexed { packetIndex, packet ->
        assertEquals(
                DemoStreamContent.VIC_HEADER_BYTES +
                        DemoStreamContent.VIC_LINES_PER_PACKET * DemoStreamContent.VIC_BYTES_PER_LINE,
                packet.size,
        )
        val line = packetIndex * DemoStreamContent.VIC_LINES_PER_PACKET
        val isLast = packetIndex == packets.size - 1
        val expectedLineField = line or (if (isLast) DemoStreamContent.VIC_LAST_LINE_FLAG else 0)
        assertEquals("slot $slotIndex packet $packetIndex line field", expectedLineField, DemoStreamContent.readU16LE(packet, 4))
        assertEquals(DemoStreamContent.VIC_FRAME_WIDTH, DemoStreamContent.readU16LE(packet, 6))
        assertEquals(DemoStreamContent.VIC_LINES_PER_PACKET, packet[8].toInt())
        assertEquals(DemoStreamContent.VIC_BITS_PER_PIXEL, packet[9].toInt())
      }
    }
  }

  @Test
  fun thePacketsOfOneFrameCoverEveryLineExactlyOnce() {
    val content = content()
    val reassembled = ByteArray(DemoStreamContent.VIC_BYTES_PER_FRAME)
    for (packet in content.videoSlotPackets[1]) {
      val line = DemoStreamContent.readU16LE(packet, 4) and 0x7fff
      System.arraycopy(
              packet,
              DemoStreamContent.VIC_HEADER_BYTES,
              reassembled,
              line * DemoStreamContent.VIC_BYTES_PER_LINE,
              DemoStreamContent.VIC_LINES_PER_PACKET * DemoStreamContent.VIC_BYTES_PER_LINE,
      )
    }
    val expected = DemoStreamContent.tintSurround(testcard(), mask(), content.slots[1].colour)
    assertTrue("a receiver reassembling the packets must get the tinted card back", expected.contentEquals(reassembled))
  }

  @Test
  fun successiveSlotsSendDifferentPictures() {
    // A frozen picture is the failure this stream exists to make visible, so consecutive slots
    // must differ. They differ only in the surround, which is the point: the picture identifies
    // the note being played.
    val content = content()
    for (index in content.slots.indices) {
      val next = (index + 1) % content.slots.size
      if (content.slots[index].colour == content.slots[next].colour) continue
      assertNotEquals(
              content.videoSlotPackets[index].map { it.toList() },
              content.videoSlotPackets[next].map { it.toList() },
      )
    }
  }

  @Test
  fun theAudioLoopIsAWholeNumberOfPacketsAndDividesEvenlyIntoSlots() {
    val content = content()
    assertEquals(2244, content.audioPackets.size)
    assertEquals(430848, content.loopSamples)
    assertEquals(
            "each slot must be the same number of samples, or the notes drift apart",
            0,
            content.loopSamples % content.slots.size,
    )
  }

  @Test
  fun theAudioAndVideoLoopsAreExactlyTheSameLength() {
    // Two independent senders started together drift apart if their loop periods differ, and the
    // drift shows up as an audio-to-video offset that grows without bound. Both intervals are
    // derived from one loop length so the offset stays where it starts.
    val content = content()
    // Integer division of the loop length by the packet/frame count leaves at most one nanosecond
    // per step, so the rebuilt loop lengths must land within a microsecond of each other.
    val toleranceNanos = 1_000L
    val videoLoopNanos = content.videoFrameIntervalNanos * content.loopFrames
    val audioLoopNanos = content.audioPacketIntervalNanos * content.audioPackets.size
    assertTrue(
            "video loop $videoLoopNanos ns against ${content.loopNanos} ns",
            abs(videoLoopNanos - content.loopNanos) <= toleranceNanos,
    )
    assertTrue(
            "audio loop $audioLoopNanos ns against ${content.loopNanos} ns",
            abs(audioLoopNanos - content.loopNanos) <= toleranceNanos,
    )
  }

  @Test
  fun theVideoFrameRateIsPalRefresh() {
    val content = content()
    val fps = 1e9 / content.videoFrameIntervalNanos
    assertEquals("PAL refresh, not a round 50", DemoStreamContent.PAL_REFRESH_HZ, fps, 0.05)
  }

  @Test
  fun everyAudioPacketIsWholeStereoFramesWithMatchingChannels() {
    val content = content()
    val expectedSize =
            DemoStreamContent.AUDIO_SEQ_BYTES +
                    DemoStreamContent.AUDIO_SAMPLES_PER_PACKET * DemoStreamContent.AUDIO_BYTES_PER_FRAME
    for (packet in content.audioPackets) {
      assertEquals(expectedSize, packet.size)
    }

    for (offset in 0 until DemoStreamContent.AUDIO_SAMPLES_PER_PACKET) {
      val base = DemoStreamContent.AUDIO_SEQ_BYTES + offset * DemoStreamContent.AUDIO_BYTES_PER_FRAME
      val packet = content.audioPackets[300]
      assertEquals(
              "mono content duplicated to stereo",
              DemoStreamContent.readU16LE(packet, base),
              DemoStreamContent.readU16LE(packet, base + 2),
      )
    }
  }

  @Test
  fun aSilentSlotIsDigitallySilent() {
    // The ladder's silences are a measurement, not a pause: a grader reads the noise floor in
    // them. Anything but exact zero here would put a floor under that measurement.
    val content = content()
    val samplesPerSlot = content.loopSamples / content.slots.size
    val silentSlot = content.slots.indexOfFirst { it.hz <= 0.0 }
    assertTrue("the ladder must contain a silence", silentSlot >= 0)

    val firstSample = silentSlot.toLong() * samplesPerSlot
    val lastSample = firstSample + samplesPerSlot - 1
    for (sample in longArrayOf(firstSample, firstSample + samplesPerSlot / 2, lastSample)) {
      assertEquals("sample $sample of a silent slot", 0, sampleAt(content, sample))
    }
  }

  @Test
  fun eachNoteIsWithinAQuarterToneOfItsLadderFrequency() {
    // Measured the way the ladder grader measures a real device: count zero crossings across the
    // steady middle of the note. A wrong note, a wrong sample rate or a wrong slot length all move
    // this; a quarter tone (50 cents) is the tolerance `toneLadder.ts` itself uses.
    val content = content()
    val samplesPerSlot = content.loopSamples / content.slots.size

    for (slot in content.slots.filter { it.hz > 0.0 }) {
      val start = slot.index.toLong() * samplesPerSlot + samplesPerSlot / 4
      val length = samplesPerSlot / 2
      var crossings = 0
      var previous = sampleAt(content, start)
      for (offset in 1 until length) {
        val value = sampleAt(content, start + offset)
        if (previous < 0 && value >= 0) crossings += 1
        previous = value
      }
      val measuredHz = crossings * DemoStreamContent.AUDIO_SAMPLE_RATE.toDouble() / length
      val cents = 1200.0 * kotlin.math.ln(measuredHz / slot.hz) / kotlin.math.ln(2.0)
      assertTrue(
              "${slot.name}: measured ${"%.2f".format(measuredHz)} Hz against ${"%.2f".format(slot.hz)} Hz " +
                      "(${"%.1f".format(cents)} cents)",
              abs(cents) < 50.0,
      )
    }
  }

  @Test
  fun everyNoteStartsAndEndsSilentSoTheLoopDoesNotClick() {
    val content = content()
    val samplesPerSlot = content.loopSamples / content.slots.size
    for (slot in content.slots.filter { it.hz > 0.0 }) {
      val start = slot.index.toLong() * samplesPerSlot
      assertEquals("${slot.name} must start from silence", 0, sampleAt(content, start))
      assertEquals("${slot.name} must end at silence", 0, sampleAt(content, start + samplesPerSlot - 1))
    }
  }

  @Test
  fun theLoudestSampleStaysWellInsideFullScale() {
    val content = content()
    var peak = 0
    for (sample in 0 until content.loopSamples step 7) {
      peak = maxOf(peak, abs(sampleAt(content, sample.toLong())))
    }
    assertTrue("the ladder must actually sound: peak was $peak", peak > 4000)
    assertTrue("and must not approach clipping: peak was $peak", peak < 12000)
  }

  @Test
  fun envelopeIsZeroAtTheEdgesAndUnityInTheMiddle() {
    assertEquals(0.0, DemoStreamContent.envelope(0L, 1000L, 100L), 1e-9)
    assertEquals(1.0, DemoStreamContent.envelope(500L, 1000L, 100L), 1e-9)
    assertEquals(0.0, DemoStreamContent.envelope(1000L, 1000L, 100L), 1e-9)
  }

  /** The left channel of one absolute sample of the loop, as a signed value. */
  private fun sampleAt(content: DemoStreamContent, sample: Long): Int {
    val packet = content.audioPackets[(sample / DemoStreamContent.AUDIO_SAMPLES_PER_PACKET).toInt()]
    val offset =
            DemoStreamContent.AUDIO_SEQ_BYTES +
                    (sample % DemoStreamContent.AUDIO_SAMPLES_PER_PACKET).toInt() * DemoStreamContent.AUDIO_BYTES_PER_FRAME
    return DemoStreamContent.readU16LE(packet, offset).toShort().toInt()
  }
}
