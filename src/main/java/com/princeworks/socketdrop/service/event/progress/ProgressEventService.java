package com.princeworks.socketdrop.service.event.progress;

public interface ProgressEventService {
  void notifyUploadStarted(String roomId, String fileName, long fileSize);

  void notifyUploadCompleted(String roomId, String fileId, String fileName, long fileSize);

  void notifyUploadCompleted(String roomId, String fileId, String fileName, long fileSize, String uploaderId);

  void notifyUploadFailed(String roomId, String fileName, String reason);

  void notifyFileDeleted(String roomId, String fileId, String fileName);

  /** Tells every peer in the room that it (and its files) is being destroyed. */
  void notifyRoomDestroyed(String roomId, int deletedFiles);
}