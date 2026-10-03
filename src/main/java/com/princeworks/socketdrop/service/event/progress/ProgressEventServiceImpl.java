package com.princeworks.socketdrop.service.event.progress;

import com.princeworks.socketdrop.response.file.UploadProgressResponse;
import com.princeworks.socketdrop.response.room.RoomDestroyedResponse;
import com.princeworks.socketdrop.websocket.messging.WebSocketMessagingService;
import com.princeworks.socketdrop.websocket.session.RoomRegistry;
import com.princeworks.socketdrop.websocket.session.SessionRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.WebSocketSession;

@Service
public class ProgressEventServiceImpl implements ProgressEventService {
	@Autowired private RoomRegistry roomRegistry;
	@Autowired private SessionRegistry sessionRegistry;
	@Autowired private WebSocketMessagingService webSocketMessagingService;

	@Override
	public void notifyUploadStarted(String roomId, String fileName, long fileSize) {
		sendToRoom(
			roomId, new UploadProgressResponse(roomId, "STARTED", null, fileName, fileSize, "Upload started"));
	}

	@Override
	public void notifyUploadCompleted(String roomId, String fileId, String fileName, long fileSize) {
		notifyUploadCompleted(roomId, fileId, fileName, fileSize, null);
	}

	@Override
	public void notifyUploadCompleted(
			String roomId, String fileId, String fileName, long fileSize, String uploaderId) {
		sendToRoom(
			roomId,
			new UploadProgressResponse(
				roomId, "COMPLETED", fileId, fileName, fileSize, "Upload completed", uploaderId));
	}

	@Override
	public void notifyUploadFailed(String roomId, String fileName, String reason) {
		sendToRoom(
			roomId,
			new UploadProgressResponse(roomId, "FAILED", null, fileName, null, reason));
	}

	@Override
	public void notifyFileDeleted(String roomId, String fileId, String fileName) {
		sendToRoom(roomId, new com.princeworks.socketdrop.response.file.FileDeletedResponse(roomId, fileId, fileName));
	}

	@Override
	public void notifyRoomDestroyed(String roomId, int deletedFiles) {
		String message =
				deletedFiles > 0
						? "Room destroyed — " + deletedFiles + " file(s) permanently deleted"
						: "Room destroyed";
		// Bypass roomExists check: destroy must reach peers even as the room is torn down.
		broadcast(roomId, new RoomDestroyedResponse(roomId, deletedFiles, message));
	}

	private void sendToRoom(String roomId, Object payload) {
		if (roomId == null || roomId.trim().isEmpty() || !roomRegistry.roomExists(roomId)) {
			return;
		}
		broadcast(roomId, payload);
	}

	private void broadcast(String roomId, Object payload) {
		if (roomId == null || roomId.trim().isEmpty()) {
			return;
		}

		// Snapshot already immutable from RoomRegistry; defensive copy guards
		// against registry swap mid-loop. One slow client must not break fan-out.
		for (String sessionId : roomRegistry.getSessions(roomId)) {
			try {
				WebSocketSession session = sessionRegistry.getSocket(sessionId);
				if (session != null) {
					webSocketMessagingService.sendToSession(session, payload);
				}
			} catch (Exception ignored) {
				// Per-session failure is isolated; continue to remaining peers.
			}
		}
	}
}