package com.c64.commander

import java.io.File
import com.hzy.libp7zip.ExitCode
import com.hzy.libp7zip.P7ZipApi

class SevenZExtractor {
  fun extract(
    archiveFile: File,
    targetDir: File,
    password: String?,
    onProgress: ((processed: Long, total: Long) -> Unit)? = null,
  ) {
    if (!targetDir.exists()) {
      targetDir.mkdirs()
    }

    onProgress?.invoke(0, 100)

    val command = buildString {
      append("7z x -y -bso0 -bsp1")
      if (!password.isNullOrBlank()) {
        append(" -p").append(password)
      }
      append(" -o\"").append(targetDir.absolutePath).append("\"")
      append(" \"").append(archiveFile.absolutePath).append("\"")
    }

    val result = P7ZipApi.executeCommand(command)
    if (result != ExitCode.EXIT_OK && result != ExitCode.EXIT_WARNING) {
      throw IllegalStateException("7z extraction failed with code $result")
    }

    onProgress?.invoke(100, 100)
  }
}
