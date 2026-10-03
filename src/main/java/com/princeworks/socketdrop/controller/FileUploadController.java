package com.princeworks.socketdrop.controller;

import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.response.file.UploadResponse;
import com.princeworks.socketdrop.service.event.progress.ProgressEventService;
import com.princeworks.socketdrop.service.files.storage.FileStorageService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/file/uploads")
public class FileUploadController {
  @Autowired private FileStorageService fileStorageService;
  @Autowired private ProgressEventService progressEventService;
  @Autowired private RoomRegistry roomRegistry;

  @PostMapping
  public ResponseEntity<UploadResponse> handleUploads(
      @RequestParam("file") MultipartFile file,
      @RequestParam("roomId") String roomId) {
    if (file == null || file.isEmpty()) {
      throw new InvalidArgumentException("File is required", "file upload");
    }

    if (roomId == null || roomId.trim().isEmpty()) {
      throw new InvalidArgumentException("roomId is required", "file upload");
    }

    if (!roomRegistry.roomExists(roomId)) {
      throw new InvalidArgumentException("Room does not exist", "file upload");
    }

    String fileName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "unknown";
    progressEventService.notifyUploadStarted(roomId, fileName, file.getSize());

    try {
      UploadResponse response = fileStorageService.uploadFile(file, roomId);
      progressEventService.notifyUploadCompleted(
          roomId, response.getFileId(), response.getFileName(), response.getFileSize());
      return ResponseEntity.ok(response);
    } catch (RuntimeException e) {
      progressEventService.notifyUploadFailed(roomId, fileName, e.getMessage());
      throw e;
    }
  }
}

