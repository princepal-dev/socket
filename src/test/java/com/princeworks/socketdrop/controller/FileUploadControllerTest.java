package com.princeworks.socketdrop.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.response.file.UploadResponse;
import com.princeworks.socketdrop.service.event.progress.ProgressEventService;
import com.princeworks.socketdrop.service.files.storage.FileStorageService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

class FileUploadControllerTest {

  @Test
  void uploadSucceedsWhenRoomExists() {
    FileStorageService fileStorageService = mock(FileStorageService.class);
    ProgressEventService progressEventService = mock(ProgressEventService.class);
    RoomRegistry roomRegistry = mock(RoomRegistry.class);

    FileUploadController controller = new FileUploadController();
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "progressEventService", progressEventService);
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);

    when(roomRegistry.roomExists("room_1")).thenReturn(true);

    UploadResponse uploadResponse = new UploadResponse();
    uploadResponse.setFileId("file_123");
    uploadResponse.setFileName("test.txt");
    uploadResponse.setFileSize(4L);

    MockMultipartFile file =
        new MockMultipartFile("file", "test.txt", "text/plain", "data".getBytes());
    when(fileStorageService.uploadFile(file, "room_1")).thenReturn(uploadResponse);

    ResponseEntity<UploadResponse> response = controller.handleUploads(file, "room_1");

    assertEquals(200, response.getStatusCode().value());
    assertEquals("file_123", response.getBody().getFileId());
    verify(progressEventService).notifyUploadStarted("room_1", "test.txt", 4L);
    verify(progressEventService).notifyUploadCompleted("room_1", "file_123", "test.txt", 4L);
  }

  @Test
  void uploadRejectsNonExistentRoom() {
    FileStorageService fileStorageService = mock(FileStorageService.class);
    ProgressEventService progressEventService = mock(ProgressEventService.class);
    RoomRegistry roomRegistry = mock(RoomRegistry.class);

    FileUploadController controller = new FileUploadController();
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "progressEventService", progressEventService);
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);

    when(roomRegistry.roomExists("room_missing")).thenReturn(false);

    MockMultipartFile file =
        new MockMultipartFile("file", "test.txt", "text/plain", "data".getBytes());

    assertThrows(
        InvalidArgumentException.class,
        () -> controller.handleUploads(file, "room_missing"));
  }

  @Test
  void uploadRejectsEmptyFile() {
    FileUploadController controller = new FileUploadController();
    MockMultipartFile emptyFile =
        new MockMultipartFile("file", "empty.txt", "text/plain", new byte[0]);

    assertThrows(
        InvalidArgumentException.class,
        () -> controller.handleUploads(emptyFile, "room_1"));
  }
}
