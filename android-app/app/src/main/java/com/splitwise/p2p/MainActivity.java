package com.splitwise.p2p;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.net.HttpURLConnection;
import java.net.URL;

import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class MainActivity extends Activity implements P2pSyncService.OnSyncListener, NearbySyncService.OnNearbySyncListener {
    private static final String TAG = "MainActivity";
    private static final String PREFS_NAME = "SplitwiseP2P_Prefs";
    private static final String PREF_DEVICE_ID = "deviceId";
    private static final String PREF_DEVICE_NAME = "deviceName";
    private static final String PREF_NAME_CONFIGURED = "nameConfigured";
    private static final int PERMISSION_REQ_CODE = 1001;
    private static final int FILECHOOSER_RESULTCODE = 2001;

    private String deviceId;
    private String deviceName;

    private HlcClock hlcClock;
    private DatabaseHelper dbHelper;
    private P2pSyncService syncService;
    private NearbySyncService nearbySyncService;

    private WifiManager.MulticastLock multicastLock;
    private WebView webView;
    private GmsBarcodeScanner barcodeScanner;
    private ValueCallback<Uri[]> uploadMessage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Acquire Wi-Fi Multicast Lock
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicastLock = wifi.createMulticastLock("SplitwiseP2PMulticastLock");
            multicastLock.setReferenceCounted(true);
            try { multicastLock.acquire(); } catch (Exception ignored) {}
        }

        // 2. Identity
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        deviceId = prefs.getString(PREF_DEVICE_ID, null);
        deviceName = prefs.getString(PREF_DEVICE_NAME, null);

        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString().substring(0, 8);
            deviceName = "Android User " + deviceId.substring(0, 4);
            prefs.edit()
                    .putString(PREF_DEVICE_ID, deviceId)
                    .putString(PREF_DEVICE_NAME, deviceName)
                    .apply();
        }

        // 3. Database & Sync
        hlcClock = new HlcClock(deviceId);
        dbHelper = new DatabaseHelper(this);

        // Start Wi-Fi Mesh Sync (TCP Socket + NSD mDNS)
        syncService = new P2pSyncService(this, deviceId, deviceName, hlcClock, dbHelper, this);
        syncService.start();

        // Start Google Nearby Connections (Quick Share BLE + Wi-Fi Direct Mesh)
        nearbySyncService = new NearbySyncService(this, deviceId, deviceName, hlcClock, dbHelper, this);
        checkAndRequestPermissions();

        // 4. Initialize Google Code Scanner for 1-Tap QR joining
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAutoZoom()
                .build();
        barcodeScanner = GmsBarcodeScanning.getClient(this, options);

        // 5. Configure Fullscreen Web View
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    try {
                        request.grant(request.getResources());
                    } catch (Exception ignored) {}
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                uploadMessage = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                String[] mimeTypes = {"text/csv", "text/comma-separated-values", "application/csv", "text/plain", "*/*"};
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);

                try {
                    startActivityForResult(Intent.createChooser(intent, "Select Splitwise CSV File"), FILECHOOSER_RESULTCODE);
                } catch (Exception e) {
                    uploadMessage = null;
                    return false;
                }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    String url = request.getUrl().toString();
                    if (url.startsWith("file:") || url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
                        return false;
                    }
                }
                return true; // Prevent WebView from redirecting to broken external pages
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("file:") || url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost"))) {
                    return false;
                }
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    WebResourceResponse ota = getOtaResource(request.getUrl().toString());
                    if (ota != null) return ota;
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                if (url != null) {
                    WebResourceResponse ota = getOtaResource(url);
                    if (ota != null) return ota;
                }
                return super.shouldInterceptRequest(view, url);
            }
        });

        // Attach Android Native Bridge to JavaScript
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        // Load bundled native app assets (or cached OTA updates if present)
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private WebResourceResponse getOtaResource(String url) {
        if (url == null || !url.startsWith("file:///android_asset/www/")) {
            return null;
        }
        String filename = url.substring("file:///android_asset/www/".length());
        if (filename.contains("?")) filename = filename.substring(0, filename.indexOf("?"));
        if (filename.contains("#")) filename = filename.substring(0, filename.indexOf("#"));

        File otaFile = new File(new File(getFilesDir(), "ota_www"), filename);
        if (otaFile.exists() && otaFile.isFile() && otaFile.length() > 0) {
            try {
                String mimeType = "text/plain";
                if (filename.endsWith(".html")) mimeType = "text/html";
                else if (filename.endsWith(".js")) mimeType = "application/javascript";
                else if (filename.endsWith(".css")) mimeType = "text/css";
                else if (filename.endsWith(".svg")) mimeType = "image/svg+xml";
                else if (filename.endsWith(".json")) mimeType = "application/json";
                return new WebResourceResponse(mimeType, "UTF-8", new FileInputStream(otaFile));
            } catch (Exception ignored) {}
        }
        return null;
    }

    private void checkAndRequestPermissions() {
        List<String> perms = new ArrayList<>();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+ (API 31+)
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ (API 33+)
            if (checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.NEARBY_WIFI_DEVICES);
            }
        }

        // Location is needed for BLE discovery on Android <= 11
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
        }

        if (!perms.isEmpty()) {
            requestPermissions(perms.toArray(new String[0]), PERMISSION_REQ_CODE);
        } else {
            nearbySyncService.start();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE) {
            if (nearbySyncService != null) {
                nearbySyncService.start();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILECHOOSER_RESULTCODE) {
            if (uploadMessage == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String dataString = data.getDataString();
                ClipData clipData = data.getClipData();
                if (clipData != null) {
                    results = new Uri[clipData.getItemCount()];
                    for (int i = 0; i < clipData.getItemCount(); i++) {
                        results[i] = clipData.getItemAt(i).getUri();
                    }
                } else if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            uploadMessage.onReceiveValue(results);
            uploadMessage = null;
        }
    }

    public static String getLocalIpAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface intf : interfaces) {
                if (intf.isLoopback() || !intf.isUp()) continue;
                List<InetAddress> addrs = Collections.list(intf.getInetAddresses());
                for (InetAddress addr : addrs) {
                    if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }

    // --- Sync Callbacks ---

    @Override
    public void onPeerFound(String name, String host, int port) {
        notifyWebView("PEER_FOUND");
    }

    @Override
    public void onPeerLost(String name) {
        notifyWebView("PEER_LOST");
    }

    @Override
    public void onPeerFound(String endpointId, String name) {
        notifyWebView("NEARBY_PEER_FOUND");
    }

    @Override
    public void onPeerConnected(String endpointId, String name) {
        notifyWebView("NEARBY_PEER_CONNECTED");
    }

    @Override
    public void onPeerDisconnected(String endpointId) {
        notifyWebView("NEARBY_PEER_DISCONNECTED");
    }

    @Override
    public void onDataMerged(int count) {
        notifyWebView("DATA_MERGED");
    }

    private void notifyWebView(String event) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if (window.onSyncUpdate) window.onSyncUpdate('" + event + "');", null);
            }
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (syncService != null) syncService.stop();
        if (nearbySyncService != null) nearbySyncService.stop();
        if (multicastLock != null && multicastLock.isHeld()) {
            multicastLock.release();
        }
    }

    // --- JavaScript Native Bridge ---

    public class AndroidBridge {
        @JavascriptInterface
        public String getDeviceInfo() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("deviceId", deviceId);
                obj.put("deviceName", deviceName);
                obj.put("nameConfigured", getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getBoolean(PREF_NAME_CONFIGURED, false));
                obj.put("ip", getLocalIpAddress());
                obj.put("port", P2pSyncService.SYNC_PORT);
                obj.put("isNativeApp", true);
                return obj.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setDeviceName(String newName) {
            if (newName == null || newName.trim().isEmpty()) return;
            deviceName = newName.trim();
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_DEVICE_NAME, deviceName)
                    .putBoolean(PREF_NAME_CONFIGURED, true)
                    .apply();

            dbHelper.updateMemberNameForDevice(deviceId, deviceName);
            if (syncService != null) {
                syncService.updateDeviceName(deviceName);
                syncService.broadcastSync();
            }
            if (nearbySyncService != null) {
                nearbySyncService.updateDeviceName(deviceName);
                nearbySyncService.broadcastSync();
            }
        }

        @JavascriptInterface
        public String getGroups() {
            return dbHelper.listGroups(deviceId).toString();
        }

        @JavascriptInterface
        public String createGroup(String name, String userName) {
            JSONObject g = dbHelper.createGroup(name, deviceId, userName);
            if (syncService != null) syncService.broadcastSync();
            if (nearbySyncService != null) nearbySyncService.broadcastSync();
            return g.toString();
        }

        @JavascriptInterface
        public String joinGroup(String groupId, String userName) {
            dbHelper.joinGroupStub(groupId, deviceId, userName);
            if (syncService != null) syncService.broadcastSync();
            if (nearbySyncService != null) nearbySyncService.broadcastSync();
            return "{\"success\": true}";
        }

        @JavascriptInterface
        public String getGroupDetail(String groupId) {
            try {
                JSONObject res = new JSONObject();
                res.put("group", dbHelper.getGroup(groupId));
                res.put("members", dbHelper.listMembers(groupId));
                res.put("expenses", dbHelper.listExpenses(groupId, false));

                JSONObject bObj = new JSONObject();
                for (java.util.Map.Entry<String, Double> entry : dbHelper.computeBalances(groupId).entrySet()) {
                    bObj.put(entry.getKey(), entry.getValue());
                }
                res.put("balances", bObj);
                res.put("settlements", dbHelper.simplifyDebts(groupId));

                return res.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String addExpense(String groupId, String desc, double amount, String paidBy, String splitBetweenJson, String category, String date) {
            try {
                JSONArray split = new JSONArray(splitBetweenJson);
                JSONObject exp = dbHelper.addExpense(hlcClock, groupId, desc, amount, paidBy, split, category, date, deviceId);
                if (syncService != null) syncService.broadcastSync();
                if (nearbySyncService != null) nearbySyncService.broadcastSync();
                return exp.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String updateExpense(String groupId, String expenseId, String desc, double amount, String paidBy, String splitBetweenJson, String category, String date) {
            try {
                JSONArray split = new JSONArray(splitBetweenJson);
                JSONObject exp = dbHelper.updateExpense(hlcClock, expenseId, desc, amount, paidBy, split, category, date, deviceId);
                if (syncService != null) syncService.broadcastSync();
                if (nearbySyncService != null) nearbySyncService.broadcastSync();
                return exp.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void deleteExpense(String groupId, String expenseId) {
            dbHelper.deleteExpense(hlcClock, expenseId);
            if (syncService != null) syncService.broadcastSync();
            if (nearbySyncService != null) nearbySyncService.broadcastSync();
        }

        @JavascriptInterface
        public String settleDebt(String groupId, String payerId, String receiverId, double amount) {
            JSONObject s = dbHelper.settleDebt(hlcClock, groupId, payerId, receiverId, amount, deviceId);
            if (syncService != null) syncService.broadcastSync();
            if (nearbySyncService != null) nearbySyncService.broadcastSync();
            return s.toString();
        }

        @JavascriptInterface
        public String getPeers() {
            List<P2pSyncService.PeerInfo> list = syncService.getDiscoveredPeers();
            JSONArray arr = new JSONArray();
            for (P2pSyncService.PeerInfo p : list) {
                try {
                    JSONObject obj = new JSONObject();
                    obj.put("name", p.name);
                    obj.put("host", p.host);
                    obj.put("port", p.port);
                    obj.put("type", "Local Wi-Fi Mesh");
                    arr.put(obj);
                } catch (Exception ignored) {}
            }
            if (nearbySyncService != null) {
                for (JSONObject p : nearbySyncService.getNearbyPeers()) {
                    arr.put(p);
                }
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void connectPeer(String host, int port) {
            syncService.connectToPeer(host, port);
        }

        // 1-Tap QR Scanner via Google Code Scanner
        @JavascriptInterface
        public void scanQrCode() {
            runOnUiThread(() -> {
                if (barcodeScanner == null) {
                    Toast.makeText(MainActivity.this, "Scanner initializing...", Toast.LENGTH_SHORT).show();
                    return;
                }
                barcodeScanner.startScan()
                        .addOnSuccessListener(barcode -> {
                            String raw = barcode.getRawValue();
                            if (raw != null) {
                                handleScannedCode(raw);
                            }
                        })
                        .addOnFailureListener(e -> {
                            Log.e(TAG, "QR scan cancelled or failed: " + e.getMessage());
                            Toast.makeText(MainActivity.this, "Scan cancelled", Toast.LENGTH_SHORT).show();
                        });
            });
        }

        private void handleScannedCode(String raw) {
            runOnUiThread(() -> {
                try {
                    String groupId = null;
                    String ip = null;
                    int port = P2pSyncService.SYNC_PORT;

                    if (raw.startsWith("splitwise://join")) {
                        android.net.Uri uri = android.net.Uri.parse(raw);
                        groupId = uri.getQueryParameter("gid");
                        ip = uri.getQueryParameter("ip");
                        String pStr = uri.getQueryParameter("port");
                        if (pStr != null) {
                            try { port = Integer.parseInt(pStr); } catch (Exception ignored) {}
                        }
                    } else if (raw.startsWith("{")) {
                        JSONObject obj = new JSONObject(raw);
                        groupId = obj.optString("gid", obj.optString("groupId", null));
                        ip = obj.optString("ip", obj.optString("host", null));
                        port = obj.optInt("port", P2pSyncService.SYNC_PORT);
                    } else {
                        groupId = raw.trim();
                    }

                    if (groupId != null && !groupId.isEmpty()) {
                        dbHelper.joinGroupStub(groupId, deviceId, deviceName);
                        if (ip != null && !ip.isEmpty()) {
                            syncService.connectToPeer(ip, port);
                        }
                        if (syncService != null) {
                            syncService.broadcastSync();
                        }
                        if (nearbySyncService != null) {
                            nearbySyncService.broadcastSync();
                        }
                        webView.evaluateJavascript("if (window.onGroupJoinedViaQr) window.onGroupJoinedViaQr('" + groupId + "');", null);
                        Toast.makeText(MainActivity.this, "Group joined & syncing!", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error handling scanned QR", e);
                }
            });
        }

        // CSV Import & Export
        @JavascriptInterface
        public String importCsv(String csvContent, String groupId, String groupName) {
            JSONObject res = dbHelper.importSplitwiseCsv(hlcClock, csvContent, groupId, groupName, deviceId);
            if (syncService != null) syncService.broadcastSync();
            if (nearbySyncService != null) nearbySyncService.broadcastSync();
            return res.toString();
        }

        @JavascriptInterface
        public String importLocalExportCsv() {
            try {
                File[] candidates = new File[] {
                    new File("/data/data/com.termux/files/home/downloads/export.csv"),
                    new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "export.csv"),
                    new File(getExternalFilesDir(null), "export.csv")
                };

                File found = null;
                for (File f : candidates) {
                    if (f.exists() && f.canRead()) {
                        found = f;
                        break;
                    }
                }

                if (found == null) {
                    return "{\"success\": false, \"error\": \"export.csv not found in Downloads folder\"}";
                }

                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new FileReader(found))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append("\n");
                    }
                }

                JSONObject res = dbHelper.importSplitwiseCsv(hlcClock, sb.toString(), null, "Flat Expenses", deviceId);
                if (syncService != null) syncService.broadcastSync();
                if (nearbySyncService != null) nearbySyncService.broadcastSync();
                return res.toString();
            } catch (Exception e) {
                return "{\"success\": false, \"error\": \"" + e.getMessage() + "\"}";
            }
        }

        @JavascriptInterface
        public String exportCsv(String groupId) {
            return dbHelper.exportSplitwiseCsv(groupId);
        }

        @JavascriptInterface
        public String getActivityFeed(String groupId) {
            return dbHelper.getActivityFeed(groupId).toString();
        }

        @JavascriptInterface
        public String getMongoConfig() {
            return getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("mongo_config", "{\"enabled\":false}");
        }

        @JavascriptInterface
        public void saveMongoConfig(String json) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString("mongo_config", json)
                    .apply();
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                android.content.pm.PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
                return pInfo.versionName;
            } catch (Exception e) {
                return "1.2.0";
            }
        }

        private InputStream openStreamWithRedirects(String initialUrl) throws Exception {
            String currentUrl = initialUrl;
            for (int i = 0; i < 6; i++) {
                URL u = new URL(currentUrl);
                HttpURLConnection conn = (HttpURLConnection) u.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "SplitwiseP2P-OTA");
                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    if (loc != null && !loc.isEmpty()) {
                        currentUrl = loc;
                        continue;
                    }
                }
                if (code >= 200 && code < 300) {
                    return conn.getInputStream();
                }
                throw new Exception("HTTP " + code + " from " + currentUrl);
            }
            throw new Exception("Too many redirects for " + initialUrl);
        }

        @JavascriptInterface
        public void performOtaUpdate(String commitSha) {
            new Thread(() -> {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "⚡ Updating directly over-the-air...", Toast.LENGTH_SHORT).show());
                try {
                    String baseUrl = "https://raw.githubusercontent.com/FLAMEPOSEIDON/splitwise-p2p/main/android-app/app/src/main/assets/www/";
                    String[] files = {"index.html", "styles.css", "app.js", "qrcode.js"};

                    File otaDir = new File(getFilesDir(), "ota_www");
                    if (!otaDir.exists()) otaDir.mkdirs();

                    File tempDir = new File(getFilesDir(), "ota_temp");
                    if (!tempDir.exists()) tempDir.mkdirs();

                    for (String fName : files) {
                        String fileUrl = baseUrl + fName + "?v=" + System.currentTimeMillis();
                        File tmp = new File(tempDir, fName);
                        try (InputStream in = openStreamWithRedirects(fileUrl);
                             FileOutputStream out = new FileOutputStream(tmp)) {
                            byte[] buffer = new byte[8192];
                            int read;
                            while ((read = in.read(buffer)) != -1) {
                                out.write(buffer, 0, read);
                            }
                        }
                    }

                    // Move to ota_www atomically
                    for (String fName : files) {
                        File tmp = new File(tempDir, fName);
                        File target = new File(otaDir, fName);
                        if (target.exists()) target.delete();
                        tmp.renameTo(target);
                    }

                    if (commitSha != null && !commitSha.isEmpty()) {
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                                .edit()
                                .putString("splitwise_installed_commit", commitSha)
                                .apply();
                    }

                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "🎉 Update applied directly! App is restarting...", Toast.LENGTH_LONG).show();
                        webView.clearCache(true);
                        webView.reload();
                    });
                } catch (Exception e) {
                    Log.e(TAG, "OTA update error: " + e.getMessage(), e);
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "Direct update failed: " + e.getMessage() + ". Downloading APK...", Toast.LENGTH_SHORT).show();
                    });
                    installApkUpdate("https://github.com/FLAMEPOSEIDON/splitwise-p2p/releases/latest/download/SplitwiseP2P.apk");
                }
            }).start();
        }

        @JavascriptInterface
        public void installApkUpdate(String downloadUrl) {
            new Thread(() -> {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "⬇️ Downloading APK update directly inside app...", Toast.LENGTH_SHORT).show());
                try {
                    String url = (downloadUrl != null && !downloadUrl.trim().isEmpty())
                            ? downloadUrl.trim()
                            : "https://github.com/FLAMEPOSEIDON/splitwise-p2p/releases/latest/download/SplitwiseP2P.apk";

                    File cacheDir = getExternalCacheDir() != null ? getExternalCacheDir() : getCacheDir();
                    File apkFile = new File(cacheDir, "SplitwiseP2P-update.apk");
                    if (apkFile.exists()) apkFile.delete();

                    try (InputStream in = openStreamWithRedirects(url);
                         FileOutputStream out = new FileOutputStream(apkFile)) {
                        byte[] buffer = new byte[16384];
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                        }
                    }

                    if (!apkFile.exists() || apkFile.length() < 100000) {
                        throw new Exception("Downloaded APK is too small or incomplete");
                    }

                    runOnUiThread(() -> {
                        try {
                            Toast.makeText(MainActivity.this, "📦 Download complete! Launching installer...", Toast.LENGTH_SHORT).show();

                            // Android 8+ Check unknown sources permission
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                if (!getPackageManager().canRequestPackageInstalls()) {
                                    Toast.makeText(MainActivity.this, "Please allow Splitwise P2P to install updates, then tap install", Toast.LENGTH_LONG).show();
                                    Intent manageIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                                    manageIntent.setData(Uri.parse("package:" + getPackageName()));
                                    manageIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(manageIntent);
                                }
                            }

                            Uri apkUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", apkFile);
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        } catch (Exception ex) {
                            Log.e(TAG, "Failed to launch package installer", ex);
                            Toast.makeText(MainActivity.this, "Installer error: " + ex.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                } catch (Exception e) {
                    Log.e(TAG, "Direct APK download failed: " + e.getMessage(), e);
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "In-app download error: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    });
                }
            }).start();
        }
    }
}
