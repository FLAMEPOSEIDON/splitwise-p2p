package com.splitwise.p2p;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.UUID;

public class MainActivity extends Activity implements P2pSyncService.OnSyncListener {
    private static final String PREFS_NAME = "SplitwiseP2P_Prefs";
    private static final String PREF_DEVICE_ID = "deviceId";
    private static final String PREF_DEVICE_NAME = "deviceName";

    private String deviceId;
    private String deviceName;

    private HlcClock hlcClock;
    private DatabaseHelper dbHelper;
    private P2pSyncService syncService;

    private WifiManager.MulticastLock multicastLock;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Acquire Wi-Fi Multicast Lock (essential on Android for mDNS / Bonjour)
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            multicastLock = wifi.createMulticastLock("SplitwiseP2PMulticastLock");
            multicastLock.setReferenceCounted(true);
            multicastLock.acquire();
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
        syncService = new P2pSyncService(this, deviceId, deviceName, hlcClock, dbHelper, this);
        syncService.start();

        // 4. Configure Fullscreen Web View
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());

        // Attach Android Native Bridge to JavaScript
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        // Load bundled native app assets
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onPeerFound(String name, String host, int port) {
        notifyWebView("PEER_FOUND");
    }

    @Override
    public void onPeerLost(String name) {
        notifyWebView("PEER_LOST");
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
                obj.put("isNativeApp", true);
                return obj.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setDeviceName(String newName) {
            deviceName = newName;
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_DEVICE_NAME, newName)
                    .apply();
        }

        @JavascriptInterface
        public String getGroups() {
            return dbHelper.listGroups(deviceId).toString();
        }

        @JavascriptInterface
        public String createGroup(String name, String userName) {
            return dbHelper.createGroup(name, deviceId, userName).toString();
        }

        @JavascriptInterface
        public String joinGroup(String groupId, String userName) {
            dbHelper.joinGroupStub(groupId, deviceId, userName);
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
                for (var entry : dbHelper.computeBalances(groupId).entrySet()) {
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
        public String addExpense(String groupId, String desc, double amount, String paidBy, String splitBetweenJson) {
            try {
                JSONArray split = new JSONArray(splitBetweenJson);
                JSONObject exp = dbHelper.addExpense(hlcClock, groupId, desc, amount, paidBy, split, deviceId);
                return exp.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void deleteExpense(String groupId, String expenseId) {
            dbHelper.deleteExpense(hlcClock, expenseId);
        }

        @JavascriptInterface
        public String settleDebt(String groupId, String payerId, String receiverId, double amount) {
            JSONObject s = dbHelper.settleDebt(hlcClock, groupId, payerId, receiverId, amount, deviceId);
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
                    arr.put(obj);
                } catch (Exception ignored) {}
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void connectPeer(String host, int port) {
            syncService.connectToPeer(host, port);
        }
    }
}
