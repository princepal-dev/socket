package com.princeworks.socketdrop.model.file;

public class FileMeta {
    private String fileId;
    private Long fileSize;
    private String originalFileName;
    private String roomId;
    private String uploaderId;

    public FileMeta(String fileId, Long fileSize, String originalFileName, String roomId) {
        this(fileId, fileSize, originalFileName, roomId, null);
    }

    public FileMeta(String fileId, Long fileSize, String originalFileName, String roomId, String uploaderId) {
        this.fileId = fileId;
        this.fileSize = fileSize;
        this.originalFileName = originalFileName;
        this.roomId = roomId;
        this.uploaderId = uploaderId;
    }

    public String getFileId() {
        return fileId;
    }

    public Long getFileSize() {
        return fileSize;
    }

    public String getOriginalFileName() {
        return originalFileName;
    }

    public String getRoomId() {
        return roomId;
    }

    public String getUploaderId() {
        return uploaderId;
    }
}
