/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import java.io.File

/**
 * The HVSC release Demo Mode offers, built on this device the first time it is asked for.
 *
 * Demo Mode exists for someone who has the app and no Commodore 64 Ultimate, and increasingly for
 * someone who has neither that nor a network. Without a music collection the Play page is an empty
 * shell, which is the opposite of what the mode is for. So the demo serves an HVSC release of its
 * own: a few hundred tunes in the directory shape the real collection uses, packed into a genuine
 * `.7z` with the same 7-Zip binary the app ships for reading one.
 *
 * Built rather than shipped. A generated archive costs nothing in the APK and stays out of the
 * source tree; the alternative was carrying an archive as an asset, which grows every install for
 * a feature only the demo path uses.
 *
 * Packed with the app's own `lib7zz.so`, deliberately: the whole point of the demo is that the
 * real download-probe-extract-hydrate path runs, and a ZIP renamed `.7z` would take a different
 * branch of DefaultHvscArchiveExtractor than a real release does. If the binary is missing the
 * caller serves no release at all, and HVSC shows its ordinary "nothing installed" state.
 *
 * The tunes are invented and so are the composers. The FOLDERS mirror HVSC's real layout, because
 * that shape is what the app navigates and what a viewer recognises; the names inside them do not
 * borrow a living composer's catalogue to do it.
 */
class DemoHvscArchive(
        private val cacheDir: File,
        private val sevenZipExecutable: File?,
) {
  companion object {
    private const val TAG = "DemoHvscArchive"

    // The name the client scans the index for: HVSC_(\d+)-all-of-them.7z (hvscReleaseService.ts).
    const val RELEASE = 84
    const val ARCHIVE_NAME = "HVSC_$RELEASE-all-of-them.7z"

    // Enough that browsing, filtering and searching all have something to work on, and small
    // enough that packing and the app's own hydration both stay quick on a phone. Measured on the
    // emulator, this is a fraction of a second to pack and a couple of seconds to ingest; the real
    // collection is a hundred times larger and takes minutes.
    private const val TUNES = 480

    private val COMPOSERS =
            listOf(
                    "Barlow_Kit",
                    "Sidwell_Anna",
                    "Vance_Ruth",
                    "Okonkwo_Ada",
                    "Lindqvist_Nils",
                    "Moreau_Yves",
            )

    private val DEMO_GROUPS = listOf("0-9", "A-F", "G-L", "M-R", "S-Z")

    private val TITLES =
            listOf(
                    "Raster Bar Rag",
                    "Sprite Collision",
                    "Kernal Panic",
                    "Datasette Dreams",
                    "Blue Screen Waltz",
                    "Loading Screen",
                    "Ready Prompt",
                    "Border Flicker",
                    "Sixty Four Kilobytes",
                    "Cassette Rewind",
                    "Floppy Shuffle",
                    "Interrupt Lullaby",
            )
  }

  private var built: File? = null

  /** The packed release, or null when this device cannot build one. */
  @Synchronized
  fun archive(): File? {
    built?.let { if (it.isFile) return it }
    val executable = sevenZipExecutable
    if (executable == null || !executable.canExecute()) {
      Log.w(TAG, "No 7-Zip binary available; Demo Mode will offer no HVSC release")
      return null
    }
    return try {
      val packed = build(executable)
      built = packed
      packed
    } catch (error: Exception) {
      Log.w(TAG, "Could not build the demo HVSC release", error)
      null
    }
  }

  private fun build(executable: File): File {
    val work = File(cacheDir, "demo-hvsc")
    val target = File(work, ARCHIVE_NAME)
    if (target.isFile && target.length() > 0) return target

    work.deleteRecursively()
    val root = File(work, "C64Music")
    writeTree(root)

    // Store rather than compress: these files are tiny and already unique, so the time is all in
    // the container. `-y` because there is no console to answer a prompt.
    val process =
            ProcessBuilder(
                            executable.absolutePath,
                            "a",
                            "-t7z",
                            "-mx0",
                            "-y",
                            target.absolutePath,
                            root.absolutePath,
                    )
                    .directory(work)
                    .redirectErrorStream(true)
                    .start()
    val output = process.inputStream.bufferedReader().use { it.readText() }
    val status = process.waitFor()
    if (status != 0 || !target.isFile) {
      throw IllegalStateException("7-Zip exited $status while packing the demo release: $output")
    }
    Log.i(TAG, "Packed demo HVSC release: ${target.length()} bytes, $TUNES tunes")
    return target
  }

  private fun writeTree(root: File) {
    val documents = File(root, "DOCUMENTS").apply { mkdirs() }
    val songlengths = StringBuilder("[Database]\n")
    var written = 0

    fun tune(dir: File, title: String, index: Int) {
      dir.mkdirs()
      val file = File(dir, "$title.sid")
      file.writeBytes(psid(title, index))

      // Real Songlengths.md5 entries come in pairs: a comment line naming the tune's path, then
      // the MD5 and its durations. Both matter here. The durations are what the app shows, and
      // the PATH line is what puts the tune into the browse index at all — on Android the archive
      // is unpacked natively and the JS side learns which songs exist from this file, so a
      // songlengths file without path comments produces a library that browses from disk and
      // cannot be searched. That is exactly what the first version of this generator produced.
      //
      // mm:ss, with the seconds under sixty: an earlier version wrote `1:119`, and the app
      // rejected 200 of 480 entries as malformed.
      val seconds = 45 + (index % 200)
      val virtualPath = file.absolutePath.substringAfter(root.absolutePath)
      songlengths.append("; ").append(virtualPath).append('\n')
      songlengths.append(String.format("%032x=%d:%02d\n", index, seconds / 60, seconds % 60))
      written += 1
    }

    // MUSICIANS/<initial>/<Composer>/ — the shape the app's browser navigates.
    var index = 0
    while (written < TUNES / 2) {
      val composer = COMPOSERS[index % COMPOSERS.size]
      val initial = composer.first().uppercase()
      val title = TITLES[(index / COMPOSERS.size) % TITLES.size]
      val suffix = index / (COMPOSERS.size * TITLES.size)
      val name = if (suffix == 0) title else "$title ${suffix + 1}"
      tune(File(root, "MUSICIANS/$initial/$composer"), name, index)
      index += 1
    }

    // DEMOS/<range>/ and GAMES/<range>/ — the other two trees a viewer recognises.
    for (tree in listOf("DEMOS", "GAMES")) {
      var group = 0
      while (written < if (tree == "DEMOS") (TUNES * 3) / 4 else TUNES) {
        val range = DEMO_GROUPS[group % DEMO_GROUPS.size]
        val title = TITLES[index % TITLES.size]
        val suffix = index / TITLES.size
        tune(File(root, "$tree/$range"), if (suffix == 0) title else "$title ${suffix + 1}", index)
        index += 1
        group += 1
      }
    }

    File(documents, "Songlengths.md5").writeText(songlengths.toString())
    File(documents, "STIL.txt")
            .writeText(
                    """
                    #  STIL.txt - The SID Tune Information List, demonstration edition
                    #
                    #  This collection is generated on the device for Demo Mode. The tunes and the
                    #  composers are invented; only the directory layout follows the real one.
                    #
                    /MUSICIANS/B/Barlow_Kit/Raster Bar Rag.sid
                       COMMENT: Written for the Demo Mode walkthrough.
                    """.trimIndent(),
            )
  }

  /**
   * A minimal valid PSID v2 file: the 126-byte header the app's parsers read, then a few bytes
   * standing in for the player. Enough to be indexed, named and listed; not music.
   */
  private fun psid(title: String, index: Int): ByteArray {
    val body = ByteArray(126 + 32)
    "PSID".toByteArray(Charsets.US_ASCII).copyInto(body)
    body[4] = 0; body[5] = 2 // version 2
    body[6] = 0; body[7] = 0x7C // data offset 124
    // songs and startSong are 16-bit big-endian: the count belongs in the LOW byte. Writing it
    // into 0x0E declared 256 songs per file, which is what left the tune index unsearchable.
    body[0x0F] = 1 // songs
    body[0x10] = 0; body[0x11] = 1 // start song
    fun text(value: String, at: Int) {
      val bytes = value.take(31).toByteArray(Charsets.ISO_8859_1)
      bytes.copyInto(body, at)
    }
    text(title, 0x16)
    text(COMPOSERS[index % COMPOSERS.size].replace('_', ' '), 0x36)
    text("Demo Mode", 0x56)
    return body
  }
}
