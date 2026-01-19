package com.c64.commander.hvsc

object HvscSchema {
  const val DATABASE_NAME = "hvsc.db"
  const val DATABASE_VERSION = 1

  const val TABLE_SONG = "hvsc_song"
  const val TABLE_META = "hvsc_meta"
  const val TABLE_UPDATE = "hvsc_update_applied"

  val CREATE_TABLE_SONG = """
    CREATE TABLE IF NOT EXISTS $TABLE_SONG (
      id INTEGER PRIMARY KEY,
      virtual_path TEXT UNIQUE,
      dir_path TEXT,
      file_name TEXT,
      size_bytes INTEGER,
      md5 TEXT,
      duration_seconds INTEGER NULL,
      data BLOB,
      source_version INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  """.trimIndent()

  val CREATE_TABLE_META = """
    CREATE TABLE IF NOT EXISTS $TABLE_META (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      installed_baseline_version INTEGER NULL,
      installed_version INTEGER NOT NULL DEFAULT 0,
      ingestion_state TEXT NOT NULL DEFAULT 'idle',
      last_update_check_utc_ms INTEGER NULL,
      ingestion_error TEXT NULL
    )
  """.trimIndent()

  val CREATE_TABLE_UPDATE = """
    CREATE TABLE IF NOT EXISTS $TABLE_UPDATE (
      version INTEGER PRIMARY KEY,
      applied_at_utc_ms INTEGER,
      status TEXT,
      error TEXT NULL
    )
  """.trimIndent()

  val CREATE_INDEX_DIR_FILE = """
    CREATE INDEX IF NOT EXISTS idx_hvsc_song_dir_file ON $TABLE_SONG (dir_path, file_name)
  """.trimIndent()

  val CREATE_INDEX_VIRTUAL_PATH = """
    CREATE INDEX IF NOT EXISTS idx_hvsc_song_virtual_path ON $TABLE_SONG (virtual_path)
  """.trimIndent()

  val CREATE_INDEX_MD5 = """
    CREATE INDEX IF NOT EXISTS idx_hvsc_song_md5 ON $TABLE_SONG (md5)
  """.trimIndent()
}
