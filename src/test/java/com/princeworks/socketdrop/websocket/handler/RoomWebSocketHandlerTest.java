package com.princeworks.socketdrop.websocket.handler;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.princeworks.socketdrop.exception.FileStorageException;
import com.princeworks.socketdrop.helper.Operation;
import com.princeworks.socketdrop.model.user.UserSessionInfo;
import com.princeworks.socketdrop.service.event.presence.RoomPresenceService;
import com.princeworks.socketdrop.service.event.progress.ProgressEventService;
import com.princeworks.socketdrop.service.files.cleanup.FileCleanupService;
import com.princeworks.socketdrop.websocket.messging.WebSocketMessagingService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

class RoomWebSocketHandlerTest {

  @Test
  void createRoomRegistersSessionAndSendsResponse() throws Exception {
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    RoomPresenceService presenceService = Mockito.mock(RoomPresenceService.class);

    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);
    ReflectionTestUtils.setField(handler, "roomPresenceService", presenceService);

    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s1");

    handler.afterConnectionEstablished(session);
    handler.handleTextMessage(session, new TextMessage("{\"type\":\"CREATE_ROOM\",\"displayName\":\"alice\"}"));

    assertTrue(sessionRegistry.isRegistered("s1"));
    assertNotNull(roomRegistry.getRoom("s1"));
    // One ROOM_CREATED frame; presence goes through its own service.
    verify(messagingService, times(1)).sendToSession(any(WebSocketSession.class), any());
    verify(presenceService, times(1)).notifyPresence(anyString());
  }

  @Test
  void invalidPayloadSendsErrorResponse() {
    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", new RoomRegistry());
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", new SessionRegistry());

    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);
    ReflectionTestUtils.setField(handler, "roomPresenceService", Mockito.mock(RoomPresenceService.class));

    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s2");

    handler.handleTextMessage(session, new TextMessage("{not-json}"));

    verify(messagingService, times(1)).sendToSession(any(WebSocketSession.class), any());
  }

  @Test
  void joinRoomWithoutRoomIdDoesNotCrashAndSendsError() {
    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);

    ReflectionTestUtils.setField(handler, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);

    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s3");

    handler.afterConnectionEstablished(session);
    // Malformed: missing roomId
    handler.handleTextMessage(session, new TextMessage("{\"type\":\"JOIN_ROOM\",\"displayName\":\"bob\"}"));

    verify(messagingService, times(1)).sendToSession(any(WebSocketSession.class), any());
  }

  @Test
  void nullJsonPayloadSendsErrorResponse() {
    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", new RoomRegistry());
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", new SessionRegistry());

    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);
    ReflectionTestUtils.setField(handler, "roomPresenceService", Mockito.mock(RoomPresenceService.class));

    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s4");

    handler.handleTextMessage(session, new TextMessage("null"));

    verify(messagingService, times(1)).sendToSession(any(WebSocketSession.class), any());
  }

  @Test
  void leaveRoomPreservesSocketInSessionRegistry() {
    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);

    ReflectionTestUtils.setField(handler, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);

    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s5");

    handler.afterConnectionEstablished(session);
    handler.handleTextMessage(session, new TextMessage("{\"type\":\"CREATE_ROOM\",\"displayName\":\"alice\"}"));

    assertTrue(sessionRegistry.isRegistered("s5"));
    assertNotNull(sessionRegistry.getSocket("s5"));

    handler.handleTextMessage(session, new TextMessage("{\"type\":\"LEAVE_ROOM\"}"));

    // User is unregistered from room, but socket is still preserved!
    assertFalse(sessionRegistry.isRegistered("s5"));
    assertNotNull(sessionRegistry.getSocket("s5"));
  }

  @Test
  void destroyRoomDeletesFilesAndKicksEveryoneIncludingCreator() {
    RoomRegistry roomRegistry = new RoomRegistry();
    SessionRegistry sessionRegistry = new SessionRegistry();
    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    FileCleanupService cleanupService = Mockito.mock(FileCleanupService.class);
    ProgressEventService progressEventService = Mockito.mock(ProgressEventService.class);

    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);
    ReflectionTestUtils.setField(handler, "fileCleanupService", cleanupService);
    ReflectionTestUtils.setField(handler, "progressEventService", progressEventService);
    ReflectionTestUtils.setField(handler, "roomPresenceService", Mockito.mock(RoomPresenceService.class));

    when(cleanupService.cleanupRoom(anyString())).thenReturn(3);

    WebSocketSession alice = mockOpenSession("s1");
    WebSocketSession bob = mockOpenSession("s2");

    handler.afterConnectionEstablished(alice);
    handler.afterConnectionEstablished(bob);
    handler.handleTextMessage(alice, new TextMessage("{\"type\":\"CREATE_ROOM\",\"displayName\":\"alice\"}"));
    String roomId = roomRegistry.getRoom("s1");

    // Bob joins the same room.
    roomRegistry.joinRoom("s2", roomId);
    sessionRegistry.register("s2", new UserSessionInfo("username_bob", "bob"));

    handler.handleTextMessage(alice, new TextMessage("{\"type\":\"DESTROY_ROOM\"}"));

    // Files wiped, peers told why, room gone, nobody registered.
    verify(cleanupService, times(1)).cleanupRoom(roomId);
    verify(progressEventService, times(1)).notifyRoomDestroyed(eq(roomId), eq(3));
    verify(messagingService, times(2)).closeSession(any(WebSocketSession.class), anyInt(), anyString());

    assertFalse(roomRegistry.roomExists(roomId));
    assertTrue(roomRegistry.getSessions(roomId).isEmpty());
    assertFalse(sessionRegistry.isRegistered("s1"));
    assertFalse(sessionRegistry.isRegistered("s2"));
    assertNull(sessionRegistry.getSocket("s1"));
    assertNull(sessionRegistry.getSocket("s2"));
  }

  @Test
  void destroyRoomOutsideAnyRoomSendsErrorAndDoesNotCleanup() {
    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    FileCleanupService cleanupService = Mockito.mock(FileCleanupService.class);

    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", new RoomRegistry());
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", new SessionRegistry());
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);
    ReflectionTestUtils.setField(handler, "fileCleanupService", cleanupService);
    ReflectionTestUtils.setField(handler, "progressEventService", Mockito.mock(ProgressEventService.class));
    ReflectionTestUtils.setField(handler, "roomPresenceService", Mockito.mock(RoomPresenceService.class));

    WebSocketSession session = mockOpenSession("s9");
    handler.afterConnectionEstablished(session);

    handler.handleTextMessage(session, new TextMessage("{\"type\":\"DESTROY_ROOM\"}"));

    verify(cleanupService, never()).cleanupRoom(anyString());
    verify(messagingService, never()).closeSession(any(WebSocketSession.class), anyInt(), anyString());
    verify(messagingService, times(1)).sendToSession(any(WebSocketSession.class), any());
  }

  @Test
  void destroyRoomAbortsWhenFileCleanupFails() {
    RoomRegistry roomRegistry = new RoomRegistry();
    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    FileCleanupService cleanupService = Mockito.mock(FileCleanupService.class);

    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", new SessionRegistry());
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);
    ReflectionTestUtils.setField(handler, "fileCleanupService", cleanupService);
    ReflectionTestUtils.setField(handler, "progressEventService", Mockito.mock(ProgressEventService.class));
    ReflectionTestUtils.setField(handler, "roomPresenceService", Mockito.mock(RoomPresenceService.class));

    when(cleanupService.cleanupRoom(anyString()))
        .thenThrow(new FileStorageException("disk on fire", Operation.DELETE, "boom"));

    WebSocketSession alice = mockOpenSession("s1");
    handler.afterConnectionEstablished(alice);
    handler.handleTextMessage(alice, new TextMessage("{\"type\":\"CREATE_ROOM\",\"displayName\":\"alice\"}"));
    String roomId = roomRegistry.getRoom("s1");

    handler.handleTextMessage(alice, new TextMessage("{\"type\":\"DESTROY_ROOM\"}"));

    // Room survives so the user can retry or leave manually.
    assertTrue(roomRegistry.roomExists(roomId));
    verify(messagingService, never()).closeSession(any(WebSocketSession.class), anyInt(), anyString());
  }

  private WebSocketSession mockOpenSession(String id) {
    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn(id);
    when(session.isOpen()).thenReturn(true);
    return session;
  }
}


