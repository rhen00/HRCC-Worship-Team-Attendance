# Use on phone (HTTPS required)

**Live site (GitHub Pages):**  
https://rhen00.github.io/HRCC-Worship-Team-Attendance/

**Scanner (bookmark this on phones):**  
https://rhen00.github.io/HRCC-Worship-Team-Attendance/scanner.html

**Why PC works but phone does not on Wi‑Fi:** `http://192.168.x.x:8080` is **not** secure — the **camera is blocked**. Use the **https://** link above.

## Deploy updates to GitHub Pages

1. Push changes to the `main` branch on GitHub.
2. **Actions** tab → wait for **Deploy static content to Pages** to finish (1–2 minutes).
3. Hard-refresh the site on your phone.

`js/firebase-config.js` sets `APP_BASE_URL` to the GitHub Pages URL so **Admin → Check-in QR** points to the right scanner page.

## Firebase (required once)

1. [Firebase Console](https://console.firebase.google.com/) → project **hrcc-worship-team-attendance**
2. **Authentication** → **Settings** → **Authorized domains** → **Add domain**
3. Add: `rhen00.github.io`
4. Enable **Anonymous** sign-in under **Sign-in method**

Without `rhen00.github.io` in authorized domains, login and check-in will fail on the live site.

## Quick test without camera

On the scan screen: **Testing without camera** → type `HRCC-CHECKIN` → **Check in**.

## PC local test

Double-click **`start-test.bat`** → `http://localhost:8080`  
(Camera works on localhost only; use GitHub Pages link on phones.)

## Phone checklist

| Step | Action |
|------|--------|
| 1 | Open the **https** GitHub Pages link (not `192.168...`) |
| 2 | Sign in with name + member ID |
| 3 | Allow camera when prompted |
| 4 | Scan door QR or use manual `HRCC-CHECKIN` |
