package com.splitwise.p2p;

import java.util.Locale;

/**
 * Hybrid Logical Clock (HLC)
 * Produces timestamps that are totally ordered across multiple devices
 * without relying on synchronized system clocks.
 *
 * Format: "<physical_ms_padded>-<logical_counter_padded>-<deviceId>"
 */
public class HlcClock {
    private final String deviceId;
    private long lastPhysical;
    private int counter;

    public HlcClock(String deviceId) {
        this.deviceId = deviceId;
        this.lastPhysical = 0;
        this.counter = 0;
    }

    public synchronized String tick() {
        long now = System.currentTimeMillis();
        if (now > lastPhysical) {
            lastPhysical = now;
            counter = 0;
        } else {
            counter++;
        }
        return format();
    }

    public synchronized String update(String remoteTsString) {
        if (remoteTsString == null || !remoteTsString.contains("-")) {
            return tick();
        }

        String[] parts = remoteTsString.split("-");
        long remotePhysical = 0;
        int remoteCounter = 0;
        try {
            remotePhysical = Long.parseLong(parts[0]);
            remoteCounter = Integer.parseInt(parts[1]);
        } catch (Exception ignored) {}

        long now = System.currentTimeMillis();
        long maxPhysical = Math.max(lastPhysical, Math.max(remotePhysical, now));

        if (maxPhysical == lastPhysical && maxPhysical == remotePhysical) {
            counter = Math.max(counter, remoteCounter) + 1;
        } else if (maxPhysical == lastPhysical) {
            counter++;
        } else if (maxPhysical == remotePhysical) {
            counter = remoteCounter + 1;
        } else {
            counter = 0;
        }

        lastPhysical = maxPhysical;
        return format();
    }

    private String format() {
        return String.format(Locale.US, "%015d-%04d-%s", lastPhysical, counter, deviceId);
    }

    public static int compare(String a, String b) {
        if (a == null && b == null) return 0;
        if (a == null) return -1;
        if (b == null) return 1;
        return a.compareTo(b);
    }
}
