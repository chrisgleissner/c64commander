package com.c64.commander.hvsc

import java.sql.Connection
import java.sql.DriverManager

class JdbcHvscDatabase(private val connection: Connection) : HvscDatabase {
  companion object {
    fun inMemory(): JdbcHvscDatabase {
      val conn = DriverManager.getConnection("jdbc:sqlite::memory:")
      val db = JdbcHvscDatabase(conn)
      db.initSchema()
      return db
    }
  }

  private fun initSchema() {
    connection.createStatement().use { stmt ->
      stmt.execute(HvscSchema.CREATE_TABLE_SONG)
      stmt.execute(HvscSchema.CREATE_TABLE_META)
      stmt.execute(HvscSchema.CREATE_TABLE_UPDATE)
      stmt.execute(HvscSchema.CREATE_INDEX_DIR_FILE)
      stmt.execute(HvscSchema.CREATE_INDEX_VIRTUAL_PATH)
      stmt.execute(HvscSchema.CREATE_INDEX_MD5)
      stmt.execute("INSERT INTO ${HvscSchema.TABLE_META} (id, installed_version, ingestion_state) VALUES (1, 0, 'idle')")
    }
  }

  override fun getMeta(): HvscMeta {
    connection.prepareStatement(
      "SELECT installed_baseline_version, installed_version, ingestion_state, last_update_check_utc_ms, ingestion_error FROM ${HvscSchema.TABLE_META} WHERE id = 1",
    ).use { stmt ->
      stmt.executeQuery().use { rs ->
        if (!rs.next()) return HvscMeta(null, 0, "idle", null, null)
        val baseline = rs.getInt(1).let { value -> if (rs.wasNull()) null else value }
        val lastCheck = rs.getLong(4).let { value -> if (rs.wasNull()) null else value }
        return HvscMeta(
          baseline,
          rs.getInt(2),
          rs.getString(3),
          lastCheck,
          rs.getString(5),
        )
      }
    }
  }

  override fun updateMeta(
    installedBaselineVersion: Int?,
    installedVersion: Int?,
    ingestionState: String?,
    lastUpdateCheckUtcMs: Long?,
    ingestionError: String?,
  ) {
    val fields = mutableListOf<String>()
    val values = mutableListOf<Any?>()
    if (installedBaselineVersion != null) {
      fields.add("installed_baseline_version = ?")
      values.add(installedBaselineVersion)
    }
    if (installedVersion != null) {
      fields.add("installed_version = ?")
      values.add(installedVersion)
    }
    if (ingestionState != null) {
      fields.add("ingestion_state = ?")
      values.add(ingestionState)
    }
    if (lastUpdateCheckUtcMs != null) {
      fields.add("last_update_check_utc_ms = ?")
      values.add(lastUpdateCheckUtcMs)
    }
    if (ingestionError != null) {
      fields.add("ingestion_error = ?")
      values.add(ingestionError)
    } else if (ingestionState == "idle" || ingestionState == "ready") {
      fields.add("ingestion_error = NULL")
    }
    if (fields.isEmpty()) return
    val sql = "UPDATE ${HvscSchema.TABLE_META} SET ${fields.joinToString(", ")} WHERE id = 1"
    connection.prepareStatement(sql).use { stmt ->
      values.forEachIndexed { index, value -> stmt.setObject(index + 1, value) }
      stmt.executeUpdate()
    }
  }

  override fun markUpdateApplied(version: Int, status: String, error: String?) {
    connection.prepareStatement(
      "INSERT OR REPLACE INTO ${HvscSchema.TABLE_UPDATE} (version, applied_at_utc_ms, status, error) VALUES (?, ?, ?, ?)",
    ).use { stmt ->
      stmt.setInt(1, version)
      stmt.setLong(2, System.currentTimeMillis())
      stmt.setString(3, status)
      stmt.setString(4, error)
      stmt.executeUpdate()
    }
  }

  override fun isUpdateApplied(version: Int): Boolean {
    connection.prepareStatement(
      "SELECT version FROM ${HvscSchema.TABLE_UPDATE} WHERE version = ? AND status = 'success'",
    ).use { stmt ->
      stmt.setInt(1, version)
      stmt.executeQuery().use { rs ->
        return rs.next()
      }
    }
  }

  override fun upsertSongs(songs: List<HvscSongRecord>) {
    if (songs.isEmpty()) return
    connection.prepareStatement(
      "INSERT OR REPLACE INTO ${HvscSchema.TABLE_SONG} (virtual_path, dir_path, file_name, size_bytes, md5, duration_seconds, data, source_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).use { stmt ->
      for (song in songs) {
        stmt.setString(1, song.virtualPath)
        stmt.setString(2, song.dirPath)
        stmt.setString(3, song.fileName)
        stmt.setLong(4, song.sizeBytes)
        stmt.setString(5, song.md5)
        val durationSeconds = song.durationSeconds
        if (durationSeconds != null) stmt.setInt(6, durationSeconds) else stmt.setObject(6, null)
        stmt.setBytes(7, song.data)
        stmt.setInt(8, song.sourceVersion)
        stmt.setLong(9, song.createdAtUtcMs)
        stmt.setLong(10, song.updatedAtUtcMs)
        stmt.executeUpdate()
      }
    }
  }

  override fun updateDurationsByMd5(durations: Map<String, Int>) {
    if (durations.isEmpty()) return
    connection.prepareStatement(
      "UPDATE ${HvscSchema.TABLE_SONG} SET duration_seconds = ? WHERE md5 = ?",
    ).use { stmt ->
      for ((md5, seconds) in durations) {
        stmt.setInt(1, seconds)
        stmt.setString(2, md5)
        stmt.executeUpdate()
      }
    }
  }

  override fun deleteByVirtualPaths(paths: List<String>) {
    if (paths.isEmpty()) return
    connection.prepareStatement(
      "DELETE FROM ${HvscSchema.TABLE_SONG} WHERE virtual_path = ?",
    ).use { stmt ->
      for (path in paths) {
        stmt.setString(1, path)
        stmt.executeUpdate()
      }
    }
  }

  override fun listFolders(path: String): List<String> {
    val normalized = normalizePath(path)
    val prefix = if (normalized == "/") "/" else normalized
    val like = if (prefix.endsWith("/")) "$prefix%" else "$prefix/%"
    val folders = mutableSetOf<String>()
    connection.prepareStatement(
      "SELECT DISTINCT dir_path FROM ${HvscSchema.TABLE_SONG} WHERE dir_path LIKE ?",
    ).use { stmt ->
      stmt.setString(1, like)
      stmt.executeQuery().use { rs ->
        while (rs.next()) {
          val dirPath = rs.getString(1)
          if (!dirPath.isNullOrBlank()) folders.add(dirPath)
        }
      }
    }
    return folders.sorted()
  }

  override fun listSongs(path: String): List<HvscSongSummary> {
    val normalized = normalizePath(path)
    val songs = mutableListOf<HvscSongSummary>()
    connection.prepareStatement(
      "SELECT id, virtual_path, file_name, duration_seconds FROM ${HvscSchema.TABLE_SONG} WHERE dir_path = ? ORDER BY file_name",
    ).use { stmt ->
      stmt.setString(1, normalized)
      stmt.executeQuery().use { rs ->
        while (rs.next()) {
          songs.add(
            HvscSongSummary(
              id = rs.getLong(1),
              virtualPath = rs.getString(2),
              fileName = rs.getString(3),
              durationSeconds = rs.getInt(4).let { value -> if (rs.wasNull()) null else value },
            ),
          )
        }
      }
    }
    return songs
  }

  override fun getSongById(id: Long): HvscSongDetail? {
    connection.prepareStatement(
      "SELECT id, virtual_path, file_name, duration_seconds, md5, data FROM ${HvscSchema.TABLE_SONG} WHERE id = ?",
    ).use { stmt ->
      stmt.setLong(1, id)
      stmt.executeQuery().use { rs ->
        return if (rs.next()) {
          HvscSongDetail(
            id = rs.getLong(1),
            virtualPath = rs.getString(2),
            fileName = rs.getString(3),
            durationSeconds = rs.getInt(4).let { value -> if (rs.wasNull()) null else value },
            md5 = rs.getString(5),
            data = rs.getBytes(6),
          )
        } else null
      }
    }
  }

  override fun getSongByVirtualPath(path: String): HvscSongDetail? {
    connection.prepareStatement(
      "SELECT id, virtual_path, file_name, duration_seconds, md5, data FROM ${HvscSchema.TABLE_SONG} WHERE virtual_path = ?",
    ).use { stmt ->
      stmt.setString(1, path)
      stmt.executeQuery().use { rs ->
        return if (rs.next()) {
          HvscSongDetail(
            id = rs.getLong(1),
            virtualPath = rs.getString(2),
            fileName = rs.getString(3),
            durationSeconds = rs.getInt(4).let { value -> if (rs.wasNull()) null else value },
            md5 = rs.getString(5),
            data = rs.getBytes(6),
          )
        } else null
      }
    }
  }

  override fun getDurationByMd5(md5: String): Int? {
    connection.prepareStatement(
      "SELECT duration_seconds FROM ${HvscSchema.TABLE_SONG} WHERE md5 = ? LIMIT 1",
    ).use { stmt ->
      stmt.setString(1, md5)
      stmt.executeQuery().use { rs ->
        return if (rs.next()) rs.getInt(1).let { value -> if (rs.wasNull()) null else value } else null
      }
    }
  }

  override fun withTransaction(block: () -> Unit) {
    connection.autoCommit = false
    try {
      block()
      connection.commit()
    } finally {
      connection.autoCommit = true
    }
  }

  override fun close() {
    connection.close()
  }

  private fun normalizePath(path: String): String {
    if (path.isBlank() || path == "/") return "/"
    return if (path.startsWith("/")) path.trimEnd('/') else "/${path.trimEnd('/')}"
  }

}

