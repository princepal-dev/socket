package com.princeworks.socketdrop.service.files.cleanup;

import com.princeworks.socketdrop.exception.FileStorageException;
import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.exception.ResourceNotFoundException;
import com.princeworks.socketdrop.helper.Operation;
import com.princeworks.socketdrop.model.file.FileMeta;
import com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry;
import com.princeworks.socketdrop.util.FileUtils;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class FileCleanupServiceImpl implements FileCleanupService {
  private static final Logger logger = LoggerFactory.getLogger(FileCleanupServiceImpl.class);

  @Value("${spring.file.base-path}")
  private String basePath;

  @Autowired private FileMetaDataRegistry fileMetaDataRegistry;

  @Override
  public void cleanupFile(String fileId) {
    if (fileId == null || fileId.trim().isEmpty()) {
      throw new InvalidArgumentException("File id is required", "cleanupFile");
    }

    Path filePath = FileUtils.generatePath(basePath, fileId);
    boolean hasMetadata = fileMetaDataRegistry.contains(fileId);
    boolean fileExists = Files.exists(filePath);

    if (!hasMetadata && !fileExists) {
      throw new ResourceNotFoundException("File", "file id", fileId);
    }

    if (fileExists) {
      try {
        Files.delete(filePath);
      } catch (IOException e) {
        throw new FileStorageException("File deletion failed", Operation.DELETE, e);
      }
    }

    fileMetaDataRegistry.removeDataFromRegistry(fileId);
  }

  @Override
  public int cleanupRoom(String roomId) {
    if (roomId == null || roomId.trim().isEmpty()) {
      return 0;
    }

    int removed = 0;
    for (FileMeta meta : fileMetaDataRegistry.findByRoomId(roomId)) {
      String fileId = meta.getFileId();
      if (fileId == null) {
        continue;
      }
      try {
        Path filePath = FileUtils.generatePath(basePath, fileId);
        if (Files.deleteIfExists(filePath)) {
          removed++;
        }
      } catch (IOException | RuntimeException e) {
        // One bad entry must not abort room teardown; metadata is still dropped.
        logger.warn("Could not delete file {} during room cleanup: {}", fileId, e.getMessage());
      } finally {
        fileMetaDataRegistry.removeDataFromRegistry(fileId);
      }
    }
    logger.info("Room {} cleanup removed {} file(s) from disk", roomId, removed);
    return removed;
  }
}