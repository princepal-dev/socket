package com.princeworks.socketdrop.service.files.metadata;

import com.princeworks.socketdrop.model.file.FileMeta;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Service
public class FileMetaDataRegistryImpl implements FileMetaDataRegistry {
    private final ConcurrentMap<String, FileMeta> fileRegistry = new ConcurrentHashMap<>();

    @Override
    public void addRegistry(String fileId, FileMeta metaData) {
        if (fileId != null && metaData != null) {
            fileRegistry.put(fileId, metaData);
        }
    }

    @Override
    public FileMeta getDataFromRegistry(String fileId) {
        if (fileId == null) return null;
        return fileRegistry.get(fileId);
    }

    @Override
    public FileMeta removeDataFromRegistry(String fileId) {
        if (fileId == null) return null;
        return fileRegistry.remove(fileId);
    }

    @Override
    public boolean contains(String fileId) {
        if (fileId == null) return false;
        return fileRegistry.containsKey(fileId);
    }

    @Override
    public List<FileMeta> findByRoomId(String roomId) {
        if (roomId == null || roomId.trim().isEmpty()) {
            return List.of();
        }
        // values() is weakly consistent; toList() snapshots it for safe iteration.
        return fileRegistry.values().stream()
                .filter(meta -> meta != null && roomId.equals(meta.getRoomId()))
                .toList();
    }
}