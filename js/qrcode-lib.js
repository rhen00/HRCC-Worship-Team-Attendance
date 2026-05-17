/** Loads the qrcode library via ESM (CDN script build/qrcode.min.js is not published on npm CDNs). */
let qrLib = null;

const QR_SOURCES = [
  "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm",
  "https://esm.sh/qrcode@1.5.4",
];

export async function loadQRCode() {
  if (qrLib) return qrLib;

  let lastError;
  for (const url of QR_SOURCES) {
    try {
      const mod = await import(url);
      qrLib = mod.default;
      if (qrLib?.toCanvas) return qrLib;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Could not load QR code library");
}

const DEFAULT_OPTS = {
  width: 280,
  margin: 2,
  color: { dark: "#1a2332", light: "#ffffff" },
};

export async function drawQRToCanvas(canvas, text, options = {}) {
  const QRCode = await loadQRCode();
  return QRCode.toCanvas(canvas, text, { ...DEFAULT_OPTS, ...options });
}
