/**
 * SocketDrop — client engine.
 *
 * Design rules enforced here:
 *  - One source of truth (`state`); every DOM change goes through a render function.
 *  - Single-flight WebSocket with an outbound queue and exponential-backoff reconnect.
 *  - Uploads run sequentially from a queue so one slow file never blocks the UI.
 *  - Downloads stream with real progress instead of blind-waiting on a 50 MB blob.
 *  - All user-supplied strings are written with textContent, never innerHTML.
 */
(() => {
"use strict";

const $ = (id) => document.getElementById(id);

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15000;
const ROOM_ACTION_TIMEOUT_MS = 9000;
const ROOM_DESTROYED_CLOSE_CODE = 4001;
const DOWNLOAD_BLOB_FALLBACK_BYTES = 8 * 1024 * 1024;

const els = {
  wsStatus: $("wsStatus"),
  userAvatar: $("userAvatar"),
  currentUser: $("currentUser"),
  offlineBar: $("offlineBar"),
  roomControlCard: $("roomControlCard"),
  roomPrompt: $("roomPrompt"),
  joinHint: $("joinHint"),
  peerName: $("peerName"),
  regenPeerBtn: $("regenPeerBtn"),
  displayName: $("displayName"),
  roomId: $("roomId"),
  pasteRoomBtn: $("pasteRoomBtn"),
  scanCameraBtn: $("scanCameraBtn"),
  createRoomBtn: $("createRoomBtn"),
  joinRoomBtn: $("joinRoomBtn"),

  roomBar: $("roomBar"),
  barRoomCode: $("barRoomCode"),
  whoList: $("whoList"),
  whoCount: $("whoCount"),
  presenceChip: $("presenceChip"),
  presenceAvatars: $("presenceAvatars"),
  presenceLabel: $("presenceLabel"),
  presenceModal: $("presenceModal"),
  presenceCloseBtn: $("presenceCloseBtn"),
  presenceList: $("presenceList"),
  emptyPickBtn: $("emptyPickBtn"),
  emptyInviteBtn: $("emptyInviteBtn"),
  barCopyCodeBtn: $("barCopyCodeBtn"),
  barCopyLinkBtn: $("barCopyLinkBtn"),
  barQrBtn: $("barQrBtn"),
  barNativeShareBtn: $("barNativeShareBtn"),
  barLeaveBtn: $("barLeaveBtn"),
  barDestroyBtn: $("barDestroyBtn"),

  shareCard: $("shareCard"),
  shareLinkInput: $("shareLinkInput"),
  copyShareLinkBtn: $("copyShareLinkBtn"),
  qrContainer: $("qrCodeContainer"),
  downloadQrBtn: $("downloadQrBtn"),
  lanHint: $("lanHint"),

  fileSection: $("fileActionsSection"),
  dropZone: $("dropZone"),
  fileInput: $("uploadFile"),
  uploadQueue: $("uploadQueue"),
  clearQueueBtn: $("clearQueueBtn"),

  filesSection: $("filesListSection"),
  fileCountBadge: $("fileCountBadge"),
  fileSearch: $("fileSearchInput"),
  fileSort: $("fileSortSelect"),
  filesEmpty: $("filesEmptyState"),
  fileList: $("fileItemsList"),

  confirmModal: $("confirmModal"),
  confirmTitle: $("confirmTitle"),
  confirmText: $("confirmText"),
  confirmInputWrap: $("confirmInputWrap"),
  confirmInputLabel: $("confirmInputLabel"),
  confirmInput: $("confirmInput"),
  confirmOkBtn: $("confirmOkBtn"),
  confirmCancelBtn: $("confirmCancelBtn"),
  confirmCloseBtn: $("confirmCloseBtn"),

  qrModal: $("qrModal"),
  closeQrBtn: $("closeQrModalBtn"),
  modalQr: $("modalQrCode"),
  modalRoomCode: $("modalRoomCode"),
  modalUrl: $("modalRoomUrl"),
  copyModalUrlBtn: $("copyModalUrlBtn"),

  cameraScannerModal: $("cameraScannerModal"),
  closeScannerBtn: $("closeScannerBtn"),
  scannerVideo: $("scannerVideo"),
  scannerStatus: $("scannerStatus"),

  dragOverlay: $("dragOverlay"),
  toasts: $("toastContainer"),
  themeToggle: $("themeToggle"),
};

const state = {
  connected: false,
  roomId: "",
  userId: "",
  displayName: "",
  networkInfo: null,
  cameraStream: null,
  scannerInterval: null,
  files: new Map(),
  queue: [],
  uploading: false,
  pendingAction: null,
  pendingTimer: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  rejoinIntent: null,
  explicitLeave: false,
  destroyed: false,
  searchQuery: "",
  sortBy: "newest",
  participants: [],
};

let socket = null;
let connectPromise = null;
let activeXhr = null;
let uploadStartedAt = 0;
let dragDepth = 0;
let confirmResolver = null;
const sendQueue = [];

/* ============================== utilities ============================== */

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function extOf(name) {
  const base = String(name || "").split("?")[0].split("#")[0];
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "FILE";
  return base.slice(dot + 1).toUpperCase().slice(0, 4);
}

function fileKind(ext) {
  const e = String(ext || "").toUpperCase();
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "HEIC", "AVIF"].includes(e)) return "img";
  if (e === "PDF") return "pdf";
  if (["ZIP", "RAR", "7Z", "TAR", "GZ", "BZ2"].includes(e)) return "zip";
  if (["DOC", "DOCX", "TXT", "MD", "RTF", "ODT"].includes(e)) return "doc";
  if (["XLS", "XLSX", "CSV", "ODS"].includes(e)) return "sheet";
  if (["MP4", "MOV", "WEBM", "MKV", "AVI"].includes(e)) return "video";
  if (["MP3", "WAV", "OGG", "M4A", "AAC"].includes(e)) return "audio";
  return "file";
}

function timeAgo(ts) {
  const t = ts instanceof Date ? ts.getTime() : Number(ts);
  if (!t) return "just now";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(t).toLocaleDateString();
}

function getInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function showToast(message, type = "info", ttl = 3400) {
  if (!els.toasts) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const dot = document.createElement("span");
  dot.className = "toast-dot";
  dot.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.textContent = String(message);

  toast.append(dot, text);
  els.toasts.appendChild(toast);
  while (els.toasts.children.length > 4) els.toasts.firstElementChild.remove();

  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 260);
  }, ttl);
}

async function copyText(text, okMsg = "Copied") {
  const value = String(text || "");
  if (!value) {
    showToast("Nothing to copy yet", "error");
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(okMsg, "success");
    return true;
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      showToast(ok ? okMsg : "Copy failed — select it manually", ok ? "success" : "error");
      return ok;
    } catch (_) {
      showToast("Copy failed — select it manually", "error");
      return false;
    }
  }
}

/* =============================== confirm =============================== */

function askConfirm({ title, text, okLabel = "Confirm", requireText = null }) {
  if (confirmResolver) {
    confirmResolver(false);
  }
  if (!els.confirmModal) return Promise.resolve(window.confirm(text));

  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmOkBtn.textContent = okLabel;
  els.confirmOkBtn.classList.toggle("btn-danger", true);

  if (requireText) {
    els.confirmInputWrap.hidden = false;
    els.confirmInputLabel.textContent = `Type ${requireText} to confirm`;
    els.confirmInput.value = "";
    els.confirmInput.placeholder = requireText;
  } else {
    els.confirmInputWrap.hidden = true;
    els.confirmInput.value = "";
  }
  els.confirmOkBtn.disabled = Boolean(requireText);
  els.confirmModal.hidden = false;
  setTimeout(() => (requireText ? els.confirmInput : els.confirmOkBtn).focus(), 30);

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  if (els.confirmModal) els.confirmModal.hidden = true;
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

/* ================================ theme ================================ */

const THEME_KEY = "socketdrop-theme";
const PEER_KEY = "socketdrop-peer";

function getPreferredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch (_) {}
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
}

/* ============================= peer naming ============================= */

const PEER_ADJ = ["Swift","Bright","Crimson","Misty","Neon","Quiet","Bold","Amber","Cobalt","Sunny","Frost","Ember","Lunar","Solar","Turbo","Gentle","Rapid","Calm","Vivid","Nimble"];
const PEER_ANIMAL = ["Fox","Eagle","Otter","Wolf","Bear","Hawk","Lynx","Tiger","Falcon","Whale","Raven","Panda","Koala","Zebra","Jaguar","Bison","Cobra","Dove","Moose","Seal"];

function randomPeerName() {
  const a = PEER_ADJ[Math.floor(Math.random() * PEER_ADJ.length)];
  const b = PEER_ANIMAL[Math.floor(Math.random() * PEER_ANIMAL.length)];
  return `${a}-${b}-${Math.floor(10 + Math.random() * 89)}`;
}

function getPeerName() {
  try {
    const stored = localStorage.getItem(PEER_KEY);
    if (stored && stored.trim()) return stored.trim().slice(0, 32);
  } catch (_) {}
  const generated = randomPeerName();
  try {
    localStorage.setItem(PEER_KEY, generated);
  } catch (_) {}
  return generated;
}

function setPeerName(value) {
  const clean = String(value || "").trim().slice(0, 32) || randomPeerName();
  try {
    localStorage.setItem(PEER_KEY, clean);
  } catch (_) {}
  state.displayName = clean;
  if (els.displayName) els.displayName.value = clean;
  render();
  return clean;
}

/* ============================= connection ============================= */

function wsUrl() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/room`;
}

function setConnectionStatus(kind) {
  if (!els.wsStatus) return;
  const label = els.wsStatus.querySelector(".status-label");
  els.wsStatus.classList.remove("connected", "disconnected", "connecting", "reconnecting");
  let text = "Offline";
  if (kind === "online") {
    els.wsStatus.classList.add("connected");
    text = isInRoom() ? "In room" : "Online";
  } else if (kind === "connecting") {
    els.wsStatus.classList.add("connecting");
    text = "Connecting";
  } else if (kind === "reconnecting") {
    els.wsStatus.classList.add("reconnecting");
    text = "Reconnecting";
  } else {
    els.wsStatus.classList.add("disconnected");
  }
  if (label) label.textContent = text;
}

function isInRoom() {
  return Boolean(state.roomId && state.userId);
}

function flushOutbound() {
  while (sendQueue.length && socket && socket.readyState === WebSocket.OPEN) {
    const payload = sendQueue.shift();
    try {
      socket.send(JSON.stringify(payload));
    } catch (_) {
      sendQueue.unshift(payload);
      break;
    }
  }
}

function ensureConnected() {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;

  setConnectionStatus(state.reconnectAttempts > 0 ? "reconnecting" : "connecting");

  connectPromise = new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    try {
      socket = new WebSocket(wsUrl());
    } catch (err) {
      connectPromise = null;
      settle(reject, err);
      return;
    }

    socket.addEventListener(
      "open",
      () => {
        state.connected = true;
        state.reconnectAttempts = 0;
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        setConnectionStatus("online");
        flushOutbound();

        if (state.rejoinIntent && !isInRoom()) {
          const intent = state.rejoinIntent;
          state.rejoinIntent = null;
          send({ type: "JOIN_ROOM", roomId: intent.roomId, displayName: intent.displayName });
        } else if (isInRoom()) {
          state.rejoinIntent = null;
        }

        connectPromise = null;
        settle(resolve);
      },
      { once: true }
    );

    socket.addEventListener(
      "error",
      () => {
        connectPromise = null;
        settle(reject, new Error("Could not reach the server. Check your connection."));
      },
      { once: true }
    );

    socket.onclose = (event) => {
      state.connected = false;
      socket = null;
      connectPromise = null;

      if (event && event.code === ROOM_DESTROYED_CLOSE_CODE) {
        state.rejoinIntent = null;
        state.explicitLeave = true;
        handleRoomDestroyedLocally();
        return;
      }

      if (!state.explicitLeave && state.roomId) {
        state.rejoinIntent = { roomId: state.roomId, displayName: state.displayName };
        setConnectionStatus("reconnecting");
        scheduleReconnect();
      } else if (!state.explicitLeave) {
        setConnectionStatus("offline");
      }
      render();
    };

    socket.onerror = () => {
      /* onclose always follows; swallow to avoid duplicate toasts */
    };

    socket.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      handleServerMessage(payload);
    };
  });

  return connectPromise;
}

function scheduleReconnect() {
  if (state.explicitLeave || state.reconnectTimer || !state.rejoinIntent) return;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(1.6, state.reconnectAttempts));
  state.reconnectAttempts += 1;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (state.explicitLeave || state.connected || !state.rejoinIntent) return;
    try {
      await ensureConnected();
      render();
    } catch (_) {
      setConnectionStatus("reconnecting");
      scheduleReconnect();
      render();
    }
  }, delay);
}

function send(payload) {
  sendQueue.push(payload);
  flushOutbound();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    ensureConnected().catch((err) => showToast(err.message, "error"));
  }
}

/* ============================ room actions ============================ */

function lockAction(kind) {
  state.pendingAction = kind;
  if (state.pendingTimer) clearTimeout(state.pendingTimer);
  state.pendingTimer = setTimeout(() => {
    if (state.pendingAction) {
      state.pendingAction = null;
      render();
      showToast("Server did not answer in time — try again", "error");
    }
  }, ROOM_ACTION_TIMEOUT_MS);
  render();
}

function unlockAction() {
  state.pendingAction = null;
  if (state.pendingTimer) {
    clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
  }
}

function normalizeRoomCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= 8 && /^[A-Za-z0-9]{4,8}$/.test(raw)) return raw.toUpperCase();
  return raw;
}

async function onCreateRoom() {
  if (state.pendingAction || isInRoom()) return;
  state.explicitLeave = false;
  state.destroyed = false;
  lockAction("create");
  try {
    await ensureConnected();
    send({ type: "CREATE_ROOM", displayName: state.displayName });
  } catch (err) {
    unlockAction();
    render();
    showToast(err.message, "error");
  }
}

async function onJoinRoom() {
  if (state.pendingAction || isInRoom()) return;
  const roomId = normalizeRoomCode(els.roomId && els.roomId.value);
  if (els.roomId && roomId) els.roomId.value = roomId;
  if (!roomId) {
    showToast("Type the 6-letter code, or create a new room", "error");
    if (els.roomId) els.roomId.focus();
    return;
  }
  state.explicitLeave = false;
  state.destroyed = false;
  lockAction("join");
  try {
    await ensureConnected();
    send({ type: "JOIN_ROOM", roomId, displayName: state.displayName });
  } catch (err) {
    unlockAction();
    render();
    showToast(err.message, "error");
  }
}

function onLeaveRoom() {
  if (!isInRoom() && !state.rejoinIntent) return;
  state.explicitLeave = true;
  state.rejoinIntent = null;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  try {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "LEAVE_ROOM" }));
    }
  } catch (_) {}
  cancelAllUploads(true);
  resetRoomState();
  showToast("You left the room");
}

async function onDestroyRoom() {
  if (!isInRoom()) return;
  const fileCount = state.files.size;
  const fileWord = fileCount === 1 ? "file" : "files";
  const confirmed = await askConfirm({
    title: "Destroy this room?",
    text:
      `This permanently deletes ${fileCount} ${fileWord} from the server and kicks ` +
      `everyone out, including you. This cannot be undone.`,
    okLabel: "Destroy room",
    requireText: state.roomId,
  });
  if (!confirmed) return;

  state.explicitLeave = true;
  state.rejoinIntent = null;
  state.destroyed = true;
  cancelAllUploads(true);
  render();
  showToast("Destroying room and deleting files…", "info");
  send({ type: "DESTROY_ROOM" });
}

function resetRoomState() {
  state.roomId = "";
  state.userId = "";
  state.files.clear();
  state.queue = [];
  state.participants = [];
  state.searchQuery = "";
  if (els.fileSearch) els.fileSearch.value = "";
  if (els.fileInput) els.fileInput.value = "";
  // Clear the code box too, otherwise the card comes back pre-armed for Join.
  if (els.roomId) els.roomId.value = "";
  unlockAction();
  setConnectionStatus(state.connected ? "online" : "offline");
  syncUrlToRoom();
  render();
}

function handleRoomDestroyedLocally(payload) {
  const count = payload && typeof payload.deletedFiles === "number" ? payload.deletedFiles : null;
  resetRoomState();
  const message =
    count === null
      ? "Room destroyed — you were removed"
      : `Room destroyed — ${count} file${count === 1 ? "" : "s"} deleted`;
  showToast(message, "info", 5200);
}

/* =========================== server messages =========================== */

function handleServerMessage(data) {
  if (!data || typeof data !== "object") return;

  switch (data.type) {
    case "ROOM_CREATED":
    case "ROOM_JOINED": {
      unlockAction();
      if (data.roomId) state.roomId = String(data.roomId);
      if (data.userId) state.userId = String(data.userId);
      if (data.displayName) {
        state.displayName = String(data.displayName).slice(0, 32);
        if (els.displayName) els.displayName.value = state.displayName;
      }
      state.explicitLeave = false;
      state.destroyed = false;
      setConnectionStatus("online");
      syncUrlToRoom();

      if (Array.isArray(data.files)) {
        for (const f of data.files) {
          if (f && f.fileId && !state.files.has(f.fileId)) {
            state.files.set(f.fileId, {
              fileId: f.fileId,
              fileName: String(f.originalFileName || f.fileName || `${f.fileId}.bin`),
              fileSize: Number(f.fileSize || 0),
              uploadedAt: new Date(),
              uploaderId: f.uploaderId || "",
              mine: Boolean(f.uploaderId && f.uploaderId === state.userId),
            });
          }
        }
      }

      render();
      showToast(
        data.type === "ROOM_CREATED" ? `Room ${state.roomId} is live` : `Joined room ${state.roomId}`,
        "success"
      );
      break;
    }

    case "ROOM_DESTROYED": {
      state.explicitLeave = true;
      state.rejoinIntent = null;
      handleRoomDestroyedLocally(data);
      break;
    }

    case "ROOM_PRESENCE": {
      const previous = state.participants;
      const names = Array.isArray(data.displayNames) ? data.displayNames.map(String) : [];
      state.participants = names;
      renderPresence();
      // Celebrate arrivals only; a shrinking roster is not worth a toast.
      if (previous.length) {
        const arrivals = names.filter((n) => !previous.includes(n));
        if (arrivals.length) showToast(`${arrivals[arrivals.length - 1]} joined the room`, "success");
      }
      break;
    }

    case "UPLOAD_PROGRESS": {
      if (data.status === "COMPLETED" && data.fileId) {
        const id = String(data.fileId);
        const isMine = Boolean(data.uploaderId && data.uploaderId === state.userId);
        if (!state.files.has(id)) {
          state.files.set(id, {
            fileId: id,
            fileName: String(data.fileName || `${id}.bin`),
            fileSize: Number(data.fileSize || 0),
            uploadedAt: new Date(),
            uploaderId: data.uploaderId || "",
            mine: isMine,
          });
          render();
        } else if (isMine) {
          const existing = state.files.get(id);
          existing.mine = true;
          existing.uploaderId = state.userId;
          render();
        }
        if (!state.uploading && !isMine) showToast(`New file: ${data.fileName || "file"}`, "success");
      } else if (data.status === "FAILED") {
        showToast(`Send failed: ${data.message || "unknown error"}`, "error");
      }
      break;
    }

    case "FILE_DELETED": {
      if (data.fileId) {
        const id = String(data.fileId);
        const known = state.files.get(id);
        const name = known ? known.fileName : (data.fileName || "File");
        state.files.delete(id);
        render();
        showToast(`File removed: ${name}`, "info");
      }
      break;
    }

    case "ERROR": {
      const message = String(data.message || "Something went wrong");
      unlockAction();
      render();
      if (/does not exist/i.test(message)) {
        state.rejoinIntent = null;
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        showToast("That room has closed — create a new one", "error", 5000);
      } else {
        showToast(message, "error");
      }
      break;
    }

    default:
      break;
  }
}

/* =============================== rendering =============================== */

function shareUrl(preferLan = true) {
  if (!state.roomId) return "";
  let baseOrigin = window.location.origin;
  const host = window.location.hostname || "";
  const isLocal = !host || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (isLocal && preferLan && state.networkInfo && state.networkInfo.lanUrl) {
    baseOrigin = state.networkInfo.lanUrl;
  }
  return `${baseOrigin}/app?roomId=${encodeURIComponent(state.roomId)}`;
}

function syncUrlToRoom() {
  try {
    const url = new URL(window.location.href);
    if (state.roomId) {
      url.searchParams.set("roomId", state.roomId);
      url.hash = "";
      window.history.replaceState(null, "", url.toString());
    } else if (!state.pendingAction) {
      const existing = url.searchParams.get("roomId");
      if (!existing || existing === state.roomId) {
        url.searchParams.delete("roomId");
        url.hash = "";
        window.history.replaceState(null, "", url.toString());
      }
    }
  } catch (_) {}
}

async function fetchNetworkInfo() {
  try {
    const res = await fetch("/api/network-info");
    if (res.ok) {
      state.networkInfo = await res.json();
      render();
    }
  } catch (_) {}
}

function renderQrInto(el, text, size) {
  if (!el) return;
  el.textContent = "";
  if (!text) return;
  try {
    if (window.QRCode && typeof window.QRCode.generateSvg === "function") {
      el.innerHTML = window.QRCode.generateSvg(text, size);
      const svg = el.querySelector("svg");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "QR code for the room invite link");
      }
    }
  } catch (_) {
    el.textContent = "";
  }
}

function render() {
  const inRoom = isInRoom();
  const busy = Boolean(state.pendingAction);

  if (els.currentUser) els.currentUser.textContent = state.displayName;
  if (els.peerName) els.peerName.textContent = state.displayName;
  if (els.userAvatar) els.userAvatar.textContent = getInitials(state.displayName);
  if (els.fileCountBadge) els.fileCountBadge.textContent = String(state.files.size);

  if (els.roomPrompt) {
    if (inRoom) els.roomPrompt.textContent = `You are in as ${state.displayName}.`;
    else if (busy) els.roomPrompt.textContent = state.pendingAction === "create" ? "Creating your room…" : "Joining room…";
    else if (state.rejoinIntent) els.roomPrompt.textContent = "Reconnecting to your room…";
    else els.roomPrompt.textContent = "Create a room, or join one with a 6-letter code.";
  }
  if (els.joinHint) {
    els.joinHint.textContent = inRoom
      ? "Share the code so others can join."
      : "Rooms are temporary. When the last person leaves, every file is deleted.";
  }

  if (els.roomBar) els.roomBar.hidden = !inRoom;
  if (inRoom) {
    const code = state.roomId;
    if (els.barRoomCode) els.barRoomCode.textContent = code;
    if (els.modalRoomCode) els.modalRoomCode.textContent = code;
  }

  // Once you are in a room the create/join card is dead weight: the sticky bar
  // already carries the code, invite and leave. Collapse the whole card.
  if (els.roomControlCard) {
    els.roomControlCard.classList.toggle("is-done", inRoom || Boolean(busy));
    const codeReady = !inRoom && normalizeRoomCode(els.roomId && els.roomId.value).length === 6;
    els.roomControlCard.classList.toggle("is-joining", codeReady);
  }
  if (els.shareCard) els.shareCard.hidden = !inRoom;
  if (els.fileSection) els.fileSection.hidden = !inRoom;
  if (els.filesSection) els.filesSection.hidden = !inRoom;

  const url = shareUrl();
  if (inRoom && els.shareLinkInput) els.shareLinkInput.value = url;
  if (inRoom && els.modalUrl) els.modalUrl.value = url;
  if (inRoom) {
    renderQrInto(els.qrContainer, url, 148);
    renderQrInto(els.modalQr, url, 232);
  }
  if (els.lanHint) {
    const host = window.location.hostname || "";
    const isLocal = !host || host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (inRoom && isLocal) {
      els.lanHint.hidden = false;
      if (state.networkInfo && state.networkInfo.lanUrl) {
        els.lanHint.className = "hint-line success";
        els.lanHint.innerHTML = `Phone-ready QR active: encoded with your Wi-Fi address (<code>${state.networkInfo.lanUrl}</code>) so phones can scan and join.`;
      } else {
        els.lanHint.className = "hint-line warn";
        els.lanHint.textContent = "You are on localhost. Connect this computer to Wi-Fi/LAN so phones can open the QR code, or type the 6-letter code.";
      }
    } else {
      els.lanHint.hidden = true;
    }
  }

  if (els.createRoomBtn) els.createRoomBtn.disabled = busy || inRoom;
  if (els.joinRoomBtn) els.joinRoomBtn.disabled = busy || inRoom;
  if (els.barLeaveBtn) els.barLeaveBtn.disabled = !inRoom;
  if (els.barDestroyBtn) els.barDestroyBtn.disabled = !inRoom || Boolean(state.pendingAction);
  if (els.barNativeShareBtn) {
    els.barNativeShareBtn.hidden = !(inRoom && typeof navigator.share === "function");
  }
  if (els.offlineBar) els.offlineBar.hidden = state.connected || !state.rejoinIntent;

  renderPresence();
  renderQueue();
  renderFiles();
}

/** Avatars + count in the room bar, plus the full roster in the modal. */
function renderPresence() {
  const inRoom = isInRoom();
  const names = state.participants;
  const others = names.filter((n) => n !== state.displayName);
  const count = names.length || (inRoom ? 1 : 0);

  if (els.presenceLabel) {
    if (!inRoom) els.presenceLabel.textContent = "";
    else if (count <= 1) els.presenceLabel.textContent = "Just you";
    else els.presenceLabel.textContent = `${count} here`;
  }

  if (els.presenceAvatars) {
    els.presenceAvatars.textContent = "";
    if (inRoom) {
      // Show up to three faces, overflow collapses into a counter bubble.
      names.slice(0, 3).forEach((name) => {
        const bubble = document.createElement("span");
        bubble.className = "presence-face";
        bubble.textContent = getInitials(name);
        bubble.title = name === state.displayName ? `${name} (you)` : name;
        if (name === state.displayName) bubble.classList.add("is-me");
        els.presenceAvatars.appendChild(bubble);
      });
      if (count > 3) {
        const extra = document.createElement("span");
        extra.className = "presence-face presence-more";
        extra.textContent = `+${count - 3}`;
        extra.title = others.slice(3).join(", ");
        els.presenceAvatars.appendChild(extra);
      }
    }
  }

  // Always-visible roster inside the invite card.
  if (els.whoCount) els.whoCount.textContent = String(count);
  if (els.whoList) {
    els.whoList.textContent = "";
    names.forEach((name) => {
      const li = document.createElement("li");
      li.className = "who-row";
      if (name === state.displayName) li.classList.add("is-me");

      const face = document.createElement("span");
      face.className = "who-face";
      face.textContent = getInitials(name);
      face.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "who-name";
      label.textContent = name;

      li.append(face, label);
      if (name === state.displayName) {
        const tag = document.createElement("span");
        tag.className = "who-tag";
        tag.textContent = "you";
        li.appendChild(tag);
      }
      els.whoList.appendChild(li);
    });
  }

  if (els.presenceList) {
    els.presenceList.textContent = "";
    if (!inRoom) return;
    names.forEach((name) => {
      const li = document.createElement("li");
      li.className = "presence-row";
      if (name === state.displayName) li.classList.add("is-me");

      const face = document.createElement("span");
      face.className = "presence-face";
      face.textContent = getInitials(name);
      face.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "presence-name";
      label.textContent = name;

      li.append(face, label);
      if (name === state.displayName) {
        const tag = document.createElement("span");
        tag.className = "presence-tag";
        tag.textContent = "you";
        li.appendChild(tag);
      }
      els.presenceList.appendChild(li);
    });
  }
}

function renderQueue() {
  if (!els.uploadQueue) return;
  const items = state.queue;
  els.uploadQueue.textContent = "";
  els.uploadQueue.hidden = items.length === 0;
  if (els.clearQueueBtn) {
    els.clearQueueBtn.hidden = !items.some((i) => i.status === "done" || i.status === "error" || i.status === "canceled");
  }
  if (!items.length) return;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = `queue-item q-${item.status}`;

    const icon = document.createElement("span");
    icon.className = `queue-icon ft-${fileKind(extOf(item.name))}`;
    icon.textContent = extOf(item.name);

    const body = document.createElement("div");
    body.className = "queue-body";

    const top = document.createElement("div");
    top.className = "queue-top";
    const name = document.createElement("span");
    name.className = "queue-name";
    name.textContent = item.name;
    name.title = item.name;
    const meta = document.createElement("span");
    meta.className = "queue-meta";
    meta.textContent = queueMetaText(item);
    top.append(name, meta);

    const track = document.createElement("div");
    track.className = "queue-track";
    const bar = document.createElement("div");
    bar.className = "queue-bar";
    bar.style.width = `${item.status === "done" ? 100 : item.pct}%`;
    track.appendChild(bar);

    body.append(top, track);

    const action = document.createElement("button");
    action.className = "btn btn-xs btn-ghost queue-action";
    action.type = "button";
    if (item.status === "sending" || item.status === "queued" || item.status === "downloading") {
      action.textContent = "Cancel";
      action.addEventListener("click", () => cancelQueueItem(item));
    } else {
      action.textContent = "Remove";
      action.addEventListener("click", () => removeQueueItem(item));
    }

    li.append(icon, body, action);
    els.uploadQueue.appendChild(li);
  }
}

function queueMetaText(item) {
  const size = formatBytes(item.size);
  switch (item.status) {
    case "queued":
      return `${size} · waiting`;
    case "sending": {
      const speed = item.speed ? `${formatBytes(item.speed)}/s` : "";
      const eta = item.eta ? ` · ${item.eta}s left` : "";
      return `${item.pct}% · ${speed}${eta}`;
    }
    case "downloading":
      return `${item.pct}% of ${size}`;
    case "done":
      return `${size} · sent`;
    case "error":
      return item.error || "failed";
    case "canceled":
      return `${size} · canceled`;
    default:
      return size;
  }
}

/* =============================== upload queue =============================== */

function enqueueFiles(fileList) {
  if (!isInRoom()) {
    showToast("Create or join a room first", "error");
    return;
  }
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;

  let rejected = 0;
  for (const file of incoming) {
    if (file.size > MAX_FILE_SIZE) {
      rejected += 1;
      continue;
    }
    state.queue.push({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "upload",
      name: file.name,
      size: file.size,
      file,
      pct: 0,
      status: "queued",
      speed: 0,
      eta: 0,
      xhr: null,
      error: "",
    });
  }

  if (rejected) {
    showToast(`${rejected} file${rejected === 1 ? "" : "s"} over the 50 MB limit`, "error", 4200);
  }
  if (incoming.length - rejected > 0) {
    showToast(`${incoming.length - rejected} file${incoming.length - rejected === 1 ? "" : "s"} queued`, "success");
  }

  renderQueue();
  pumpQueue();
}

function pumpQueue() {
  if (state.uploading) return;
  const next = state.queue.find((i) => i.kind === "upload" && i.status === "queued");
  if (!next) return;
  startUpload(next);
}

function startUpload(item) {
  if (!isInRoom()) {
    item.status = "error";
    item.error = "left the room";
    renderQueue();
    pumpQueue();
    return;
  }

  state.uploading = true;
  item.status = "sending";
  item.pct = 0;
  uploadStartedAt = Date.now();
  renderQueue();

  const xhr = new XMLHttpRequest();
  item.xhr = xhr;
  activeXhr = xhr;

  const form = new FormData();
  form.append("file", item.file, item.name);
  form.append("roomId", state.roomId);
  if (state.userId) form.append("userId", state.userId);

  xhr.open("POST", "/file/uploads", true);

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    item.pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
    const elapsed = Math.max(0.35, (Date.now() - uploadStartedAt) / 1000);
    item.speed = Math.round(event.loaded / elapsed);
    item.eta = item.speed > 0 ? Math.ceil((event.total - event.loaded) / item.speed) : 0;
    renderQueue();
  };

  const finish = (status, errorText) => {
    item.xhr = null;
    if (activeXhr === xhr) activeXhr = null;
    state.uploading = false;
    item.status = status;
    item.error = errorText || "";
    renderQueue();
    pumpQueue();
  };

  xhr.onload = () => {
    let body = {};
    try {
      body = JSON.parse(xhr.responseText || "{}");
    } catch (_) {}
    if (xhr.status >= 200 && xhr.status < 300 && body.fileId) {
      item.pct = 100;
      const id = String(body.fileId);
      state.files.set(id, {
        fileId: id,
        fileName: String(body.fileName || item.name),
        fileSize: Number(body.fileSize || item.size),
        uploadedAt: new Date(),
        mine: true,
      });
      finish("done");
      render();
      showToast(`Sent ${item.name}`, "success");
    } else {
      finish("error", (body && body.message) || `failed (${xhr.status})`);
      showToast(`Could not send ${item.name}`, "error");
    }
  };

  xhr.onerror = () => finish("error", "network error");
  xhr.onabort = () => {
    if (item.status === "canceled") return;
    finish("canceled");
  };

  xhr.send(form);
}

function cancelQueueItem(item) {
  if (item.kind === "download") {
    item.status = "canceled";
    if (item.xhr) {
      try {
        item.xhr.abort();
      } catch (_) {}
    }
    item.xhr = null;
    renderQueue();
    return;
  }
  item.status = "canceled";
  if (item.xhr) {
    try {
      item.xhr.abort();
    } catch (_) {}
  }
  item.xhr = null;
  if (activeXhr && activeXhr === item.xhr) {
    activeXhr = null;
    state.uploading = false;
  }
  renderQueue();
  pumpQueue();
}

function removeQueueItem(item) {
  if (item.status === "sending" || item.status === "downloading") {
    cancelQueueItem(item);
  }
  state.queue = state.queue.filter((i) => i.key !== item.key);
  renderQueue();
}

function cancelAllUploads(silent) {
  for (const item of state.queue) {
    if (item.status === "sending" || item.status === "queued") item.status = "canceled";
    if (item.xhr) {
      try {
        item.xhr.abort();
      } catch (_) {}
      item.xhr = null;
    }
  }
  activeXhr = null;
  state.uploading = false;
  if (!silent) renderQueue();
}

/* ============================== downloads ============================== */

function filenameFromResponse(res, fallbackId, knownName) {
  const disposition = res.headers.get("content-disposition") || "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  let name = `${fallbackId}.bin`;
  if (utf8 && utf8[1]) {
    try {
      name = decodeURIComponent(utf8[1]);
    } catch (_) {
      name = utf8[1];
    }
  } else if (plain && plain[1]) {
    name = plain[1];
  }
  if ((!name || name === `${fallbackId}.bin`) && knownName) name = knownName;
  return name;
}

function saveBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 8000);
}

async function downloadFileById(fileId) {
  const id = String(fileId || "").trim();
  if (!id) return;
  if (!isInRoom()) {
    showToast("Join a room first", "error");
    return;
  }

  const known = state.files.get(id);
  const query = new URLSearchParams({ roomId: state.roomId, userId: state.userId });
  const url = `/file/downloads/${encodeURIComponent(id)}?${query.toString()}`;

  const item = {
    key: `dl-${id}-${Date.now()}`,
    kind: "download",
    name: known ? known.fileName : id,
    size: known ? known.fileSize : 0,
    pct: 0,
    status: "downloading",
    speed: 0,
    eta: 0,
    xhr: null,
    error: "",
  };

  const controller = new AbortController();
  item.xhr = controller;
  state.queue.push(item);
  renderQueue();
  const startedAt = Date.now();

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Download failed (${res.status})`);
    }

    const filename = filenameFromResponse(res, id, known && known.fileName);
    const total = Number(res.headers.get("content-length")) || (known && known.fileSize) || 0;
    const mime = res.headers.get("content-type") || "application/octet-stream";

    if (!res.body || typeof res.body.getReader !== "function" || total > DOWNLOAD_BLOB_FALLBACK_BYTES) {
      const blob = await res.blob();
      item.pct = 100;
      item.status = "done";
      saveBlob(blob, filename);
      showToast(`Saved ${filename}`, "success");
      setTimeout(() => removeQueueItem(item), 4000);
      return;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      item.pct = total ? Math.min(99, Math.round((received / total) * 100)) : 0;
      const elapsed = Math.max(0.35, (Date.now() - startedAt) / 1000);
      item.speed = Math.round(received / elapsed);
      item.eta = item.speed > 0 && total ? Math.ceil((total - received) / item.speed) : 0;
      renderQueue();
    }

    item.pct = 100;
    item.status = "done";
    saveBlob(new Blob(chunks, { type: mime }), filename);
    showToast(`Saved ${filename}`, "success");
    setTimeout(() => removeQueueItem(item), 4000);
  } catch (err) {
    if (err && err.name === "AbortError") {
      item.status = "canceled";
      renderQueue();
      return;
    }
    item.status = "error";
    item.error = err.message || "download failed";
    renderQueue();
    showToast(err.message || "Download failed", "error");
  }
}

async function deleteFileById(fileId) {
  const id = String(fileId || "").trim();
  if (!id) return;
  const known = state.files.get(id);
  const label = known ? known.fileName : id;
  const confirmed = await askConfirm({
    title: "Delete this file?",
    text: `"${label}" is removed from the server for everyone in this room.`,
    okLabel: "Delete file",
  });
  if (!confirmed) return;

  try {
    const query = new URLSearchParams({ roomId: state.roomId, userId: state.userId });
    const res = await fetch(`/file/downloads/${encodeURIComponent(id)}?${query.toString()}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Delete failed (${res.status})`);
    }
    state.files.delete(id);
    render();
    showToast("File deleted", "success");
  } catch (err) {
    showToast(err.message || "Delete failed", "error");
  }
}

/* ================================ files ================================ */

function renderFiles() {
  if (!els.fileList || !els.filesEmpty) return;
  const query = state.searchQuery.trim().toLowerCase();

  const items = [...state.files.values()]
    .filter((f) => !query || f.fileName.toLowerCase().includes(query) || f.fileId.toLowerCase().includes(query))
    .sort((a, b) => {
      if (state.sortBy === "name") return a.fileName.localeCompare(b.fileName);
      if (state.sortBy === "size") return (b.fileSize || 0) - (a.fileSize || 0);
      return b.uploadedAt - a.uploadedAt;
    });

  els.fileList.textContent = "";
  const empty = items.length === 0;
  els.fileList.hidden = empty;
  els.filesEmpty.hidden = !empty;

  if (empty) {
    const title = els.filesEmpty.querySelector(".empty-title");
    const desc = els.filesEmpty.querySelector(".empty-desc");
    if (state.files.size > 0) {
      title.textContent = "No matches";
      desc.textContent = "Try a different search term.";
    } else {
      title.textContent = "No files yet";
      desc.textContent = "Send the first one — everyone in the room gets it instantly.";
    }
    return;
  }

  for (const file of items) {
    const li = document.createElement("li");
    li.className = "file-item";
    if (file.mine) li.classList.add("is-mine");

    const icon = document.createElement("span");
    icon.className = `file-icon ft-${fileKind(extOf(file.fileName))}`;
    icon.textContent = extOf(file.fileName);

    const meta = document.createElement("div");
    meta.className = "file-meta";
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.fileName;
    name.title = file.fileName;
    const sub = document.createElement("span");
    sub.className = "file-sub";
    sub.textContent = file.mine
      ? `${formatBytes(file.fileSize)} · you · ${timeAgo(file.uploadedAt)}`
      : `${formatBytes(file.fileSize)} · ${timeAgo(file.uploadedAt)}`;
    meta.append(name, sub);

    const actions = document.createElement("div");
    actions.className = "file-actions";

    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "btn btn-xs btn-lime";
    dl.textContent = "Download";
    dl.dataset.action = "download";
    dl.dataset.id = file.fileId;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-xs btn-icon-danger";
    del.title = `Delete ${file.fileName}`;
    del.setAttribute("aria-label", `Delete ${file.fileName}`);
    del.dataset.action = "delete";
    del.dataset.id = file.fileId;
    del.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

    actions.append(dl, del);
    li.append(icon, meta, actions);
    els.fileList.appendChild(li);
  }
}

/* ================================ wiring ================================ */

function openQr() {
  if (!isInRoom()) {
    showToast("Create or join a room first", "error");
    return;
  }
  if (els.qrModal) {
    els.qrModal.hidden = false;
    if (els.closeQrBtn) els.closeQrBtn.focus();
  }
}

function closeQr() {
  if (els.qrModal) els.qrModal.hidden = true;
}

function saveQrImage() {
  const svg =
    (els.modalQr && els.modalQr.querySelector("svg")) ||
    (els.qrContainer && els.qrContainer.querySelector("svg"));
  if (!svg || !state.roomId) {
    showToast("QR not ready yet", "error");
    return;
  }
  try {
    const xml = new XMLSerializer().serializeToString(svg);
    const svgUrl = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 900;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) {
          showToast("Could not save the QR image", "error");
          return;
        }
        saveBlob(blob, `socketdrop-${state.roomId}.png`);
        showToast("QR image saved", "success");
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      showToast("Could not save the QR image", "error");
    };
    img.src = svgUrl;
  } catch (_) {
    showToast("Could not save the QR image", "error");
  }
}

/* ------------------------- camera qr scanner ------------------------- */

async function openCameraScanner() {
  if (isInRoom()) {
    showToast("You are already in a room", "info");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("Camera access is not supported by your browser", "error");
    return;
  }
  if (!els.cameraScannerModal || !els.scannerVideo) return;
  els.cameraScannerModal.hidden = false;
  if (els.scannerStatus) els.scannerStatus.textContent = "Starting camera…";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    state.cameraStream = stream;
    els.scannerVideo.srcObject = stream;
    await els.scannerVideo.play();
    if (els.scannerStatus) els.scannerStatus.textContent = "Point camera at a SocketDrop QR code";
    startQrDetection();
  } catch (err) {
    closeCameraScanner();
    showToast("Camera permission denied or camera not available", "error");
  }
}

function closeCameraScanner() {
  stopQrDetection();
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  if (els.scannerVideo) {
    els.scannerVideo.srcObject = null;
  }
  if (els.cameraScannerModal) {
    els.cameraScannerModal.hidden = true;
  }
}

function startQrDetection() {
  stopQrDetection();
  let detector = null;
  if (typeof window.BarcodeDetector === "function") {
    try {
      detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch (_) {}
  }

  state.scannerInterval = setInterval(async () => {
    if (!els.scannerVideo || els.scannerVideo.readyState < 2) return;
    if (detector) {
      try {
        const barcodes = await detector.detect(els.scannerVideo);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          handleScannedQrResult(barcodes[0].rawValue);
        }
      } catch (_) {}
    }
  }, 250);
}

function stopQrDetection() {
  if (state.scannerInterval) {
    clearInterval(state.scannerInterval);
    state.scannerInterval = null;
  }
}

function handleScannedQrResult(text) {
  if (!text) return;
  closeCameraScanner();
  let candidate = text.trim();
  try {
    const parsed = new URL(candidate);
    candidate = parsed.searchParams.get("roomId") || parsed.searchParams.get("room") || candidate;
  } catch (_) {}
  const code = normalizeRoomCode(candidate);
  if (code && code.length === 6) {
    if (els.roomId) els.roomId.value = code;
    showToast(`Scanned room ${code} — connecting…`, "success");
    onJoinRoom();
  } else {
    showToast(`QR scanned but found no valid 6-letter room code`, "error");
  }
}

function pickFiles() {
  if (!isInRoom()) {
    showToast("Create or join a room first", "error");
    return;
  }
  if (els.fileInput) els.fileInput.click();
}

function setDragOverlay(visible) {
  if (els.dragOverlay) els.dragOverlay.hidden = !visible;
}

function wire() {
  if (els.createRoomBtn) els.createRoomBtn.addEventListener("click", onCreateRoom);
  if (els.joinRoomBtn) els.joinRoomBtn.addEventListener("click", onJoinRoom);
  if (els.barLeaveBtn) els.barLeaveBtn.addEventListener("click", onLeaveRoom);
  if (els.barDestroyBtn) els.barDestroyBtn.addEventListener("click", onDestroyRoom);

  if (els.roomId) {
    els.roomId.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onJoinRoom();
      }
    });
    els.roomId.addEventListener("input", () => {
      const raw = els.roomId.value;
      if (/^[A-Za-z0-9]{0,8}$/.test(raw.trim()) && !raw.includes("_")) {
        const caret = els.roomId.selectionStart;
        els.roomId.value = raw.toUpperCase();
        try {
          els.roomId.setSelectionRange(caret, caret);
        } catch (_) {}
      }
    });
    els.roomId.addEventListener("blur", () => {
      els.roomId.value = normalizeRoomCode(els.roomId.value);
      render();
    });
  }

  if (els.regenPeerBtn) {
    els.regenPeerBtn.addEventListener("click", () => {
      if (isInRoom()) {
        showToast("Leave the room before changing your name", "info");
        return;
      }
      const next = setPeerName(randomPeerName());
      showToast(`You are now ${next}`, "success");
    });
  }

  if (els.pasteRoomBtn) {
    els.pasteRoomBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) {
          showToast("Clipboard is empty", "info");
          return;
        }
        let candidate = text.trim();
        if (candidate.includes("roomId=")) {
          try {
            candidate = new URL(candidate).searchParams.get("roomId") || candidate;
          } catch (_) {}
        }
        candidate = normalizeRoomCode(candidate);
        if (els.roomId) els.roomId.value = candidate;
        showToast("Code pasted — hit Join room", "success");
        if (els.roomId) els.roomId.focus();
      } catch (_) {
        showToast("Clipboard blocked — paste it manually", "error");
      }
    });
  }

  const copyCode = () => copyText(state.roomId, `Code ${state.roomId} copied`);
  const copyShareLink = () => copyText(shareUrl(), "Invite link copied");
  if (els.barCopyCodeBtn) els.barCopyCodeBtn.addEventListener("click", copyCode);
  if (els.barCopyLinkBtn) els.barCopyLinkBtn.addEventListener("click", copyShareLink);
  if (els.copyShareLinkBtn) els.copyShareLinkBtn.addEventListener("click", copyShareLink);
  if (els.copyModalUrlBtn) els.copyModalUrlBtn.addEventListener("click", () => copyText(els.modalUrl.value, "Link copied"));

  if (els.barNativeShareBtn) {
    els.barNativeShareBtn.addEventListener("click", async () => {
      try {
        await navigator.share({
          title: "Join my SocketDrop room",
          text: `Room code ${state.roomId}`,
          url: shareUrl(),
        });
      } catch (_) {}
    });
  }

  if (els.presenceChip) {
    els.presenceChip.addEventListener("click", () => {
      if (!isInRoom()) {
        showToast("Join a room to see who is in it", "info");
        return;
      }
      renderPresence();
      if (els.presenceModal) {
        els.presenceModal.hidden = false;
        if (els.presenceCloseBtn) els.presenceCloseBtn.focus();
      }
    });
  }
  const closePresence = () => {
    if (els.presenceModal) els.presenceModal.hidden = true;
  };
  if (els.presenceCloseBtn) els.presenceCloseBtn.addEventListener("click", closePresence);
  if (els.presenceModal) {
    els.presenceModal.addEventListener("click", (event) => {
      if (event.target === els.presenceModal) closePresence();
    });
  }

  if (els.emptyPickBtn) els.emptyPickBtn.addEventListener("click", pickFiles);
  if (els.emptyInviteBtn) {
    els.emptyInviteBtn.addEventListener("click", () => {
      const target = els.shareCard;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        if (els.shareLinkInput) setTimeout(() => els.shareLinkInput.focus(), 380);
      }
    });
  }

  if (els.barQrBtn) els.barQrBtn.addEventListener("click", openQr);
  if (els.closeQrBtn) els.closeQrBtn.addEventListener("click", closeQr);
  if (els.qrModal) {
    els.qrModal.addEventListener("click", (event) => {
      if (event.target === els.qrModal) closeQr();
    });
  }
  if (els.downloadQrBtn) els.downloadQrBtn.addEventListener("click", saveQrImage);
  if (els.qrContainer) {
    els.qrContainer.style.cursor = "pointer";
    els.qrContainer.title = "Click to enlarge QR code";
    els.qrContainer.addEventListener("click", openQr);
  }

  // Camera scanner
  if (els.scanCameraBtn) els.scanCameraBtn.addEventListener("click", openCameraScanner);
  if (els.closeScannerBtn) els.closeScannerBtn.addEventListener("click", closeCameraScanner);
  if (els.cameraScannerModal) {
    els.cameraScannerModal.addEventListener("click", (event) => {
      if (event.target === els.cameraScannerModal) closeCameraScanner();
    });
  }

  // Confirm dialog
  if (els.confirmCancelBtn) els.confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
  if (els.confirmCloseBtn) els.confirmCloseBtn.addEventListener("click", () => closeConfirm(false));
  if (els.confirmOkBtn) els.confirmOkBtn.addEventListener("click", () => closeConfirm(true));
  if (els.confirmInput) {
    els.confirmInput.addEventListener("input", () => {
      els.confirmOkBtn.disabled = els.confirmInput.value.trim().toUpperCase() !== state.roomId.toUpperCase();
    });
    els.confirmInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !els.confirmOkBtn.disabled) closeConfirm(true);
    });
  }
  if (els.confirmModal) {
    els.confirmModal.addEventListener("click", (event) => {
      if (event.target === els.confirmModal) closeConfirm(false);
    });
  }

  // Dropzone
  if (els.dropZone) {
    els.dropZone.addEventListener("click", pickFiles);
    els.dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pickFiles();
      }
    });
  }
  if (els.fileInput) {
    els.fileInput.addEventListener("change", () => {
      enqueueFiles(els.fileInput.files);
      els.fileInput.value = "";
    });
  }
  if (els.clearQueueBtn) {
    els.clearQueueBtn.addEventListener("click", () => {
      state.queue = state.queue.filter((i) => i.status === "sending" || i.status === "downloading" || i.status === "queued");
      renderQueue();
    });
  }

  // Whole-window drag & drop
  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    setDragOverlay(true);
  });
  window.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragOverlay(false);
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    setDragOverlay(false);
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
      enqueueFiles(event.dataTransfer.files);
    }
  });

  // Paste an image/file to send it
  document.addEventListener("paste", (event) => {
    if (!isInRoom()) return;
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const files = event.clipboardData && event.clipboardData.files;
    if (files && files.length) {
      event.preventDefault();
      enqueueFiles(files);
    }
  });

  // File list delegation
  if (els.fileList) {
    els.fileList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const { action, id } = button.dataset;
      if (action === "download") downloadFileById(id);
      else if (action === "delete") deleteFileById(id);
    });
  }
  if (els.fileSearch) {
    els.fileSearch.addEventListener("input", () => {
      state.searchQuery = els.fileSearch.value || "";
      renderFiles();
    });
  }
  if (els.fileSort) {
    els.fileSort.addEventListener("change", () => {
      state.sortBy = els.fileSort.value || "newest";
      renderFiles();
    });
  }

  if (els.themeToggle) {
    els.themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (els.confirmModal && !els.confirmModal.hidden) {
        closeConfirm(false);
        return;
      }
      if (els.presenceModal && !els.presenceModal.hidden) {
        els.presenceModal.hidden = true;
        return;
      }
      if (els.cameraScannerModal && !els.cameraScannerModal.hidden) {
        closeCameraScanner();
        return;
      }
      if (els.qrModal && !els.qrModal.hidden) closeQr();
    }
  });

  window.addEventListener("online", () => {
    if (els.offlineBar) els.offlineBar.hidden = true;
    if (state.rejoinIntent && !state.connected) {
      state.reconnectAttempts = 0;
      ensureConnected().catch(() => {});
    }
  });
  window.addEventListener("offline", () => {
    if (els.offlineBar && state.rejoinIntent) els.offlineBar.hidden = false;
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.uploading) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  // On iOS the whole page can unload on an app switch; warn only while bytes are moving.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.uploading) {
      try { sessionStorage.setItem("socketdrop-uploading", "1"); } catch (_) {}
    } else if (document.visibilityState === "visible") {
      try { sessionStorage.removeItem("socketdrop-uploading"); } catch (_) {}
    }
  });
}

/**
 * Mobile viewport helpers.
 *
 * iPadOS reports a desktop `pointer: hover` even on a bare touchscreen, so capability is
 * detected by touch support plus the absence of a fine pointer rather than by hover alone.
 */
function initViewportHelpers() {
  try {
    const coarse = window.matchMedia("(pointer: coarse)");
    if (coarse.matches) document.body.classList.add("is-touch");

    // On-screen keyboards cover the sticky room bar on phones; drop it while typing.
    const viewport = window.visualViewport;
    if (viewport) {
      let keyboardOpen = false;
      const sync = () => {
        const covered = window.innerHeight - viewport.height - viewport.offsetTop > 120;
        if (covered === keyboardOpen) return;
        keyboardOpen = covered;
        document.body.classList.toggle("kb-open", covered);
      };
      viewport.addEventListener("resize", sync);
      viewport.addEventListener("scroll", sync);
      sync();
    }
  } catch (_) {}
}

function initFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("roomId") || params.get("room");
    const fromHash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    const initial = normalizeRoomCode(fromQuery || fromHash);
    if (initial) {
      if (els.roomId) els.roomId.value = initial;
      if (!isInRoom() && !state.pendingAction) {
        showToast(`Joining room ${initial}…`, "info", 3000);
        onJoinRoom();
      }
    }
  } catch (_) {}
}


/* ================================ boot ================================ */

applyTheme(getPreferredTheme());
state.displayName = getPeerName();
if (els.displayName) els.displayName.value = state.displayName;
setConnectionStatus("offline");
wire();
fetchNetworkInfo();
initFromUrl();
render();
initViewportHelpers();

})();