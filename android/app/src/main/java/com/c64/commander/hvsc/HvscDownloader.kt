package com.c64.commander.hvsc

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

interface HvscDownloadClient {
  fun download(url: String, target: File, onProgress: ((percent: Int) -> Unit)? = null)
}

class HvscDownloader : HvscDownloadClient {
  override fun download(url: String, target: File, onProgress: ((percent: Int) -> Unit)?) {
    if (target.exists()) target.delete()
    target.parentFile?.mkdirs()

    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 20000
    connection.readTimeout = 30000
    connection.requestMethod = "GET"
    connection.setRequestProperty("Accept-Encoding", "identity")
    connection.instanceFollowRedirects = true

    val total = connection.contentLengthLong
    val buffer = ByteArray(256 * 1024)
    var downloaded = 0L
    var lastPercent = -1

    connection.inputStream.use { input ->
      FileOutputStream(target).buffered().use { output ->
        while (true) {
          val read = input.read(buffer)
          if (read <= 0) break
          output.write(buffer, 0, read)
          downloaded += read
          if (total > 0 && onProgress != null) {
            val percent = ((downloaded * 100) / total).toInt().coerceIn(0, 100)
            if (percent != lastPercent) {
              lastPercent = percent
              onProgress(percent)
            }
          }
        }
      }
    }
  }
}
