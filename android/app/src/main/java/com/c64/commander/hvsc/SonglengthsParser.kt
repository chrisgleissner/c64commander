package com.c64.commander.hvsc

object SonglengthsParser {
  data class Result(
    val pathToSeconds: Map<String, Int>,
    val md5ToSeconds: Map<String, Int>,
  )

  fun parse(content: String): Result {
    val pathToSeconds = mutableMapOf<String, Int>()
    val md5ToSeconds = mutableMapOf<String, Int>()
    var currentPath = ""

    val lines = content.split(Regex("\\r?\\n"))
    for (raw in lines) {
      val line = raw.trim()
      if (line.isBlank()) continue
      if (line.startsWith(";")) {
        val path = line.removePrefix(";").trim()
        if (path.isNotBlank()) currentPath = normalizePath(path)
        continue
      }
      if (line.startsWith("[")) continue
      val parts = line.split("=")
      if (parts.size != 2) continue
      val md5 = parts[0].trim()
      val time = parts[1].trim()
      if (md5.isBlank() || time.isBlank()) continue
      val timeParts = time.split(":")
      if (timeParts.isEmpty()) continue
      val minutes = timeParts[0].toIntOrNull() ?: continue
      val secondsPart = timeParts.getOrNull(1) ?: "0"
      val secondsSplit = secondsPart.split(".")
      val seconds = secondsSplit[0].toIntOrNull() ?: 0
      val fraction = secondsSplit.getOrNull(1)?.padEnd(3, '0')?.take(3)?.toIntOrNull() ?: 0
      val totalMs = (minutes * 60 + seconds) * 1000 + fraction
      val totalSeconds = kotlin.math.round(totalMs / 1000.0).toInt()
      if (currentPath.isNotBlank()) {
        pathToSeconds[currentPath] = totalSeconds
      }
      md5ToSeconds[md5] = totalSeconds
    }

    return Result(pathToSeconds, md5ToSeconds)
  }

  private fun normalizePath(path: String): String {
    val normalized = path.replace("\\", "/")
    return if (normalized.startsWith("/")) normalized else "/$normalized"
  }
}
