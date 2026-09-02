/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/**
 * What the simulated C64 has on its screen.
 *
 * Live View against real hardware shows whatever the machine is doing, so Demo Mode's Live View has
 * to as well: a BASIC prompt when nothing is running, a load in progress when the app has just told
 * the device to start something, the program's own screen while it runs. A single static picture
 * would make every machine action the app offers look like it did nothing.
 *
 * The simulated device cannot execute a real C64 program — that is the one hard wall here — so a
 * running program is drawn as a title card naming what was started and where it came from. That is
 * the honest thing to show: it says the app's command arrived and took effect, without pretending
 * to be an emulator.
 */
sealed interface MachineScreen {
  /** The screen a C64 shows when it is switched on. */
  data object Ready : MachineScreen

  /** `LOAD"NAME",8,1` and the messages the KERNAL prints while it works. */
  data class Loading(val name: String, val device: String) : MachineScreen

  /** A program the app started, named on its own title card. */
  data class Running(val name: String, val kind: String) : MachineScreen

  /**
   * A tune the app started. The sound comes from the phone's own SID engine.
   *
   * Named by file and mount, which is all the device is told: the real firmware's `runners:sidplay`
   * carries a path and nothing else, so inventing an author here would be the simulation showing
   * something a real Ultimate could not have known.
   */
  data class Playing(val name: String, val device: String) : MachineScreen

  data object Paused : MachineScreen

  data object Off : MachineScreen
}

/**
 * Draws a [MachineScreen] into the 4bpp VIC frame the stream carries.
 *
 * The text screen is 40x25 characters of 8x8, centred in the 384x272 frame the way a PAL VIC puts
 * 320x200 of text inside its border. The border colour is supplied per frame rather than baked in,
 * because the tone ladder steps it once per note and re-rendering the text 18 times to change one
 * colour would be most of a megabyte of pixel work for nothing.
 */
class DemoScreen(private val font: ByteArray) {
  init {
    require(font.size == GLYPH_COUNT * GLYPH_BYTES) {
      "font must be ${GLYPH_COUNT * GLYPH_BYTES} bytes, was ${font.size}"
    }
  }

  /** One frame: the text drawn on `background` in `foreground`, everything outside it `border`. */
  fun render(screen: MachineScreen, border: Int): ByteArray {
    val palette = paletteFor(screen)
    val frame = ByteArray(WIDTH * HEIGHT) { palette.background.toByte() }
    fillBorder(frame, border)
    val lines = linesFor(screen)
    for ((row, line) in lines.withIndex()) {
      if (row >= ROWS) break
      drawLine(frame, line, row, palette.foreground)
    }
    return pack(frame)
  }

  /** Replace only the border of an already-packed frame, which is all a ladder step changes. */
  fun retint(packed: ByteArray, border: Int): ByteArray {
    val out = packed.copyOf()
    val nibble = border and 0x0f
    for (y in 0 until HEIGHT) {
      for (x in 0 until WIDTH) {
        if (x >= TEXT_LEFT && x < TEXT_LEFT + COLUMNS * 8 && y >= TEXT_TOP && y < TEXT_TOP + ROWS * 8) continue
        val pixel = y * WIDTH + x
        val index = pixel ushr 1
        val current = out[index].toInt() and 0xff
        out[index] =
                if (pixel and 1 == 0) ((current and 0xf0) or nibble).toByte()
                else ((current and 0x0f) or (nibble shl 4)).toByte()
      }
    }
    return out
  }

  private data class Palette(val background: Int, val foreground: Int)

  private fun paletteFor(screen: MachineScreen): Palette =
          when (screen) {
            is MachineScreen.Off -> Palette(BLACK, BLACK)
            is MachineScreen.Running -> Palette(BLACK, LIGHT_GREEN)
            is MachineScreen.Playing -> Palette(BLACK, CYAN)
            is MachineScreen.Paused -> Palette(DARK_GREY, WHITE)
            else -> Palette(BLUE, LIGHT_BLUE)
          }

  private fun fillBorder(frame: ByteArray, border: Int) {
    for (y in 0 until HEIGHT) {
      for (x in 0 until WIDTH) {
        val inText = x >= TEXT_LEFT && x < TEXT_LEFT + COLUMNS * 8 && y >= TEXT_TOP && y < TEXT_TOP + ROWS * 8
        if (!inText) frame[y * WIDTH + x] = border.toByte()
      }
    }
  }

  private fun drawLine(frame: ByteArray, line: String, row: Int, colour: Int) {
    for (column in 0 until minOf(line.length, COLUMNS)) {
      val code = line[column].code
      val index = if (code < FIRST_CODE || code >= FIRST_CODE + GLYPH_COUNT) 0 else code - FIRST_CODE
      for (y in 0 until 8) {
        val bits = font[index * GLYPH_BYTES + y].toInt() and 0xff
        for (x in 0 until 8) {
          if (bits and (0x80 ushr x) == 0) continue
          frame[(TEXT_TOP + row * 8 + y) * WIDTH + TEXT_LEFT + column * 8 + x] = colour.toByte()
        }
      }
    }
  }

  private fun pack(indices: ByteArray): ByteArray {
    val packed = ByteArray(WIDTH * HEIGHT / 2)
    for (i in packed.indices) {
      val low = indices[i * 2].toInt() and 0x0f
      val high = indices[i * 2 + 1].toInt() and 0x0f
      packed[i] = ((high shl 4) or low).toByte()
    }
    return packed
  }

  companion object {
    const val WIDTH = 384
    const val HEIGHT = 272
    const val COLUMNS = 40
    const val ROWS = 25
    const val TEXT_LEFT = (WIDTH - COLUMNS * 8) / 2
    const val TEXT_TOP = (HEIGHT - ROWS * 8) / 2

    const val FIRST_CODE = 32
    const val GLYPH_COUNT = 96
    const val GLYPH_BYTES = 8

    private const val BLACK = 0
    private const val WHITE = 1
    private const val CYAN = 3
    private const val BLUE = 6
    private const val DARK_GREY = 11
    private const val LIGHT_GREEN = 13
    private const val LIGHT_BLUE = 14

    /** Centred in the 40 columns, the way a C64 program prints a title. */
    private fun centred(text: String): String {
      val clipped = text.take(COLUMNS)
      val pad = (COLUMNS - clipped.length) / 2
      return " ".repeat(pad) + clipped
    }

    internal fun linesFor(screen: MachineScreen): List<String> =
            when (screen) {
              is MachineScreen.Ready ->
                      listOf(
                              "",
                              "    **** COMMODORE 64 BASIC V2 ****",
                              "",
                              " 64K RAM SYSTEM  38911 BASIC BYTES FREE",
                              "",
                              "READY.",
                              "",
                      )
              is MachineScreen.Loading ->
                      listOf(
                              "",
                              "    **** COMMODORE 64 BASIC V2 ****",
                              "",
                              " 64K RAM SYSTEM  38911 BASIC BYTES FREE",
                              "",
                              "READY.",
                              "LOAD\"${screen.name.uppercase().take(16)}\",8,1",
                              "",
                              "SEARCHING FOR ${screen.name.uppercase().take(16)}",
                              "LOADING",
                              "",
                              "FROM ${screen.device.uppercase()}",
                      )
              is MachineScreen.Running ->
                      listOf(
                              "",
                              "",
                              centred("C64 COMMANDER"),
                              centred("SIMULATED DEVICE"),
                              "",
                              centred("- NOW RUNNING -"),
                              "",
                              centred(screen.name.uppercase()),
                              "",
                              centred("(${screen.kind.uppercase()})"),
                              "",
                              "",
                              centred("THE SIMULATED C64 CANNOT EXECUTE"),
                              centred("A REAL PROGRAM, SO THIS SCREEN"),
                              centred("STANDS IN FOR IT. EVERYTHING ELSE"),
                              centred("BEHAVES AS IT DOES ON HARDWARE."),
                      )
              is MachineScreen.Playing ->
                      listOf(
                              "",
                              "",
                              centred("C64 COMMANDER"),
                              centred("SIMULATED DEVICE"),
                              "",
                              centred("- NOW PLAYING -"),
                              "",
                              centred(screen.name.uppercase()),
                              centred("FROM ${screen.device.uppercase()}"),
                              "",
                              "",
                              centred("THE SIMULATED DEVICE HAS NO SID"),
                              centred("CHIP, SO THE SOUND IS COMING"),
                              centred("FROM THIS PHONE'S OWN ENGINE."),
                      )
              is MachineScreen.Paused ->
                      listOf("", "", centred("C64 COMMANDER"), centred("SIMULATED DEVICE"), "", centred("- PAUSED -"))
              is MachineScreen.Off -> emptyList()
            }
  }
}
