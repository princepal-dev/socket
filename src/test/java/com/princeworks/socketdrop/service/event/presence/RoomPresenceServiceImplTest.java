package com.princeworks.socketdrop.service.event.presence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.princeworks.socketdrop.model.user.UserSessionInfo;
import com.princeworks.socketdrop.websocket.messging.WebSocketMessagingService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.WebSocketSession;

class RoomPresenceServiceImplTest {

  private RoomPresenceServiceImpl serviceWith(RoomRegistry rooms, SessionRegistry sessions, WebSocketMessagingService msg) {
    RoomPresenceServiceImpl service = new RoomPresenceServiceImpl();
    org.springframework.test.util.ReflectionTestUtils.setField(service, "roomRegistry", rooms);
    org.springframework.test.util.ReflectionTestUtils.setField(service, "sessionRegistry", sessions);
    org.springframework.test.util.ReflectionTestUtils.setField(service, "webSocketMessagingService", msg);
    return service;
  }

  @Test
  void listsEveryMemberDisplayName() {
    RoomRegistry rooms = new RoomRegistry();
    SessionRegistry sessions = new SessionRegistry();

    rooms.joinRoom("s1", "R1");
    rooms.joinRoom("s2", "R1");
    rooms.joinRoom("s3", "R2");
    sessions.register("s1", new UserSessionInfo("u1", "Alice"));
    sessions.register("s2", new UserSessionInfo("u2", "Bob"));

    RoomPresenceServiceImpl service = serviceWith(rooms, sessions, Mockito.mock(WebSocketMessagingService.class));

    List<String> names = service.currentParticipants("R1");

    assertEquals(2, names.size());
    assertTrue(names.contains("Alice"));
    assertTrue(names.contains("Bob"));
  }

  @Test
  void deduplicatesSamePersonOnTwoTabs() {
    RoomRegistry rooms = new RoomRegistry();
    SessionRegistry sessions = new SessionRegistry();
    rooms.joinRoom("s1", "R1");
    rooms.joinRoom("s2", "R1");
    sessions.register("s1", new UserSessionInfo("u1", "Alice"));
    sessions.register("s2", new UserSessionInfo("u2", "Alice"));

    RoomPresenceServiceImpl service = serviceWith(rooms, sessions, Mockito.mock(WebSocketMessagingService.class));

    assertEquals(1, service.currentParticipants("R1").size());
  }

  @Test
  void unknownAndBlankRoomsAreHandled() {
    RoomPresenceServiceImpl service =
        serviceWith(new RoomRegistry(), new SessionRegistry(), Mockito.mock(WebSocketMessagingService.class));

    assertTrue(service.currentParticipants(null).isEmpty());
    assertTrue(service.currentParticipants("  ").isEmpty());
    assertTrue(service.currentParticipants("NOPE").isEmpty());
  }

  @Test
  void notifyPresenceBroadcastsToAllRoomMembers() {
    RoomRegistry rooms = new RoomRegistry();
    SessionRegistry sessions = new SessionRegistry();
    WebSocketMessagingService msg = Mockito.mock(WebSocketMessagingService.class);

    WebSocketSession s1 = mockOpenSession("s1");
    WebSocketSession s2 = mockOpenSession("s2");

    rooms.joinRoom("s1", "R1");
    rooms.joinRoom("s2", "R1");
    sessions.registerSocket(s1);
    sessions.registerSocket(s2);
    sessions.register("s1", new UserSessionInfo("u1", "Alice"));
    sessions.register("s2", new UserSessionInfo("u2", "Bob"));

    RoomPresenceServiceImpl service = serviceWith(rooms, sessions, msg);
    service.notifyPresence("R1");

    verify(msg, times(2)).sendToSession(any(WebSocketSession.class), any());
  }

  @Test
  void notifyPresenceIgnoresBlankRoom() {
    WebSocketMessagingService msg = Mockito.mock(WebSocketMessagingService.class);
    RoomPresenceServiceImpl service = serviceWith(new RoomRegistry(), new SessionRegistry(), msg);

    service.notifyPresence(null);
    service.notifyPresence("   ");

    verify(msg, never()).sendToSession(any(WebSocketSession.class), any());
    verify(msg, never()).sendToSession(any(), anyString());
  }

  private WebSocketSession mockOpenSession(String id) {
    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    Mockito.when(session.getId()).thenReturn(id);
    Mockito.when(session.isOpen()).thenReturn(true);
    return session;
  }
}