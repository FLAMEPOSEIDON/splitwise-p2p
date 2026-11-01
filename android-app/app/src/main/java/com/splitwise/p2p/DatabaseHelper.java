package com.splitwise.p2p;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.*;

public class DatabaseHelper extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "splitwise_p2p.db";
    private static final int DATABASE_VERSION = 1;

    public DatabaseHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS groups (" +
                "id TEXT PRIMARY KEY, " +
                "name TEXT NOT NULL, " +
                "created_by TEXT NOT NULL, " +
                "created_at TEXT NOT NULL);");

        db.execSQL("CREATE TABLE IF NOT EXISTS members (" +
                "id TEXT PRIMARY KEY, " +
                "group_id TEXT NOT NULL, " +
                "name TEXT NOT NULL, " +
                "device_id TEXT NOT NULL, " +
                "joined_at TEXT NOT NULL, " +
                "UNIQUE (group_id, device_id));");

        db.execSQL("CREATE TABLE IF NOT EXISTS expenses (" +
                "id TEXT PRIMARY KEY, " +
                "group_id TEXT NOT NULL, " +
                "description TEXT NOT NULL, " +
                "amount REAL NOT NULL, " +
                "paid_by TEXT NOT NULL, " +
                "split_between TEXT NOT NULL, " +
                "created_by_device TEXT NOT NULL, " +
                "hlc TEXT NOT NULL, " +
                "deleted INTEGER NOT NULL DEFAULT 0, " +
                "updated_hlc TEXT NOT NULL);");

        db.execSQL("CREATE TABLE IF NOT EXISTS sync_state (" +
                "group_id TEXT NOT NULL, " +
                "peer_device_id TEXT NOT NULL, " +
                "last_seen_hlc TEXT NOT NULL, " +
                "PRIMARY KEY (group_id, peer_device_id));");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Upgrade migrations if needed
    }

    private String nowIso() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    // --- Groups ---

    public JSONObject createGroup(String name, String deviceId, String memberName) {
        SQLiteDatabase db = getWritableDatabase();
        String groupId = UUID.randomUUID().toString();
        String now = nowIso();

        ContentValues cv = new ContentValues();
        cv.put("id", groupId);
        cv.put("name", name);
        cv.put("created_by", deviceId);
        cv.put("created_at", now);
        db.insert("groups", null, cv);

        addMember(groupId, memberName, deviceId);

        try {
            JSONObject obj = new JSONObject();
            obj.put("id", groupId);
            obj.put("name", name);
            obj.put("created_by", deviceId);
            obj.put("created_at", now);
            return obj;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    public void addMember(String groupId, String name, String deviceId) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("id", UUID.randomUUID().toString());
        cv.put("group_id", groupId);
        cv.put("name", name);
        cv.put("device_id", deviceId);
        cv.put("joined_at", nowIso());
        db.insertWithOnConflict("members", null, cv, SQLiteDatabase.CONFLICT_IGNORE);
    }

    public void joinGroupStub(String groupId, String deviceId, String yourName) {
        SQLiteDatabase db = getWritableDatabase();
        Cursor c = db.rawQuery("SELECT id FROM groups WHERE id = ?", new String[]{groupId});
        boolean exists = c.moveToFirst();
        c.close();

        if (!exists) {
            ContentValues cv = new ContentValues();
            cv.put("id", groupId);
            cv.put("name", "(syncing...)");
            cv.put("created_by", deviceId);
            cv.put("created_at", nowIso());
            db.insert("groups", null, cv);
        }
        addMember(groupId, yourName, deviceId);
    }

    public void updateGroupInfo(String groupId, String name, String createdBy, String createdAt) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("name", name);
        cv.put("created_by", createdBy);
        cv.put("created_at", createdAt);
        db.update("groups", cv, "id = ?", new String[]{groupId});
    }

    public JSONArray listGroups(String myDeviceId) {
        SQLiteDatabase db = getReadableDatabase();
        JSONArray arr = new JSONArray();
        Cursor c = db.rawQuery("SELECT * FROM groups ORDER BY created_at DESC", null);
        try {
            while (c.moveToNext()) {
                JSONObject g = new JSONObject();
                String gid = c.getString(c.getColumnIndexOrThrow("id"));
                g.put("id", gid);
                g.put("name", c.getString(c.getColumnIndexOrThrow("name")));
                g.put("created_by", c.getString(c.getColumnIndexOrThrow("created_by")));
                g.put("created_at", c.getString(c.getColumnIndexOrThrow("created_at")));

                JSONArray members = listMembers(gid);
                g.put("members", members);

                JSONArray expenses = listExpenses(gid, false);
                double total = 0.0;
                for (int i = 0; i < expenses.length(); i++) {
                    total += expenses.getJSONObject(i).getDouble("amount");
                }
                g.put("expenseCount", expenses.length());
                g.put("totalAmount", Math.round(total * 100.0) / 100.0);

                Map<String, Double> balances = computeBalances(gid);
                JSONObject bObj = new JSONObject();
                for (Map.Entry<String, Double> entry : balances.entrySet()) {
                    bObj.put(entry.getKey(), entry.getValue());
                }
                g.put("balances", bObj);

                arr.put(g);
            }
        } catch (Exception ignored) {
        } finally {
            c.close();
        }
        return arr;
    }

    public JSONObject getGroup(String groupId) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT * FROM groups WHERE id = ?", new String[]{groupId});
        JSONObject obj = null;
        try {
            if (c.moveToFirst()) {
                obj = new JSONObject();
                obj.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                obj.put("name", c.getString(c.getColumnIndexOrThrow("name")));
                obj.put("created_by", c.getString(c.getColumnIndexOrThrow("created_by")));
                obj.put("created_at", c.getString(c.getColumnIndexOrThrow("created_at")));
            }
        } catch (Exception ignored) {
        } finally {
            c.close();
        }
        return obj;
    }

    public JSONArray listMembers(String groupId) {
        SQLiteDatabase db = getReadableDatabase();
        JSONArray arr = new JSONArray();
        Cursor c = db.rawQuery("SELECT * FROM members WHERE group_id = ? ORDER BY joined_at ASC", new String[]{groupId});
        try {
            while (c.moveToNext()) {
                JSONObject m = new JSONObject();
                m.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                m.put("group_id", c.getString(c.getColumnIndexOrThrow("group_id")));
                m.put("name", c.getString(c.getColumnIndexOrThrow("name")));
                m.put("device_id", c.getString(c.getColumnIndexOrThrow("device_id")));
                m.put("joined_at", c.getString(c.getColumnIndexOrThrow("joined_at")));
                arr.put(m);
            }
        } catch (Exception ignored) {
        } finally {
            c.close();
        }
        return arr;
    }

    // --- Expenses ---

    public JSONObject addExpense(HlcClock clock, String groupId, String desc, double amount, String paidBy, JSONArray splitBetween, String deviceId) {
        SQLiteDatabase db = getWritableDatabase();
        String id = UUID.randomUUID().toString();
        String hlc = clock.tick();

        ContentValues cv = new ContentValues();
        cv.put("id", id);
        cv.put("group_id", groupId);
        cv.put("description", desc);
        cv.put("amount", amount);
        cv.put("paid_by", paidBy);
        cv.put("split_between", splitBetween.toString());
        cv.put("created_by_device", deviceId);
        cv.put("hlc", hlc);
        cv.put("deleted", 0);
        cv.put("updated_hlc", hlc);
        db.insert("expenses", null, cv);

        try {
            JSONObject exp = new JSONObject();
            exp.put("id", id);
            exp.put("group_id", groupId);
            exp.put("description", desc);
            exp.put("amount", amount);
            exp.put("paid_by", paidBy);
            exp.put("split_between", splitBetween);
            exp.put("created_by_device", deviceId);
            exp.put("hlc", hlc);
            return exp;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    public void deleteExpense(HlcClock clock, String expenseId) {
        SQLiteDatabase db = getWritableDatabase();
        String hlc = clock.tick();
        ContentValues cv = new ContentValues();
        cv.put("deleted", 1);
        cv.put("updated_hlc", hlc);
        db.update("expenses", cv, "id = ?", new String[]{expenseId});
    }

    public JSONArray listExpenses(String groupId, boolean includeDeleted) {
        SQLiteDatabase db = getReadableDatabase();
        JSONArray arr = new JSONArray();
        String q = includeDeleted
                ? "SELECT * FROM expenses WHERE group_id = ? ORDER BY hlc ASC"
                : "SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY hlc ASC";
        Cursor c = db.rawQuery(q, new String[]{groupId});
        try {
            while (c.moveToNext()) {
                JSONObject e = new JSONObject();
                e.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                e.put("group_id", c.getString(c.getColumnIndexOrThrow("group_id")));
                e.put("description", c.getString(c.getColumnIndexOrThrow("description")));
                e.put("amount", c.getDouble(c.getColumnIndexOrThrow("amount")));
                e.put("paid_by", c.getString(c.getColumnIndexOrThrow("paid_by")));
                e.put("split_between", new JSONArray(c.getString(c.getColumnIndexOrThrow("split_between"))));
                e.put("created_by_device", c.getString(c.getColumnIndexOrThrow("created_by_device")));
                e.put("hlc", c.getString(c.getColumnIndexOrThrow("hlc")));
                e.put("deleted", c.getInt(c.getColumnIndexOrThrow("deleted")) == 1);
                e.put("updated_hlc", c.getString(c.getColumnIndexOrThrow("updated_hlc")));
                arr.put(e);
            }
        } catch (Exception ignored) {
        } finally {
            c.close();
        }
        return arr;
    }

    // --- Balances & Settlements ---

    public Map<String, Double> computeBalances(String groupId) {
        Map<String, Double> balances = new HashMap<>();
        JSONArray members = listMembers(groupId);
        for (int i = 0; i < members.length(); i++) {
            try {
                balances.put(members.getJSONObject(i).getString("id"), 0.0);
            } catch (Exception ignored) {}
        }

        JSONArray expenses = listExpenses(groupId, false);
        for (int i = 0; i < expenses.length(); i++) {
            try {
                JSONObject exp = expenses.getJSONObject(i);
                double amount = exp.getDouble("amount");
                String paidBy = exp.getString("paid_by");
                JSONArray split = exp.getJSONArray("split_between");

                if (split.length() == 0) continue;
                double share = amount / split.length();

                balances.put(paidBy, balances.getOrDefault(paidBy, 0.0) + amount);
                for (int j = 0; j < split.length(); j++) {
                    String memId = split.getString(j);
                    balances.put(memId, balances.getOrDefault(memId, 0.0) - share);
                }
            } catch (Exception ignored) {}
        }

        for (Map.Entry<String, Double> entry : balances.entrySet()) {
            entry.setValue(Math.round(entry.getValue() * 100.0) / 100.0);
        }
        return balances;
    }

    public JSONArray simplifyDebts(String groupId) {
        Map<String, Double> balances = computeBalances(groupId);

        class Debtor { String id; double amount; Debtor(String id, double a) { this.id = id; this.amount = a; } }
        class Creditor { String id; double amount; Creditor(String id, double a) { this.id = id; this.amount = a; } }

        List<Creditor> creditors = new ArrayList<>();
        List<Debtor> debtors = new ArrayList<>();

        for (Map.Entry<String, Double> entry : balances.entrySet()) {
            if (entry.getValue() > 0.01) {
                creditors.add(new Creditor(entry.getKey(), entry.getValue()));
            } else if (entry.getValue() < -0.01) {
                debtors.add(new Debtor(entry.getKey(), -entry.getValue()));
            }
        }

        creditors.sort((a, b) -> Double.compare(b.amount, a.amount));
        debtors.sort((a, b) -> Double.compare(b.amount, a.amount));

        JSONArray settlements = new JSONArray();
        int i = 0, j = 0;
        while (i < debtors.size() && j < creditors.size()) {
            Debtor d = debtors.get(i);
            Creditor c = creditors.get(j);
            double settled = Math.min(d.amount, c.amount);

            try {
                JSONObject s = new JSONObject();
                s.put("from", d.id);
                s.put("to", c.id);
                s.put("amount", Math.round(settled * 100.0) / 100.0);
                settlements.put(s);
            } catch (Exception ignored) {}

            d.amount -= settled;
            c.amount -= settled;

            if (d.amount < 0.01) i++;
            if (c.amount < 0.01) j++;
        }
        return settlements;
    }

    public JSONObject settleDebt(HlcClock clock, String groupId, String payerId, String receiverId, double amount, String deviceId) {
        JSONArray split = new JSONArray();
        split.put(receiverId);
        return addExpense(clock, groupId, "Payment settlement", amount, payerId, split, deviceId);
    }

    // --- Sync Operations ---

    public String getLastSeenHlc(String groupId, String peerDeviceId) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT last_seen_hlc FROM sync_state WHERE group_id = ? AND peer_device_id = ?",
                new String[]{groupId, peerDeviceId});
        String res = "000000000000000-0000-0000";
        if (c.moveToFirst()) {
            res = c.getString(c.getColumnIndexOrThrow("last_seen_hlc"));
        }
        c.close();
        return res;
    }

    public void updateCheckpoint(String groupId, String peerDeviceId, String hlc) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("group_id", groupId);
        cv.put("peer_device_id", peerDeviceId);
        cv.put("last_seen_hlc", hlc);
        db.insertWithOnConflict("sync_state", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public int mergeExpense(HlcClock clock, String groupId, JSONObject incoming) {
        try {
            String expId = incoming.getString("id");
            String incomingHlc = incoming.getString("updated_hlc");

            clock.update(incomingHlc);

            SQLiteDatabase db = getWritableDatabase();
            Cursor c = db.rawQuery("SELECT * FROM expenses WHERE id = ?", new String[]{expId});
            boolean exists = c.moveToFirst();

            if (!exists) {
                c.close();
                ContentValues cv = new ContentValues();
                cv.put("id", expId);
                cv.put("group_id", groupId);
                cv.put("description", incoming.getString("description"));
                cv.put("amount", incoming.getDouble("amount"));
                cv.put("paid_by", incoming.getString("paid_by"));
                cv.put("split_between", incoming.get("split_between").toString());
                cv.put("created_by_device", incoming.getString("created_by_device"));
                cv.put("hlc", incoming.getString("hlc"));
                cv.put("deleted", incoming.optBoolean("deleted", false) ? 1 : 0);
                cv.put("updated_hlc", incomingHlc);
                db.insert("expenses", null, cv);
                return 1;
            }

            String localHlc = c.getString(c.getColumnIndexOrThrow("updated_hlc"));
            c.close();

            if (HlcClock.compare(incomingHlc, localHlc) > 0) {
                ContentValues cv = new ContentValues();
                cv.put("description", incoming.getString("description"));
                cv.put("amount", incoming.getDouble("amount"));
                cv.put("paid_by", incoming.getString("paid_by"));
                cv.put("split_between", incoming.get("split_between").toString());
                cv.put("deleted", incoming.optBoolean("deleted", false) ? 1 : 0);
                cv.put("updated_hlc", incomingHlc);
                db.update("expenses", cv, "id = ?", new String[]{expId});
                return 1;
            }
        } catch (Exception ignored) {}
        return 0;
    }
}
