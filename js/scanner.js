import { VENUE_CHECKIN_CODE } from "./firebase-config.js";
import {
  ensureAuth,
  recordAttendance,
  verifyMemberLogin,
  getMemberAttendanceHistory,
  computeMemberSummary,
  loadPenaltyRules,
  isFirebaseConfigured,
} from "./firebase-app.js";
import {
  formatTime,
  formatDateTime,
  penaltyLabel,
  formatDisplayDate,
  getAttendanceDateTime,
  attendancePenaltyBadgeHtml,
} from "./penalty.js";

const SESSION_KEY = "hrcc_scanner_member";
const CAMERA_PREF_KEY = "hrcc_scanner_camera_id";
const CAMERA_FACING_KEY = "hrcc_scanner_camera_facing";

const viewLogin = document.getElementById("view-login");
const viewScan = document.getElementById("view-scan");
const viewHistory = document.getElementById("view-history");

const loginForm = document.getElementById("login-form");
const loginName = document.getElementById("login-name");
const loginId = document.getElementById("login-id");
const loginError = document.getElementById("login-error");
const scanMemberLabel = document.getElementById("scan-member-label");
const btnLogout = document.getElementById("btn-logout");
const btnToggle = document.getElementById("btn-toggle-scan");
const btnRequestCamera = document.getElementById("btn-request-camera");
const btnManualCheckin = document.getElementById("btn-manual-checkin");
const manualQrInput = document.getElementById("manual-qr-input");
const cameraPermissionPanel = document.getElementById("camera-permission-panel");
const cameraPermissionError = document.getElementById("camera-permission-error");
const cameraPermissionStatus = document.getElementById("camera-permission-status");
const insecureBanner = document.getElementById("insecure-banner");
const qrReaderEl = document.getElementById("qr-reader");
const cameraPickerRow = document.getElementById("camera-picker-row");
const btnCamBack = document.getElementById("btn-cam-back");
const btnCamFront = document.getElementById("btn-cam-front");
const btnScanAgain = document.getElementById("btn-scan-again");
const btnSignOut = document.getElementById("btn-sign-out");

const overlay = document.getElementById("feedback-overlay");
const feedbackCard = document.getElementById("feedback-card");
const feedbackIcon = document.getElementById("feedback-icon");
const feedbackTitle = document.getElementById("feedback-title");
const feedbackMessage = document.getElementById("feedback-message");
const feedbackPenalty = document.getElementById("feedback-penalty");
const btnDismiss = document.getElementById("feedback-dismiss");

let scanner = null;
let scanning = false;
let availableCameras = [];
let cameraFacingMap = { back: null, front: null };
let cameraSwitching = false;
let processing = false;
let lastScanned = "";
let currentMember = null;
let feedbackOnDismiss = null;

const SCAN_COOLDOWN_MS = 2500;

function saveSession(member) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(member));
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  currentMember = null;
}

function showView(name) {
  viewLogin.classList.toggle("hidden", name !== "login");
  viewScan.classList.toggle("hidden", name !== "scan");
  viewHistory.classList.toggle("hidden", name !== "history");
}

function showFeedback(type, title, message, penalty = null, onDismiss = null) {
  feedbackCard.className = `feedback-card ${type}`;
  const icons = { success: "✅", warning: "⚠️", error: "❌" };
  feedbackIcon.textContent = icons[type] || "ℹ️";
  feedbackTitle.textContent = title;
  feedbackMessage.textContent = message;
  if (penalty !== null && penalty !== undefined) {
    feedbackPenalty.textContent =
      penalty === 0 ? "No penalty — on time" : `Penalty: ₱${penalty} (${penaltyLabel(penalty)})`;
    feedbackPenalty.classList.remove("hidden");
  } else {
    feedbackPenalty.classList.add("hidden");
  }
  feedbackOnDismiss = onDismiss;
  overlay.classList.add("show");
}

function hideFeedback() {
  overlay.classList.remove("show");
  lastScanned = "";
  const cb = feedbackOnDismiss;
  feedbackOnDismiss = null;
  if (cb) cb();
}

function getConnectionInfo() {
  const { protocol, hostname } = window.location;
  if (protocol === "file:") {
    return {
      needsLocalhost: true,
      hint: "You opened a file directly. Double-click start-test.bat in the project folder.",
      testUrl: "http://localhost:8080/scanner.html",
    };
  }
  if (
    !window.isSecureContext &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  ) {
    return {
      needsLocalhost: true,
      hint: `Address http://${hostname} cannot use the camera. On this PC, use localhost instead.`,
      testUrl: "http://localhost:8080/scanner.html",
    };
  }
  return { needsLocalhost: false, hint: "", testUrl: "" };
}

function updateInsecureBanner() {
  if (!insecureBanner) return;
  const info = getConnectionInfo();
  if (!info.needsLocalhost) {
    insecureBanner.classList.add("hidden");
    insecureBanner.innerHTML = "";
    return;
  }
  insecureBanner.classList.remove("hidden");
  insecureBanner.innerHTML = `
    <strong>Local test:</strong> ${escapeHtml(info.hint)}
    <a href="${escapeHtml(info.testUrl)}">${escapeHtml(info.testUrl)}</a>
    — or use <strong>Testing without camera</strong> below.
  `;
}

function isValidCheckInScan(text, member) {
  const t = text.trim();
  const upper = t.toUpperCase();
  if (upper === VENUE_CHECKIN_CODE.toUpperCase()) return true;
  if (upper === member.memberID.toUpperCase()) return true;
  try {
    const u = new URL(t);
    if (u.pathname.includes("scanner.html")) return true;
  } catch (_) {}
  return false;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

async function showMemberHistory(member, todayResult = null) {
  await ensureAuth();
  const records = await getMemberAttendanceHistory(member.memberID);
  const summary = computeMemberSummary(member, records);

  document.getElementById("history-name").textContent = member.name;
  document.getElementById("history-id").textContent = member.memberID;
  document.getElementById("history-subtitle").textContent = `${member.role} · ${member.section}`;

  document.getElementById("stat-balance").textContent = `₱${summary.remainingBalance}`;
  document.getElementById("stat-penalties").textContent = `₱${summary.totalPenalties}`;
  const statPaidEl = document.getElementById("stat-paid");
  if (statPaidEl) statPaidEl.textContent = `₱${summary.totalPaid}`;
  const statCheckins = document.getElementById("stat-checkins");
  if (statCheckins) statCheckins.textContent = String(summary.totalCheckIns ?? records.length);
  document.getElementById("stat-present").textContent = String(summary.totalPresent);
  document.getElementById("stat-ontime").textContent = String(summary.onTime);
  document.getElementById("stat-late").textContent = String(summary.lateTotal);

  const todayMsg = document.getElementById("today-checkin-msg");
  if (todayResult?.status === "success" && todayResult.record) {
    const t = getAttendanceDateTime(todayResult.record);
    const repeatNote = todayResult.isRepeatToday
      ? " (new log added — previous check-ins today kept in history)"
      : "";
    todayMsg.textContent = `✓ Checked in at ${formatDateTime(t)} — ${penaltyLabel(todayResult.record.penalty)}${repeatNote}`;
    todayMsg.classList.remove("hidden");
  } else {
    todayMsg.classList.add("hidden");
  }

  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  list.innerHTML = "";

  if (!records.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    for (const r of records) {
      const t = getAttendanceDateTime(r);
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `
        <div class="history-item-main">
          <strong>${escapeHtml(formatDisplayDate(r.date))}</strong>
          <span>${escapeHtml(formatDateTime(t))} · ${escapeHtml(r.serviceType || "Sunday Service")}</span>
        </div>
        <div class="history-item-end">
          ${attendancePenaltyBadgeHtml(r)}
          <span class="history-penalty-amt">${(r.penalty || 0) > 0 && !r.penaltyPaid ? `₱${r.penalty} due` : (r.penalty || 0) > 0 ? "Paid" : "—"}</span>
        </div>
      `;
      list.appendChild(li);
    }
  }

  await stopScanner();
  showView("history");
}

async function handleScan(decodedText) {
  if (!currentMember || processing) return;
  const text = decodedText.trim();
  if (!text || text === lastScanned) return;

  processing = true;
  lastScanned = text;

  try {
    if (!isValidCheckInScan(text, currentMember)) {
      showFeedback(
        "error",
        "Wrong QR",
        "Scan the church check-in QR at the door, or your own member QR card."
      );
      return;
    }

    await ensureAuth();
    const result = await recordAttendance(currentMember);
    lastScanned = "";

    await showMemberHistory(currentMember, result);
  } catch (err) {
    console.error(err);
    showFeedback("error", "Error", err.message || "Could not save attendance.");
  } finally {
    processing = false;
    setTimeout(() => {
      if (!overlay.classList.contains("show")) lastScanned = "";
    }, SCAN_COOLDOWN_MS);
  }
}

function cameraErrorMessage(err) {
  const name = err?.name || "";
  const msg = String(err?.message || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera was blocked. Allow camera in browser settings, then tap Ask permission to open camera again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Camera is in use by another app. Close other apps using the camera and try again.";
  }
  if (/secure|https|insecure/i.test(msg) || !window.isSecureContext) {
    const info = getConnectionInfo();
    if (info.needsLocalhost) {
      return `${info.hint} Open ${info.testUrl} or use manual check-in below.`;
    }
    return "Camera requires HTTPS. Open https://rhen00.github.io/HRCC-Worship-Team-Attendance/scanner.html (not http://192.168…).";
  }
  const info = getConnectionInfo();
  if (info.needsLocalhost) {
    return `${info.hint} Open ${info.testUrl} or use manual check-in below.`;
  }
  return msg || "Could not access the camera. Tap Ask permission again.";
}

async function getCameraPermissionState() {
  if (!navigator.permissions?.query) return null;
  try {
    const result = await navigator.permissions.query({ name: "camera" });
    return result.state;
  } catch {
    return null;
  }
}

function setPermissionStatus(message, isError = false) {
  if (!cameraPermissionStatus) return;
  if (!message) {
    cameraPermissionStatus.classList.add("hidden");
    cameraPermissionStatus.textContent = "";
    return;
  }
  cameraPermissionStatus.textContent = message;
  cameraPermissionStatus.classList.toggle("is-error", isError);
  cameraPermissionStatus.classList.remove("hidden");
}

/** Triggers the browser's native camera permission dialog (optional warm-up). */
async function requestCameraPermission() {
  const info = getConnectionInfo();
  if (info.needsLocalhost) {
    throw new Error(`${info.hint} Open ${info.testUrl}`);
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Your browser does not support camera access. Try Chrome or Safari.");
  }

  setPermissionStatus("Waiting for permission… Choose Allow in the popup.");
  revealScannerViewport();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    await new Promise((r) => setTimeout(r, 150));
    setPermissionStatus("Camera allowed. Starting scanner…");
  } catch (err) {
    setPermissionStatus("", false);
    throw err;
  }
}

function showCameraPermissionUi() {
  if (cameraPermissionPanel) cameraPermissionPanel.classList.remove("hidden");
  if (qrReaderEl) qrReaderEl.classList.add("qr-reader-hidden");
  if (btnToggle) btnToggle.classList.add("hidden");
  if (availableCameras.length > 0) showCameraPickerRow(true);
  if (cameraPermissionError) cameraPermissionError.classList.add("hidden");
  if (btnRequestCamera) {
    btnRequestCamera.disabled = false;
    btnRequestCamera.textContent = "Ask permission to open camera";
  }
  setPermissionStatus("");
}

function showCameraActiveUi() {
  if (cameraPermissionPanel) cameraPermissionPanel.classList.add("hidden");
  if (qrReaderEl) qrReaderEl.classList.remove("qr-reader-hidden");
  if (btnToggle) btnToggle.classList.remove("hidden");
}

/** Camera must not be started inside display:none — browsers block it. */
function revealScannerViewport() {
  if (qrReaderEl) qrReaderEl.classList.remove("qr-reader-hidden");
}

function isBackCamera(camera) {
  return /back|rear|environment/i.test(camera.label || "");
}

function isFrontCamera(camera) {
  return /front|user|face|selfie/i.test(camera.label || "");
}

function buildCameraFacingMap(cameras) {
  const map = { back: null, front: null };
  if (!cameras?.length) return map;

  for (const c of cameras) {
    if (!map.back && isBackCamera(c)) map.back = c.id;
    if (!map.front && isFrontCamera(c)) map.front = c.id;
  }

  if (cameras.length >= 2) {
    if (!map.front) map.front = cameras[0].id;
    if (!map.back) map.back = cameras[cameras.length - 1].id;
  } else if (cameras.length === 1) {
    map.back = cameras[0].id;
    map.front = cameras[0].id;
  }

  return map;
}

function showCameraPickerRow(show) {
  if (!cameraPickerRow) return;
  cameraPickerRow.classList.toggle("hidden", !show);
}

function getSelectedFacing() {
  const saved = sessionStorage.getItem(CAMERA_FACING_KEY);
  if (saved === "front" || saved === "back") return saved;

  const legacyId = sessionStorage.getItem(CAMERA_PREF_KEY);
  if (legacyId && legacyId === cameraFacingMap.front) return "front";
  if (legacyId && legacyId === cameraFacingMap.back) return "back";

  return "back";
}

function setActiveFacingButton(facing) {
  const isBack = facing !== "front";
  btnCamBack?.classList.toggle("is-active", isBack);
  btnCamFront?.classList.toggle("is-active", !isBack);
  btnCamBack?.setAttribute("aria-pressed", String(isBack));
  btnCamFront?.setAttribute("aria-pressed", String(!isBack));
}

function updateFacingButtons() {
  if (btnCamBack) btnCamBack.disabled = !cameraFacingMap.back;
  if (btnCamFront) btnCamFront.disabled = !cameraFacingMap.front;
  setActiveFacingButton(getSelectedFacing());
}

function resolveCameraIdForFacing(facing) {
  return facing === "front" ? cameraFacingMap.front : cameraFacingMap.back;
}

async function loadCameraList() {
  const Lib = window.Html5Qrcode;
  if (!Lib?.getCameras) {
    cameraFacingMap = { back: null, front: null };
    showCameraPickerRow(true);
    updateFacingButtons();
    return;
  }

  try {
    availableCameras = (await Lib.getCameras()) || [];
    cameraFacingMap = buildCameraFacingMap(availableCameras);

    const legacyId = sessionStorage.getItem(CAMERA_PREF_KEY);
    if (legacyId && !sessionStorage.getItem(CAMERA_FACING_KEY)) {
      if (legacyId === cameraFacingMap.front) sessionStorage.setItem(CAMERA_FACING_KEY, "front");
      else if (legacyId === cameraFacingMap.back) sessionStorage.setItem(CAMERA_FACING_KEY, "back");
    }

    showCameraPickerRow(true);
    updateFacingButtons();
  } catch (err) {
    console.warn("Could not list cameras:", err);
    cameraFacingMap = { back: null, front: null };
    showCameraPickerRow(true);
    updateFacingButtons();
  }
}

async function startScannerWithFacing(html5, config, facing) {
  const onScan = (t) => handleScan(t);
  const onError = () => {};
  const preferId = resolveCameraIdForFacing(facing);
  let lastErr;

  if (preferId) {
    try {
      await html5.start(preferId, config, onScan, onError);
      sessionStorage.setItem(CAMERA_FACING_KEY, facing);
      sessionStorage.setItem(CAMERA_PREF_KEY, preferId);
      setActiveFacingButton(facing);
      return;
    } catch (e) {
      lastErr = e;
      console.warn("Camera id failed:", preferId, e);
    }
  }

  const mode = facing === "front" ? { facingMode: "user" } : { facingMode: "environment" };
  try {
    await html5.start(mode, config, onScan, onError);
    sessionStorage.setItem(CAMERA_FACING_KEY, facing);
    setActiveFacingButton(facing);
    return;
  } catch (e) {
    lastErr = e;
  }

  const other = facing === "front" ? "back" : "front";
  const otherId = resolveCameraIdForFacing(other);
  if (otherId && otherId !== preferId) {
    try {
      await html5.start(otherId, config, onScan, onError);
      sessionStorage.setItem(CAMERA_FACING_KEY, other);
      sessionStorage.setItem(CAMERA_PREF_KEY, otherId);
      setActiveFacingButton(other);
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Could not start the camera.");
}

const SCANNER_CONFIG = { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 };

async function restartScannerWithSelectedCamera() {
  if (!currentMember || cameraSwitching) return;
  const facing = getSelectedFacing();

  cameraSwitching = true;
  sessionStorage.setItem(CAMERA_FACING_KEY, facing);

  try {
    if (scanner && scanning) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch (_) {}
      scanning = false;
    }

    if (!window.Html5Qrcode) return;

    revealScannerViewport();
    if (cameraPermissionPanel) cameraPermissionPanel.classList.add("hidden");

    scanner = new Html5Qrcode("qr-reader");
    await startScannerWithFacing(scanner, SCANNER_CONFIG, facing);
    scanning = true;
    showCameraActiveUi();
  } catch (err) {
    console.error(err);
    showCameraPermissionUi();
    if (cameraPermissionError) {
      cameraPermissionError.textContent = cameraErrorMessage(err);
      cameraPermissionError.classList.remove("hidden");
    }
  } finally {
    cameraSwitching = false;
  }
}

function selectCameraFacing(facing) {
  if (facing !== "front" && facing !== "back") return;
  if (facing === "front" && !cameraFacingMap.front && !cameraFacingMap.back) return;
  if (facing === "back" && !cameraFacingMap.back && !cameraFacingMap.front) return;

  sessionStorage.setItem(CAMERA_FACING_KEY, facing);
  setActiveFacingButton(facing);
  if (scanning) void restartScannerWithSelectedCamera();
}

async function startScanner() {
  if (scanning || !currentMember) return;

  if (!window.Html5Qrcode) {
    showFeedback("error", "Scanner unavailable", "QR scanner library failed to load. Check your internet connection.");
    return;
  }

  const info = getConnectionInfo();
  if (info.needsLocalhost) {
    showCameraPermissionUi();
    const msg = `${info.hint} Open ${info.testUrl}`;
    if (cameraPermissionError) {
      cameraPermissionError.textContent = msg;
      cameraPermissionError.classList.remove("hidden");
    }
    return;
  }

  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (_) {}
  }

  scanner = new Html5Qrcode("qr-reader");

  try {
    if (btnRequestCamera) {
      btnRequestCamera.disabled = true;
      btnRequestCamera.textContent = "Starting camera…";
    }

    revealScannerViewport();
    if (cameraPermissionPanel) cameraPermissionPanel.classList.add("hidden");

    await loadCameraList();
    await startScannerWithFacing(scanner, SCANNER_CONFIG, getSelectedFacing());

    scanning = true;
    showCameraActiveUi();
    if (btnToggle) btnToggle.disabled = false;
  } catch (err) {
    console.error(err);
    showCameraPermissionUi();
    const msg = cameraErrorMessage(err);
    if (cameraPermissionError) {
      cameraPermissionError.textContent = msg;
      cameraPermissionError.classList.remove("hidden");
    } else {
      showFeedback("error", "Camera error", msg);
    }
  } finally {
    if (btnRequestCamera && !scanning) {
      btnRequestCamera.disabled = false;
      btnRequestCamera.textContent = "Ask permission to open camera";
    }
  }
}

async function allowCameraAndScan() {
  if (cameraPermissionError) cameraPermissionError.classList.add("hidden");

  const state = await getCameraPermissionState();
  if (state === "granted") {
    setPermissionStatus("Camera already allowed. Opening scanner…");
    await loadCameraList();
    await startScanner();
    return;
  }

  if (btnRequestCamera) {
    btnRequestCamera.disabled = true;
    btnRequestCamera.textContent = "Requesting permission…";
  }

  try {
    await requestCameraPermission();
    await loadCameraList();
    await startScanner();
    setPermissionStatus("");
  } catch (err) {
    console.error(err);
    const msg = cameraErrorMessage(err);
    if (cameraPermissionError) {
      cameraPermissionError.textContent = msg;
      cameraPermissionError.classList.remove("hidden");
    } else {
      showFeedback("error", "Camera permission", msg);
    }
    if (btnRequestCamera) {
      btnRequestCamera.disabled = false;
      btnRequestCamera.textContent = "Ask permission to open camera";
    }
  }
}

async function stopScanner() {
  if (scanner && scanning) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (_) {}
  }
  scanning = false;
  showCameraPermissionUi();
}

function openScanView(member) {
  currentMember = member;
  saveSession(member);
  scanMemberLabel.textContent = `${member.name} · ${member.memberID}`;
  if (manualQrInput && !manualQrInput.value) {
    manualQrInput.placeholder = VENUE_CHECKIN_CODE;
  }
  updateInsecureBanner();
  if (scanning) {
    void stopScanner();
  } else {
    showCameraPermissionUi();
  }
  showView("scan");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");

  if (!isFirebaseConfigured()) {
    loginError.textContent = "Firebase is not configured.";
    loginError.classList.remove("hidden");
    return;
  }

  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    await ensureAuth();
    await loadPenaltyRules();
    const result = await verifyMemberLogin(loginName.value, loginId.value);
    if (!result.ok) {
      loginError.textContent = result.error;
      loginError.classList.remove("hidden");
      return;
    }
    openScanView(result.member);
    btn.textContent = "Opening camera…";
    await allowCameraAndScan();
  } catch (err) {
    loginError.textContent = err.message || "Could not verify. Try again.";
    loginError.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Continue to scan";
  }
});

function signOut() {
  void stopScanner();
  clearSession();
  loginForm.reset();
  loginError.classList.add("hidden");
  showView("login");
  updateInsecureBanner();
}

btnLogout?.addEventListener("click", signOut);
btnSignOut?.addEventListener("click", signOut);

btnScanAgain?.addEventListener("click", async () => {
  if (!currentMember) return;
  openScanView(currentMember);
  await allowCameraAndScan();
});

btnRequestCamera?.addEventListener("click", () => allowCameraAndScan());

btnCamBack?.addEventListener("click", () => selectCameraFacing("back"));
btnCamFront?.addEventListener("click", () => selectCameraFacing("front"));

btnManualCheckin?.addEventListener("click", () => {
  const code = manualQrInput?.value?.trim() || VENUE_CHECKIN_CODE;
  if (code) handleScan(code);
});

manualQrInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    btnManualCheckin?.click();
  }
});

btnToggle?.addEventListener("click", () => {
  if (scanning) void stopScanner();
});

btnDismiss.addEventListener("click", hideFeedback);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) hideFeedback();
});

async function init() {
  updateInsecureBanner();
  if (isFirebaseConfigured()) {
    try {
      await loadPenaltyRules();
    } catch (_) {}
  }
  const saved = loadSession();
  if (saved?.memberID) {
    try {
      await ensureAuth();
      const result = await verifyMemberLogin(saved.name, saved.memberID);
      if (result.ok) {
        openScanView(result.member);
        return;
      }
    } catch (_) {}
    clearSession();
  }
  showView("login");
}

init();
