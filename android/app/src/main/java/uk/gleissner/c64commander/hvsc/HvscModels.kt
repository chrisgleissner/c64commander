package uk.gleissner.c64commander.hvsc

data class HvscMeta(
  val installedBaselineVersion: Int?,
  val installedVersion: Int,
  val ingestionState: String,
  val lastUpdateCheckUtcMs: Long?,
  val ingestionError: String?,
)

data class HvscSongRecord(
  val virtualPath: String,
  val dirPath: String,
  val fileName: String,
  val sizeBytes: Long,
  val md5: String,
  val durationSeconds: Int?,
  val data: ByteArray,
  val sourceVersion: Int,
  val createdAtUtcMs: Long,
  val updatedAtUtcMs: Long,
)

data class HvscSongSummary(
  val id: Long,
  val virtualPath: String,
  val fileName: String,
  val durationSeconds: Int?,
)

data class HvscSongDetail(
  val id: Long,
  val virtualPath: String,
  val fileName: String,
  val durationSeconds: Int?,
  val md5: String?,
  val data: ByteArray,
)

data class HvscFolderListing(
  val path: String,
  val folders: List<String>,
  val songs: List<HvscSongSummary>,
)

data class HvscUpdateStatus(
  val latestVersion: Int,
  val installedVersion: Int,
  val requiredUpdates: List<Int>,
  val baselineVersion: Int?,
)
