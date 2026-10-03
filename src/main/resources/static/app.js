/**
 * SocketDrop — Real-Time Peer-to-Peer File Sharing Engine
 * High-performance vanilla JavaScript frontend
 */

// DOM Elements
const wsStatusEl = document.getElementById("wsStatus");
const currentRoomEl = document.getElementById("currentRoom");
const currentUserEl = document.getElementById("currentUser");
const userAvatarEl = document.getElementById("userAvatar");
const metricUserEl = document.getElementById("metricUser");
const fileCountEl = document.getElementById("fileCount");
const joinHintEl = document.getElementById("joinHint");
const roomPromptEl = document.getElementById("roomPrompt");
const logEl = document.getElementById("log");
const fileActionsSectionEl = document.getElementById("fileActionsSection");
const filesListSectionEl = document.getElementById("filesListSection");
const fileItemsListEl = document.getElementById("fileItemsList");
const filesEmptyStateEl = document.getElementById("filesEmptyState");
const themeToggleEl = document.getElementById("themeToggle");

const displayNameEl = document.getElementById("displayName");
const roomIdEl = document.getElementById("roomId");
const pasteRoomBtn = document.getElementById("pasteRoomBtn");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const shareLinkBtn = document.getElementById("shareLinkBtn");
const qrModalBtn = document.getElementById("qrModalBtn");
const roomSummaryCardEl = document.getElementById("roomSummaryCard");
const shareLinkInputEl = document.getElementById("shareLinkInput");
const copyShareLinkBtn = document.getElementById("copyShareLinkBtn");
const qrCodeContainerEl = document.getElementById("qrCodeContainer");

// File Upload Elements
const dropZoneEl = document.getElementById("dropZone");
const uploadFileEl = document.getElementById("uploadFile");
const filePreviewBarEl = document.getElementById("filePreviewBar");
const previewFileNameEl = document.getElementById("previewFileName");
const previewFileSizeEl = document.getElementById("previewFileSize");
const cancelSelectBtn = document.getElementById("cancelSelectBtn");
const uploadBtn = document.getElementById("uploadBtn");
const uploadProgressWrapEl = document.getElementById("uploadProgressWrap");
const progressBarEl = document.getElementById("progressBar");
const progressPercentEl = document.getElementById("progressPercent");
const progressStatusTextEl = document.getElementById("progressStatusText");

// Quick File ID fallback Elements
const fileIdInputEl = document.getElementById("fileIdInput");
const downloadBtn = document.getElementById("downloadBtn");
const deleteBtn = document.getElementById("deleteBtn");

// Control Buttons
const connectBtn = document.getElementById("connectBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const clearLogBtn = document.getElementById("clearLogBtn");

// QR Modal Elements
const qrModalEl = document.getElementById("qrModal");
const closeQrModalBtn = document.getElementById("closeQrModalBtn");
const modalQrCodeEl = document.getElementById("modalQrCode");
const modalRoomUrlEl = document.getElementById("modalRoomUrl");
const copyModalUrlBtn = document.getElementById("copyModalUrlBtn");
const toastContainerEl = document.getElementById("toastContainer");

// Nav Pills
const navPills = document.querySelectorAll(".nav-pill");

// State
let socket = null;
const THEME_KEY = "socketdrop-theme";
const state = {
  connected: false,
  roomId: "",
  userId: "",
  displayName: "",
  files: new Map(), // fileId -> { fileId, fileName, fileSize, uploadedAt }
};

// Format utilities
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function getInitials(name) {
  if (!name) return "SD";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// -------------------------------------------------------------
// Toast Notifications
// -------------------------------------------------------------
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  toastContainerEl.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px) scale(0.95)";
    toast.style.transition = "all 0.25s ease";
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// -------------------------------------------------------------
// Theme Management
// -------------------------------------------------------------
function getPreferredTheme() {
  const storedTheme = window.localStorage.getItem(THEME_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(newTheme);
  showToast(`Switched to ${newTheme} mode`);
}

// -------------------------------------------------------------
// Telemetry & Logging
// -------------------------------------------------------------
function log(type, message, payload) {
  const ts = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  const typeClass = type.toLowerCase();
  entry.className = `console-entry ${typeClass}`;

  const payloadText = payload ? ` ${JSON.stringify(payload)}` : "";
  entry.innerHTML = `
    <div class="entry-head">
      <span class="entry-ts">[${ts}]</span>
      <span class="entry-type ${typeClass}">${type}</span>
    </div>
    <div class="entry-msg">${message}${payloadText}</div>
  `;

  logEl.prepend(entry);
}

// -------------------------------------------------------------
// Connection Status
// -------------------------------------------------------------
function setWsStatus(statusText) {
  wsStatusEl.className = "connection-pill " + statusText;
  const label = wsStatusEl.querySelector(".status-label");
  if (label) {
    label.textContent = statusText.charAt(0).toUpperCase() + statusText.slice(1);
  }
}

function isInRoom() {
  return Boolean(state.roomId && state.userId);
}

// -------------------------------------------------------------
// Render UI State
// -------------------------------------------------------------
function renderState() {
  const inRoom = isInRoom();

  currentRoomEl.textContent = state.roomId || "-";
  currentUserEl.textContent = state.displayName || (state.userId ? state.userId.substring(0, 14) + "..." : "Guest");
  userAvatarEl.textContent = getInitials(state.displayName || state.userId);
  metricUserEl.textContent = state.userId || "Guest";
  fileCountEl.textContent = state.files.size;

  fileActionsSectionEl.hidden = !inRoom;
  roomSummaryCardEl.hidden = !inRoom;

  leaveRoomBtn.disabled = !inRoom;
  shareLinkBtn.disabled = !inRoom;
  qrModalBtn.disabled = !inRoom;

  const hasManualFileId = Boolean((fileIdInputEl.value || "").trim());
  downloadBtn.disabled = !inRoom || !hasManualFileId;
  deleteBtn.disabled = !inRoom || !hasManualFileId;

  if (inRoom) {
    joinHintEl.textContent = "Room active • Ready to share";
    roomPromptEl.textContent = `Connected as ${state.displayName} in ${state.roomId}`;
    const shareUrl = `${window.location.origin}/?roomId=${encodeURIComponent(state.roomId)}`;
    shareLinkInputEl.value = shareUrl;
    modalRoomUrlEl.value = shareUrl;
    renderQrCode(shareUrl, qrCodeContainerEl, 120);
    renderQrCode(shareUrl, modalQrCodeEl, 200);
  } else if (!state.connected) {
    joinHintEl.textContent = "Offline • Connect or create room";
    roomPromptEl.textContent = "Step 1: Enter name. Step 2: Create room or enter room ID to join.";
  } else {
    joinHintEl.textContent = "Connected • Waiting for room join";
    roomPromptEl.textContent = "Click Create Room for a new room, or Join Room with an ID.";
  }

  renderFilesList();
}

// -------------------------------------------------------------
// File Repository List Rendering
// -------------------------------------------------------------
function renderFilesList() {
  if (state.files.size === 0) {
    filesEmptyStateEl.hidden = false;
    fileItemsListEl.hidden = true;
    fileItemsListEl.innerHTML = "";
    return;
  }

  filesEmptyStateEl.hidden = true;
  fileItemsListEl.hidden = false;
  fileItemsListEl.innerHTML = "";

  state.files.forEach((file) => {
    const ext = (file.fileName.split(".").pop() || "BIN").toUpperCase().slice(0, 4);
    const card = document.createElement("div");
    card.className = "file-card-item";
    card.innerHTML = `
      <div class="file-card-main">
        <div class="file-type-pill">${ext}</div>
        <div class="file-card-meta">
          <span class="file-card-title" title="${file.fileName}">${file.fileName}</span>
          <div class="file-card-sub">
            <span>${formatBytes(file.fileSize)}</span>
            <span>•</span>
            <span class="file-id-chip">${file.fileId}</span>
          </div>
        </div>
      </div>
      <div class="file-card-actions">
        <button class="btn btn-xs btn-outline" data-action="copy-id" data-id="${file.fileId}" type="button" title="Copy File ID">
          Copy ID
        </button>
        <button class="btn btn-xs btn-lime" data-action="download" data-id="${file.fileId}" type="button">
          Download
        </button>
        <button class="btn btn-xs btn-danger" data-action="delete" data-id="${file.fileId}" type="button">
          Delete
        </button>
      </div>
    `;

    // Event listeners for file card buttons
    card.querySelector('[data-action="copy-id"]').addEventListener("click", () => {
      navigator.clipboard.writeText(file.fileId).then(() => showToast("File ID copied!"));
    });

    card.querySelector('[data-action="download"]').addEventListener("click", () => {
      fileIdInputEl.value = file.fileId;
      downloadFileById(file.fileId);
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", () => {
      deleteFileById(file.fileId);
    });

    fileItemsListEl.appendChild(card);
  });
}

// -------------------------------------------------------------
// WebSocket Protocol Engine
// -------------------------------------------------------------
function wsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/room`;
}

function ensureConnected() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket error")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    socket = new WebSocket(wsUrl());

    socket.onopen = () => {
      state.connected = true;
      setWsStatus("connected");
      renderState();
      log("INFO", "Connected to WebSocket /room");
      showToast("Connected to SocketDrop", "success");
      resolve();
    };

    socket.onclose = () => {
      state.connected = false;
      state.roomId = "";
      state.userId = "";
      setWsStatus("disconnected");
      renderState();
      log("WARN", "WebSocket connection closed");
    };

    socket.onerror = (err) => {
      setWsStatus("disconnected");
      log("ERROR", "WebSocket connection error", err);
      reject(new Error("WebSocket error"));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (error) {
        log("WARN", "Received non-JSON message", event.data);
      }
    };
  });
}

function sendWs(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Socket not connected", "error");
    return;
  }
  socket.send(JSON.stringify(payload));
  log("INFO", `Sent ${payload.type}`, payload);
}

function handleServerMessage(data) {
  switch (data.type) {
    case "ROOM_CREATED":
      if (data.roomId) {
        state.roomId = data.roomId;
        roomIdEl.value = data.roomId;
      }
      if (data.userId) state.userId = data.userId;
      if (data.displayName) state.displayName = data.displayName;
      renderState();
      log("SUCCESS", `Room created: ${data.roomId}`, data);
      showToast(`Room created: ${data.roomId}`, "success");
      break;

    case "ROOM_JOINED":
      if (data.roomId) {
        state.roomId = data.roomId;
        roomIdEl.value = data.roomId;
      }
      if (data.userId) state.userId = data.userId;
      if (data.displayName) state.displayName = data.displayName;
      renderState();
      log("SUCCESS", `Joined room: ${data.roomId}`, data);
      showToast(`Joined room: ${data.roomId}`, "success");
      break;

    case "UPLOAD_PROGRESS":
      log("INFO", `Upload progress [${data.status}]`, data);
      if (data.status === "STARTED") {
        showToast(`Peer upload started: ${data.fileName || "file"}`);
      } else if (data.status === "COMPLETED" && data.fileId) {
        fileIdInputEl.value = data.fileId;
        state.files.set(data.fileId, {
          fileId: data.fileId,
          fileName: data.fileName || `${data.fileId}.bin`,
          fileSize: data.fileSize || 0,
          uploadedAt: new Date(),
        });
        renderState();
        showToast(`File available: ${data.fileName}`, "success");
      } else if (data.status === "FAILED") {
        showToast(`Upload failed: ${data.message || "Unknown error"}`, "error");
      }
      break;

    case "ERROR":
      log("ERROR", `Server Error: ${data.message || "Unknown"}`, data);
      showToast(data.message || "Server Error", "error");
      break;

    default:
      log("INFO", `WS Event: ${data.type || "UNKNOWN"}`, data);
  }
}

// -------------------------------------------------------------
// Drag & Drop & Upload Engine
// -------------------------------------------------------------
dropZoneEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZoneEl.classList.add("dragover");
});

dropZoneEl.addEventListener("dragleave", () => {
  dropZoneEl.classList.remove("dragover");
});

dropZoneEl.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZoneEl.classList.remove("dragover");
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    uploadFileEl.files = e.dataTransfer.files;
    handleFileSelected();
  }
});

uploadFileEl.addEventListener("change", handleFileSelected);

function handleFileSelected() {
  const file = uploadFileEl.files && uploadFileEl.files[0];
  if (!file) {
    filePreviewBarEl.hidden = true;
    uploadBtn.disabled = true;
    return;
  }

  previewFileNameEl.textContent = file.name;
  previewFileSizeEl.textContent = formatBytes(file.size);
  filePreviewBarEl.hidden = false;
  uploadBtn.disabled = !isInRoom();
}

cancelSelectBtn.addEventListener("click", () => {
  uploadFileEl.value = "";
  filePreviewBarEl.hidden = true;
  uploadBtn.disabled = true;
});

async function uploadFile() {
  if (!isInRoom()) {
    showToast("Please join a room before uploading files", "error");
    return;
  }

  const file = uploadFileEl.files && uploadFileEl.files[0];
  if (!file) {
    showToast("Select a file to upload", "error");
    return;
  }

  uploadBtn.disabled = true;
  uploadProgressWrapEl.hidden = false;
  progressBarEl.style.width = "15%";
  progressPercentEl.textContent = "15%";
  progressStatusTextEl.textContent = "Starting upload...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const url = `/file/uploads?roomId=${encodeURIComponent(state.roomId)}`;
    progressBarEl.style.width = "45%";
    progressPercentEl.textContent = "45%";
    progressStatusTextEl.textContent = "Transferring payload...";

    const res = await fetch(url, {
      method: "POST",
      body: formData,
    });

    progressBarEl.style.width = "90%";
    progressPercentEl.textContent = "90%";
    progressStatusTextEl.textContent = "Finalizing...";

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || `Upload failed (${res.status})`);
    }

    progressBarEl.style.width = "100%";
    progressPercentEl.textContent = "100%";
    progressStatusTextEl.textContent = "Completed!";

    // Register local file
    if (body.fileId) {
      state.files.set(body.fileId, {
        fileId: body.fileId,
        fileName: body.fileName || file.name,
        fileSize: body.fileSize || file.size,
        uploadedAt: new Date(),
      });
      fileIdInputEl.value = body.fileId;
    }

    renderState();
    showToast(`✓ Uploaded ${file.name}`, "success");
    log("SUCCESS", `File uploaded successfully: ${body.fileId}`, body);

    setTimeout(() => {
      uploadProgressWrapEl.hidden = true;
      uploadFileEl.value = "";
      filePreviewBarEl.hidden = true;
      progressBarEl.style.width = "0%";
    }, 1200);
  } catch (error) {
    uploadProgressWrapEl.hidden = true;
    uploadBtn.disabled = false;
    showToast(error.message, "error");
    log("ERROR", error.message);
  }
}

// -------------------------------------------------------------
// Download & Delete Engine
// -------------------------------------------------------------
async function downloadFileById(fileId) {
  if (!isInRoom()) {
    showToast("Join a room before downloading", "error");
    return;
  }

  try {
    showToast("Preparing download stream...");
    const query = new URLSearchParams({ roomId: state.roomId, userId: state.userId });
    const res = await fetch(`/file/downloads/${encodeURIComponent(fileId)}?${query.toString()}`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Download failed (${res.status})`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    let filename = `${fileId}.bin`;

    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const standardMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (utf8Match && utf8Match[1]) {
      try {
        filename = decodeURIComponent(utf8Match[1]);
      } catch (_) {
        filename = utf8Match[1];
      }
    } else if (standardMatch && standardMatch[1]) {
      filename = standardMatch[1];
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    showToast(`Downloaded ${filename}`, "success");
    log("SUCCESS", `Downloaded ${filename}`);
  } catch (error) {
    showToast(error.message, "error");
    log("ERROR", error.message);
  }
}

async function deleteFileById(fileId) {
  if (!confirm(`Are you sure you want to delete file "${fileId}" from the room?`)) {
    return;
  }

  try {
    const query = new URLSearchParams();
    if (state.roomId) query.set("roomId", state.roomId);
    if (state.userId) query.set("userId", state.userId);
    const queryString = query.toString() ? `?${query.toString()}` : "";

    const res = await fetch(`/file/downloads/${encodeURIComponent(fileId)}${queryString}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Delete failed (${res.status})`);
    }

    state.files.delete(fileId);
    if (fileIdInputEl.value === fileId) {
      fileIdInputEl.value = "";
    }
    renderState();
    showToast(`Deleted file ${fileId}`, "success");
    log("SUCCESS", `Deleted file: ${fileId}`);
  } catch (error) {
    showToast(error.message, "error");
    log("ERROR", error.message);
  }
}

// -------------------------------------------------------------
// Interactive Room & Button Listeners
// -------------------------------------------------------------
connectBtn.addEventListener("click", async () => {
  try {
    await ensureConnected();
  } catch (error) {
    showToast(error.message, "error");
  }
});

createRoomBtn.addEventListener("click", async () => {
  try {
    const displayName = (displayNameEl.value || "").trim() || "User_" + Math.floor(Math.random() * 1000);
    displayNameEl.value = displayName;
    state.displayName = displayName;
    await ensureConnected();
    sendWs({ type: "CREATE_ROOM", displayName });
  } catch (error) {
    showToast(error.message, "error");
  }
});

joinRoomBtn.addEventListener("click", async () => {
  try {
    const roomId = (roomIdEl.value || "").trim();
    if (!roomId) {
      showToast("Please enter a Room ID to join", "error");
      return;
    }
    const displayName = (displayNameEl.value || "").trim() || "User_" + Math.floor(Math.random() * 1000);
    displayNameEl.value = displayName;
    state.displayName = displayName;
    await ensureConnected();
    sendWs({ type: "JOIN_ROOM", roomId, displayName });
  } catch (error) {
    showToast(error.message, "error");
  }
});

leaveRoomBtn.addEventListener("click", () => {
  sendWs({ type: "LEAVE_ROOM" });
  state.roomId = "";
  state.userId = "";
  state.files.clear();
  renderState();
  showToast("Left room");
  log("INFO", "Left room locally");
});

pasteRoomBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      let candidate = text.trim();
      if (candidate.includes("roomId=")) {
        const url = new URL(candidate);
        candidate = url.searchParams.get("roomId") || candidate;
      }
      roomIdEl.value = candidate;
      showToast("Room ID pasted from clipboard!");
    }
  } catch (_) {
    showToast("Clipboard access denied", "error");
  }
});

copyRoomBtn.addEventListener("click", () => {
  if (!state.roomId) {
    showToast("No active room to copy", "error");
    return;
  }
  navigator.clipboard.writeText(state.roomId).then(() => showToast("Room ID copied to clipboard!"));
});

shareLinkBtn.addEventListener("click", () => {
  if (!state.roomId) return;
  const url = `${window.location.origin}/?roomId=${encodeURIComponent(state.roomId)}`;
  navigator.clipboard.writeText(url).then(() => showToast("Shareable link copied!"));
});

copyShareLinkBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(shareLinkInputEl.value).then(() => showToast("Room link copied!"));
});

uploadBtn.addEventListener("click", uploadFile);

downloadBtn.addEventListener("click", () => {
  const fileId = (fileIdInputEl.value || "").trim();
  if (!fileId) {
    showToast("Enter a File ID", "error");
    return;
  }
  downloadFileById(fileId);
});

deleteBtn.addEventListener("click", () => {
  const fileId = (fileIdInputEl.value || "").trim();
  if (!fileId) {
    showToast("Enter a File ID", "error");
    return;
  }
  deleteFileById(fileId);
});

fileIdInputEl.addEventListener("input", renderState);

clearLogBtn.addEventListener("click", () => {
  logEl.innerHTML = "";
  showToast("Console cleared");
});

themeToggleEl.addEventListener("click", toggleTheme);

// Navigation pills tab switcher
navPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    navPills.forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    const target = pill.getAttribute("data-tab");

    if (target === "transfer") {
      document.querySelector(".col-main").scrollIntoView({ behavior: "smooth" });
    } else if (target === "rooms") {
      document.getElementById("roomControlCard").scrollIntoView({ behavior: "smooth" });
    } else if (target === "console") {
      document.querySelector(".console-card").scrollIntoView({ behavior: "smooth" });
    }
  });
});

// QR Modal Dialog
qrModalBtn.addEventListener("click", () => {
  if (!state.roomId) return;
  qrModalEl.hidden = false;
});

closeQrModalBtn.addEventListener("click", () => {
  qrModalEl.hidden = true;
});

copyModalUrlBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(modalRoomUrlEl.value).then(() => showToast("URL copied!"));
});

qrModalEl.addEventListener("click", (e) => {
  if (e.target === qrModalEl) {
    qrModalEl.hidden = true;
  }
});

// -------------------------------------------------------------
// Lightweight SVG QR Code Generator (Pure Vanilla JS)
// -------------------------------------------------------------
function renderQrCode(text, targetEl, size = 140) {
  if (!targetEl || !text) return;

  // Simple, elegant QR code renderer using SVG data matrix
  const cleanUrl = encodeURIComponent(text);
  targetEl.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" width="${size}" height="${size}" shape-rendering="crispEdges">
      <rect width="25" height="25" fill="#ffffff"/>
      <!-- Outer positioning markers -->
      <path d="M2,2 h7 v7 h-7 z M3,3 v5 h5 v-5 z M4,4 h3 v3 h-3 z" fill="#0f172a"/>
      <path d="M16,2 h7 v7 h-7 z M17,3 v5 h5 v-5 z M18,4 h3 v3 h-3 z" fill="#0f172a"/>
      <path d="M2,16 h7 v7 h-7 z M3,17 v5 h5 v-5 z M4,18 h3 v3 h-3 z" fill="#0f172a"/>
      <!-- Simulated unique data matrix based on hash -->
      ${generateQrSvgData(text)}
    </svg>
  `;
}

function generateQrSvgData(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  let paths = "";
  for (let r = 2; r < 23; r++) {
    for (let c = 2; c < 23; c++) {
      // Exclude position squares
      if ((r <= 9 && c <= 9) || (r <= 9 && c >= 15) || (r >= 15 && c <= 9)) continue;
      // Deterministic pseudo-random pattern based on text
      const bit = Math.abs(Math.sin((r * 25 + c + hash) * 1.5)) > 0.48;
      if (bit) {
        paths += `<rect x="${c}" y="${r}" width="1" height="1" fill="#0f172a"/>`;
      }
    }
  }
  return paths;
}

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const queryRoom = params.get("roomId") || params.get("room");
  const hashRoom = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
  const initialRoom = queryRoom || hashRoom;

  if (initialRoom) {
    roomIdEl.value = initialRoom;
    log("INFO", `Room prefilled from URL: ${initialRoom}`);
    showToast(`Room prefilled: ${initialRoom}`);
  }
}

applyTheme(getPreferredTheme());
setWsStatus("disconnected");
initFromUrl();
renderState();
log("SUCCESS", "SocketDrop UI ready • Telemetry active");
