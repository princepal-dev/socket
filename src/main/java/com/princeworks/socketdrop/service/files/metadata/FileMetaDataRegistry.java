package com.princeworks.socketdrop.service.files.metadata;

import com.princeworks.socketdrop.model.file.FileMeta;
import java.util.List;

public interface FileMetaDataRegistry {
  void addRegistry(String fileId, FileMeta metaData);

  FileMeta getDataFromRegistry(String fileId);

  FileMeta removeDataFromRegistry(String fileId);

  boolean contains(String fileId);

  /** Snapshot of every metadata entry that belongs to the given room. */
  List<FileMeta> findByRoomId(String roomId);
}