package com.princeworks.socketdrop.service.event.progress;

public interface ProgressEventService {
  void notifyUploadStarted(String roomId, String fileName, long fileSize);

  void notifyUploadCompleted(String roomId, String fileId, String fileName, long fileSize);

  void notifyUploadFailed(String roomId, String fileName, String reason);

  /** Tells every peer in the room that it (and its files) is being destroyed. */
  void notifyRoomDestroyed(String roomId, int deletedFiles);
}