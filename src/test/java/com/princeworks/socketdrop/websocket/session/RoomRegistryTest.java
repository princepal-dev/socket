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

  @Test
  void reserveRoomIsExclusiveAndSurvivesFailedAttempts() {
    assertTrue(registry.reserveRoom("ABCD12"));

    // Second claim on the same code must fail (create-room TOCTOU guard).
    assertFalse(registry.reserveRoom("ABCD12"));
    assertFalse(registry.reserveRoom(null));
    assertFalse(registry.reserveRoom("  "));
    assertTrue(registry.reserveRoom("ZZZZ99"));

    // Reserved-but-empty room is not yet joinable/existing.
    assertFalse(registry.roomExists("ABCD12"));

    registry.joinRoom("s1", "ABCD12");
    assertTrue(registry.roomExists("ABCD12"));
    assertEquals("ABCD12", registry.getRoom("s1"));
  }

  @Test
  void concurrentReservationsNeverHandOutTheSameRoomTwice() throws Exception {
    int threads = 24;
    java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(8);
    java.util.List<java.util.concurrent.Future<Boolean>> futures = new java.util.ArrayList<>();
    java.util.Set<String> winners = java.util.concurrent.ConcurrentHashMap.newKeySet();

    for (int i = 0; i < threads; i++) {
      futures.add(
          pool.submit(
              () -> {
                boolean won = registry.reserveRoom("RACE01");
                if (won) {
                  winners.add("RACE01");
                }
                return won;
              }));
    }
    for (var f : futures) {
      f.get();
    }
    pool.shutdown();

    assertEquals(1, winners.size(), "exactly one thread may win a contested room code");
  }

  @Test
  void evictRoomRemovesRoomAndAllSessionPointers() {
    registry.joinRoom("s1", "r1");
    registry.joinRoom("s2", "r1");
    registry.joinRoom("s3", "r2");

    assertTrue(registry.evictRoom("r1"));

    assertFalse(registry.roomExists("r1"));
    assertNull(registry.getRoom("s1"), "session pointer must be cleared");
    assertNull(registry.getRoom("s2"), "session pointer must be cleared");
    assertTrue(registry.getSessions("r1").isEmpty());

    // Untouched room keeps working.
    assertTrue(registry.roomExists("r2"));
    assertEquals("r2", registry.getRoom("s3"));
  }

  @Test
  void evictRoomIsSafeOnUnknownAndNullRooms() {
    assertFalse(registry.evictRoom(null));
    assertFalse(registry.evictRoom("ghost"));
    registry.joinRoom("s1", "r1");
    assertFalse(registry.evictRoom("ghost"));
    assertTrue(registry.roomExists("r1"));
  }
}
