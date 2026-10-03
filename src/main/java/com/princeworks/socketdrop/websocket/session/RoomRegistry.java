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

  public void joinRoom(String sessionId, String roomId) {
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

  public void leaveRoom(String sessionId) {
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

  public boolean roomExists(String roomId) {
    if (roomId == null) return false;
    return roomToSessionId.containsKey(roomId);
  }

  public Set<String> getSessions(String roomId) {
    if (roomId == null) return Collections.emptySet();
    Set<String> sessions = roomToSessionId.get(roomId);
    return sessions == null ? Collections.emptySet() : Collections.unmodifiableSet(sessions);
  }
}

