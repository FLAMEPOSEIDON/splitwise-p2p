# Splitwise P2P — Offline-First Mesh Expense Sharing with Cloud Addon

An offline-first, peer-to-peer expense splitting application that runs with **zero internet connection** over local Wi-Fi or hotspots, with an optional **Free MongoDB Cloud Addon** for cross-network synchronization.

Available as:
1. 📱 **Standalone Native Android App (APK)**: Packaged `.apk` file that anyone can install directly on their Android phone with zero browsers or setup.
2. 🌐 **Progressive Web App (PWA)**: Works across all platforms (Android, iOS Safari, Windows, Mac, Linux) with a trusted certificate authority for 1-tap installation.
3. 🍃 **Optional Free MongoDB Atlas Cloud Addon**: Choose between **100% Local Only** or **Dual Mode (Local + MongoDB)**. Data is always stored locally, and optionally mirrored to your free MongoDB database when online!

---

## Key Features

- 📴 **100% Offline-First**: Add expenses, create groups, split bills, and calculate balances anytime—even in airplanes, subways, or remote campouts.
- 📱 **Standalone Android App (APK)**: Native APK project with Android's `NsdManager` (mDNS), background socket sync, native SQLite database, and pre-configured release signing keystore.
- 🍃 **Optional Free MongoDB Addon**: Run 100% locally or plug in your free MongoDB Atlas connection string. Data is saved locally AND mirrored to MongoDB, enabling remote sync across different Wi-Fi networks!
- 📡 **Automatic Wi-Fi Mesh Sync**: Devices automatically discover each other over local Wi-Fi (using mDNS / Bonjour) and sync transactions without internet.
- 🕒 **Conflict-Free Hybrid Logical Clocks (HLC)**: Deterministic last-write-wins ledger merging. No central server needed; every device has a synchronized copy of the database.
- 🛡️ **Trusted Certificate Generator**: Built-in Certificate Authority generator (`splitwise-root-ca.crt`) providing green-lock HTTPS so mobile browsers allow instant 1-tap installation to the home screen.
- 🧮 **Debt Simplification**: Greedy debt-minimization algorithm that computes the minimum number of payments to settle all debts in a group.
- 🤝 **1-Click Settlement**: Record payments between members that instantly update balances across the mesh.

---

## 1. Standalone Android App (Install Directly)

If you want a **total, standalone app (`.apk`)** that friends can install directly by tapping on it:

### Option A: Automatic Cloud Build via GitHub Actions (Recommended)
1. Push this repository to your GitHub account (free private or public repository).
2. Go to the **Actions** tab on GitHub: the workflow `.github/workflows/build-apk.yml` runs automatically.
3. In ~2 minutes, click on the latest workflow run and download the `Splitwise-P2P-Release-APK` artifact!
4. Send the `.apk` file to your friends (via WhatsApp, Telegram, Google Drive, or Bluetooth).
5. Anyone can tap the `.apk` on their Android phone to install directly!

### Option B: Build Locally in Termux / Linux
If you have Gradle or JDK installed in Termux:
```bash
pkg install openjdk-17 gradle
chmod +x build-apk-termux.sh
./build-apk-termux.sh
```
The signed release APK will be generated at:
`android-app/app/build/outputs/apk/release/app-release.apk`

---

## 2. Optional Free MongoDB Cloud Addon (Dual Storage)

In the app, you have two storage modes:

```
[ Option 1: 100% Local Only ]          [ Option 2: Dual Mode (Local + MongoDB) ]
- Operates purely offline              - Always saves to Local SQLite / IndexedDB
- Syncs only over local Wi-Fi          - AND mirrors to free MongoDB Atlas
- Zero cloud accounts needed           - Syncs with friends across different Wi-Fi!
```

### How to use MongoDB as an Addon:
1. Go to the **MongoDB** tab in the app.
2. Select **☁️ Local + MongoDB**.
3. Paste your free MongoDB connection string:
   `mongodb+srv://<username>:<password>@cluster0.mongodb.net/splitwise`
4. Tap **Save & Connect**.
5. Your data is now stored on **both your phone/device locally and in MongoDB**!
6. If you go offline, you can continue using the app locally. When you reconnect to the internet, all offline changes sync to MongoDB automatically.

### How to get a Free MongoDB Database (Takes 2 Minutes):
1. Sign up for free at [mongodb.com/atlas](https://www.mongodb.com/cloud/atlas/register) (no credit card required).
2. Create a Free **M0 Sandbox** cluster (512MB free forever).
3. Under **Database Access**, create a username and password.
4. Under **Network Access**, click **Add IP Address** and choose `0.0.0.0/0` (Allow from anywhere).
5. Click **Connect → Drivers → Node.js**, copy the connection string, replace `<password>`, and paste it into the app!

---

## 3. Quick Start (Terminal / Node.js Server Mode)

```bash
# 1. Start the local server
node index.js
```

Upon launching, the terminal displays:
```text
======================================================
       Splitwise P2P — Local Mesh Edition
======================================================
  Device Name     : Chandan (950f2bd3)
  HTTPS App (PWA) : https://192.168.1.34:8443
  HTTP Helper     : http://192.168.1.34:8080
  Root CA Cert    : http://192.168.1.34:8080/ca.crt

  Scan with phone camera on this Wi-Fi to open & install:
  [QR CODE]
======================================================
```

---

## 4. Install as a PWA (With Trusted Certificate)

### 📱 Android (Phones & Tablets)
1. Connect to the same Wi-Fi.
2. Scan the terminal QR code or open `http://<HOST-IP>:8080/ca.crt` in Chrome to download `splitwise-root-ca.crt`.
3. Open phone **Settings → Security & Privacy → More security settings → Install from device storage → CA certificate**.
4. Choose **Install anyway** and select `splitwise-root-ca.crt`.
5. Open `https://<HOST-IP>:8443` in Chrome: you will see the secure lock 🔒.
6. Tap the **Install** banner or Chrome menu (3 dots) → **Install app / Add to Home screen**.

### 🍏 iPhone & iPad (iOS Safari)
1. Connect to the same Wi-Fi.
2. Open Safari to `http://<HOST-IP>:8080/ca.crt` → tap **Allow**.
3. Open **Settings → Profile Downloaded → Install**.
4. Open **Settings → General → About → Certificate Trust Settings** → toggle **ON** full trust for `Splitwise P2P Local Root CA`.
5. Open `https://<HOST-IP>:8443` in Safari, tap **Share → Add to Home Screen**.

---

## Project Structure

```
splitwise-p2p/
├── android-app/                # Standalone Native Android Application
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml # Permissions (Internet, Wi-Fi Multicast)
│   │   ├── java/com/splitwise/p2p/
│   │   │   ├── MainActivity.java    # Fullscreen WebView + AndroidBridge
│   │   │   ├── P2pSyncService.java  # Native mDNS (NsdManager) + Socket Sync
│   │   │   ├── DatabaseHelper.java  # Native Android SQLite DB
│   │   │   └── HlcClock.java        # Hybrid Logical Clock in Java
│   │   └── assets/www/              # Bundled offline HTML/CSS/JS frontend
│   ├── build.gradle                 # Gradle build with release keystore signing
│   └── splitwise-release.keystore   # Release signing keystore
├── .github/workflows/          # Automated cloud APK builder
│   └── build-apk.yml           # GitHub Actions workflow (builds APK on push)
├── build-apk-termux.sh         # Local Termux APK build script
├── src/                        # Core backend modules
│   ├── mongoSync.js            # Optional Free MongoDB Atlas Cloud Addon
│   ├── cert.js                 # Automatic TLS Certificate & Local CA Manager
│   ├── qrcode.js               # Zero-dependency QR Code generator (ANSI & SVG)
│   ├── webServer.js            # HTTPS/HTTP server with WebSocket & REST API
│   ├── discovery.js            # mDNS LAN peer discovery
│   ├── sync.js                 # P2P WebSocket sync protocol
│   ├── db.js                   # Local SQLite storage layer
│   ├── expenses.js             # Splitwise business logic & debt simplification
│   ├── hlc.js                  # Hybrid Logical Clock implementation
│   └── cli.js                  # Terminal menu interface
├── public/                     # PWA frontend assets
│   ├── index.html              # Modern responsive mobile UI with MongoDB tab
│   ├── styles.css              # Dark-mode fintech styling
│   ├── app.js                  # Dual native/web frontend application
│   ├── sw.js                   # Offline caching service worker
│   ├── manifest.json           # PWA Web Manifest
│   └── icons/                  # Vector app icons
├── index.js                    # Application entry point
└── package.json
```

---

## License
MIT
