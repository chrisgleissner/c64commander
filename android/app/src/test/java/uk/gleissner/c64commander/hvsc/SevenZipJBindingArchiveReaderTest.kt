package uk.gleissner.c64commander.hvsc

import org.junit.Assert.assertFalse
import org.junit.Test

class SevenZipJBindingArchiveReaderTest {
  @Test
  fun isAvailableReturnsFalseOnJvm() {
    assertFalse(SevenZipJBindingArchiveReader.isAvailable())
  }
}