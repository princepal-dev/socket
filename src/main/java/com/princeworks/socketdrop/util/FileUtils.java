package com.princeworks.socketdrop.util;

import com.princeworks.socketdrop.exception.InvalidArgumentException;
import java.nio.file.Path;
import java.nio.file.Paths;

public final class FileUtils {
  private FileUtils() {}

  public static boolean sizeCheck(long actualSize, long maxAllowedSize) {
    return actualSize <= maxAllowedSize;
  }

  public static Path generatePath(String baseDirectory, String fileId) {
    if (fileId == null || fileId.trim().isEmpty()) {
      throw new InvalidArgumentException("File id is required", "generatePath");
    }
    Path basePath = Paths.get(baseDirectory).toAbsolutePath().normalize();
    Path resolved = basePath.resolve(fileId).normalize();
    if (!resolved.startsWith(basePath) || resolved.equals(basePath)) {
      throw new InvalidArgumentException("Invalid file identifier", "generatePath");
    }
    return resolved;
  }
}

