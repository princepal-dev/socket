package com.princeworks.socketdrop.service.event.presence;

import com.princeworks.socketdrop.model.user.UserSessionInfo;
import com.princeworks.socketdrop.response.room.RoomPresenceResponse;
import com.princeworks.socketdrop.websocket.messging.WebSocketMessagingService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

@Service
public class RoomPresenceServiceImpl implements RoomPresenceService {

  @Autowired private RoomRegistry roomRegistry;
  @Autowired private SessionRegistry sessionRegistry;
  @Autowired private WebSocketMessagingService webSocketMessagingService;

  @Override
  public void notifyPresence(String roomId) {
    if (roomId == null || roomId.trim().isEmpty()) return;

    List<String> names = currentParticipants(roomId);
    RoomPresenceResponse payload = new RoomPresenceResponse(roomId, names);

    for (String sessionId : roomRegistry.getSessions(roomId)) {
      try {
        WebSocketSession session = sessionRegistry.getSocket(sessionId);
        if (session != null) {
          webSocketMessagingService.sendToSession(session, payload);
        }
      } catch (Exception ignored) {
        // One broken socket must not stop presence reaching the rest of the room.
      }
    }
  }

  @Override
  public List<String> currentParticipants(String roomId) {
    if (roomId == null || roomId.trim().isEmpty()) return List.of();

    // De-duplicate by display name: two tabs on one device show as one person.
    LinkedHashSet<String> unique = new LinkedHashSet<>();
    for (String sessionId : roomRegistry.getSessions(roomId)) {
      UserSessionInfo info = sessionRegistry.getUserInfo(sessionId);
      if (info != null && info.getDisplayName() != null && !info.getDisplayName().trim().isEmpty()) {
        unique.add(info.getDisplayName().trim());
      }
    }
    return new ArrayList<>(unique);
  }
}