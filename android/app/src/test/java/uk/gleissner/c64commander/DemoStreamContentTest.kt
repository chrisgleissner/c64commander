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

  private fun font() = File(assetDir, "font8x8.bin").readBytes()

  private fun ladderJson() = File(assetDir, "tone-ladder.json").readText()

  private fun content() = DemoStreamContent.from(font(), ladderJson())

  private fun readyLoop() = content().videoLoopFor(MachineScreen.Ready)

  /** The frame a receiver would rebuild from one slot's packets. */
  private fun reassemble(packets: List<ByteArray>): ByteArray {
    val frame = ByteArray(DemoStreamContent.VIC_BYTES_PER_FRAME)
    for (packet in packets) {
      val line = DemoStreamContent.readU16LE(packet, 4) and 0x7fff
      System.arraycopy(
              packet,
              DemoStreamContent.VIC_HEADER_BYTES,
              frame,
              line * DemoStreamContent.VIC_BYTES_PER_LINE,
              DemoStreamContent.VIC_LINES_PER_PACKET * DemoStreamContent.VIC_BYTES_PER_LINE,
      )
    }
    return frame
  }

  private fun nibbleAt(frame: ByteArray, pixel: Int): Int {
    val byte = frame[pixel ushr 1].toInt() and 0xff
    return if (pixel and 1 == 0) byte and 0x0f else (byte ushr 4) and 0x0f
  }

  @Test
  fun theFontIsTheSizeTheScreenRendererRequires() {
    assertEquals(DemoScreen.GLYPH_COUNT * DemoScreen.GLYPH_BYTES, font().size)
  }

  @Test
  fun theLadderIsEighteenSlotsCoveringAllSixteenColours() {
    val slots = content().slots
    assertEquals(18, slots.size)
    assertEquals(
            "every VIC colour must appear, so the border identifies the note",
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
  fun everyNibbleOfARenderedScreenIsAValidPaletteIndex() {
    // 4bpp leaves no room for an invalid index, so this can only fail if the renderer writes
    // outside the frame or the font is the wrong size — which is exactly what it is here to catch.
    val frame = reassemble(readyLoop().slotPackets[0])
    assertEquals(DemoStreamContent.VIC_BYTES_PER_FRAME, frame.size)
    for (pixel in 0 until DemoScreen.WIDTH * DemoScreen.HEIGHT) {
      assertTrue(nibbleAt(frame, pixel) in 0..15)
    }
  }

  @Test
  fun theIdleScreenIsACommodoreBootScreen() {
    // The picture is the machine's screen, not a test card: a Live View that showed the same thing
    // whatever the machine was doing would make every action the app offers look inert.
    val text = DemoScreen.linesFor(MachineScreen.Ready).joinToString(" ")
    assertTrue(text, text.contains("COMMODORE 64 BASIC V2"))
    assertTrue(text, text.contains("READY."))
  }

  @Test
  fun aRunningProgramIsNamedOnScreenAndSaysWhatItStandsIn() {
    val text = DemoScreen.linesFor(MachineScreen.Running("SAMPLE QUEST", "PRG")).joinToString(" ")
    assertTrue(text, text.contains("NOW RUNNING"))
    assertTrue(text, text.contains("SAMPLE QUEST"))
    assertTrue(text, text.contains("PRG"))
    // The one hard wall is stated on the screen rather than left for the user to discover.
    assertTrue(text, text.contains("CANNOT EXECUTE"))
  }

  @Test
  fun aPlayingTuneSaysWhereTheSoundIsComingFrom() {
    val text = DemoScreen.linesFor(MachineScreen.Playing("COMMANDER MARCH", "Usb0")).joinToString(" ")
    assertTrue(text, text.contains("NOW PLAYING"))
    assertTrue(text, text.contains("COMMANDER MARCH"))
    assertTrue(text, text.contains("USB0"))
    // The one hard wall is named on the screen rather than left for the listener to wonder about.
    assertTrue(text, text.contains("NO SID"))
  }

  @Test
  fun aLoadNamesTheFileAndTheDeviceTheWayTheKernalDoes() {
    val text = DemoScreen.linesFor(MachineScreen.Loading("HELLO", "Usb0")).joinToString(" ")
    assertTrue(text, text.contains("LOAD\"HELLO\",8,1"))
    assertTrue(text, text.contains("SEARCHING FOR HELLO"))
    assertTrue(text, text.contains("USB0"))
  }

  @Test
  fun onlyTheBorderChangesBetweenSlotsOfOneScreen() {
    // The text is drawn once and re-tinted per slot. If a slot re-rendered the text instead, a
    // screen change would cost eighteen full renders while the stream is running.
    val loop = readyLoop()
    val first = reassemble(loop.slotPackets[0])
    val second = reassemble(loop.slotPackets[5])
    var differing = 0
    for (pixel in 0 until DemoScreen.WIDTH * DemoScreen.HEIGHT) {
      if (nibbleAt(first, pixel) == nibbleAt(second, pixel)) continue
      differing += 1
      val x = pixel % DemoScreen.WIDTH
      val y = pixel / DemoScreen.WIDTH
      val inText =
              x >= DemoScreen.TEXT_LEFT &&
                      x < DemoScreen.TEXT_LEFT + DemoScreen.COLUMNS * 8 &&
                      y >= DemoScreen.TEXT_TOP &&
                      y < DemoScreen.TEXT_TOP + DemoScreen.ROWS * 8
      assertTrue("pixel $x,$y is inside the text area and must not change with the border", !inText)
    }
    assertTrue("the border must actually change colour between slots", differing > 1000)
  }

  @Test
  fun twoScreensDifferInsideTheTextArea() {
    val ready = reassemble(readyLoop().slotPackets[0])
    val running = reassemble(content().videoLoopFor(MachineScreen.Running("HELLO", "PRG")).slotPackets[0])
    var differingInText = 0
    for (pixel in 0 until DemoScreen.WIDTH * DemoScreen.HEIGHT) {
      val x = pixel % DemoScreen.WIDTH
      val y = pixel / DemoScreen.WIDTH
      val inText =
              x >= DemoScreen.TEXT_LEFT &&
                      x < DemoScreen.TEXT_LEFT + DemoScreen.COLUMNS * 8 &&
                      y >= DemoScreen.TEXT_TOP &&
                      y < DemoScreen.TEXT_TOP + DemoScreen.ROWS * 8
      if (inText && nibbleAt(ready, pixel) != nibbleAt(running, pixel)) differingInText += 1
    }
    assertTrue("a program screen must not look like the BASIC prompt", differingInText > 500)
  }

  @Test
  fun everySlotProducesAWholeFrameOfWireFormatPackets() {
    val content = content()
    val loop = content.videoLoopFor(MachineScreen.Ready)
    assertEquals(content.slots.size, loop.slotPackets.size)

    for ((slotIndex, packets) in loop.slotPackets.withIndex()) {
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
        assertEquals(
                "slot $slotIndex packet $packetIndex line field",
                expectedLineField,
                DemoStreamContent.readU16LE(packet, 4),
        )
        assertEquals(DemoStreamContent.VIC_FRAME_WIDTH, DemoStreamContent.readU16LE(packet, 6))
        assertEquals(DemoStreamContent.VIC_LINES_PER_PACKET, packet[8].toInt())
        assertEquals(DemoStreamContent.VIC_BITS_PER_PIXEL, packet[9].toInt())
      }
    }
  }

  @Test
  fun thePacketsOfOneFrameCoverEveryLineExactlyOnce() {
    val loop = readyLoop()
    val reassembled = reassemble(loop.slotPackets[1])
    // Every byte must have been written by exactly one packet: a gap would leave zeros, which is a
    // valid palette index and so would not be caught by a range check.
    assertEquals(DemoStreamContent.VIC_BYTES_PER_FRAME, reassembled.size)
    val lines = loop.slotPackets[1].map { DemoStreamContent.readU16LE(it, 4) and 0x7fff }.toSet()
    assertEquals(DemoStreamContent.VIC_PACKETS_PER_FRAME, lines.size)
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
  fun anNtscLoopIsShorterFramesAtSixtyHertzOverTheSameNineSeconds() {
    // Both standards must cover the same 18 half-second ladder slots in the same total time, since
    // the audio loop is shared: NTSC just divides that time into more, shorter frames of 240 lines.
    val content = content()
    val pal = content.videoLoopFor(MachineScreen.Ready, VideoStandard.PAL)
    val ntsc = content.videoLoopFor(MachineScreen.Ready, VideoStandard.NTSC)

    assertEquals(68, pal.slotPackets[0].size)
    assertEquals(60, ntsc.slotPackets[0].size)
    assertEquals(450, pal.loopFrames)
    assertEquals(540, ntsc.loopFrames)

    assertEquals("PAL refresh", DemoStreamContent.PAL_REFRESH_HZ, 1e9 / pal.frameIntervalNanos, 0.05)
    assertEquals("NTSC refresh", 60.1, 1e9 / ntsc.frameIntervalNanos, 0.3)

    val toleranceNanos = 1_000L
    for (loop in listOf(pal, ntsc)) {
      val loopNanos = loop.frameIntervalNanos * loop.loopFrames
      assertTrue(
              "${loop.standard} loop $loopNanos ns against ${content.loopNanos} ns",
              abs(loopNanos - content.loopNanos) <= toleranceNanos,
      )
    }
  }

  @Test
  fun anNtscFrameCarriesTwoHundredAndFortyLinesAndFlagsItsLast() {
    // The app decides the standard from the frame height alone, so a 240-line frame that still
    // flagged its last line at 268 would be reported as PAL however the machine was configured.
    val loop = content().videoLoopFor(MachineScreen.Ready, VideoStandard.NTSC)
    val packets = loop.slotPackets[1]
    val lines = packets.map { DemoStreamContent.readU16LE(it, 4) and 0x7fff }
    assertEquals((0 until 240 step DemoStreamContent.VIC_LINES_PER_PACKET).toList(), lines)

    val flagged = packets.indices.filter { DemoStreamContent.readU16LE(packets[it], 4) and DemoStreamContent.VIC_LAST_LINE_FLAG != 0 }
    assertEquals(listOf(packets.size - 1), flagged)
    assertEquals(236, DemoStreamContent.readU16LE(packets.last(), 4) and 0x7fff)

    assertEquals(
            DemoScreen.WIDTH * VideoStandard.NTSC.height / 2,
            packets.sumOf { it.size - DemoStreamContent.VIC_HEADER_BYTES },
    )
  }

  @Test
  fun theSystemModeSettingNamesTheStandard() {
    // The firmware's list is PAL, NTSC, PAL-60, NTSC-50 and the /L variants. What travels on the
    // wire is the LINE COUNT, which is what the prefix names, so the refresh suffix does not move
    // a mode to the other standard.
    assertEquals(VideoStandard.PAL, VideoStandard.fromSystemMode("PAL"))
    assertEquals(VideoStandard.PAL, VideoStandard.fromSystemMode("PAL-60"))
    assertEquals(VideoStandard.NTSC, VideoStandard.fromSystemMode("NTSC"))
    assertEquals(VideoStandard.NTSC, VideoStandard.fromSystemMode("NTSC-50"))
    assertEquals(VideoStandard.NTSC, VideoStandard.fromSystemMode("ntsc-50/l"))
    assertEquals("an unreadable value must not silently change the machine", VideoStandard.PAL, VideoStandard.fromSystemMode(null))
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
