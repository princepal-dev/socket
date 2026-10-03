package com.princeworks.socketdrop.service.files.cleanup;

public interface FileCleanupService {
  void cleanupFile(String fileId);

  /**
   * Deletes every file (disk + metadata) belonging to a room.
   *
   * @return number of files removed from disk
   */
  int cleanupRoom(String roomId);
}