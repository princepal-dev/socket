package com.princeworks.socketdrop.websocket.session;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.princeworks.socketdrop.model.user.UserSessionInfo;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

class SessionRegistryTest {

  private final SessionRegistry registry = new SessionRegistry();

  @Test
  void handlesNullArgumentsGracefully() {
    assertDoesNotThrow(() -> registry.register(null, null));
    assertDoesNotThrow(() -> registry.registerSocket(null));
    assertDoesNotThrow(() -> registry.unregister(null));
    assertDoesNotThrow(() -> registry.unregisterUser(null));
    assertFalse(registry.isRegistered(null));
    assertNull(registry.getSocket(null));
    assertNull(registry.getUserInfo(null));
    assertFalse(registry.matchesUser(null, "u1"));
  }

  @Test
  void unregisterUserKeepsSocketAlive() {
    WebSocketSession session = mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s1");

    registry.registerSocket(session);
    registry.register("s1", new UserSessionInfo("u1", "alice"));

    assertTrue(registry.isRegistered("s1"));
    assertNotNull(registry.getSocket("s1"));
    assertTrue(registry.matchesUser("s1", "u1"));

    registry.unregisterUser("s1");

    assertFalse(registry.isRegistered("s1"));
    // Socket must still exist so user can rejoin!
    assertNotNull(registry.getSocket("s1"));

    registry.unregister("s1");
    assertNull(registry.getSocket("s1"));
  }
}
