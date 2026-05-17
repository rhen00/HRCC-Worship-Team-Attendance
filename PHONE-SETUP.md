# Use on phone (HTTPS required)

**Why PC works but phone does not:** On PC you use `http://localhost:8080` — browsers allow the camera there. On a phone, `http://192.168.x.x:8080` is **not** secure, so the **camera is blocked**. You need **HTTPS**.

## Option A — Firebase Hosting (recommended for Sunday)

1. Install Firebase CLI (one time):
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
2. In this folder, double-click **`deploy-hosting.bat`** or run:
   ```bash
   firebase deploy --only hosting
   ```
3. On the phone, open:
   ```
   https://hrcc-worship-team-attendance.web.app
   ```
4. Add to home screen (optional): Share → Add to Home Screen.

`js/firebase-config.js` already sets `APP_BASE_URL` to this URL so the admin **Check-in QR** is correct after deploy.

## Option B — Quick test without deploying

On the scan screen, use **Testing without camera** → type `HRCC-CHECKIN` → **Check in**.  
Works on any URL; no camera needed.

## Option C — Temporary HTTPS tunnel (dev only)

With PC server running on port 8080:
```bash
npx ngrok http 8080
```
Open the `https://....ngrok.io` link on your phone.

## After deploying

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**  
   Ensure `hrcc-worship-team-attendance.web.app` is listed (added automatically with Hosting).
2. Re-open **Admin → Check-in QR** and re-download the poster QR if you changed `APP_BASE_URL`.

## Phone checklist

| Step | Action |
|------|--------|
| 1 | Open **https** link (not `192.168...`) |
| 2 | Sign in with name + member ID |
| 3 | Allow camera when prompted |
| 4 | Scan door QR or use manual `HRCC-CHECKIN` |
