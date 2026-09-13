/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.io.File
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URL
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
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
  private var server: MockC64UServer? = null

  @After
  fun stopServer() {
    server?.stop()
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

  private fun players(): List<ByteArray> =
          File(assetRoot, DemoHvscArchive.PLAYERS_ASSET_DIRECTORY)
                  .listFiles { file -> file.name.endsWith(".sid") }!!
                  .sortedBy { it.name }
                  .map { it.readBytes() }

  private fun headerText(bytes: ByteArray, at: Int): String =
          String(bytes, at, DemoHvscArchive.PSID_TEXT_BYTES, Charsets.ISO_8859_1).trimEnd('\u0000')

  private fun u16(bytes: ByteArray, at: Int) = ((bytes[at].toInt() and 0xff) shl 8) or (bytes[at + 1].toInt() and 0xff)

  @Test
  fun everyTuneReusesADeviceTunePlayerUnderItsOwnHeaderText() {
    val layout = DemoHvscArchive(temp.root, null, sourceAssets).layout()
    val players = players()
    val offset = DemoHvscArchive.PSID_DATA_OFFSET
    val usedPlayers = mutableSetOf<Int>()

    assertEquals(identities().size, layout.tunes.size)
    layout.tunes.forEach { tune ->
      val bytes = tune.bytes
      assertEquals("PSID", String(bytes, 0, 4, Charsets.US_ASCII))
      assertTrue("${tune.path} has no player after its header", bytes.size > offset)
      val code = bytes.copyOfRange(offset, bytes.size)
      val player = players.indexOfFirst { it.copyOfRange(offset, it.size).contentEquals(code) }
      assertTrue("${tune.path} does not carry a device tune's code", player >= 0)
      usedPlayers += player
      // Version, data offset, load, init and play addresses, song count and start song.
      for (field in listOf(0x04, 0x06, 0x08, 0x0A, 0x0C, 0x0E, 0x10)) {
        assertEquals("${tune.path} header word at $field", u16(players[player], field), u16(bytes, field))
      }
      assertTrue("${tune.path} has no init or play address", u16(bytes, 0x0A) != 0 && u16(bytes, 0x0C) != 0)
      assertEquals(tune.path.substringAfterLast('/').removeSuffix(".sid"), headerText(bytes, DemoHvscArchive.PSID_TITLE))
      assertTrue(headerText(bytes, DemoHvscArchive.PSID_AUTHOR).isNotEmpty())
      assertEquals(DemoHvscArchive.RELEASED, headerText(bytes, DemoHvscArchive.PSID_RELEASED))
    }
    assertEquals(players.indices.toSet(), usedPlayers)
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
  fun stilDescribesTwoTunesInThreeUsingStilFieldSyntax() {
    val layout = DemoHvscArchive(temp.root, null, sourceAssets).layout()
    val paths = layout.tunes.map { it.path }.toSet()
    val headings = layout.stil.lines().filter { it.startsWith("/") }

    assertTrue(headings.all { it in paths })
    assertEquals((layout.tunes.size + 2) / 3 + (layout.tunes.size + 1) / 3, headings.size)
    val fields = layout.stil.lines().filter { Regex("^ {0,3}(TITLE|ARTIST|COMMENT): ").containsMatchIn(it) }
    assertEquals(headings.size, fields.count { it.startsWith("COMMENT: ") })
    assertEquals((layout.tunes.size + 2) / 3, fields.count { it.startsWith("  TITLE: ") })
    assertEquals((layout.tunes.size + 2) / 3, fields.count { it.startsWith(" ARTIST: ") })
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

  private fun startServer(token: String): MockC64UServer {
    val state = MockC64UState.fromPayload(JSONObject())
    val demo = DemoHvscArchive(temp.newFolder("cache"), fakeSevenZip(), sourceAssets)
    val started = MockC64UServer(state, MockTimingProfile.defaultProfile(), token, null, null, demo)
    server = started
    started.start()
    repeat(20) {
      try {
        Socket("127.0.0.1", started.port).use {}
        return started
      } catch (error: Exception) {
        System.err.println("DemoHvscArchiveTest waiting for the mock server: ${error.message}")
        Thread.sleep(25)
      }
    }
    return started
  }

  private fun open(url: String, method: String): HttpURLConnection =
          (URL(url).openConnection() as HttpURLConnection).apply { requestMethod = method }

  @Test
  fun stilIsServedAtTheVersionedAndUnversionedPathsStilServiceTries() {
    val token = "demo-token"
    val started = startServer(token)
    val generated = DemoHvscArchive(temp.root, null, sourceAssets).layout().stil.toByteArray(Charsets.ISO_8859_1)

    for (path in listOf("C64Music.${DemoHvscArchive.RELEASE}/DOCUMENTS/STIL.txt", "C64Music/DOCUMENTS/STIL.txt")) {
      val get = open("${started.baseUrl}/hvsc/$token/$path", "GET")
      assertEquals(path, 200, get.responseCode)
      assertArrayEquals(path, generated, get.inputStream.use { it.readBytes() })
    }
    assertEquals(401, open("${started.baseUrl}/hvsc/wrong-token/C64Music/DOCUMENTS/STIL.txt", "GET").responseCode)
  }
}
