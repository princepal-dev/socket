package com.princeworks.socketdrop.service.files.storage;

import com.princeworks.socketdrop.exception.FileStorageException;
import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.exception.ResourceNotFoundException;
import com.princeworks.socketdrop.model.file.FileMeta;
import com.princeworks.socketdrop.model.file.StoredFile;
import com.princeworks.socketdrop.response.file.UploadResponse;
import com.princeworks.socketdrop.service.files.cleanup.FileCleanupService;
import com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry;
import com.princeworks.socketdrop.util.FileUtils;
import com.princeworks.socketdrop.util.IdGenerator;
import com.princeworks.socketdrop.helper.Operation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@Service
public class FileStorageServiceImpl implements FileStorageService {
  @Value("${spring.file.max-size}")
  private long allowedSize;

  @Value("${spring.file.base-path}")
  private String basePath;

  @Autowired private FileMetaDataRegistry fileMetaDataRegistry;
  @Autowired private FileCleanupService fileCleanupService;

  @Override
  public UploadResponse uploadFile(MultipartFile file, String roomId) {
    if (file == null || file.isEmpty()) {
      throw new InvalidArgumentException("File is required", "uploadFile");
    }

    if (!FileUtils.sizeCheck(file.getSize(), allowedSize)) {
      throw new InvalidArgumentException("You have exceeded the upload size limit", "uploadFile");
    }

    String fileId = IdGenerator.generateFileId();
    String originalFileName = file.getOriginalFilename();
    if (originalFileName == null || originalFileName.trim().isEmpty()) {
      originalFileName = fileId;
    } else {
      originalFileName = Paths.get(originalFileName).getFileName().toString();
    }

    Path filePath = FileUtils.generatePath(basePath, fileId);

    try {
      Path baseDir = filePath.getParent();
      if (baseDir != null && !Files.exists(baseDir)) {
        Files.createDirectories(baseDir);
      }

      file.transferTo(filePath.toAbsolutePath());
    } catch (IOException e) {
      try {
        Files.deleteIfExists(filePath);
      } catch (IOException ignored) {}
      throw new FileStorageException("File upload failed", Operation.UPLOAD, e);
    }

    fileMetaDataRegistry.addRegistry(
        fileId, new FileMeta(fileId, file.getSize(), originalFileName, roomId));

    UploadResponse response = new UploadResponse();
    response.setFileId(fileId);
    response.setFileName(originalFileName);
    response.setFileSize(file.getSize());

    return response;
  }

  @Override
  public StoredFile downloadFile(String fileId) {
    if (fileId == null || fileId.trim().isEmpty()) {
      throw new InvalidArgumentException("File id is required", "downloadFile");
    }

    FileMeta metadata = fileMetaDataRegistry.getDataFromRegistry(fileId);
    if (metadata == null) {
      throw new ResourceNotFoundException("File metadata", "file id", fileId);
    }

    Path filePath = FileUtils.generatePath(basePath, fileId);

    if (!Files.exists(filePath)) {
      throw new ResourceNotFoundException("File", "file id", fileId);
    }

    if (!Files.isReadable(filePath)) {
      throw new FileStorageException(
          "File is not readable", Operation.READ, new IOException("File is not readable"));
    }

    try {
      return new StoredFile(
              metadata, new InputStreamResource(Files.newInputStream(filePath)));
    } catch (IOException e) {
      throw new FileStorageException("File read failed", Operation.READ, e);
    }
  }

  @Override
  public void deleteFile(String fileId) {
    fileCleanupService.cleanupFile(fileId);
  }
}

