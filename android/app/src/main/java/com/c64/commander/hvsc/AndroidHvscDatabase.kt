package com.c64.commander.hvsc

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class AndroidHvscDatabase(context: Context) : SQLiteOpenHelper(
  context,
  HvscSchema.DATABASE_NAME,
  null,
  HvscSchema.DATABASE_VERSION,
), HvscDatabase {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(HvscSchema.CREATE_TABLE_SONG)
    db.execSQL(HvscSchema.CREATE_TABLE_META)
    db.execSQL(HvscSchema.CREATE_TABLE_UPDATE)
    db.execSQL(HvscSchema.CREATE_INDEX_DIR_FILE)
    db.execSQL(HvscSchema.CREATE_INDEX_VIRTUAL_PATH)
    db.execSQL(HvscSchema.CREATE_INDEX_MD5)
    val init = ContentValues().apply {
      put("id", 1)
      put("installed_version", 0)
      put("ingestion_state", "idle")
    }
    db.insert(HvscSchema.TABLE_META, null, init)
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // For now, recreate if schema changes.
    if (oldVersion != newVersion) {
      db.execSQL("DROP TABLE IF EXISTS ${HvscSchema.TABLE_SONG}")
      db.execSQL("DROP TABLE IF EXISTS ${HvscSchema.TABLE_META}")
      db.execSQL("DROP TABLE IF EXISTS ${HvscSchema.TABLE_UPDATE}")
      onCreate(db)
    }
  }

  override fun getMeta(): HvscMeta {
    readableDatabase.rawQuery(
      "SELECT installed_baseline_version, installed_version, ingestion_state, last_update_check_utc_ms, ingestion_error FROM ${HvscSchema.TABLE_META} WHERE id = 1",
      emptyArray(),
    ).use { cursor ->
      if (!cursor.moveToFirst()) {
        return HvscMeta(null, 0, "idle", null, null)
      }
      return HvscMeta(
        cursor.getIntOrNull(0),
        cursor.getInt(1),
        cursor.getString(2),
        cursor.getLongOrNull(3),
        cursor.getStringOrNull(4),
      )
    }
  }

  override fun updateMeta(
    installedBaselineVersion: Int?,
    installedVersion: Int?,
    ingestionState: String?,
    lastUpdateCheckUtcMs: Long?,
    ingestionError: String?,
    clearIngestionError: Boolean,
  ) {
    val values = ContentValues()
    if (installedBaselineVersion != null) values.put("installed_baseline_version", installedBaselineVersion)
    if (installedVersion != null) values.put("installed_version", installedVersion)
    if (ingestionState != null) values.put("ingestion_state", ingestionState)
    if (lastUpdateCheckUtcMs != null) values.put("last_update_check_utc_ms", lastUpdateCheckUtcMs)
    if (ingestionError != null) {
      values.put("ingestion_error", ingestionError)
    } else if (clearIngestionError) {
      values.putNull("ingestion_error")
    }
    writableDatabase.update(HvscSchema.TABLE_META, values, "id = 1", emptyArray())
  }

  override fun markUpdateApplied(version: Int, status: String, error: String?) {
    val values = ContentValues().apply {
      put("version", version)
      put("applied_at_utc_ms", System.currentTimeMillis())
      put("status", status)
      if (error != null) put("error", error) else putNull("error")
    }
    writableDatabase.insertWithOnConflict(
      HvscSchema.TABLE_UPDATE,
      null,
      values,
      SQLiteDatabase.CONFLICT_REPLACE,
    )
  }

  override fun isUpdateApplied(version: Int): Boolean {
    readableDatabase.rawQuery(
      "SELECT version FROM ${HvscSchema.TABLE_UPDATE} WHERE version = ? AND status = 'success'",
      arrayOf(version.toString()),
    ).use { cursor ->
      return cursor.moveToFirst()
    }
  }

  override fun upsertSongs(songs: List<HvscSongRecord>) {
    if (songs.isEmpty()) return
    val db = writableDatabase
    val sql = """
      INSERT OR REPLACE INTO ${HvscSchema.TABLE_SONG}
      (virtual_path, dir_path, file_name, size_bytes, md5, duration_seconds, data, source_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """.trimIndent()
    val stmt = db.compileStatement(sql)
    for (song in songs) {
      stmt.clearBindings()
      stmt.bindString(1, song.virtualPath)
      stmt.bindString(2, song.dirPath)
      stmt.bindString(3, song.fileName)
      stmt.bindLong(4, song.sizeBytes)
      stmt.bindString(5, song.md5)
      if (song.durationSeconds != null) stmt.bindLong(6, song.durationSeconds.toLong()) else stmt.bindNull(6)
      stmt.bindBlob(7, song.data)
      stmt.bindLong(8, song.sourceVersion.toLong())
      stmt.bindLong(9, song.createdAtUtcMs)
      stmt.bindLong(10, song.updatedAtUtcMs)
      stmt.executeInsert()
    }
  }

  override fun updateDurationsByMd5(durations: Map<String, Int>) {
    if (durations.isEmpty()) return
    val db = writableDatabase
    val stmt = db.compileStatement(
      "UPDATE ${HvscSchema.TABLE_SONG} SET duration_seconds = ? WHERE md5 = ?",
    )
    for ((md5, seconds) in durations) {
      stmt.clearBindings()
      stmt.bindLong(1, seconds.toLong())
      stmt.bindString(2, md5)
      stmt.executeUpdateDelete()
    }
  }

  override fun deleteByVirtualPaths(paths: List<String>) {
    if (paths.isEmpty()) return
    val db = writableDatabase
    val stmt = db.compileStatement(
      "DELETE FROM ${HvscSchema.TABLE_SONG} WHERE virtual_path = ?",
    )
    for (path in paths) {
      stmt.clearBindings()
      stmt.bindString(1, path)
      stmt.executeUpdateDelete()
    }
  }

  override fun listFolders(path: String): List<String> {
    val normalized = normalizePath(path)
    val prefix = if (normalized == "/") "/" else normalized
    val like = if (prefix.endsWith("/")) "$prefix%" else "$prefix/%"
    val folders = mutableSetOf<String>()
    readableDatabase.rawQuery(
      "SELECT DISTINCT dir_path FROM ${HvscSchema.TABLE_SONG} WHERE dir_path LIKE ?",
      arrayOf(like),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val dirPath = cursor.getString(0)
        if (dirPath.isNotBlank()) folders.add(dirPath)
      }
    }
    return folders.sorted()
  }

  override fun listSongs(path: String): List<HvscSongSummary> {
    val normalized = normalizePath(path)
    val list = mutableListOf<HvscSongSummary>()
    readableDatabase.rawQuery(
      "SELECT id, virtual_path, file_name, duration_seconds FROM ${HvscSchema.TABLE_SONG} WHERE dir_path = ? ORDER BY file_name",
      arrayOf(normalized),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        list.add(
          HvscSongSummary(
            id = cursor.getLong(0),
            virtualPath = cursor.getString(1),
            fileName = cursor.getString(2),
            durationSeconds = cursor.getIntOrNull(3),
          ),
        )
      }
    }
    return list
  }

  override fun getSongById(id: Long): HvscSongDetail? {
    readableDatabase.rawQuery(
      "SELECT id, virtual_path, file_name, duration_seconds, md5, data FROM ${HvscSchema.TABLE_SONG} WHERE id = ?",
      arrayOf(id.toString()),
    ).use { cursor ->
      return if (cursor.moveToFirst()) {
        HvscSongDetail(
          id = cursor.getLong(0),
          virtualPath = cursor.getString(1),
          fileName = cursor.getString(2),
          durationSeconds = cursor.getIntOrNull(3),
          md5 = cursor.getStringOrNull(4),
          data = cursor.getBlob(5),
        )
      } else {
        null
      }
    }
  }

  override fun getSongByVirtualPath(path: String): HvscSongDetail? {
    readableDatabase.rawQuery(
      "SELECT id, virtual_path, file_name, duration_seconds, md5, data FROM ${HvscSchema.TABLE_SONG} WHERE virtual_path = ?",
      arrayOf(path),
    ).use { cursor ->
      return if (cursor.moveToFirst()) {
        HvscSongDetail(
          id = cursor.getLong(0),
          virtualPath = cursor.getString(1),
          fileName = cursor.getString(2),
          durationSeconds = cursor.getIntOrNull(3),
          md5 = cursor.getStringOrNull(4),
          data = cursor.getBlob(5),
        )
      } else {
        null
      }
    }
  }

  override fun getDurationByMd5(md5: String): Int? {
    readableDatabase.rawQuery(
      "SELECT duration_seconds FROM ${HvscSchema.TABLE_SONG} WHERE md5 = ? LIMIT 1",
      arrayOf(md5),
    ).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getIntOrNull(0) else null
    }
  }

  override fun withTransaction(block: () -> Unit) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      block()
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  private fun normalizePath(path: String): String {
    if (path.isBlank() || path == "/") return "/"
    return if (path.startsWith("/")) path.trimEnd('/') else "/${path.trimEnd('/')}"
  }

  private fun Cursor.getIntOrNull(index: Int): Int? {
    return if (isNull(index)) null else getInt(index)
  }

  private fun Cursor.getLongOrNull(index: Int): Long? {
    return if (isNull(index)) null else getLong(index)
  }

  private fun Cursor.getStringOrNull(index: Int): String? {
    return if (isNull(index)) null else getString(index)
  }
}
