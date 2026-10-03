package com.princeworks.socketdrop.controller;

import com.princeworks.socketdrop.exception.ForbiddenOperationException;
import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.response.file.UploadResponse;
import com.princeworks.socketdrop.service.event.progress.ProgressEventService;
import com.princeworks.socketdrop.service.files.storage.FileStorageService;
import com.princeworks.socketdrop.util.IdGenerator;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/file/uploads")
public class FileUploadController {
  @Autowired private FileStorageService fileStorageService;
  @Autowired private ProgressEventService progressEventService;
  @Autowired private RoomRegistry roomRegistry;
  @Autowired(required = false) private SessionRegistry sessionRegistry;

  public ResponseEntity<UploadResponse> handleUploads(MultipartFile file, String roomId) {
    return handleUploads(file, roomId, null);
  }

  @PostMapping
  public ResponseEntity<UploadResponse> handleUploads(
      @RequestParam("file") MultipartFile file,
      @RequestParam("roomId") String rawRoomId,
      @RequestParam(value = "userId", required = false) String userId) {
    if (file == null || file.isEmpty()) {
      throw new InvalidArgumentException("File is required", "file upload");
    }

    if (rawRoomId == null || rawRoomId.trim().isEmpty()) {
      throw new InvalidArgumentException("roomId is required", "file upload");
    }

    String roomId = IdGenerator.normalizeRoomId(rawRoomId);

    if (!roomRegistry.roomExists(roomId)) {
      throw new InvalidArgumentException("Room does not exist", "file upload");
    }

    if (userId != null && !userId.trim().isEmpty() && sessionRegistry != null) {
      boolean joinedRoom = roomRegistry.getSessions(roomId).stream()
          .anyMatch(sessionId -> sessionRegistry.matchesUser(sessionId, userId));
      if (!joinedRoom) {
        throw new ForbiddenOperationException("Join the room before uploading files");
      }
    }

    String fileName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "unknown";
    progressEventService.notifyUploadStarted(roomId, fileName, file.getSize());

    try {
      UploadResponse response = userId != null
          ? fileStorageService.uploadFile(file, roomId, userId)
          : fileStorageService.uploadFile(file, roomId);
      if (response != null) {
        if (userId != null) {
          progressEventService.notifyUploadCompleted(
              roomId, response.getFileId(), response.getFileName(), response.getFileSize(), userId);
        } else {
          progressEventService.notifyUploadCompleted(
              roomId, response.getFileId(), response.getFileName(), response.getFileSize());
        }
      }
      return ResponseEntity.ok(response);
    } catch (RuntimeException e) {
      progressEventService.notifyUploadFailed(roomId, fileName, e.getMessage());
      throw e;
    }
  }
}

