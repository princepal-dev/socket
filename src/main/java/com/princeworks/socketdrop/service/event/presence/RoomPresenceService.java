package com.princeworks.socketdrop.service.event.presence;

import java.util.List;

/** Broadcasts who is currently inside a room so clients can show live presence. */
public interface RoomPresenceService {
  /** Recomputes and pushes the participant list for the room. */
  void notifyPresence(String roomId);

  /** Current display names in the room, best-effort (may be empty for unknown rooms). */
  List<String> currentParticipants(String roomId);
}