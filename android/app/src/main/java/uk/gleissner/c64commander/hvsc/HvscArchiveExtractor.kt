package uk.gleissner.c64commander.hvsc

import java.io.File

data class ExtractionResult(
  val extractedFiles: Int,
  val extractedBytes: Long,
)

interface HvscArchiveExtractor {
  fun extractAll(archiveFile: File, targetDir: File): ExtractionResult
}
