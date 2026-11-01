package com.splitwise.p2p;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * NearbySyncService — Offline P2P Mesh Sync using Google Nearby Connections (Quick Share engine).
 * Uses Bluetooth Low Energy (BLE) for automatic zero-router peer discovery
 * and high-speed Wi-Fi Direct / Local Hotspot for payload transfer.
 */
public class NearbySyncService {
    private static final String TAG = "NearbySyncService";
    public static final String SERVICE_ID = "com.splitwise.p2p";
    public static final Strategy STRATEGY = Strategy.P2P_CLUSTER;

    public interface OnNearbySyncListener {
        void onPeerFound(String endpointId, String name);
        void onPeerConnected(String endpointId, String name);
        void onPeerDisconnected(String endpointId);
        void onDataMerged(int count);
    }

    private final Context context;
    private final String deviceId;
    private String deviceName;
    private final HlcClock hlcClock;
    private final DatabaseHelper db;
    private final OnNearbySyncListener listener;
    private final Handler mainHandler;
    private final ConnectionsClient connectionsClient;

    private final Map<String, String> discoveredEndpoints = new ConcurrentHashMap<>();
    private final Map<String, String> connectedEndpoints = new ConcurrentHashMap<>();
    private final Set<String> pendingConnections = Collections.synchronizedSet(new HashSet<>());

    private volatile boolean isRunning = false;

    public NearbySyncService(Context context, String deviceId, String deviceName, HlcClock clock, DatabaseHelper db, OnNearbySyncListener listener) {
        this.context = context.getApplicationContext();
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.hlcClock = clock;
        this.db = db;
        this.listener = listener;
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.connectionsClient = Nearby.getConnectionsClient(this.context);
    }

    public synchronized void start() {
        if (isRunning) return;
        isRunning = true;
        startAdvertising();
        startDiscovery();
    }

    public synchronized void stop() {
        isRunning = false;
        try {
            connectionsClient.stopAdvertising();
            connectionsClient.stopDiscovery();
            connectionsClient.stopAllEndpoints();
        } catch (Exception e) {
            Log.e(TAG, "Error stopping Nearby Connections", e);
        }
        discoveredEndpoints.clear();
        connectedEndpoints.clear();
        pendingConnections.clear();
    }

    public synchronized void updateDeviceName(String newName) {
        if (newName == null || newName.trim().isEmpty()) return;
        this.deviceName = newName.trim();
        if (isRunning) {
            try {
                connectionsClient.stopAdvertising();
            } catch (Exception ignored) {}
            startAdvertising();
            broadcastSync();
        }
    }

    public List<JSONObject> getNearbyPeers() {
        List<JSONObject> peers = new ArrayList<>();
        for (Map.Entry<String, String> entry : connectedEndpoints.entrySet()) {
            try {
                JSONObject obj = new JSONObject();
                obj.put("id", entry.getKey());
                obj.put("name", entry.getValue());
                obj.put("type", "Quick Share (BLE/Wi-Fi Direct)");
                obj.put("connected", true);
                peers.add(obj);
            } catch (Exception ignored) {}
        }
        for (Map.Entry<String, String> entry : discoveredEndpoints.entrySet()) {
            if (!connectedEndpoints.containsKey(entry.getKey())) {
                try {
                    JSONObject obj = new JSONObject();
                    obj.put("id", entry.getKey());
                    obj.put("name", entry.getValue());
                    obj.put("type", "Quick Share (Nearby)");
                    obj.put("connected", false);
                    peers.add(obj);
                } catch (Exception ignored) {}
            }
        }
        return peers;
    }

    // --- 1. Advertising ---

    private void startAdvertising() {
        String endpointName = deviceName + "#" + deviceId;
        AdvertisingOptions options = new AdvertisingOptions.Builder()
                .setStrategy(STRATEGY)
                .build();

        connectionsClient.startAdvertising(endpointName, SERVICE_ID, connectionLifecycleCallback, options)
                .addOnSuccessListener(unused -> Log.d(TAG, "Nearby advertising started as " + endpointName))
                .addOnFailureListener(e -> Log.e(TAG, "Nearby advertising failed: " + e.getMessage()));
    }

    // --- 2. Discovery ---

    private void startDiscovery() {
        DiscoveryOptions options = new DiscoveryOptions.Builder()
                .setStrategy(STRATEGY)
                .build();

        connectionsClient.startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
                .addOnSuccessListener(unused -> Log.d(TAG, "Nearby discovery started"))
                .addOnFailureListener(e -> Log.e(TAG, "Nearby discovery failed: " + e.getMessage()));
    }

    private final EndpointDiscoveryCallback endpointDiscoveryCallback = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            String remoteName = info.getEndpointName();
            Log.d(TAG, "Discovered nearby endpoint: " + endpointId + " (" + remoteName + ")");

            // Avoid self connection if endpoint contains our deviceId
            if (remoteName != null && remoteName.contains("#" + deviceId)) {
                return;
            }

            String cleanName = remoteName != null && remoteName.contains("#") ? remoteName.split("#")[0] : remoteName;
            discoveredEndpoints.put(endpointId, cleanName);
            mainHandler.post(() -> listener.onPeerFound(endpointId, cleanName));

            // Automatically request connection for hands-free mesh sync
            if (!connectedEndpoints.containsKey(endpointId) && !pendingConnections.contains(endpointId)) {
                pendingConnections.add(endpointId);
                connectionsClient.requestConnection(deviceName + "#" + deviceId, endpointId, connectionLifecycleCallback)
                        .addOnFailureListener(e -> {
                            Log.e(TAG, "Failed requesting connection to " + endpointId, e);
                            pendingConnections.remove(endpointId);
                        });
            }
        }

        @Override
        public void onEndpointLost(String endpointId) {
            Log.d(TAG, "Lost nearby endpoint: " + endpointId);
            discoveredEndpoints.remove(endpointId);
            pendingConnections.remove(endpointId);
            mainHandler.post(() -> listener.onPeerDisconnected(endpointId));
        }
    };

    // --- 3. Connection Lifecycle ---

    private final ConnectionLifecycleCallback connectionLifecycleCallback = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo connectionInfo) {
            String remoteName = connectionInfo.getEndpointName();
            String cleanName = remoteName != null && remoteName.contains("#") ? remoteName.split("#")[0] : remoteName;
            discoveredEndpoints.put(endpointId, cleanName);

            Log.d(TAG, "Nearby connection initiated with " + cleanName + " (" + endpointId + "). Auto-accepting...");
            // Hands-free P2P sync: automatically accept connection
            connectionsClient.acceptConnection(endpointId, payloadCallback);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution resolution) {
            pendingConnections.remove(endpointId);
            if (resolution.getStatus().getStatusCode() == ConnectionsStatusCodes.STATUS_OK) {
                String name = discoveredEndpoints.getOrDefault(endpointId, "Nearby Peer");
                connectedEndpoints.put(endpointId, name);
                Log.d(TAG, "Nearby connection SUCCESS with " + name + " (" + endpointId + ")");
                mainHandler.post(() -> listener.onPeerConnected(endpointId, name));

                // Exchange HELLO to start bidirectional group sync
                sendHello(endpointId);
            } else {
                Log.w(TAG, "Nearby connection failed with " + endpointId + ": " + resolution.getStatus().getStatusMessage());
            }
        }

        @Override
        public void onDisconnected(String endpointId) {
            Log.d(TAG, "Nearby disconnected from " + endpointId);
            connectedEndpoints.remove(endpointId);
            pendingConnections.remove(endpointId);
            mainHandler.post(() -> listener.onPeerDisconnected(endpointId));
        }
    };

    // --- 4. Payload & Sync Protocol (HELLO -> SYNC_REQUEST -> SYNC_DATA) ---

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
            if (payload.getType() == Payload.Type.BYTES && payload.asBytes() != null) {
                String jsonStr = new String(payload.asBytes(), StandardCharsets.UTF_8);
                handleNearbyMessage(endpointId, jsonStr);
            }
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {}
    };

    public void broadcastSync() {
        for (String endpointId : connectedEndpoints.keySet()) {
            sendHello(endpointId);
        }
    }

    private void sendPayload(String endpointId, JSONObject msg) {
        try {
            byte[] bytes = msg.toString().getBytes(StandardCharsets.UTF_8);
            connectionsClient.sendPayload(endpointId, Payload.fromBytes(bytes));
        } catch (Exception e) {
            Log.e(TAG, "Error sending payload to " + endpointId, e);
        }
    }

    private void sendHello(String endpointId) {
        try {
            JSONArray groups = db.listGroups(deviceId);
            JSONArray groupIds = new JSONArray();
            for (int i = 0; i < groups.length(); i++) {
                groupIds.put(groups.getJSONObject(i).getString("id"));
            }

            JSONObject hello = new JSONObject();
            hello.put("type", "HELLO");
            hello.put("deviceId", deviceId);
            hello.put("deviceName", deviceName);
            hello.put("groups", groupIds);

            sendPayload(endpointId, hello);
        } catch (Exception e) {
            Log.e(TAG, "Error creating HELLO message", e);
        }
    }

    private void handleNearbyMessage(String endpointId, String jsonStr) {
        try {
            JSONObject msg = new JSONObject(jsonStr);
            String type = msg.optString("type");

            if ("HELLO".equals(type)) {
                handleHello(endpointId, msg);
            } else if ("SYNC_REQUEST".equals(type)) {
                handleSyncRequest(endpointId, msg);
            } else if ("SYNC_DATA".equals(type)) {
                handleSyncData(msg);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing nearby message", e);
        }
    }

    private void handleHello(String endpointId, JSONObject msg) {
        try {
            String remoteDeviceId = msg.getString("deviceId");
            if (remoteDeviceId.equals(deviceId)) return;

            String remoteName = msg.optString("deviceName", null);
            if (remoteName != null && !remoteName.trim().isEmpty()) {
                discoveredEndpoints.put(endpointId, remoteName.trim());
                connectedEndpoints.put(endpointId, remoteName.trim());
                db.updateMemberNameForDevice(remoteDeviceId, remoteName.trim());
                mainHandler.post(() -> listener.onPeerConnected(endpointId, remoteName.trim()));
            }

            JSONArray remoteGroups = msg.getJSONArray("groups");
            JSONArray myGroups = db.listGroups(deviceId);
            Set<String> myGroupSet = new HashSet<>();
            for (int i = 0; i < myGroups.length(); i++) {
                myGroupSet.add(myGroups.getJSONObject(i).getString("id"));
            }

            List<String> shared = new ArrayList<>();
            for (int i = 0; i < remoteGroups.length(); i++) {
                String gid = remoteGroups.getString(i);
                if (myGroupSet.contains(gid)) {
                    shared.add(gid);
                }
            }

            if (shared.isEmpty()) return;

            // 1. Immediately push our local data for shared groups to remote peer
            sendSyncDataForGroups(endpointId, shared);

            // 2. Request remote peer's latest data for shared groups
            JSONObject req = new JSONObject();
            req.put("type", "SYNC_REQUEST");
            req.put("deviceId", deviceId);
            JSONArray reqGroups = new JSONArray();
            JSONObject checkpoints = new JSONObject();

            for (String gid : shared) {
                reqGroups.put(gid);
                checkpoints.put(gid, db.getLastSeenHlc(gid, remoteDeviceId));
            }
            req.put("groups", reqGroups);
            req.put("checkpoints", checkpoints);

            sendPayload(endpointId, req);
        } catch (Exception e) {
            Log.e(TAG, "Error handling HELLO", e);
        }
    }

    private void sendSyncDataForGroups(String endpointId, List<String> groupIds) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("type", "SYNC_DATA");
            payload.put("deviceId", deviceId);
            JSONObject groupsObj = new JSONObject();

            for (String gid : groupIds) {
                JSONObject gData = new JSONObject();
                gData.put("info", db.getGroup(gid));
                gData.put("members", db.listMembers(gid));
                gData.put("expenses", db.listExpenses(gid, true));
                groupsObj.put(gid, gData);
            }
            payload.put("groups", groupsObj);
            sendPayload(endpointId, payload);
        } catch (Exception e) {
            Log.e(TAG, "Error sending sync data for groups", e);
        }
    }

    private void handleSyncRequest(String endpointId, JSONObject msg) {
        try {
            JSONArray reqGroups = msg.getJSONArray("groups");
            JSONObject checkpoints = msg.getJSONObject("checkpoints");

            JSONObject payload = new JSONObject();
            payload.put("type", "SYNC_DATA");
            payload.put("deviceId", deviceId);
            JSONObject groupsObj = new JSONObject();

            for (int i = 0; i < reqGroups.length(); i++) {
                String gid = reqGroups.getString(i);
                String since = checkpoints.optString(gid, "000000000000000-0000-0000");

                JSONObject gData = new JSONObject();
                gData.put("info", db.getGroup(gid));
                gData.put("members", db.listMembers(gid));

                JSONArray allExpenses = db.listExpenses(gid, true);
                JSONArray filtered = new JSONArray();
                for (int j = 0; j < allExpenses.length(); j++) {
                    JSONObject exp = allExpenses.getJSONObject(j);
                    if (HlcClock.compare(exp.getString("updated_hlc"), since) > 0) {
                        filtered.put(exp);
                    }
                }
                gData.put("expenses", filtered);
                groupsObj.put(gid, gData);
            }
            payload.put("groups", groupsObj);
            sendPayload(endpointId, payload);
        } catch (Exception e) {
            Log.e(TAG, "Error handling SYNC_REQUEST", e);
        }
    }

    private void handleSyncData(JSONObject msg) {
        try {
            String remoteDeviceId = msg.getString("deviceId");
            JSONObject groupsObj = msg.getJSONObject("groups");
            int totalMerged = 0;

            Iterator<String> keys = groupsObj.keys();
            while (keys.hasNext()) {
                String gid = keys.next();
                JSONObject gData = groupsObj.getJSONObject(gid);

                JSONObject info = gData.optJSONObject("info");
                if (info != null) {
                    db.upsertGroupInfo(gid, info.getString("name"), info.getString("created_by"), info.getString("created_at"));
                }

                JSONArray members = gData.getJSONArray("members");
                for (int i = 0; i < members.length(); i++) {
                    JSONObject m = members.getJSONObject(i);
                    db.upsertMember(m.optString("id", null), gid, m.getString("name"), m.getString("device_id"), m.optString("joined_at", null));
                }

                JSONArray expenses = gData.getJSONArray("expenses");
                for (int i = 0; i < expenses.length(); i++) {
                    totalMerged += db.mergeExpense(hlcClock, gid, expenses.getJSONObject(i));
                }

                db.updateCheckpoint(gid, remoteDeviceId, hlcClock.tick());
            }

            final int count = totalMerged;
            mainHandler.post(() -> listener.onDataMerged(count));
        } catch (Exception e) {
            Log.e(TAG, "Error handling SYNC_DATA", e);
        }
    }
}
