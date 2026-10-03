package com.princeworks.socketdrop.util;

import static org.junit.jupiter.api.Assertions.*;

import com.princeworks.socketdrop.exception.InvalidArgumentException;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FileUtilsTest {

  @TempDir Path tempDir;

  @Test
  void sizeCheckAllowsExactAndBelowLimit() {
    assertTrue(FileUtils.sizeCheck(100L, 100L));
    assertTrue(FileUtils.sizeCheck(50L, 100L));
    assertFalse(FileUtils.sizeCheck(101L, 100L));
  }

  @Test
  void generatePathResolvesValidChild() {
    Path resolved = FileUtils.generatePath(tempDir.toString(), "file_123");
    assertEquals(tempDir.resolve("file_123").normalize().toAbsolutePath(), resolved);
  }

  @Test
  void generatePathRejectsPathTraversal() {
    assertThrows(
        InvalidArgumentException.class,
        () -> FileUtils.generatePath(tempDir.toString(), "../../etc/passwd"));
    assertThrows(
        InvalidArgumentException.class,
        () -> FileUtils.generatePath(tempDir.toString(), "../"));
    assertThrows(
        InvalidArgumentException.class,
        () -> FileUtils.generatePath(tempDir.toString(), "."));
  }

  @Test
  void generatePathRejectsNullOrBlank() {
    assertThrows(
        InvalidArgumentException.class,
        () -> FileUtils.generatePath(tempDir.toString(), null));
    assertThrows(
        InvalidArgumentException.class,
        () -> FileUtils.generatePath(tempDir.toString(), "   "));
  }
}
