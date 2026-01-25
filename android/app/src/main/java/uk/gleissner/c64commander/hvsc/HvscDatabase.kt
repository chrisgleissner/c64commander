package uk.gleissner.c64commander.hvsc

interface HvscDatabase {
  fun getMeta(): HvscMeta
  fun updateMeta(
    installedBaselineVersion: Int? = null,
    installedVersion: Int? = null,
    ingestionState: String? = null,
    lastUpdateCheckUtcMs: Long? = null,
    ingestionError: String? = null,
    clearIngestionError: Boolean = false,
  )

  fun markUpdateApplied(version: Int, status: String, error: String? = null)
  fun isUpdateApplied(version: Int): Boolean

  fun upsertSongs(songs: List<HvscSongRecord>)
  fun updateDurationsByMd5(durations: Map<String, Int>)
  fun updateDurationsByVirtualPath(durations: Map<String, Int>)
  fun deleteByVirtualPaths(paths: List<String>)

  fun listFolders(path: String): List<String>
  fun listSongs(path: String): List<HvscSongSummary>
  fun getSongById(id: Long): HvscSongDetail?
  fun getSongByVirtualPath(path: String): HvscSongDetail?
  fun getDurationByMd5(md5: String): Int?

  fun withTransaction(block: () -> Unit)
  fun close()
}
