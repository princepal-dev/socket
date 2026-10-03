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
import com.princeworks.socketdrop.service.event.presence.RoomPresenceService;
import com.princeworks.socketdrop.service.event.progress.ProgressEventService;
import com.princeworks.socketdrop.service.files.cleanup.FileCleanupService;
import com.princeworks.socketdrop.util.IdGenerator;
import com.princeworks.socketdrop.websocket.messging.WebSocketMessagingService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import org.springframework.web.socket.WebSocketSession;

@Component
public class RoomWebSocketHandler extends TextWebSocketHandler {

  private static final Logger logger = LoggerFactory.getLogger(RoomWebSocketHandler.class);

  /** Custom close code so clients can tell "room destroyed" from a network drop. */
  private static final int ROOM_DESTROYED_CLOSE_CODE = 4001;

  @Autowired private RoomRegistry roomRegistry;
  @Autowired private ObjectMapper objectMapper;
  @Autowired private SessionRegistry sessionRegistry;
  @Autowired private WebSocketMessagingService webSocketMessagingService;
  @Autowired private FileCleanupService fileCleanupService;
  @Autowired(required = false) private com.princeworks.socketdrop.service.files.metadata.FileMetaDataRegistry fileMetaDataRegistry;
  @Autowired private ProgressEventService progressEventService;
  @Autowired private RoomPresenceService roomPresenceService;

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
    handleDisconnect(sessionId);
  }

  @Override
  public void handleTransportError(WebSocketSession session, Throwable exception) {
    String sessionId = session.getId();
    logger.error(
        "ERROR while connecting to : {}, error message :{}", sessionId, exception.getMessage());
    handleDisconnect(sessionId);
  }

  private void handleDisconnect(String sessionId) {
    String roomId = roomRegistry.getRoom(sessionId);
    roomRegistry.leaveRoom(sessionId);
    sessionRegistry.unregister(sessionId);
    if (roomId != null) {
      if (!roomRegistry.roomExists(roomId)) {
        if (fileCleanupService != null) {
          try {
            int cleaned = fileCleanupService.cleanupRoom(roomId);
            logger.info("Room {} became empty after disconnect; auto-cleaned {} file(s)", roomId, cleaned);
          } catch (Exception e) {
            logger.warn("Auto-cleanup for empty room {} failed: {}", roomId, e.getMessage());
          }
        }
      } else if (roomPresenceService != null) {
        roomPresenceService.notifyPresence(roomId);
      }
    }
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
        case DESTROY_ROOM:
          handleDestroyRoom(session);
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

    String roomId = null;
    for (int attempt = 0; attempt < 10; attempt++) {
      String candidate = IdGenerator.generateRoomId();
      // reserveRoom is atomic: no two creators can win the same code.
      if (roomRegistry.reserveRoom(candidate)) {
        roomId = candidate;
        break;
      }
    }
    if (roomId == null) {
      sendError(session, "Could not create room, try again");
      return;
    }

    try {
      String userId = IdGenerator.generateUsername();

      sessionRegistry.register(sessionId, new UserSessionInfo(userId, displayName.trim()));
      roomRegistry.joinRoom(sessionId, roomId);

      webSocketMessagingService.sendToSession(
          session, new RoomCreatedResponse(roomId, userId, displayName.trim()));
      if (roomPresenceService != null) {
        roomPresenceService.notifyPresence(roomId);
      }
      logger.info("Room id created : {} successfully!", roomId);
    } catch (Exception e) {
      logger.error("Failed to finish room creation for {}: {}", roomId, e.getMessage());
      roomRegistry.evictRoom(roomId);
      sessionRegistry.unregisterUser(sessionId);
      sendError(session, "Internal error creating room");
    }
  }

  private void handleJoinRoom(WebSocketSession session, JoinRoomMessage msg) {
    if (msg == null) {
      sendError(session, "Malformed message payload");
      return;
    }

    String rawRoomId = msg.getRoomId();
    String sessionId = session.getId();

    if (rawRoomId == null || rawRoomId.trim().isEmpty()) {
      logger.warn("Room id cannot be blank");
      sendError(session, "roomId is required");
      return;
    }

    String roomId = IdGenerator.normalizeRoomId(rawRoomId);

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

    var existingFiles = fileMetaDataRegistry != null
        ? fileMetaDataRegistry.findByRoomId(roomId)
        : java.util.List.<com.princeworks.socketdrop.model.file.FileMeta>of();

    webSocketMessagingService.sendToSession(
        session, new RoomJoinedResponse(roomId, userInfo.getUserId(), userInfo.getDisplayName(), existingFiles));
    if (roomPresenceService != null) {
      roomPresenceService.notifyPresence(roomId);
    }

    // Logging success
    logger.info("Room id : {} joined successfully!", roomId);
  }

  private void handleLeaveRoom(WebSocketSession session) {
    String sessionId = session.getId();
    String roomId = roomRegistry.getRoom(sessionId);

    // Leaving room & clearing user registration while preserving socket for re-joining
    roomRegistry.leaveRoom(sessionId);
    sessionRegistry.unregisterUser(sessionId);

    if (roomId != null) {
      if (!roomRegistry.roomExists(roomId)) {
        if (fileCleanupService != null) {
          try {
            int cleaned = fileCleanupService.cleanupRoom(roomId);
            logger.info("Room {} became empty after leave; auto-cleaned {} file(s)", roomId, cleaned);
          } catch (Exception e) {
            logger.warn("Auto-cleanup for empty room {} failed: {}", roomId, e.getMessage());
          }
        }
      } else if (roomPresenceService != null) {
        // Tell the rest of the room the roster shrank.
        roomPresenceService.notifyPresence(roomId);
      }
    }

    // Logging you have left room successfully
    logger.info("Session id : {} cleared successfully", sessionId);
  }

  /**
   * Self-destruct: wipes every file owned by the caller's room, tells peers why, then kicks all
   * sockets out including the initiator's.
   *
   * <p>Order matters — announce first so peers get a reason instead of a mystery socket close.
   */
  private void handleDestroyRoom(WebSocketSession session) {
    String sessionId = session.getId();
    String roomId = roomRegistry.getRoom(sessionId);

    if (roomId == null) {
      sendError(session, "You are not in a room");
      return;
    }

    // Snapshot before mutating the registry.
    var members = roomRegistry.getSessions(roomId);
    if (members.isEmpty()) {
      roomRegistry.evictRoom(roomId);
      sendError(session, "Room is already empty");
      return;
    }

    int deletedFiles = 0;
    try {
      deletedFiles = fileCleanupService.cleanupRoom(roomId);
    } catch (RuntimeException e) {
      logger.error("Room {} file cleanup failed: {}", roomId, e.getMessage());
      sendError(session, "Could not delete room files — aborting destroy");
      return;
    }

    progressEventService.notifyRoomDestroyed(roomId, deletedFiles);

    for (String memberSessionId : members) {
      WebSocketSession member = sessionRegistry.getSocket(memberSessionId);
      roomRegistry.leaveRoom(memberSessionId);
      sessionRegistry.unregister(memberSessionId);
      webSocketMessagingService.closeSession(member, ROOM_DESTROYED_CLOSE_CODE, "Room destroyed");
    }
    roomRegistry.evictRoom(roomId);

    logger.warn(
        "Room {} DESTROYED by {} — {} file(s) deleted, {} peer(s) kicked",
        roomId,
        sessionId,
        deletedFiles,
        members.size());
  }

  private void sendError(WebSocketSession session, String message) {
    webSocketMessagingService.sendToSession(session, new ErrorResponse(message));
  }
}
