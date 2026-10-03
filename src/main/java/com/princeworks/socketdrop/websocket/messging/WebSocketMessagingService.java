package com.princeworks.socketdrop.websocket.messging;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Service
public class WebSocketMessagingService {
  private final ObjectMapper objectMapper;
  private final Logger logger = LoggerFactory.getLogger(WebSocketMessagingService.class);

  public WebSocketMessagingService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public void sendToSession(WebSocketSession session, Object payload) {
    if (session == null || !session.isOpen()) {
      return;
    }

    try {
      String json = objectMapper.writeValueAsString(payload);
      synchronized (session) {
        if (session.isOpen()) {
          session.sendMessage(new TextMessage(json));
        }
      }
    } catch (Exception e) {
      logger.error("Error in sending messages to client : {}", e.getMessage());
    }
  }
}

