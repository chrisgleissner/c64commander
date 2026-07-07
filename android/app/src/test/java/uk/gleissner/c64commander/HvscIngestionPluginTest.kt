package uk.gleissner.c64commander

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import java.io.File
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import uk.gleissner.c64commander.hvsc.ArchiveProfile
import uk.gleissner.c64commander.hvsc.ExtractionProgress
import uk.gleissner.c64commander.hvsc.ExtractionResult
import uk.gleissner.c64commander.hvsc.HvscArchiveExtractor
import uk.gleissner.c64commander.hvsc.HvscArchiveMode
import uk.gleissner.c64commander.hvsc.MemoryBudget

private open class TestableHvscIngestionPlugin : HvscIngestionPlugin() {
  val progressEvents = mutableListOf<JSObject>()
  var fakeExtractor: HvscArchiveExtractor? = null

  public override fun notifyListeners(eventName: String?, data: JSObject?) {
    if (eventName == "hvscProgress" && data != null) {
      progressEvents.add(data)
    }
    super.notifyListeners(eventName, data)
  }

  // Lets a test drive the full ingestHvsc() coroutine pipeline (SQLite,
  // deletion application, payload construction) with a canned extraction
  // result instead of a real 7z/zip archive.
  public override fun createArchiveExtractor(): HvscArchiveExtractor = fakeExtractor ?: super.createArchiveExtractor()
}

@RunWith(RobolectricTestRunner::class)
class HvscIngestionPluginTest {
  private lateinit var context: Context
  private lateinit var plugin: TestableHvscIngestionPlugin

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    plugin = TestableHvscIngestionPlugin()
    injectBridge(plugin, context)
  }

  private fun injectBridge(target: Plugin, ctx: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(ctx)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun ingestHvscRejectsMissingArchivePath() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn(null)

    plugin.ingestHvsc(call)

    verify(call).reject("relativeArchivePath is required")
    verify(call, never()).resolve(any(JSObject::class.java))
  }

  @Test
  fun ingestHvscRejectsInvalidMode() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn("hvsc-baseline-1.7z")
    `when`(call.getString("mode")).thenReturn("invalid")

    plugin.ingestHvsc(call)

    verify(call).reject("mode must be baseline or update")
    verify(call, never()).resolve(any(JSObject::class.java))
  }

  @Test
  fun cancelIngestionAlwaysResolves() {
    val call = mock(PluginCall::class.java)

    plugin.cancelIngestion(call)

    verify(call).resolve()
  }

  @Test
  fun getIngestionStatsResolvesWithMetadataRows() {
    val call = mock(PluginCall::class.java)
    val resolveLatch = CountDownLatch(1)
    val payloadHolder = arrayOfNulls<JSObject>(1)

    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              resolveLatch.countDown()
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.getIngestionStats(call)

    assertTrue(resolveLatch.await(5, TimeUnit.SECONDS))
    assertTrue((payloadHolder[0]?.getLong("metadataRows") ?: -1L) >= 0L)
  }
  @Test
  fun emitProgressPublishesExpectedPayloadShape() {
    val method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "emitProgress",
                    String::class.java,
                    String::class.java,
                    Int::class.javaPrimitiveType,
                    Int::class.javaObjectType,
                    String::class.java,
                    Int::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType,
            )
    method.isAccessible = true

    method.invoke(
            plugin,
            "sid_metadata_parsing",
            "Processing HVSC archive…",
            12,
            20,
            "/MUSICIANS/A/Artist/Tiny.sid",
            5,
            1,
    )

    assertTrue(plugin.progressEvents.isNotEmpty())
    val event = plugin.progressEvents.last()
    assertEquals("sid_metadata_parsing", event.getString("stage"))
    assertEquals(12, event.getInt("processedCount"))
    assertEquals(20, event.getInt("totalCount"))
    assertEquals(60, event.getInt("percent"))
    assertEquals(5, event.getInt("songsUpserted"))
    assertEquals(1, event.getInt("songsDeleted"))
  }

  @Test
  fun buildIngestionFailureMessageClassifiesUnsupportedSevenZipMethod() {
    val method: Method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "buildIngestionFailureMessage",
                    Exception::class.java,
            )
    method.isAccessible = true

    val result =
            method.invoke(
                    plugin,
                    IllegalStateException(
                            "Unsupported compression method [3, 4, 1] used in entry demo.7z"
                    ),
            ) as
                    String

    assertEquals(
            "HVSC 7z method chain [3, 4, 1] is unsupported by the bundled upstream extractor",
            result,
    )
  }

  @Test
  fun resolveBundledSevenZipExecutableUsesNativeLibraryPathRegression() {
    val nativeLibraryDir = File(context.filesDir, "native-libs-test")
    context.applicationInfo.nativeLibraryDir = nativeLibraryDir.absolutePath
    nativeLibraryDir.mkdirs()
    val bundledExecutable = File(nativeLibraryDir, "lib7zz.so")
    bundledExecutable.writeText("fake-7zip-binary")

    val resolvedExecutable = plugin.resolveBundledSevenZipExecutable()

    assertEquals(bundledExecutable.absolutePath, resolvedExecutable.absolutePath)
    assertEquals("fake-7zip-binary", resolvedExecutable.readText())
  }

  private fun makeCallWithData(
          relativeArchivePath: String,
          offsetBytes: Long?,
          lengthBytes: Int
  ): PluginCall {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn(relativeArchivePath)
    `when`(call.getInt("lengthBytes")).thenReturn(lengthBytes)
    val data = JSObject()
    if (offsetBytes != null) {
      data.put("offsetBytes", offsetBytes)
    }
    `when`(call.getData()).thenReturn(data)
    return call
  }

  @Test
  fun readArchiveChunkReturnsBoundedBase64Payload() {
    val archiveDir = File(context.filesDir, "hvsc/cache")
    archiveDir.mkdirs()
    val archiveFile = File(archiveDir, "baseline.7z")
    archiveFile.writeBytes(byteArrayOf(1, 2, 3, 4, 5, 6))

    val call = makeCallWithData("hvsc/cache/baseline.7z", 2L, 3)

    val payloadHolder = arrayOfNulls<JSObject>(1)
    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.readArchiveChunk(call)

    val payload = payloadHolder[0]
    assertEquals(3, payload?.getInteger("sizeBytes"))
    assertEquals(false, payload?.getBoolean("eof"))
    assertEquals("AwQF", payload?.getString("data"))
  }

  @Test
  fun readArchiveChunkAcceptsZeroOffsetBytesRegression() {
    // Regression for R11-001: offsetBytes=0 was incorrectly rejected because
    // call.getLong("offsetBytes") returns null for JSON integer value 0 in some
    // Capacitor versions. The fix reads from call.data directly.
    val archiveDir = File(context.filesDir, "hvsc/cache")
    archiveDir.mkdirs()
    val archiveFile = File(archiveDir, "zero-offset.7z")
    archiveFile.writeBytes(byteArrayOf(7, 8, 9))

    val call = makeCallWithData("hvsc/cache/zero-offset.7z", 0L, 3)

    val payloadHolder = arrayOfNulls<JSObject>(1)
    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.readArchiveChunk(call)

    val payload = payloadHolder[0]
    assertEquals(3, payload?.getInteger("sizeBytes"))
    assertEquals(true, payload?.getBoolean("eof"))
  }

  @Test
  fun readArchiveChunkMarksEofWhenOffsetStartsAtFinalByteRange() {
    val archiveDir = File(context.filesDir, "hvsc/cache")
    archiveDir.mkdirs()
    val archiveFile = File(archiveDir, "final-range.7z")
    archiveFile.writeBytes(byteArrayOf(10, 11, 12, 13, 14, 15))

    val call = makeCallWithData("hvsc/cache/final-range.7z", 4L, 8)

    val payloadHolder = arrayOfNulls<JSObject>(1)
    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.readArchiveChunk(call)

    val payload = payloadHolder[0]
    assertEquals(2, payload?.getInteger("sizeBytes"))
    assertEquals(true, payload?.getBoolean("eof"))
    assertEquals("Dg8=", payload?.getString("data"))
  }

  @Test
  fun readArchiveChunkRejectsMissingOffsetBytes() {
    val call = makeCallWithData("hvsc/cache/missing.7z", null, 4)

    plugin.readArchiveChunk(call)

    verify(call).reject("offsetBytes is required")
    verify(call, never()).resolve(any(JSObject::class.java))
  }

  @Test
  fun readArchiveChunkRejectsNegativeOffsetsBeforeTouchingFilesystem() {
    val call = makeCallWithData("hvsc/cache/missing.7z", -1L, 4)

    plugin.readArchiveChunk(call)

    verify(call).reject("offsetBytes must be >= 0")
    verify(call, never()).resolve(any(JSObject::class.java))
  }

  @Test
  fun buildIngestionFailureMessageDescribesCorruptArchiveOnOffsetBytesError() {
    val method: Method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "buildIngestionFailureMessage",
                    Exception::class.java,
            )
    method.isAccessible = true

    val result =
            method.invoke(
                    plugin,
                    java.io.IOException("offset bytes must be larger equal zero"),
            ) as
                    String

    assertEquals("HVSC archive is corrupt or truncated; please re-download", result)
  }

  @Test
  fun buildIngestionFailureMessageDescribesCorruptArchiveOnUnexpectedEofError() {
    val method: Method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "buildIngestionFailureMessage",
                    Exception::class.java,
            )
    method.isAccessible = true

    val result =
            method.invoke(
                    plugin,
                    java.io.IOException("unexpected end of archive reading header"),
            ) as
                    String

    assertEquals("HVSC archive is corrupt or truncated; please re-download", result)
  }

  @Test
  fun buildIngestionFailureMessagePassesThroughUnrecognisedErrors() {
    val method: Method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "buildIngestionFailureMessage",
                    Exception::class.java,
            )
    method.isAccessible = true

    val result =
            method.invoke(
                    plugin,
                    RuntimeException("something entirely unrelated"),
            ) as
                    String

    assertEquals("something entirely unrelated", result)
  }

  // ---------------------------------------------------------------------
  // HARD9-013: withContext(Dispatchers.Main) inside a cancelled coroutine's
  // catch block never runs its lambda, so a bare `call.reject(...)` there
  // (as ingestHvsc's CancellationException and generic Exception catch
  // blocks used before the fix) never reaches the JS side - the awaited
  // ingestHvsc() promise hangs forever after cancelIngestion() is called.
  // These two tests isolate and deterministically prove the exact
  // coroutines mechanism the fix (withContext(NonCancellable +
  // Dispatchers.Main)) relies on, without needing to race the real
  // ingestion pipeline's asynchronous cancellation timing.
  // ---------------------------------------------------------------------

  @Test
  fun withContextOnCancelledJobSkipsItsBlockWithoutNonCancellable() {
    val delivered = CountDownLatch(1)
    val started = CountDownLatch(1)
    val proceed = CountDownLatch(1)
    val completion = CountDownLatch(1)
    val job = Job()
    val scope = CoroutineScope(Dispatchers.IO + job)

    scope.launch {
      started.countDown()
      proceed.await(5, TimeUnit.SECONDS) // park until the test cancels the job from outside
      try {
        withContext(Dispatchers.Main) { delivered.countDown() }
      } catch (_: CancellationException) {
        // expected: withContext threw on entry instead of running its block
      } finally {
        completion.countDown()
      }
    }

    assertTrue(started.await(5, TimeUnit.SECONDS))
    job.cancel()
    proceed.countDown()

    assertTrue(completion.await(5, TimeUnit.SECONDS))
    assertEquals(1L, delivered.count) // never counted down - block never ran
  }

  @Test
  fun withContextNonCancellableStillDeliversAfterJobCancellation() {
    val delivered = CountDownLatch(1)
    val started = CountDownLatch(1)
    val proceed = CountDownLatch(1)
    val completion = CountDownLatch(1)
    val job = Job()
    val scope = CoroutineScope(Dispatchers.IO + job)

    scope.launch {
      started.countDown()
      proceed.await(5, TimeUnit.SECONDS)
      try {
        withContext(NonCancellable + Dispatchers.Main) { delivered.countDown() }
      } finally {
        completion.countDown()
      }
    }

    assertTrue(started.await(5, TimeUnit.SECONDS))
    job.cancel()
    proceed.countDown()

    // Unlike the cancelled-and-thrown-immediately path in the previous test,
    // withContext(NonCancellable + ...) really does dispatch its block onto
    // Dispatchers.Main - which under Robolectric queues onto the shadow main
    // looper instead of running inline, so this thread (the JUnit runner
    // thread, which Robolectric treats as "main") must pump it explicitly.
    val deadline = System.currentTimeMillis() + 5000
    while (completion.count > 0 && System.currentTimeMillis() < deadline) {
      org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
      Thread.sleep(10)
    }

    assertTrue(completion.await(0, TimeUnit.SECONDS))
    assertTrue(delivered.await(0, TimeUnit.SECONDS))
  }

  // ---------------------------------------------------------------------
  // HARD9-040: a failed baseline promotion (staging -> library directory
  // swap) could delete the last surviving copy of the user's HVSC library,
  // and a promotion that failed but recovered could leave the DB rewrite
  // (which used to commit before the swap) describing files that no longer
  // matched what was actually on disk. promoteBaselineLibrary and
  // cleanupHvscOldRootIfLibraryPresent are exercised directly via
  // reflection, since driving this through the full ingestHvsc() pipeline
  // needs a real 7z archive.
  // ---------------------------------------------------------------------

  private fun openHvscSongIndexTestDb(): SQLiteDatabase {
    val db = SQLiteDatabase.create(null)
    db.execSQL(
            """
        CREATE TABLE hvsc_song_index (
          virtual_path TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          songs INTEGER,
          start_song INTEGER,
          updated_at_ms INTEGER NOT NULL
        )
      """.trimIndent(),
    )
    return db
  }

  private fun songIndexRowCount(db: SQLiteDatabase): Int {
    db.rawQuery("SELECT COUNT(*) FROM hvsc_song_index", null).use { cursor ->
      cursor.moveToFirst()
      return cursor.getInt(0)
    }
  }

  private fun invokePromoteBaselineLibrary(
          libraryRoot: File,
          stagingRoot: File,
          oldRoot: File,
          db: SQLiteDatabase,
  ) {
    val method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "promoteBaselineLibrary",
                    File::class.java,
                    File::class.java,
                    File::class.java,
                    SQLiteDatabase::class.java,
                    List::class.java,
                    Long::class.javaPrimitiveType,
            )
    method.isAccessible = true
    try {
      method.invoke(plugin, libraryRoot, stagingRoot, oldRoot, db, emptyList<Any>(), 1000L)
    } catch (wrapped: InvocationTargetException) {
      throw wrapped.targetException
    }
  }

  @Test
  fun promoteBaselineLibrarySwapsStagingIntoLibraryAndCommitsDb() {
    val root = File(context.filesDir, "hvsc-promote-happy")
    root.deleteRecursively()
    val libraryRoot = File(root, "library").apply { mkdirs() }
    File(libraryRoot, "old.sid").writeText("OLD")
    val stagingRoot = File(root, "library-staging").apply { mkdirs() }
    File(stagingRoot, "new.sid").writeText("NEW")
    val oldRoot = File(root, "library-old")

    val db = openHvscSongIndexTestDb()
    db.execSQL(
            "INSERT INTO hvsc_song_index (virtual_path, file_name, updated_at_ms) " +
                    "VALUES ('/OLD/Song.sid', 'Song.sid', 0)"
    )

    try {
      invokePromoteBaselineLibrary(libraryRoot, stagingRoot, oldRoot, db)

      assertTrue(libraryRoot.exists())
      assertTrue(File(libraryRoot, "new.sid").exists())
      assertTrue(!File(libraryRoot, "old.sid").exists())
      assertTrue(!stagingRoot.exists())
      assertTrue(!oldRoot.exists())
      assertEquals(0, songIndexRowCount(db))
    } finally {
      db.close()
      root.deleteRecursively()
    }
  }

  @Test
  fun promoteBaselineLibraryLeavesOriginalLibraryUntouchedWhenFirstRenameFails() {
    val root = File(context.filesDir, "hvsc-promote-first-rename-fails")
    root.deleteRecursively()
    val libraryRoot = File(root, "library").apply { mkdirs() }
    File(libraryRoot, "old.sid").writeText("OLD")
    val stagingRoot = File(root, "library-staging").apply { mkdirs() }
    File(stagingRoot, "new.sid").writeText("NEW")
    // A regular file already occupies the rename target: renaming a
    // directory onto an existing non-directory reliably fails on POSIX.
    val oldRoot = File(root, "library-old").apply { writeText("OCCUPIED") }

    val db = openHvscSongIndexTestDb()
    db.execSQL(
            "INSERT INTO hvsc_song_index (virtual_path, file_name, updated_at_ms) " +
                    "VALUES ('/OLD/Song.sid', 'Song.sid', 0)"
    )

    try {
      var thrown: Throwable? = null
      try {
        invokePromoteBaselineLibrary(libraryRoot, stagingRoot, oldRoot, db)
      } catch (error: Throwable) {
        thrown = error
      }

      assertTrue(thrown is IllegalStateException)
      assertTrue(thrown!!.message!!.contains("Failed to rename library to old"))
      assertTrue(libraryRoot.exists())
      assertEquals("OLD", File(libraryRoot, "old.sid").readText())
      assertTrue(stagingRoot.exists())
      assertEquals("NEW", File(stagingRoot, "new.sid").readText())
      assertEquals(1, songIndexRowCount(db)) // DB never touched
    } finally {
      db.close()
      root.deleteRecursively()
    }
  }

  @Test
  fun promoteBaselineLibraryRecoversAndLeavesDbUntouchedWhenStagingRenameFails() {
    val root = File(context.filesDir, "hvsc-promote-second-rename-fails")
    root.deleteRecursively()
    val libraryRoot = File(root, "library").apply { mkdirs() }
    File(libraryRoot, "old.sid").writeText("OLD")
    // stagingRoot deliberately does not exist: renameTo on a non-existent
    // source fails without ever touching libraryRoot's path, isolating the
    // "staging -> library" rename failure from the first rename.
    val stagingRoot = File(root, "library-staging")
    val oldRoot = File(root, "library-old")

    val db = openHvscSongIndexTestDb()
    db.execSQL(
            "INSERT INTO hvsc_song_index (virtual_path, file_name, updated_at_ms) " +
                    "VALUES ('/OLD/Song.sid', 'Song.sid', 0)"
    )

    try {
      var thrown: Throwable? = null
      try {
        invokePromoteBaselineLibrary(libraryRoot, stagingRoot, oldRoot, db)
      } catch (error: Throwable) {
        thrown = error
      }

      assertTrue(thrown is IllegalStateException)
      assertTrue(thrown!!.message!!.contains("Failed to promote staging directory"))
      // Recovery succeeded: the original library is back in place.
      assertTrue(libraryRoot.exists())
      assertEquals("OLD", File(libraryRoot, "old.sid").readText())
      assertTrue(!oldRoot.exists())
      // The DB rewrite runs after the swap, so a swap failure never reaches
      // it - it still matches the recovered (old) library on disk.
      assertEquals(1, songIndexRowCount(db))
    } finally {
      db.close()
      root.deleteRecursively()
    }
  }

  @Test
  fun cleanupHvscOldRootIfLibraryPresentPreservesOldRootWhenLibraryMissingRegression() {
    // This is the exact HARD9-040 data-loss scenario: a promotion failed and
    // its own recovery also failed, so libraryRoot does not exist and
    // oldRoot is the sole surviving copy of the user's library. Pre-fix,
    // the cleanup that ran here was unconditional and would have deleted it.
    val method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "cleanupHvscOldRootIfLibraryPresent",
                    File::class.java,
                    File::class.java,
            )
    method.isAccessible = true

    val root = File(context.filesDir, "hvsc-cleanup-guard-missing")
    root.deleteRecursively()
    val libraryRoot = File(root, "library") // deliberately does not exist
    val oldRoot = File(root, "library-old").apply { mkdirs() }
    File(oldRoot, "surviving.sid").writeText("LAST COPY")

    try {
      method.invoke(plugin, libraryRoot, oldRoot)

      assertTrue(
              "oldRoot must survive when libraryRoot does not exist - it may be the only copy",
              oldRoot.exists(),
      )
      assertEquals("LAST COPY", File(oldRoot, "surviving.sid").readText())
    } finally {
      root.deleteRecursively()
    }
  }

  @Test
  fun cleanupHvscOldRootIfLibraryPresentDeletesOldRootWhenLibraryExists() {
    val method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "cleanupHvscOldRootIfLibraryPresent",
                    File::class.java,
                    File::class.java,
            )
    method.isAccessible = true

    val root = File(context.filesDir, "hvsc-cleanup-guard-present")
    root.deleteRecursively()
    val libraryRoot = File(root, "library").apply { mkdirs() }
    val oldRoot = File(root, "library-old").apply { mkdirs() }
    File(oldRoot, "superseded.sid").writeText("STALE")

    try {
      method.invoke(plugin, libraryRoot, oldRoot)

      assertTrue(!oldRoot.exists())
    } finally {
      root.deleteRecursively()
    }
  }

  // ---------------------------------------------------------------------
  // HARD18-028: the native update path computed deletedVirtualPaths (via
  // applyDeletionFiles) but never included them in the resolved payload -
  // only a count. The JS browse-index snapshot that serves Play page
  // browsing/search had no way to learn WHICH songs to remove, so deleted
  // songs stayed listed/searchable forever. Driven through the full
  // ingestHvsc() coroutine pipeline (real SQLite + real file deletion) with
  // a fake HvscArchiveExtractor standing in for a real 7z/zip archive.
  // ---------------------------------------------------------------------

  private fun fakeExtractionResult(deletionPaths: List<String>): ExtractionResult =
          ExtractionResult(
                  profile =
                          ArchiveProfile(
                                  format = "zip",
                                  methodChain = null,
                                  dictionaryBytes = null,
                                  solid = null,
                                  blocks = null,
                                  entryCount = 1,
                                  fileCount = 1,
                                  directoryCount = 0,
                                  sidFileCount = 0,
                                  songlengthFiles = 0,
                                  encryptedEntries = 0,
                                  uncompressedSizeBytes = 0L,
                                  estimatedRequiredBytes = 0L,
                          ),
                  totalEntries = 1,
                  songsIngested = 0,
                  failedSongs = 0,
                  failedPaths = emptyList(),
                  songlengthFilesWritten = 0,
                  deletionPaths = deletionPaths,
                  extractedSongs = emptyList(),
          )

  @Test
  fun ingestHvscUpdatePropagatesDeletedVirtualPathsIntoResolvedPayload() {
    val deletionPaths = listOf("MUSICIANS/T/Tester/Old.sid")
    val testablePlugin = TestableHvscIngestionPlugin()
    injectBridge(testablePlugin, context)
    testablePlugin.fakeExtractor = FakeHvscArchiveExtractor(fakeExtractionResult(deletionPaths))

    val libraryRoot = File(context.filesDir, "hvsc/library")
    val staleSong = File(libraryRoot, "MUSICIANS/T/Tester/Old.sid")
    staleSong.parentFile?.mkdirs()
    staleSong.writeText("PSID-stale-fixture")

    val archiveFile = File(context.filesDir, "hvsc-cache/fake-update.7z")
    archiveFile.parentFile?.mkdirs()
    archiveFile.writeText("not-a-real-archive-body")

    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn("hvsc-cache/fake-update.7z")
    `when`(call.getString("mode")).thenReturn("update")
    `when`(call.getBoolean("resetLibrary", false)).thenReturn(false)
    `when`(call.getInt("progressEvery", 250)).thenReturn(250)
    `when`(call.getInt("dbBatchSize", 500)).thenReturn(500)
    `when`(call.getInt("minExpectedRows", 0)).thenReturn(0)
    `when`(call.getBoolean("debugHeapLogging", false)).thenReturn(false)

    val resolveLatch = CountDownLatch(1)
    val payloadHolder = arrayOfNulls<JSObject>(1)
    val rejectionHolder = arrayOfNulls<String>(1)
    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              resolveLatch.countDown()
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))
    doAnswer { invocation ->
              rejectionHolder[0] = invocation.getArgument<String?>(0) ?: "(no message)"
              resolveLatch.countDown()
              null
            }
            .`when`(call)
            .reject(any(String::class.java), any(Exception::class.java))

    try {
      testablePlugin.ingestHvsc(call)

      // ingestHvsc runs its work on Dispatchers.IO (a real background thread)
      // and only hops to Dispatchers.Main to call call.resolve/reject - which
      // under Robolectric queues onto the shadow main looper instead of
      // running inline, so this thread (the JUnit runner thread, which
      // Robolectric treats as "main") must pump it explicitly. See the
      // withContext(...Dispatchers.Main) tests above for the same pattern.
      val deadline = System.currentTimeMillis() + 10_000
      while (resolveLatch.count > 0 && System.currentTimeMillis() < deadline) {
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        Thread.sleep(10)
      }

      assertTrue(resolveLatch.await(0, TimeUnit.SECONDS))
      assertEquals(null, rejectionHolder[0])
      val payload = payloadHolder[0] ?: error("ingestHvsc never resolved a payload")

      assertEquals(1, payload.getInt("songsDeleted"))
      val deletedVirtualPaths = payload.getJSONArray("deletedVirtualPaths")
      assertEquals(1, deletedVirtualPaths.length())
      assertEquals("/MUSICIANS/T/Tester/Old.sid", deletedVirtualPaths.getString(0))
      assertTrue("deleted file must actually be removed from disk", !staleSong.exists())
    } finally {
      File(context.filesDir, "hvsc").deleteRecursively()
      File(context.filesDir, "hvsc-cache").deleteRecursively()
    }
  }
}

private class FakeHvscArchiveExtractor(private val result: ExtractionResult) : HvscArchiveExtractor {
  override fun probe(archiveFile: File, mode: HvscArchiveMode, cancellationToken: AtomicBoolean): ArchiveProfile =
          result.profile

  override fun extract(
          archiveFile: File,
          outputDir: File,
          mode: HvscArchiveMode,
          cancellationToken: AtomicBoolean,
          memoryBudget: MemoryBudget,
          onProgress: (ExtractionProgress) -> Unit,
  ): ExtractionResult = result
}
