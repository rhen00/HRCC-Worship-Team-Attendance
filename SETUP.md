# HRCC Worship Team Attendance — Setup

## 1. Firebase project

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. Enable **Firestore Database** (production mode is fine).
3. **Enable Authentication (required — fixes `auth/configuration-not-found`):**
   - Go to **Build → Authentication**
   - Click **Get started** (if you skip this, every sign-in fails with `configuration-not-found`)
   - Open **Sign-in method** → **Anonymous** → toggle **Enable** → **Save**
4. Copy your web app config into `js/firebase-config.js`.
5. Deploy security rules from `firestore.rules` (Firebase Console → Firestore → Rules).
6. Deploy Firestore rules + indexes (fixes **"query requires an index"**):
   - Double-click **`deploy-firestore.bat`**, or run `firebase deploy --only firestore`
   - **Or** when the app shows the error, click the **link** in the message → Firebase Console → **Create index** → wait until status is **Enabled** (a few minutes).

### Why "requires an index"?

Firestore needs a **composite index** when a query uses **filter + sort on different fields**, or **two filters** (e.g. `memberID` + `date` for "already checked in today"). The app uses a simpler query now where possible; one index may still be required for duplicate check-in per day.

## 2. Run locally

Browsers require **HTTPS** or **localhost** for camera access.

```bash
# Python 3
cd "HRCC Worship team attendance"
python -m http.server 8080
```

Open: `http://localhost:8080`

Or use [Firebase Hosting](https://firebase.google.com/docs/hosting) for HTTPS on phones.

## 3. Admin password

Default password: `hrcc2026` — change `ADMIN_PASSWORD` in `js/firebase-config.js`.

## 4. Workflow

1. **Admin** → Add members → Generate ID → Show QR → Download/print QR.
2. **Scanner** → Start camera → Scan member QR on Sunday.
3. **Admin** → Attendance tab → Filter by date → Export CSV.

## Collections

| Collection   | Purpose                          |
|-------------|-----------------------------------|
| `members`   | Name, role, section, memberID     |
| `attendance`| Daily check-ins with penalties    |
