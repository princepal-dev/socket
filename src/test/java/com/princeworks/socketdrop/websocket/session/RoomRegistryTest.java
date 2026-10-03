package com.princeworks.socketdrop.websocket.session;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Set;
import org.junit.jupiter.api.Test;

class RoomRegistryTest {

  private final RoomRegistry registry = new RoomRegistry();

  @Test
  void handlesNullArgumentsGracefully() {
    assertDoesNotThrow(() -> registry.joinRoom(null, null));
    assertDoesNotThrow(() -> registry.joinRoom("s1", null));
    assertDoesNotThrow(() -> registry.joinRoom(null, "r1"));
    assertDoesNotThrow(() -> registry.leaveRoom(null));
    assertFalse(registry.roomExists(null));
    assertNull(registry.getRoom(null));
    assertTrue(registry.getSessions(null).isEmpty());
  }

  @Test
  void joinsAndLeavesRoom() {
    registry.joinRoom("s1", "r1");
    assertTrue(registry.roomExists("r1"));
    assertEquals("r1", registry.getRoom("s1"));
    assertEquals(Set.of("s1"), registry.getSessions("r1"));

    registry.joinRoom("s2", "r1");
    assertEquals(Set.of("s1", "s2"), registry.getSessions("r1"));

    registry.leaveRoom("s1");
    assertTrue(registry.roomExists("r1"));
    assertEquals(Set.of("s2"), registry.getSessions("r1"));

    registry.leaveRoom("s2");
    assertFalse(registry.roomExists("r1"));
    assertTrue(registry.getSessions("r1").isEmpty());
  }

  @Test
  void movingRoomsCleansOldRoom() {
    registry.joinRoom("s1", "r1");
    registry.joinRoom("s1", "r2");

    assertFalse(registry.roomExists("r1"));
    assertTrue(registry.roomExists("r2"));
    assertEquals("r2", registry.getRoom("s1"));
  }
}
