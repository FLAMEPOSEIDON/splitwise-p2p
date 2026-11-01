package com.splitwise.p2p;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

public class P2pSyncService {
    public static final String SERVICE_TYPE = "_splitwisep2p._tcp.";
    public static final int SYNC_PORT = 47811;

    public interface OnSyncListener {
        void onPeerFound(String name, String host, int port);
        void onPeerLost(String name);
        void onDataMerged(int count);
    }

    private final Context context;
    private final String deviceId;
    private final String deviceName;
    private final HlcClock hlcClock;
    private final DatabaseHelper db;
    private final OnSyncListener listener;
    private final Handler mainHandler;

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;

    private ServerSocket serverSocket;
    private final ExecutorService threadPool = Executors.newCachedThreadPool();
    private final Set<String> connectedPeers = Collections.synchronizedSet(new HashSet<>());
    private final Map<String, PeerInfo> discoveredPeers = new ConcurrentHashMap<>();

    private volatile boolean running = false;

    public static class PeerInfo {
        public String name;
        public String host;
        public int port;
        public String deviceId;

        public PeerInfo(String name, String host, int port, String deviceId) {
            this.name = name;
            this.host = host;
            this.port = port;
            this.deviceId = deviceId;
        }
    }

    public P2pSyncService(Context context, String deviceId, String deviceName, HlcClock clock, DatabaseHelper db, OnSyncListener listener) {
        this.context = context;
        this.deviceId = deviceId;
        this.deviceName = deviceName;
        this.hlcClock = clock;
        this.db = db;
        this.listener = listener;
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public void start() {
        running = true;
        startServer();
        startNsd();
    }

    public void stop() {
        running = false;
        stopNsd();
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (Exception ignored) {}
        threadPool.shutdownNow();
    }

    public List<PeerInfo> getDiscoveredPeers() {
        return new ArrayList<>(discoveredPeers.values());
    }

    // --- 1. TCP Server for Mesh Sync ---

    private void startServer() {
        threadPool.execute(() -> {
            try {
                serverSocket = new ServerSocket(SYNC_PORT);
                while (running) {
                    Socket socket = serverSocket.accept();
                    threadPool.execute(() -> handleConnection(socket, false));
                }
            } catch (Exception e) {
                if (running) {
                    // Port might be in use, retry after delay
                    try { Thread.sleep(3000); } catch (Exception ignored) {}
                    if (running) startServer();
                }
            }
        });
    }

    public void connectToPeer(String host, int port) {
        threadPool.execute(() -> {
            try {
                Socket socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 5000);
                handleConnection(socket, true);
            } catch (Exception ignored) {}
        });
    }

    private void handleConnection(Socket socket, boolean isInitiator) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            PrintWriter writer = new PrintWriter(socket.getOutputStream(), true);

            // Send initial HELLO
            sendHello(writer);

            String line;
            while (running && (line = reader.readLine()) != null) {
                try {
                    JSONObject msg = new JSONObject(line);
                    String type = msg.getString("type");

                    if ("HELLO".equals(type)) {
                        handleHello(writer, msg, isInitiator);
                    } else if ("SYNC_REQUEST".equals(type)) {
                        handleSyncRequest(writer, msg);
                    } else if ("SYNC_DATA".equals(type)) {
                        handleSyncData(msg);
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            try { socket.close(); } catch (Exception ignored) {}
        }
    }

    private void sendHello(PrintWriter writer) {
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
            writer.println(hello.toString());
        } catch (Exception ignored) {}
    }

    private void handleHello(PrintWriter writer, JSONObject msg, boolean isInitiator) {
        try {
            String remoteDeviceId = msg.getString("deviceId");
            if (remoteDeviceId.equals(deviceId)) return;

            connectedPeers.add(remoteDeviceId);

            JSONArray remoteGroups = msg.getJSONArray("groups");
            JSONArray myGroups = db.listGroups(deviceId);
            Set<String> myGroupSet = new HashSet<>();
            for (int i = 0; i < myGroups.length(); i++) {
                myGroupSet.add(myGroups.getJSONObject(i).getString("id"));
            }

            List<String> shared = new ArrayList<>();
            for (int i = 0; i < remoteGroups.length(); i++) {
                String gid = remoteGroups.getString(i);
                if (myGroupSet.contains(gid)) shared.add(gid);
            }

            if (!isInitiator) {
                sendHello(writer);
            }

            if (shared.isEmpty()) return;

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

            writer.println(req.toString());
        } catch (Exception ignored) {}
    }

    private void handleSyncRequest(PrintWriter writer, JSONObject msg) {
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
            writer.println(payload.toString());
        } catch (Exception ignored) {}
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
                    JSONObject local = db.getGroup(gid);
                    if (local != null && "(syncing...)".equals(local.optString("name"))) {
                        db.updateGroupInfo(gid, info.getString("name"), info.getString("created_by"), info.getString("created_at"));
                    }
                }

                JSONArray members = gData.getJSONArray("members");
                for (int i = 0; i < members.length(); i++) {
                    JSONObject m = members.getJSONObject(i);
                    db.addMember(gid, m.getString("name"), m.getString("device_id"));
                }

                JSONArray expenses = gData.getJSONArray("expenses");
                for (int i = 0; i < expenses.length(); i++) {
                    totalMerged += db.mergeExpense(hlcClock, gid, expenses.getJSONObject(i));
                }

                db.updateCheckpoint(gid, remoteDeviceId, hlcClock.tick());
            }

            final int count = totalMerged;
            mainHandler.post(() -> listener.onDataMerged(count));
        } catch (Exception ignored) {}
    }

    // --- 2. Android Network Service Discovery (mDNS) ---

    private void startNsd() {
        nsdManager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        if (nsdManager == null) return;

        // Register local service
        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        serviceInfo.setServiceName("Splitwise-" + deviceName.replaceAll("[^a-zA-Z0-9]", "") + "-" + deviceId);
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(SYNC_PORT);

        registrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo info) {}
            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {}
            @Override
            public void onServiceUnregistered(NsdServiceInfo info) {}
            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {}
        };

        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener);
        } catch (Exception ignored) {}

        // Start discovery for peers
        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String regType) {}

            @Override
            public void onServiceFound(NsdServiceInfo service) {
                if (service.getServiceType().equals(SERVICE_TYPE)) {
                    // Ignore self service
                    if (service.getServiceName().contains(deviceId)) return;

                    try {
                        nsdManager.resolveService(service, new NsdManager.ResolveListener() {
                            @Override
                            public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {}

                            @Override
                            public void onServiceResolved(NsdServiceInfo serviceInfo) {
                                String host = serviceInfo.getHost().getHostAddress();
                                int port = serviceInfo.getPort();
                                String name = serviceInfo.getServiceName();

                                discoveredPeers.put(name, new PeerInfo(name, host, port, name));
                                mainHandler.post(() -> listener.onPeerFound(name, host, port));

                                // Automatically connect and sync with peer!
                                connectToPeer(host, port);
                            }
                        });
                    } catch (Exception ignored) {}
                }
            }

            @Override
            public void onServiceLost(NsdServiceInfo service) {
                discoveredPeers.remove(service.getServiceName());
                mainHandler.post(() -> listener.onPeerLost(service.getServiceName()));
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {}

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
        };

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (Exception ignored) {}
    }

    private void stopNsd() {
        if (nsdManager != null) {
            try {
                if (registrationListener != null) nsdManager.unregisterService(registrationListener);
            } catch (Exception ignored) {}
            try {
                if (discoveryListener != null) nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception ignored) {}
        }
    }
}
