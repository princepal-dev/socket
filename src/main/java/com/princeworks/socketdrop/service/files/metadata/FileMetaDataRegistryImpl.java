package com.princeworks.socketdrop.service.files.metadata;

import com.princeworks.socketdrop.model.file.FileMeta;
import org.springframework.stereotype.Service;

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
}

