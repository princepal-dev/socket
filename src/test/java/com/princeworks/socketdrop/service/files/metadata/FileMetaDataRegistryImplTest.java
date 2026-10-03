package com.princeworks.socketdrop.service.files.metadata;

import static org.junit.jupiter.api.Assertions.*;

import com.princeworks.socketdrop.model.file.FileMeta;
import java.util.List;
import org.junit.jupiter.api.Test;

class FileMetaDataRegistryImplTest {

  private final FileMetaDataRegistryImpl registry = new FileMetaDataRegistryImpl();

  @Test
  void addGetContainsAndRemoveWork() {
    FileMeta meta = new FileMeta("file_1", 10L, "a.txt", "room_1");

    registry.addRegistry("file_1", meta);

    assertTrue(registry.contains("file_1"));
    assertEquals(meta, registry.getDataFromRegistry("file_1"));
    assertEquals(meta, registry.removeDataFromRegistry("file_1"));
    assertFalse(registry.contains("file_1"));
  }

  @Test
  void findByRoomIdReturnsOnlyThatRoomsFiles() {
    registry.addRegistry("file_1", new FileMeta("file_1", 1L, "a.txt", "ROOM1"));
    registry.addRegistry("file_2", new FileMeta("file_2", 2L, "b.txt", "ROOM1"));
    registry.addRegistry("file_3", new FileMeta("file_3", 3L, "c.txt", "ROOM2"));

    List<FileMeta> found = registry.findByRoomId("ROOM1");

    assertEquals(2, found.size());
    assertTrue(found.stream().allMatch(m -> "ROOM1".equals(m.getRoomId())));
  }

  @Test
  void findByRoomIdIsNullSafeAndSnapshotSafe() {
    assertTrue(registry.findByRoomId(null).isEmpty());
    assertTrue(registry.findByRoomId("  ").isEmpty());
    assertTrue(registry.findByRoomId("nope").isEmpty());

    registry.addRegistry("file_1", new FileMeta("file_1", 1L, "a.txt", "R"));
    var snapshot = registry.findByRoomId("R");
    registry.removeDataFromRegistry("file_1");

    // Snapshot must survive later mutation of the live registry.
    assertEquals(1, snapshot.size());
  }
}