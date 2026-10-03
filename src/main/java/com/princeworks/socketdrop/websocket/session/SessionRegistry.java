package com.princeworks.socketdrop.websocket.session;

import com.princeworks.socketdrop.model.user.UserSessionInfo;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

// Answers:
// Who is connected?
// Which user belongs to which session?
// Which session belongs to which user?

@Component
public class SessionRegistry {
  private final ConcurrentMap<String, UserSessionInfo> sessionToUser = new ConcurrentHashMap<>();
  private final ConcurrentMap<String, WebSocketSession> sessionIdToSocket = new ConcurrentHashMap<>();

  public void registerSocket(WebSocketSession session) {
    if (session != null && session.getId() != null) {
      sessionIdToSocket.put(session.getId(), new ConcurrentWebSocketSessionDecorator(session, 10000, 64 * 1024));
    }
  }

  public void register(String sessionId, UserSessionInfo userInfo) {
    if (sessionId != null && userInfo != null) {
      sessionToUser.put(sessionId, userInfo);
    }
  }

  public void unregister(String sessionId) {
    if (sessionId == null) return;
    sessionToUser.remove(sessionId);
    sessionIdToSocket.remove(sessionId);
  }

  public void unregisterUser(String sessionId) {
    if (sessionId == null) return;
    sessionToUser.remove(sessionId);
  }

  public UserSessionInfo getUserName(String sessionId) {
    return getUserInfo(sessionId);
  }

  public UserSessionInfo getUserInfo(String sessionId) {
    if (sessionId == null) return null;
    return sessionToUser.get(sessionId);
  }

  public boolean isRegistered(String sessionId) {
    if (sessionId == null) return false;
    return sessionToUser.containsKey(sessionId);
  }

  public WebSocketSession getSocket(String sessionId) {
    if (sessionId == null) return null;
    return sessionIdToSocket.get(sessionId);
  }

  public boolean matchesUser(String sessionId, String userId) {
    if (sessionId == null || userId == null) return false;
    UserSessionInfo userInfo = sessionToUser.get(sessionId);
    return userInfo != null && userId.equals(userInfo.getUserId());
  }
}

