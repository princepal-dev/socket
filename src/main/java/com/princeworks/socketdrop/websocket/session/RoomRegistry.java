package com.princeworks.socketdrop.websocket.session;

import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Component
public class RoomRegistry {
  private final ConcurrentMap<String, String> sessionToRoom = new ConcurrentHashMap<>();
  private final ConcurrentMap<String, Set<String>> roomToSessionId = new ConcurrentHashMap<>();

  public synchronized void joinRoom(String sessionId, String roomId) {
    if (sessionId == null || roomId == null) return;

    // 1. Remove from old room (if exists)
    String oldRoom = sessionToRoom.remove(sessionId);
    if (oldRoom != null) {
      roomToSessionId.computeIfPresent(oldRoom, (r, sessions) -> {
        sessions.remove(sessionId);
        return sessions.isEmpty() ? null : sessions;
      });
    }

    // 2. Add to new room
    roomToSessionId.computeIfAbsent(roomId, r -> ConcurrentHashMap.newKeySet()).add(sessionId);

    // 3. Update session → room mapping
    sessionToRoom.put(sessionId, roomId);
  }

  public synchronized void leaveRoom(String sessionId) {
    if (sessionId == null) return;
    String room = sessionToRoom.remove(sessionId);
    if (room == null) return;

    roomToSessionId.computeIfPresent(room, (r, sessions) -> {
      sessions.remove(sessionId);
      return sessions.isEmpty() ? null : sessions;
    });
  }

  public String getRoom(String sessionId) {
    if (sessionId == null) return null;
    return sessionToRoom.get(sessionId);
  }

  /**
   * A room "exists" only once it has at least one member.
   *
   * <p>Deliberately not {@code containsKey}: a code reserved by {@link #reserveRoom} but not yet
   * joined must stay invisible so nobody can slip into a half-created room.
   */
  public boolean roomExists(String roomId) {
    if (roomId == null) return false;
    Set<String> sessions = roomToSessionId.get(roomId);
    return sessions != null && !sessions.isEmpty();
  }

  public Set<String> getSessions(String roomId) {
    if (roomId == null) return Collections.emptySet();
    Set<String> sessions = roomToSessionId.get(roomId);
    // Snapshot copy: callers (broadcast fan-out) iterate without seeing
    // concurrent join/leave interleavings or weakly-consistent views.
    return sessions == null ? Collections.emptySet() : Set.copyOf(sessions);
  }

  /**
   * Atomically claims a room code before any session joins it.
   *
   * <p>Guards the create-room TOCTOU window: two concurrent creators must never both observe the
   * code as free and end up sharing one room.
   *
   * @return true when the code was free and is now reserved
   */
  public synchronized boolean reserveRoom(String roomId) {
    if (roomId == null || roomId.trim().isEmpty()) {
      return false;
    }
    return roomToSessionId.putIfAbsent(roomId, ConcurrentHashMap.newKeySet()) == null;
  }

  /**
   * Hard-removes a room and every session→room pointer pointing at it.
   *
   * <p>Used by room self-destruct. Sessions are only unindexed here; socket lifecycle stays with
   * {@link SessionRegistry}.
   *
   * @return true when the room existed and was evicted
   */
  public synchronized boolean evictRoom(String roomId) {
    if (roomId == null) return false;
    Set<String> members = roomToSessionId.remove(roomId);
    if (members == null) return false;
    for (String sessionId : members) {
      sessionToRoom.remove(sessionId);
    }
    return true;
  }
}

