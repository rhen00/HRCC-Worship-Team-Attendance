/**
 * Firebase configuration — replace with your project credentials from Firebase Console.
 * https://console.firebase.google.com/
 */
export const firebaseConfig = {
  apiKey: "AIzaSyDNiET8M8eL4tUbbx4FZ2jLgIXiGcINBs8",
  authDomain: "hrcc-worship-team-attendance.firebaseapp.com",
  databaseURL: "https://hrcc-worship-team-attendance-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hrcc-worship-team-attendance",
  storageBucket: "hrcc-worship-team-attendance.firebasestorage.app",
  messagingSenderId: "881393297583",
  appId: "1:881393297583:web:af51a9f5548094b1728c5a",
};

/** Simple PIN for admin access (change before production). */
export const ADMIN_PIN = "hrcc2026";

/**
 * Public URL for the live site (check-in QR, admin poster).
 * GitHub Pages: https://rhen00.github.io/HRCC-Worship-Team-Attendance
 * Leave empty to use the current host (localhost / LAN testing only).
 */
export const APP_BASE_URL = "https://rhen00.github.io/HRCC-Worship-Team-Attendance";

/** QR code on the door poster — members scan this after logging in. */
export const VENUE_CHECKIN_CODE = "HRCC-CHECKIN";
