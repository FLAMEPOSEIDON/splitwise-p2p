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
    public static final String SERVICE_TYPE = "_splitwisep2p._tcp";
    public static final int SYNC_PORT = 47811;
    public static final int UDP_BEACON_PORT = 47812;

    public interface OnSyncListener {
        void onPeerFound(String name, String host, int port);
        void onPeerLost(String name);
        void onDataMerged(int count);
    }

    private final Context context;
    private final String deviceId;
    private String deviceName;
    private final HlcClock hlcClock;
    private final DatabaseHelper db;
    private final OnSyncListener listener;
    private final Handler mainHandler;

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;

    private ServerSocket serverSocket;
    private DatagramSocket udpSocket;
    private final ExecutorService threadPool = Executors.newCachedThreadPool();
    private final Set<String> connectedPeers = Collections.synchronizedSet(new HashSet<>());
    private final Set<String> activePeerHosts = Collections.synchronizedSet(new HashSet<>());
    private final Map<String, PeerInfo> discoveredPeers = new ConcurrentHashMap<>();
    private final Set<PrintWriter> activeWriters = Collections.synchronizedSet(new HashSet<>());
    private final Queue<NsdServiceInfo> resolveQueue = new ConcurrentLinkedQueue<>();
    private final java.util.concurrent.atomic.AtomicBoolean isResolving = new java.util.concurrent.atomic.AtomicBoolean(false);

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
        startUdpBeacon();
        startHeartbeat();
    }

    public void stop() {
        running = false;
        stopNsd();
        try {
            if (udpSocket != null) udpSocket.close();
        } catch (Exception ignored) {}
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (Exception ignored) {}
        threadPool.shutdownNow();
    }

    private void startHeartbeat() {
        threadPool.execute(() -> {
            while (running) {
                try {
                    Thread.sleep(5000);
                    if (running) {
                        broadcastSync();
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    private void startUdpBeacon() {
        // 1. Broadcast presence every 3s on local subnet for sub-second discovery
        threadPool.execute(() -> {
            DatagramSocket sender = null;
            try {
                sender = new DatagramSocket();
                sender.setBroadcast(true);
                while (running) {
                    try {
                        String payload = "SW_BEACON:" + deviceId + ":" + deviceName + ":" + SYNC_PORT;
                        byte[] data = payload.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        DatagramPacket packet = new DatagramPacket(data, data.length, 
                                InetAddress.getByName("255.255.255.255"), UDP_BEACON_PORT);
                        sender.send(packet);
                    } catch (Exception ignored) {}
                    Thread.sleep(3000);
                }
            } catch (Exception ignored) {
            } finally {
                if (sender != null) {
                    try { sender.close(); } catch (Exception ignored) {}
                }
            }
        });

        // 2. Listen for UDP beacons on port 47812
        threadPool.execute(() -> {
            try {
                udpSocket = new DatagramSocket(UDP_BEACON_PORT);
                udpSocket.setBroadcast(true);
                byte[] buffer = new byte[1024];
                while (running) {
                    try {
                        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                        udpSocket.receive(packet);
                        String str = new String(packet.getData(), 0, packet.getLength(), java.nio.charset.StandardCharsets.UTF_8);
                        if (str.startsWith("SW_BEACON:")) {
                            String[] parts = str.split(":", 4);
                            if (parts.length >= 4) {
                                String remoteDevId = parts[1];
                                String remoteDevName = parts[2];
                                int remotePort = Integer.parseInt(parts[3]);
                                String remoteHost = packet.getAddress().getHostAddress();

                                if (remoteDevId != null && !remoteDevId.equals(deviceId)) {
                                    if (!discoveredPeers.containsKey(remoteDevName)) {
                                        discoveredPeers.put(remoteDevName, new PeerInfo(remoteDevName, remoteHost, remotePort, remoteDevId));
                                        mainHandler.post(() -> listener.onPeerFound(remoteDevName, remoteHost, remotePort));
                                    }
                                    connectToPeer(remoteHost, remotePort);
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                }
            } catch (Exception ignored) {
            } finally {
                if (udpSocket != null) {
                    try { udpSocket.close(); } catch (Exception ignored) {}
                }
            }
        });
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
                    threadPool.execute(() -> handleConnection(socket, false, null));
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
        String key = host + ":" + port;
        if (!activePeerHosts.add(key)) {
            return;
        }
        threadPool.execute(() -> {
            try {
                Socket socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 5000);
                handleConnection(socket, true, key);
            } catch (Exception e) {
                activePeerHosts.remove(key);
            }
        });
    }

    public void broadcastSync() {
        threadPool.execute(() -> {
            synchronized (activeWriters) {
                for (PrintWriter w : activeWriters) {
                    try {
                        sendAllSyncData(w);
                        sendHello(w);
                    } catch (Exception ignored) {}
                }
            }
            for (PeerInfo p : discoveredPeers.values()) {
                connectToPeer(p.host, p.port);
            }
        });
    }

    private void sendAllSyncData(PrintWriter writer) {
        try {
            JSONArray myGroups = db.listGroups(deviceId);
            List<String> gids = new ArrayList<>();
            for (int i = 0; i < myGroups.length(); i++) {
                gids.add(myGroups.getJSONObject(i).getString("id"));
            }
            if (!gids.isEmpty()) {
                sendSyncDataForGroups(writer, gids);
            }
        } catch (Exception ignored) {}
    }

    public void broadcastChatMessage(String groupId, JSONObject msg) {
        threadPool.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("type", "INSTANT_CHAT");
                payload.put("deviceId", deviceId);
                payload.put("groupId", groupId);
                payload.put("message", msg);
                String line = payload.toString();
                synchronized (activeWriters) {
                    for (PrintWriter w : activeWriters) {
                        try {
                            w.println(line);
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    public synchronized void updateDeviceName(String newName) {
        if (newName == null || newName.trim().isEmpty()) return;
        this.deviceName = newName.trim();
        if (running) {
            stopNsd();
            startNsd();
            broadcastSync();
        }
    }

    private void handleConnection(Socket socket, boolean isInitiator, String hostKey) {
        PrintWriter writer = null;
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
            writer = new PrintWriter(socket.getOutputStream(), true);
            activeWriters.add(writer);

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
                    } else if ("GROUP_INVITE".equals(type)) {
                        handleGroupInvite(msg);
                    } else if ("INSTANT_CHAT".equals(type)) {
                        handleInstantChat(msg);
                    }
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            if (hostKey != null) activePeerHosts.remove(hostKey);
            if (writer != null) activeWriters.remove(writer);
            try { socket.close(); } catch (Exception ignored) {}
        }
    }

    private void handleInstantChat(JSONObject msg) {
        try {
            String remoteDeviceId = msg.optString("deviceId", "");
            if (remoteDeviceId.equals(deviceId)) return;
            String gid = msg.getString("groupId");
            JSONObject chatMsg = msg.getJSONObject("message");
            JSONArray arr = new JSONArray();
            arr.put(chatMsg);
            int count = db.mergeMessagesBatch(hlcClock, gid, arr);
            if (count > 0) {
                mainHandler.post(() -> listener.onDataMerged(count));
            }
        } catch (Exception ignored) {}
    }

    private void sendHello(PrintWriter writer) {
        try {
            JSONArray groups = db.listGroups(deviceId);
            JSONArray groupIds = new JSONArray();
            JSONObject groupMeta = new JSONObject();
            for (int i = 0; i < groups.length(); i++) {
                JSONObject g = groups.getJSONObject(i);
                String gid = g.getString("id");
                groupIds.put(gid);
                String gName = g.optString("name", "");
                if (!gName.isEmpty() && !gName.equalsIgnoreCase("(syncing...)")) {
                    JSONObject meta = new JSONObject();
                    meta.put("name", gName);
                    meta.put("created_by", g.optString("created_by", ""));
                    meta.put("created_at", g.optString("created_at", ""));
                    groupMeta.put(gid, meta);
                }
            }

            JSONObject hello = new JSONObject();
            hello.put("type", "HELLO");
            hello.put("deviceId", deviceId);
            hello.put("deviceName", deviceName);
            hello.put("groups", groupIds);
            hello.put("groupMeta", groupMeta);
            writer.println(hello.toString());
        } catch (Exception ignored) {}
    }

    private void handleHello(PrintWriter writer, JSONObject msg, boolean isInitiator) {
        try {
            String remoteDeviceId = msg.getString("deviceId");
            if (remoteDeviceId.equals(deviceId)) return;

            connectedPeers.add(remoteDeviceId);

            String remoteName = msg.optString("deviceName", null);
            if (remoteName != null && !remoteName.trim().isEmpty()) {
                db.updateMemberNameForDevice(remoteDeviceId, remoteName.trim());
            }
            for (PeerInfo p : discoveredPeers.values()) {
                if (p.deviceId == null || p.deviceId.equals(remoteDeviceId) || (p.name != null && p.name.contains(remoteDeviceId))) {
                    p.deviceId = remoteDeviceId;
                    if (remoteName != null && !remoteName.trim().isEmpty()) {
                        p.name = remoteName.trim();
                    }
                }
            }

            JSONObject groupMeta = msg.optJSONObject("groupMeta");
            if (groupMeta != null) {
                Iterator<String> gKeys = groupMeta.keys();
                boolean anyUpdated = false;
                while (gKeys.hasNext()) {
                    String gid = gKeys.next();
                    JSONObject meta = groupMeta.optJSONObject(gid);
                    if (meta != null) {
                        String gName = meta.optString("name", "");
                        if (!gName.isEmpty() && !gName.equalsIgnoreCase("(syncing...)")) {
                            db.upsertGroupInfo(gid, gName, meta.optString("created_by", ""), meta.optString("created_at", ""));
                            anyUpdated = true;
                        }
                    }
                }
                if (anyUpdated) {
                    mainHandler.post(() -> listener.onDataMerged(1));
                }
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
                if (myGroupSet.contains(gid)) shared.add(gid);
            }

            if (!isInitiator) {
                sendHello(writer);
            }

            // Sync direct 1-on-1 messages with this peer regardless of group membership
            try {
                String dmChatId = DatabaseHelper.getDirectChatId(deviceId, remoteDeviceId);
                JSONObject dmPayload = new JSONObject();
                dmPayload.put("type", "SYNC_DATA");
                dmPayload.put("deviceId", deviceId);
                JSONObject groupsObj = new JSONObject();
                JSONObject dmData = new JSONObject();
                dmData.put("messages", db.listMessages(dmChatId));
                groupsObj.put(dmChatId, dmData);
                dmPayload.put("groups", groupsObj);
                writer.println(dmPayload.toString());
            } catch (Exception ignored) {}

            if (shared.isEmpty()) return;

            // Push our data for shared groups immediately
            sendSyncDataForGroups(writer, shared);

            // Request remote's changes
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

    private void sendSyncDataForGroups(PrintWriter writer, List<String> groupIds) {
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
                gData.put("messages", db.listMessages(gid));
                groupsObj.put(gid, gData);
            }
            payload.put("groups", groupsObj);
            writer.println(payload.toString());
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
                gData.put("messages", db.listMessages(gid));
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
                    db.upsertGroupInfo(gid, info.getString("name"), info.getString("created_by"), info.getString("created_at"));
                }

                JSONArray members = gData.getJSONArray("members");
                for (int i = 0; i < members.length(); i++) {
                    JSONObject m = members.getJSONObject(i);
                    db.upsertMember(m.optString("id", null), gid, m.getString("name"), m.getString("device_id"), m.optString("joined_at", null));
                }

                JSONArray expenses = gData.optJSONArray("expenses");
                if (expenses != null && expenses.length() > 0) {
                    totalMerged += db.mergeExpensesBatch(hlcClock, gid, expenses);
                }

                JSONArray messages = gData.optJSONArray("messages");
                if (messages != null && messages.length() > 0) {
                    totalMerged += db.mergeMessagesBatch(hlcClock, gid, messages);
                }

                db.updateCheckpoint(gid, remoteDeviceId, hlcClock.tick());
            }

            final int count = totalMerged;
            mainHandler.post(() -> listener.onDataMerged(count));
        } catch (Exception ignored) {}
    }

    private void handleGroupInvite(JSONObject msg) {
        try {
            String targetDeviceId = msg.optString("targetDeviceId", "");
            if (!targetDeviceId.isEmpty() && !targetDeviceId.equals(deviceId)) {
                return;
            }
            String gid = msg.getString("groupId");
            String gName = msg.getString("groupName");
            String invName = msg.getString("inviterName");
            String invDevId = msg.getString("inviterDeviceId");
            db.addPendingInvite(gid, gName, invName, invDevId);
            mainHandler.post(() -> listener.onDataMerged(1));
        } catch (Exception ignored) {}
    }

    public void sendGroupInvite(String groupId, String groupName, String targetDeviceId) {
        threadPool.execute(() -> {
            try {
                JSONObject inv = new JSONObject();
                inv.put("type", "GROUP_INVITE");
                inv.put("groupId", groupId);
                inv.put("groupName", groupName);
                inv.put("inviterName", deviceName);
                inv.put("inviterDeviceId", deviceId);
                inv.put("targetDeviceId", targetDeviceId != null ? targetDeviceId : "");
                String jsonStr = inv.toString();
                synchronized (activeWriters) {
                    for (PrintWriter w : activeWriters) {
                        try {
                            w.println(jsonStr);
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}
        });
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
                String type = service.getServiceType();
                if (type != null && type.contains("splitwisep2p")) {
                    // Ignore self service
                    if (service.getServiceName() != null && service.getServiceName().contains(deviceId)) return;

                    resolveQueue.add(service);
                    processNextResolve();
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

    private synchronized void processNextResolve() {
        if (!running || isResolving.get() || resolveQueue.isEmpty() || nsdManager == null) return;
        final NsdServiceInfo nextService = resolveQueue.poll();
        if (nextService == null) return;

        isResolving.set(true);
        try {
            nsdManager.resolveService(nextService, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                    isResolving.set(false);
                    processNextResolve();
                }

                @Override
                public void onServiceResolved(NsdServiceInfo serviceInfo) {
                    try {
                        String host = serviceInfo.getHost().getHostAddress();
                        int port = serviceInfo.getPort();
                        String name = serviceInfo.getServiceName();

                        discoveredPeers.put(name, new PeerInfo(name, host, port, name));
                        mainHandler.post(() -> listener.onPeerFound(name, host, port));

                        // Automatically connect and sync with peer!
                        connectToPeer(host, port);
                    } finally {
                        isResolving.set(false);
                        processNextResolve();
                    }
                }
            });
        } catch (Exception e) {
            isResolving.set(false);
            processNextResolve();
        }
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
