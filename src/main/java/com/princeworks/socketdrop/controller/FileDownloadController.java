package com.princeworks.socketdrop.controller;

import com.princeworks.socketdrop.exception.ForbiddenOperationException;
import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.exception.ResourceNotFoundException;
import com.princeworks.socketdrop.model.file.FileMeta;
import com.princeworks.socketdrop.model.file.StoredFile;
import com.princeworks.socketdrop.service.event.progress.ProgressEventService;
import com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry;
import com.princeworks.socketdrop.service.files.storage.FileStorageService;
import com.princeworks.socketdrop.util.IdGenerator;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/file/downloads")
public class FileDownloadController {
  @Value("${spring.file.max-download-size:52428800}")
  private long maxDownloadSize = 52428800L;

  @Autowired private FileStorageService fileStorageService;
  @Autowired private RoomRegistry roomRegistry;
  @Autowired private SessionRegistry sessionRegistry;
  @Autowired(required = false) private FileMetaDataRegistry fileMetaDataRegistry;
  @Autowired(required = false) private ProgressEventService progressEventService;

  @GetMapping("/{fileId}")
  public ResponseEntity<Resource> downloadFile(
          @PathVariable String fileId,
          @RequestParam("roomId") String rawRoomId,
          @RequestParam("userId") String userId) {
    if (rawRoomId == null || rawRoomId.trim().isEmpty() || userId == null || userId.trim().isEmpty()) {
      throw new InvalidArgumentException("roomId and userId are required", "file download");
    }

    String roomId = IdGenerator.normalizeRoomId(rawRoomId);

    boolean joinedRoom = roomRegistry.getSessions(roomId).stream()
        .anyMatch(sessionId -> sessionRegistry.matchesUser(sessionId, userId));
    if (!joinedRoom) {
      throw new ForbiddenOperationException("Join the room before downloading files");
    }

    StoredFile fileFromServer = fileStorageService.downloadFile(fileId);
    FileMeta metadata = fileFromServer.getMetaData();

    if (metadata == null) {
      closeResourceStream(fileFromServer.getResource());
      throw new ResourceNotFoundException("File", "file id", fileId);
    }

    if (metadata.getRoomId() == null || !metadata.getRoomId().equals(roomId)) {
      closeResourceStream(fileFromServer.getResource());
      throw new ForbiddenOperationException("You are not allowed to download this file");
    }

    if (metadata.getFileSize() != null && metadata.getFileSize() > maxDownloadSize) {
      closeResourceStream(fileFromServer.getResource());
      long maxMb = maxDownloadSize / (1024 * 1024);
      throw new InvalidArgumentException(
          String.format("Download size exceeds max allowed size of %d MB", maxMb), "file download");
    }

    Resource resource = fileFromServer.getResource();
    ContentDisposition contentDisposition = ContentDisposition.attachment()
        .filename(metadata.getOriginalFileName(), StandardCharsets.UTF_8)
        .build();

    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, contentDisposition.toString())
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .contentLength(metadata.getFileSize() != null ? metadata.getFileSize() : -1)
        .body(resource);
  }

  @GetMapping("/room/{roomId}")
  public ResponseEntity<List<FileMeta>> getRoomFiles(
      @PathVariable String roomId,
      @RequestParam("userId") String userId) {
    if (roomId == null || roomId.trim().isEmpty() || userId == null || userId.trim().isEmpty()) {
      throw new InvalidArgumentException("roomId and userId are required", "getRoomFiles");
    }

    String normalizedRoomId = IdGenerator.normalizeRoomId(roomId);
    boolean joinedRoom = roomRegistry.getSessions(normalizedRoomId).stream()
        .anyMatch(sessionId -> sessionRegistry.matchesUser(sessionId, userId));
    if (!joinedRoom) {
      throw new ForbiddenOperationException("Join the room before listing files");
    }

    if (fileMetaDataRegistry == null) {
      return ResponseEntity.ok(List.of());
    }
    return ResponseEntity.ok(fileMetaDataRegistry.findByRoomId(normalizedRoomId));
  }

  @DeleteMapping("/{fileId}")
  public ResponseEntity<Void> deleteFile(
      @PathVariable("fileId") String fileId,
      @RequestParam(value = "roomId") String rawRoomId,
      @RequestParam(value = "userId") String userId) {
    if (rawRoomId == null || rawRoomId.trim().isEmpty() || userId == null || userId.trim().isEmpty()) {
      throw new InvalidArgumentException("roomId and userId are required", "file delete");
    }

    String roomId = IdGenerator.normalizeRoomId(rawRoomId);

    boolean joinedRoom = roomRegistry.getSessions(roomId).stream()
        .anyMatch(sessionId -> sessionRegistry.matchesUser(sessionId, userId));
    if (!joinedRoom) {
      throw new ForbiddenOperationException("Join the room before deleting files");
    }

    String fileName = fileId;
    if (fileMetaDataRegistry != null) {
      FileMeta metadata = fileMetaDataRegistry.getDataFromRegistry(fileId);
      if (metadata == null) {
        throw new ResourceNotFoundException("File", "file id", fileId);
      }
      if (metadata.getRoomId() == null || !metadata.getRoomId().equals(roomId)) {
        throw new ForbiddenOperationException("You are not allowed to delete this file");
      }
      fileName = metadata.getOriginalFileName();
    }

    fileStorageService.deleteFile(fileId);

    if (progressEventService != null) {
      progressEventService.notifyFileDeleted(roomId, fileId, fileName);
    }

    return ResponseEntity.noContent().build();
  }

  private void closeResourceStream(Resource resource) {
    if (resource != null) {
      try {
        resource.getInputStream().close();
      } catch (Exception ignored) {}
    }
  }
}

