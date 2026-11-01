# Splitwise P2P — Offline-First Mesh Expense Sharing with Quick Share & QR

An offline-first, peer-to-peer expense splitting application built for Indian users with **Indian Rupees (₹)**, **Google Nearby Connections (Quick Share mesh)**, **In-App QR Code Scanner & Generator**, official **Splitwise CSV Import/Export**, and **UPI 1-Tap Settlements** (`upi://pay`).

Works with **zero internet connection** over local Wi-Fi, hotspot, or Bluetooth/Wi-Fi Direct mesh, with an optional **Free MongoDB Cloud Addon** for cross-network synchronization.

Available as:
1. 📱 **Standalone Native Android App (APK)**: Packaged `.apk` file that anyone can install directly on their Android phone with zero browsers or setup.
2. 🌐 **Progressive Web App (PWA)**: Works across all platforms (Android, iOS Safari, Windows, Mac, Linux) with a trusted certificate authority for 1-tap installation.
3. 🍃 **Optional Free MongoDB Atlas Cloud Addon**: Data is always stored locally, and optionally mirrored to your free MongoDB database when online.

---

## 🚀 Key Features

- ⚡ **Google Nearby Connections (Quick Share Mesh)**: Devices discover and sync with each other automatically using Bluetooth Low Energy (BLE) and Wi-Fi Direct / Local Hotspots, even if home Wi-Fi has client isolation!
- 📷 **In-App QR Code Scanner & Generator**:
  - Tap **"📷 Scan QR"** in the top bar to scan another device's screen and join the group in one second with zero typing.
  - Built-in zero-dependency client-side QR generator displays the group ID and connection endpoints instantly.
- 🇮🇳 **Indian Rupees (₹) Everywhere**: Native Indian number formatting (`₹1,50,000.00`) across group cards, expense logs, balances, and settlements.
- 📲 **1-Tap UPI Settlement**: When settling debts, tap **"Pay via UPI (GPay / PhonePe / Paytm)"** to launch your favourite UPI app pre-filled with the exact amount and payee!
- 📥 **Official Splitwise CSV Import**:
  - 1-Tap import specifically tailored for your Splitwise exports (e.g. `export.csv`).
  - Automatically parses multiple payers, unequal split shares, categories (🥦 Groceries, 🍔 Dining out, 🏠 Rent, 🧹 Cleaning, etc.), and transaction dates.
- 📤 **Splitwise CSV Export**: Export any group into an official Splitwise-compatible CSV file at any time.
- 🔍 **Real-Time Search & Category Filters**: Filter expenses instantly by category chips (Groceries, Dining, Rent, Utilities, etc.) or search by description/payer.
- ⚖️ **Flexible Split Modes**: Split bills equally among selected members or enter custom exact share amounts.
- 🕒 **Conflict-Free Hybrid Logical Clocks (HLC)**: Deterministic last-write-wins ledger merging. No central server needed; every device maintains a synchronized local ledger.
- 🧮 **Greedy Debt Simplification**: Automatically computes the minimum number of transactions needed to settle all debts in a group.

---

## 📱 1. Standalone Android App (APK)

### Option A: Automatic Cloud Build via GitHub Actions (Recommended)
1. Push this repository to your GitHub account (public or private):
   ```bash
   git add .
   git commit -m "Add Quick Share Nearby Connections, QR Scanner, CSV import, and INR currency"
   git push origin main
   ```
2. Open your repository on GitHub and click on the **Actions** tab.
3. The workflow `.github/workflows/build-apk.yml` runs automatically.
4. Once completed (~2 minutes), click on the workflow run and download the **`Splitwise-P2P-Release-APK`** artifact.
5. Extract the downloaded zip file to get `app-release.apk`.
6. Send the `.apk` to your devices (via WhatsApp, Telegram, Quick Share, or Google Drive) and install directly!

### Option B: Build Locally in Termux / Linux
If you have Gradle and JDK installed in Termux:
```bash
pkg install openjdk-17 gradle
chmod +x build-apk-termux.sh
./build-apk-termux.sh
```
The signed release APK will be located at:
`android-app/app/build/outputs/apk/release/app-release.apk`

---

## 🔄 2. How Offline Peer-to-Peer Sync Works

The app implements a **multi-layer hybrid discovery and sync architecture**:

```
┌────────────────────────────────────────────────────────┐
│                      Splitwise P2P                     │
└────────────────────────────────────────────────────────┘
          │                                  │
    Layer 1: Nearby Mesh               Layer 2: Wi-Fi NSD
 (Google Nearby Connections)           (mDNS / Bonjour)
          │                                  │
  • BLE Advertisement                • mDNS Service Broadcast
  • BLE Discovery                    • Socket Server (:8888)
  • Wi-Fi Direct / Hotspot           • Local Wi-Fi Router
  • Works with AP Isolation!         • Fast High-Throughput
```

1. **Nearby Connections (Quick Share style)**: Uses BLE to discover nearby devices within range and automatically negotiates an offline Wi-Fi Direct or hotspot socket. This works even when your home Wi-Fi router blocks peer-to-peer traffic (AP / Client Isolation).
2. **Wi-Fi NSD / mDNS**: Automatically discovers other phones running Splitwise P2P on the local subnet (`_splitwisep2p._tcp`).
3. **1-Tap QR Join**: Display the QR code on Device A. Tap **"📷 Scan QR"** on Device B to instantly scan and connect, immediately triggering a full state sync!

---

## 📥 3. Splitwise CSV Import Guide

You can import any group history exported from the official Splitwise app:

### 1-Tap Import from Downloads:
1. Make sure your `export.csv` file is located in your device's `Downloads` folder (or at `/data/data/com.termux/files/home/downloads/export.csv`).
2. Open the app and tap **"📥 Import Splitwise CSV"**.
3. Tap **"⚡ 1-Tap Import downloads/export.csv"**.
4. All members, categories, historical dates, payments, and expenses are imported in milliseconds.

### Custom CSV File Picker:
1. Tap **"📥 Import Splitwise CSV"**.
2. Select any `.csv` file exported from Splitwise.
3. Tap **"Import File"**.

---

## 🌐 4. Progressive Web App (PWA) Mode

If you wish to run the Node.js server and connect via mobile web browser:

```bash
# Start the local server
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

### Install PWA on Android Chrome:
1. Connect to the same Wi-Fi.
2. Download `http://<HOST-IP>:8080/ca.crt`.
3. Go to **Settings → Security → Install from storage → CA certificate** and select `splitwise-root-ca.crt`.
4. Open `https://<HOST-IP>:8443` in Chrome: you will see the green lock 🔒.
5. Tap **Add to Home screen** / **Install**.

### Install PWA on iPhone (iOS Safari):
1. Connect to the same Wi-Fi.
2. Open Safari to `http://<HOST-IP>:8080/ca.crt` → tap **Allow**.
3. Open **Settings → Profile Downloaded → Install**.
4. Open **Settings → General → About → Certificate Trust Settings** → toggle **ON** full trust for `Splitwise P2P Local Root CA`.
5. Open `https://<HOST-IP>:8443` in Safari, tap **Share → Add to Home Screen**.

---

## 🍃 5. Optional Free MongoDB Cloud Addon

If you want your data to sync across mobile cellular data or different Wi-Fi networks when internet is available:
1. In the app, switch to the **MongoDB** tab.
2. Select **☁️ Local + MongoDB**.
3. Enter your free MongoDB Atlas connection string:
   `mongodb+srv://<username>:<password>@cluster0.mongodb.net/splitwise`
4. Tap **Save & Connect**.
5. All local transactions are mirrored to MongoDB, and remote changes sync to your phone seamlessly!

---

## 📁 Project Structure

```
splitwise-p2p/
├── android-app/                       # Standalone Native Android Application
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml        # Permissions (BLE, Wi-Fi, Camera, Internet)
│   │   ├── java/com/splitwise/p2p/
│   │   │   ├── MainActivity.java      # AndroidBridge, WebView, Google Code Scanner
│   │   │   ├── NearbySyncService.java # Google Nearby Connections (Quick Share mesh)
│   │   │   ├── P2pSyncService.java    # Wi-Fi NSD (mDNS) + Socket Mesh
│   │   │   ├── DatabaseHelper.java    # SQLite DB v2, CSV Import/Export, Balances
│   │   │   └── HlcClock.java          # Hybrid Logical Clock in Java
│   │   └── assets/www/                # Bundled offline HTML/CSS/JS frontend
│   └── build.gradle                   # Gradle configuration & Google Play Services
├── .github/workflows/
│   └── build-apk.yml                  # Automated cloud APK builder (GitHub Actions)
├── build-apk-termux.sh                # Local Termux APK build script
├── src/                               # Node.js backend modules
│   ├── expenses.js                    # Splitwise logic, CSV parser, debt simplification
│   ├── webServer.js                   # REST API, WebSocket sync & CSV endpoints
│   ├── mongoSync.js                   # Free MongoDB Atlas Cloud Addon
│   ├── cert.js                        # Automatic TLS Certificate & Local CA Manager
│   ├── discovery.js                   # mDNS LAN peer discovery
│   └── sync.js                        # P2P WebSocket sync protocol
├── public/                            # Web PWA frontend assets
│   ├── index.html                     # Responsive UI with INR, QR, CSV & UPI buttons
│   ├── styles.css                     # Modern dark-mode fintech theme
│   ├── app.js                         # Dual native/web frontend application
│   └── qrcode.js                      # Zero-dependency QR code generator
├── index.js                           # Node.js application entry point
└── package.json
```

---

## 📜 License
MIT
