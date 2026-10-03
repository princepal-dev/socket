package com.princeworks.socketdrop.websocket.handler;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.princeworks.socketdrop.model.message.BaseMessage;
import com.princeworks.socketdrop.model.message.CreateRoomMessage;
import com.princeworks.socketdrop.model.message.JoinRoomMessage;
import com.princeworks.socketdrop.model.user.UserSessionInfo;
import com.princeworks.socketdrop.response.room.ErrorResponse;
import com.princeworks.socketdrop.response.room.RoomCreatedResponse;
import com.princeworks.socketdrop.response.room.RoomJoinedResponse;
import com.princeworks.socketdrop.util.IdGenerator;
import com.princeworks.socketdrop.websocket.messging.WebSocketMessagingService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;

@Component
public class RoomWebSocketHandler extends TextWebSocketHandler {

  private static final Logger logger = LoggerFactory.getLogger(RoomWebSocketHandler.class);

  @Autowired private RoomRegistry roomRegistry;
  @Autowired private ObjectMapper objectMapper;
  @Autowired private SessionRegistry sessionRegistry;
  @Autowired private WebSocketMessagingService webSocketMessagingService;

  @Override
  public void afterConnectionEstablished(WebSocketSession session) {
    String sessionId = session.getId();
    sessionRegistry.registerSocket(session);
    logger.info("WS CONNECTED : {}", sessionId);
  }

  @Override
  public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) {
    String sessionId = session.getId();
    logger.info("WS DISCONNECTED : {}", sessionId);
    roomRegistry.leaveRoom(sessionId);
    sessionRegistry.unregister(sessionId);
  }

  @Override
  public void handleTransportError(WebSocketSession session, Throwable exception) {
    String sessionId = session.getId();
    logger.error(
        "ERROR while connecting to : {}, error message :{}", sessionId, exception.getMessage());
    roomRegistry.leaveRoom(sessionId);
    sessionRegistry.unregister(sessionId);
  }

  @Override
  protected void handleTextMessage(WebSocketSession session, TextMessage message) {
    try {
      String sessionId = session.getId();
      BaseMessage baseMessage = objectMapper.readValue(message.getPayload(), BaseMessage.class);

      if (baseMessage == null || baseMessage.getType() == null) {
        logger.info(
            "No TYPE is found in the session {} & payload {}", sessionId, message.getPayload());
        sendError(session, "Missing message type");
        return;
      }

      switch (baseMessage.getType()) {
        case CREATE_ROOM:
          CreateRoomMessage createRoomMessage =
              objectMapper.readValue(message.getPayload(), CreateRoomMessage.class);
          handleCreateRoom(session, createRoomMessage);
          break;
        case JOIN_ROOM:
          JoinRoomMessage joinRoomMessage =
              objectMapper.readValue(message.getPayload(), JoinRoomMessage.class);
          handleJoinRoom(session, joinRoomMessage);
          break;
        case LEAVE_ROOM:
          handleLeaveRoom(session);
          break;
        default:
          logger.info("Invalid TYPE provided!");
          sendError(session, "Unsupported message type");
      }

    } catch (JsonProcessingException e) {
      logger.error("ERROR in Json processing : {}", e.getMessage());
      sendError(session, "Malformed message payload");
    } catch (Exception e) {
      logger.error("ERROR processing message : {}", e.getMessage(), e);
      sendError(session, "Internal error processing message");
    }
  }

  private void handleCreateRoom(WebSocketSession session, CreateRoomMessage msg) {
    if (msg == null) {
      sendError(session, "Malformed message payload");
      return;
    }

    String sessionId = session.getId();
    String displayName = msg.getDisplayName();

    if (displayName == null || displayName.trim().isEmpty()) {
      logger.warn("Display name cannot be blank");
      sendError(session, "displayName is required");
      return;
    }

    if (sessionRegistry.isRegistered(sessionId)) {
      logger.warn("Session {} already registered", sessionId);
      sendError(session, "Session is already in a room");
      return;
    }

    String roomId = IdGenerator.generateRoomId();
    String userId = IdGenerator.generateUsername();

    sessionRegistry.register(sessionId, new UserSessionInfo(userId, displayName.trim()));
    roomRegistry.joinRoom(sessionId, roomId);

    webSocketMessagingService.sendToSession(
        session, new RoomCreatedResponse(roomId, userId, displayName.trim()));
    logger.info("Room id created : {} successfully!", roomId);
  }

  private void handleJoinRoom(WebSocketSession session, JoinRoomMessage msg) {
    if (msg == null) {
      sendError(session, "Malformed message payload");
      return;
    }

    String roomId = msg.getRoomId();
    String sessionId = session.getId();

    if (roomId == null || roomId.trim().isEmpty()) {
      logger.warn("Room id cannot be blank");
      sendError(session, "roomId is required");
      return;
    }

    if (!roomRegistry.roomExists(roomId)) {
      logger.warn("You are trying to join a room id : {} which doesn't exist", roomId);
      sendError(session, "Room does not exist");
      return;
    }

    if (msg.getDisplayName() == null || msg.getDisplayName().trim().isEmpty()) {
      logger.warn("Display name cannot be blank");
      sendError(session, "displayName is required");
      return;
    }

    if (sessionRegistry.isRegistered(sessionId)) {
      logger.warn("Session {} already registered", sessionId);
      sendError(session, "Session is already in a room");
      return;
    }

    String userId = IdGenerator.generateUsername();
    UserSessionInfo userInfo = new UserSessionInfo(userId, msg.getDisplayName().trim());

    // Logging the info
    logger.info(
        "JOIN_ROOM from session : {}, user id : {}, room id : {}", sessionId, userId, roomId);

    // Registering rooms & username to a particular session
    sessionRegistry.register(sessionId, userInfo);
    roomRegistry.joinRoom(sessionId, roomId);
    webSocketMessagingService.sendToSession(
        session, new RoomJoinedResponse(roomId, userInfo.getUserId(), userInfo.getDisplayName()));

    // Logging success
    logger.info("Room id : {} joined successfully!", roomId);
  }

  private void handleLeaveRoom(WebSocketSession session) {
    String sessionId = session.getId();

    // Leaving room & clearing user registration while preserving socket for re-joining
    roomRegistry.leaveRoom(sessionId);
    sessionRegistry.unregisterUser(sessionId);

    // Logging you have left room successfully
    logger.info("Session id : {} cleared successfully", sessionId);
  }

  private void sendError(WebSocketSession session, String message) {
    webSocketMessagingService.sendToSession(session, new ErrorResponse(message));
  }
}
