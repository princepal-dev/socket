package com.princeworks.socketdrop.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.princeworks.socketdrop.exception.ForbiddenOperationException;
import com.princeworks.socketdrop.exception.InvalidArgumentException;
import com.princeworks.socketdrop.model.file.FileMeta;
import com.princeworks.socketdrop.model.file.StoredFile;
import com.princeworks.socketdrop.model.user.UserSessionInfo;
import com.princeworks.socketdrop.service.files.storage.FileStorageService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import java.io.ByteArrayInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

class FileDownloadControllerTest {

  private static final long MAX_DOWNLOAD_SIZE = 50L * 1024L * 1024L;

  @Test
  void downloadAllowedWhenUserIsInFileRoom() {
    FileStorageService fileStorageService = mock(FileStorageService.class);
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();

    String roomId = "room_1";
    String userId = "user_1";
    String sessionId = "session_1";

    roomRegistry.joinRoom(sessionId, roomId);
    sessionRegistry.register(sessionId, new UserSessionInfo(userId, "alice"));

    FileMeta meta = new FileMeta("file_1", 5L, "hello.txt", roomId);
    StoredFile storedFile =
        new StoredFile(meta, new InputStreamResource(new ByteArrayInputStream("hello".getBytes())));
    when(fileStorageService.downloadFile("file_1")).thenReturn(storedFile);

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);

    ResponseEntity<?> response = controller.downloadFile("file_1", roomId, userId);

    assertEquals(200, response.getStatusCode().value());
    assertNotNull(response.getBody());
  }

  @Test
  void downloadBlockedWhenRoomDoesNotMatchFileRoom() {
    FileStorageService fileStorageService = mock(FileStorageService.class);

    FileMeta meta = new FileMeta("file_1", 5L, "hello.txt", "room_1");
    StoredFile storedFile =
        new StoredFile(meta, new InputStreamResource(new ByteArrayInputStream("hello".getBytes())));
    when(fileStorageService.downloadFile("file_1")).thenReturn(storedFile);

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "roomRegistry", new RoomRegistry());
    ReflectionTestUtils.setField(controller, "sessionRegistry", new SessionRegistry());

    assertThrows(
        ForbiddenOperationException.class,
        () -> controller.downloadFile("file_1", "room_2", "user_1"));
  }

  @Test
  void downloadBlockedWhenUserIsNotInRoom() {
    FileStorageService fileStorageService = mock(FileStorageService.class);
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();

    roomRegistry.joinRoom("session_1", "room_1");
    sessionRegistry.register("session_1", new UserSessionInfo("user_2", "bob"));

    FileMeta meta = new FileMeta("file_1", 5L, "hello.txt", "room_1");
    StoredFile storedFile =
        new StoredFile(meta, new InputStreamResource(new ByteArrayInputStream("hello".getBytes())));
    when(fileStorageService.downloadFile("file_1")).thenReturn(storedFile);

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);

    assertThrows(
        ForbiddenOperationException.class,
        () -> controller.downloadFile("file_1", "room_1", "user_1"));
  }

  @Test
  void downloadRequiresRoomAndUser() {
    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "fileStorageService", mock(FileStorageService.class));
    ReflectionTestUtils.setField(controller, "roomRegistry", new RoomRegistry());
    ReflectionTestUtils.setField(controller, "sessionRegistry", new SessionRegistry());

    assertThrows(
        InvalidArgumentException.class,
        () -> controller.downloadFile("file_1", "  ", "user_1"));
    assertThrows(
        InvalidArgumentException.class,
        () -> controller.downloadFile("file_1", "room_1", ""));
  }

  @Test
  void downloadBlockedWhenFileExceedsMaxDownloadSize() {
    FileStorageService fileStorageService = mock(FileStorageService.class);
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();

    String roomId = "room_1";
    String userId = "user_1";
    String sessionId = "session_1";

    roomRegistry.joinRoom(sessionId, roomId);
    sessionRegistry.register(sessionId, new UserSessionInfo(userId, "alice"));

    FileMeta meta = new FileMeta("file_1", MAX_DOWNLOAD_SIZE + 1L, "large.bin", roomId);
    StoredFile storedFile =
        new StoredFile(meta, new InputStreamResource(new ByteArrayInputStream(new byte[] {1})));
    when(fileStorageService.downloadFile("file_1")).thenReturn(storedFile);

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "maxDownloadSize", MAX_DOWNLOAD_SIZE);
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);

    assertThrows(
        InvalidArgumentException.class,
        () -> controller.downloadFile("file_1", roomId, userId));
  }

  @Test
  void downloadAllowedWhenFileSizeEqualsMaxDownloadSize() {
    FileStorageService fileStorageService = mock(FileStorageService.class);
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();

    String roomId = "room_1";
    String userId = "user_1";
    String sessionId = "session_1";

    roomRegistry.joinRoom(sessionId, roomId);
    sessionRegistry.register(sessionId, new UserSessionInfo(userId, "alice"));

    FileMeta meta = new FileMeta("file_1", MAX_DOWNLOAD_SIZE, "max.bin", roomId);
    StoredFile storedFile =
        new StoredFile(meta, new InputStreamResource(new ByteArrayInputStream(new byte[] {1})));
    when(fileStorageService.downloadFile("file_1")).thenReturn(storedFile);

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "maxDownloadSize", MAX_DOWNLOAD_SIZE);
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);

    ResponseEntity<?> response = controller.downloadFile("file_1", roomId, userId);

    assertEquals(200, response.getStatusCode().value());
  }

  @Test
  void deleteFileRequiresRoomAndUser() {
    FileDownloadController controller = new FileDownloadController();
    assertThrows(InvalidArgumentException.class, () -> controller.deleteFile("f1", null, "u1"));
    assertThrows(InvalidArgumentException.class, () -> controller.deleteFile("f1", "r1", null));
    assertThrows(InvalidArgumentException.class, () -> controller.deleteFile("f1", "   ", "u1"));
    assertThrows(InvalidArgumentException.class, () -> controller.deleteFile("f1", "r1", "   "));
  }

  @Test
  void deleteFileBlocksNonMember() {
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);

    assertThrows(ForbiddenOperationException.class, () -> controller.deleteFile("f1", "room_1", "user_1"));
  }

  @Test
  void deleteFileBlocksCrossRoomDeletion() {
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry metaRegistry =
        mock(com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry.class);

    roomRegistry.joinRoom("s1", "room_1");
    sessionRegistry.register("s1", new UserSessionInfo("user_1", "alice"));

    when(metaRegistry.getDataFromRegistry("f1"))
        .thenReturn(new FileMeta("f1", 10L, "other.txt", "room_2"));

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(controller, "fileMetaDataRegistry", metaRegistry);

    assertThrows(ForbiddenOperationException.class, () -> controller.deleteFile("f1", "room_1", "user_1"));
  }

  @Test
  void deleteFileSucceedsAndNotifiesPeers() {
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry metaRegistry =
        mock(com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry.class);
    FileStorageService fileStorageService = mock(FileStorageService.class);
    com.princeworks.socketdrop.service.event.progress.ProgressEventService progressEventService =
        mock(com.princeworks.socketdrop.service.event.progress.ProgressEventService.class);

    roomRegistry.joinRoom("s1", "room_1");
    sessionRegistry.register("s1", new UserSessionInfo("user_1", "alice"));

    when(metaRegistry.getDataFromRegistry("f1"))
        .thenReturn(new FileMeta("f1", 10L, "photo.jpg", "room_1"));

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(controller, "fileMetaDataRegistry", metaRegistry);
    ReflectionTestUtils.setField(controller, "fileStorageService", fileStorageService);
    ReflectionTestUtils.setField(controller, "progressEventService", progressEventService);

    ResponseEntity<Void> res = controller.deleteFile("f1", "room_1", "user_1");

    assertEquals(204, res.getStatusCode().value());
    org.mockito.Mockito.verify(fileStorageService).deleteFile("f1");
    org.mockito.Mockito.verify(progressEventService).notifyFileDeleted("room_1", "f1", "photo.jpg");
  }

  @Test
  void getRoomFilesRequiresMembershipAndReturnsFiles() {
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry metaRegistry =
        mock(com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry.class);

    roomRegistry.joinRoom("s1", "room_1");
    sessionRegistry.register("s1", new UserSessionInfo("user_1", "alice"));

    FileDownloadController controller = new FileDownloadController();
    ReflectionTestUtils.setField(controller, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(controller, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(controller, "fileMetaDataRegistry", metaRegistry);

    assertThrows(ForbiddenOperationException.class, () -> controller.getRoomFiles("room_1", "intruder"));

    when(metaRegistry.findByRoomId("room_1"))
        .thenReturn(java.util.List.of(new FileMeta("f1", 5L, "a.txt", "room_1")));

    ResponseEntity<java.util.List<FileMeta>> response = controller.getRoomFiles("room_1", "user_1");
    assertEquals(200, response.getStatusCode().value());
    assertEquals(1, response.getBody().size());
  }
}

