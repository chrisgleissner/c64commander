/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin

/**
 * Everything Demo Mode's Live View sends, built once and then only replayed.
 *
 * The phone is both ends of this stream: it synthesises the packets AND decodes, assembles and
 * plays them. Generating each frame and each sample on the fly would spend, on the sending side,
 * the CPU the receiving side needs — 52224 bytes of pixel work per frame at 50 Hz plus a sine per
 * audio sample at 47983 Hz. So nothing is generated while the stream runs: this class pre-builds
 * one loop of ready-to-send datagrams, and [MockStreamServer] then does nothing per packet but
 * patch a two-byte sequence number and hand the same array to the socket again.
 *
 * The loop is the tone and colour ladder (`src/lib/streams/toneLadder.ts`) the app already uses to
 * grade a real device's stream: eighteen half-second slots — a silence, a C-major octave up, a
 * silence, the octave back down — with the screen BORDER stepping through all sixteen VIC colours,
 * one per note, exactly as the ladder's own SID does on real hardware. Reusing it means the
 * synthetic stream is gradable by the same instruments as a real one (pitch per note, note length,
 * silence floor, and the audio-to-video offset, since tone and colour change together), and it
 * sounds like a scale rather than a test tone.
 *
 * Video is one distinct frame per slot, sent [FRAMES_PER_SLOT] times. The text on the screen does
 * not change within a loop; only the border does. So a screen is drawn once and the eighteen slot
 * frames are that drawing with the border re-tinted, which is what keeps a screen change cheap
 * enough to do while the stream is running. Audio is the whole loop, pre-rendered.
 *
 * Both loops last exactly [loopNanos], derived from the audio sample count, so the picture cannot
 * drift against the sound however long the stream runs.
 */
class DemoStreamContent
private constructor(
        val slots: List<Slot>,
        /** The whole audio loop, already split into wire packets. */
        val audioPackets: List<ByteArray>,
        private val screenRenderer: DemoScreen,
) {
  /** One screen's eighteen slot frames, each already split into wire packets. */
  class VideoLoop(val slotPackets: List<List<ByteArray>>)

  /**
   * Build the frames for a screen.
   *
   * Called on a machine state change, not per frame: the text is drawn once and re-tinted per slot,
   * so a change costs one screen render plus eighteen border passes rather than eighteen renders.
   */
  fun videoLoopFor(screen: MachineScreen): VideoLoop {
    val base = screenRenderer.render(screen, slots[0].colour)
    return VideoLoop(slots.map { slot -> packetizeFrame(screenRenderer.retint(base, slot.colour)) })
  }
  /** One ladder slot: the note to sound (0 Hz for a silence) and the colour the surround holds. */
  data class Slot(val index: Int, val name: String, val hz: Double, val colour: Int)

  /** A slot as `tone-ladder.json` states it, before a silence inherits the colour before it. */
  private data class DeclaredSlot(val index: Int, val name: String, val hz: Double, val colour: Int?)

  val loopFrames: Int = slots.size * FRAMES_PER_SLOT
  val loopSamples: Int = audioPackets.size * AUDIO_SAMPLES_PER_PACKET
  val loopNanos: Long = loopSamples.toLong() * NANOS_PER_SECOND / AUDIO_SAMPLE_RATE
  val videoFrameIntervalNanos: Long = loopNanos / loopFrames
  val audioPacketIntervalNanos: Long = loopNanos / audioPackets.size

  companion object {
    // VIC wire format. Must match src/lib/streams/vicStream.ts and vicDecode.ts, and
    // StreamUdpPlugin's own copies, since those decoders are built against these constants.
    const val VIC_HEADER_BYTES = 12
    const val VIC_FRAME_WIDTH = 384
    const val VIC_PAL_HEIGHT = 272
    const val VIC_BYTES_PER_LINE = VIC_FRAME_WIDTH / 2 // 192, 4bpp
    const val VIC_BYTES_PER_FRAME = VIC_FRAME_WIDTH * VIC_PAL_HEIGHT / 2 // 52224
    const val VIC_LINES_PER_PACKET = 4
    const val VIC_BITS_PER_PIXEL = 4
    const val VIC_LAST_LINE_FLAG = 0x8000
    const val VIC_PACKETS_PER_FRAME = VIC_PAL_HEIGHT / VIC_LINES_PER_PACKET // 68

    // Audio wire format. Must match StreamUdpPlugin's AUDIO_SEQ_BYTES / AUDIO_BYTES_PER_FRAME and
    // DEFAULT_AUDIO_SAMPLE_RATE.
    const val AUDIO_SEQ_BYTES = 2
    const val AUDIO_BYTES_PER_FRAME = 4 // interleaved stereo S16LE
    const val AUDIO_SAMPLE_RATE = 47983
    /** ~4 ms per packet, the real device's cadence. */
    const val AUDIO_SAMPLES_PER_PACKET = 192

    /** PAL raster frames per ladder slot, as `toneLadder.ts` defines a slot. */
    const val FRAMES_PER_SLOT = 25

    private const val NANOS_PER_SECOND = 1_000_000_000L

    /** Peak amplitude, about -14.7 dBFS: audible on a phone speaker without being shrill. */
    private const val AMPLITUDE = 6000.0
    /** Raised-cosine attack and release, long enough to remove the click, short enough to leave
     * the onset sharp for the grader that measures note length from it. */
    private const val RAMP_SECONDS = 0.006

    /**
     * Build the loop from the committed assets.
     *
     * @param font `font8x8.bin`, 96 glyphs of 8 rows.
     * @param ladderJson `tone-ladder.json`, generated from `toneLadder.ts`.
     */
    fun from(font: ByteArray, ladderJson: String): DemoStreamContent {

      val slots = parseSlots(ladderJson)
      val audioPackets = renderAudioLoop(slots)
      return DemoStreamContent(slots, audioPackets, DemoScreen(font))
    }

    /**
     * Slots in play order, with each silence given the colour of the slot before it.
     *
     * `toneLadder.ts` leaves a silence's colour null because the real device simply does not write
     * the background register during it, so the previous colour stays on screen. The first slot is
     * a silence, so it holds the LAST slot's colour — which is what the loop actually shows on the
     * second and every later pass.
     */
    internal fun parseSlots(ladderJson: String): List<Slot> {
      val array = JSONObject(ladderJson).getJSONArray("slots")
      require(array.length() > 0) { "tone ladder has no slots" }
      val declared =
              (0 until array.length()).map { index ->
                val entry = array.getJSONObject(index)
                DeclaredSlot(
                        index = entry.getInt("index"),
                        name = entry.getString("name"),
                        hz = entry.getDouble("hz"),
                        colour = if (entry.isNull("colour")) null else entry.getInt("colour"),
                )
              }
      var carried =
              declared.lastOrNull { it.colour != null }?.colour ?: error("tone ladder has no slot with a colour")
      return declared.map { slot ->
        carried = slot.colour ?: carried
        Slot(index = slot.index, name = slot.name, hz = slot.hz, colour = carried)
      }
    }

    /**
     * Split a frame into its wire packets: [VIC_LINES_PER_PACKET]-line groups, each a 12-byte
     * little-endian header and its payload, last-line flag on the final packet. The sequence
     * number is left at zero — [MockStreamServer] patches it per send, which is what lets the same
     * arrays be reused for the whole run.
     */
    internal fun packetizeFrame(frame: ByteArray): List<ByteArray> =
            (0 until VIC_PACKETS_PER_FRAME).map { group ->
              val line = group * VIC_LINES_PER_PACKET
              val packet = ByteArray(VIC_HEADER_BYTES + VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE)
              writeU16LE(packet, 0, 0) // seq, patched per send
              writeU16LE(packet, 2, 0) // frame number, patched per send
              writeU16LE(
                      packet,
                      4,
                      (line and 0x7fff) or (if (group == VIC_PACKETS_PER_FRAME - 1) VIC_LAST_LINE_FLAG else 0),
              )
              writeU16LE(packet, 6, VIC_FRAME_WIDTH)
              packet[8] = VIC_LINES_PER_PACKET.toByte()
              packet[9] = VIC_BITS_PER_PIXEL.toByte()
              writeU16LE(packet, 10, 0)
              System.arraycopy(
                      frame,
                      line * VIC_BYTES_PER_LINE,
                      packet,
                      VIC_HEADER_BYTES,
                      VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE,
              )
              packet
            }

    /**
     * How many audio packets one loop is.
     *
     * The loop must be a whole number of packets (a partial packet has nowhere to go) and, so that
     * the eighteen slots come out the same length as each other, a sample count divisible by the
     * slot count. Rounding the ideal length to the nearest whole packet costs 1.5 ms across the
     * whole 9-second loop, which is far inside the ladder's own note-length tolerance, and leaves
     * 430848 samples — exactly 23936 per slot.
     */
    internal fun audioPacketsPerLoop(slotCount: Int, slotSeconds: Double): Int {
      val idealSamples = slotCount * slotSeconds * AUDIO_SAMPLE_RATE
      return (idealSamples / AUDIO_SAMPLES_PER_PACKET).roundToInt().coerceAtLeast(1)
    }

    private fun renderAudioLoop(slots: List<Slot>): List<ByteArray> {
      val packetCount = audioPacketsPerLoop(slots.size, FRAMES_PER_SLOT / PAL_REFRESH_HZ)
      val loopSamples = packetCount * AUDIO_SAMPLES_PER_PACKET
      val samplesPerSlot = loopSamples.toLong() / slots.size
      val rampSamples = (RAMP_SECONDS * AUDIO_SAMPLE_RATE).roundToLong().coerceAtLeast(1)
      return (0 until packetCount).map { packetIndex ->
        val packet = ByteArray(AUDIO_SEQ_BYTES + AUDIO_SAMPLES_PER_PACKET * AUDIO_BYTES_PER_FRAME)
        val firstSample = packetIndex.toLong() * AUDIO_SAMPLES_PER_PACKET
        for (offset in 0 until AUDIO_SAMPLES_PER_PACKET) {
          val sample = firstSample + offset
          val slot = slots[((sample / samplesPerSlot) % slots.size).toInt()]
          val value =
                  if (slot.hz <= 0.0) 0
                  else {
                    val positionInSlot = sample % samplesPerSlot
                    // Phase is measured from the slot's own start, not from the loop's, so every
                    // note begins at zero crossing and the loop joins itself without a click.
                    val phase = 2.0 * PI * slot.hz * (positionInSlot.toDouble() / AUDIO_SAMPLE_RATE)
                    val level = sin(phase) * AMPLITUDE * envelope(positionInSlot, samplesPerSlot, rampSamples)
                    level.roundToInt().coerceIn(-32768, 32767)
                  }
          val byteOffset = AUDIO_SEQ_BYTES + offset * AUDIO_BYTES_PER_FRAME
          writeU16LE(packet, byteOffset, value and 0xffff) // left
          writeU16LE(packet, byteOffset + 2, value and 0xffff) // right
        }
        packet
      }
    }

    /** Raised cosine in and out; 1.0 through the middle of the note. */
    internal fun envelope(positionInSlot: Long, samplesPerSlot: Long, rampSamples: Long): Double {
      val fromEnd = samplesPerSlot - positionInSlot
      val ramp =
              when {
                positionInSlot < rampSamples -> positionInSlot.toDouble() / rampSamples
                fromEnd < rampSamples -> fromEnd.toDouble() / rampSamples
                else -> return 1.0
              }
      return 0.5 - 0.5 * cos(PI * ramp.coerceIn(0.0, 1.0))
    }

    /**
     * The VIC's actual vertical refresh, 985248/19656 Hz — not a round 50. Taken from
     * `toneLadder.ts`, which uses it for the same reason: a timing fixture must not build in a
     * bias it then reports as a finding.
     */
    const val PAL_REFRESH_HZ = 985248.0 / 19656.0

    fun writeU16LE(buffer: ByteArray, offset: Int, value: Int) {
      buffer[offset] = (value and 0xff).toByte()
      buffer[offset + 1] = ((value ushr 8) and 0xff).toByte()
    }

    fun readU16LE(buffer: ByteArray, offset: Int): Int =
            (buffer[offset].toInt() and 0xff) or ((buffer[offset + 1].toInt() and 0xff) shl 8)
  }
}
