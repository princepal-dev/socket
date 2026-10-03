package com.princeworks.socketdrop.websocket.handler;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
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

    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", roomRegistry);
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", sessionRegistry);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);

    WebSocketSession session = Mockito.mock(WebSocketSession.class);
    when(session.getId()).thenReturn("s1");

    handler.afterConnectionEstablished(session);
    handler.handleTextMessage(session, new TextMessage("{\"type\":\"CREATE_ROOM\",\"displayName\":\"alice\"}"));

    assertTrue(sessionRegistry.isRegistered("s1"));
    assertNotNull(roomRegistry.getRoom("s1"));
    verify(messagingService, times(1)).sendToSession(any(WebSocketSession.class), any());
  }

  @Test
  void invalidPayloadSendsErrorResponse() {
    RoomWebSocketHandler handler = new RoomWebSocketHandler();
    ReflectionTestUtils.setField(handler, "roomRegistry", new RoomRegistry());
    ReflectionTestUtils.setField(handler, "objectMapper", new ObjectMapper());
    ReflectionTestUtils.setField(handler, "sessionRegistry", new SessionRegistry());

    WebSocketMessagingService messagingService = Mockito.mock(WebSocketMessagingService.class);
    ReflectionTestUtils.setField(handler, "webSocketMessagingService", messagingService);

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
}


