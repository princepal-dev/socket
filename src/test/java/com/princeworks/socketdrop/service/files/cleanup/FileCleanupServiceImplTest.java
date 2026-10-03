package com.princeworks.socketdrop.service.files.cleanup;

import static org.junit.jupiter.api.Assertions.*;

import com.princeworks.socketdrop.exception.ResourceNotFoundException;
import com.princeworks.socketdrop.model.file.FileMeta;
import com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistryImpl;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class FileCleanupServiceImplTest {

  @TempDir Path tempDir;

  @Test
  void cleanupDeletesFileAndMetadata() throws Exception {
    FileMetaDataRegistryImpl registry = new FileMetaDataRegistryImpl();
    registry.addRegistry("file_1", new FileMeta("file_1", 4L, "x.txt", "room_1"));

    Path filePath = tempDir.resolve("file_1");
    Files.writeString(filePath, "test");

    FileCleanupServiceImpl service = new FileCleanupServiceImpl();
    ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
    ReflectionTestUtils.setField(service, "fileMetaDataRegistry", registry);

    service.cleanupFile("file_1");

    assertFalse(Files.exists(filePath));
    assertFalse(registry.contains("file_1"));
  }

  @Test
  void cleanupThrowsWhenFileDoesNotExistAnywhere() {
    FileMetaDataRegistryImpl registry = new FileMetaDataRegistryImpl();

    FileCleanupServiceImpl service = new FileCleanupServiceImpl();
    ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
    ReflectionTestUtils.setField(service, "fileMetaDataRegistry", registry);

    assertThrows(ResourceNotFoundException.class, () -> service.cleanupFile("missing"));
  }

  @Test
  void cleanupRoomDeletesOnlyThatRoomsFiles() throws Exception {
    FileMetaDataRegistryImpl registry = new FileMetaDataRegistryImpl();
    registry.addRegistry("file_1", new FileMeta("file_1", 4L, "a.txt", "ROOM1"));
    registry.addRegistry("file_2", new FileMeta("file_2", 4L, "b.txt", "ROOM1"));
    registry.addRegistry("file_3", new FileMeta("file_3", 4L, "c.txt", "ROOM2"));

    Files.writeString(tempDir.resolve("file_1"), "a");
    Files.writeString(tempDir.resolve("file_2"), "b");
    Files.writeString(tempDir.resolve("file_3"), "c");

    FileCleanupServiceImpl service = new FileCleanupServiceImpl();
    ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
    ReflectionTestUtils.setField(service, "fileMetaDataRegistry", registry);

    int removed = service.cleanupRoom("ROOM1");

    assertEquals(2, removed);
    assertFalse(Files.exists(tempDir.resolve("file_1")));
    assertFalse(Files.exists(tempDir.resolve("file_2")));
    assertTrue(Files.exists(tempDir.resolve("file_3")), "other room's file must survive");
    assertFalse(registry.contains("file_1"));
    assertFalse(registry.contains("file_2"));
    assertTrue(registry.contains("file_3"));
  }

  @Test
  void cleanupRoomIsLenientAboutMissingBlobsAndBadInput() throws Exception {
    FileMetaDataRegistryImpl registry = new FileMetaDataRegistryImpl();
    registry.addRegistry("file_gone", new FileMeta("file_gone", 4L, "a.txt", "ROOM1"));

    FileCleanupServiceImpl service = new FileCleanupServiceImpl();
    ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
    ReflectionTestUtils.setField(service, "fileMetaDataRegistry", registry);

    // Metadata exists but blob is already gone -> no throw, metadata still dropped.
    assertEquals(0, service.cleanupRoom("ROOM1"));
    assertFalse(registry.contains("file_gone"));

    assertEquals(0, service.cleanupRoom(null));
    assertEquals(0, service.cleanupRoom("   "));
    assertEquals(0, service.cleanupRoom("UNKNOWN"));
  }
}

