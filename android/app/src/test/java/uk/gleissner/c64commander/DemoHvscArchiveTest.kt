/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Generates the demo release from the committed assets the APK ships, read from `src/main/assets`. */
class DemoHvscArchiveTest {
  @get:Rule val temp = TemporaryFolder()

  private val assetRoot = File("src/main/assets")
  private val sourceAssets =
          object : DemoHvscAssets {
            override fun list(directory: String) = File(assetRoot, directory).list()?.toList().orEmpty()

            override fun read(path: String) = File(assetRoot, path).readBytes()
          }

  /** Stands in for `lib7zz.so`: `a -t7z -mx0 -y <target> <root>` writes the packed file list. */
  private fun fakeSevenZip(): File =
          temp.newFile("7zz").apply {
            writeText("#!/bin/sh\ncd \"$6\" && find . -type f | sort > \"$5\"\n")
            setExecutable(true)
          }

  private fun identities(): List<String> =
          File(assetRoot, DemoHvscArchive.IDENTITIES_ASSET).readLines().filter {
            it.isNotBlank() && !it.startsWith("#")
          }

  @Test
  fun songlengthsListEveryTuneUnderItsCorpusIdentityPaddedToAFullMd5() {
    val layout = DemoHvscArchive(temp.root, null, sourceAssets).layout()
    val lines = layout.songlengths.lines().filter { it.isNotEmpty() }

    assertEquals("[Database]", lines.first())
    val pairs = lines.drop(1).chunked(2)
    assertEquals(layout.tunes.size, pairs.size)
    pairs.forEachIndexed { index, (pathLine, entryLine) ->
      assertEquals("; ${layout.tunes[index].path}", pathLine)
      assertTrue(entryLine, entryLine.matches(Regex("^[0-9a-f]{32}=\\d+:[0-5]\\d$")))
      assertEquals(identities()[index] + "0".repeat(20), entryLine.substringBefore('='))
    }
  }

  @Test
  fun aCachedArchiveFromEarlierGeneratedContentIsReplaced() {
    val stale = File(temp.root, "demo-hvsc/${DemoHvscArchive.ARCHIVE_NAME}").apply {
      parentFile?.mkdirs()
      writeText("archive with the previous generator's tunes")
    }
    val archive = DemoHvscArchive(temp.root, fakeSevenZip(), sourceAssets).archive()

    assertNotNull(archive)
    assertFalse(stale.exists())
    val packed = archive!!.readLines()
    assertTrue(packed.contains("./DOCUMENTS/STIL.txt"))
    assertTrue(packed.contains("./DOCUMENTS/Songlengths.md5"))
    assertEquals(identities().size, packed.count { it.endsWith(".sid") })
  }
}
