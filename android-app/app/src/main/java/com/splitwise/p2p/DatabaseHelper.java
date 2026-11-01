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
    public static final String DATABASE_NAME = "splitwise_p2p.db";
    public static final int DATABASE_VERSION = 2;

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
                "category TEXT DEFAULT 'General', " +
                "date TEXT, " +
                "created_by_device TEXT NOT NULL, " +
                "hlc TEXT NOT NULL, " +
                "deleted INTEGER NOT NULL DEFAULT 0, " +
                "updated_hlc TEXT NOT NULL);");

        db.execSQL("CREATE TABLE IF NOT EXISTS sync_state (" +
                "group_id TEXT NOT NULL, " +
                "peer_device_id TEXT NOT NULL, " +
                "last_seen_hlc TEXT NOT NULL, " +
                "PRIMARY KEY (group_id, peer_device_id));");

        db.execSQL("CREATE TABLE IF NOT EXISTS activity_log (" +
                "id TEXT PRIMARY KEY, " +
                "group_id TEXT NOT NULL, " +
                "type TEXT NOT NULL, " +
                "icon TEXT, " +
                "title TEXT NOT NULL, " +
                "subtitle TEXT NOT NULL, " +
                "amount TEXT, " +
                "raw_amount REAL, " +
                "timestamp TEXT NOT NULL, " +
                "date TEXT);");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        try {
            db.execSQL("ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'General';");
        } catch (Exception ignored) {}
        try {
            db.execSQL("ALTER TABLE expenses ADD COLUMN date TEXT;");
        } catch (Exception ignored) {}
        ensureActivityTable(db);
    }

    public void ensureActivityTable(SQLiteDatabase db) {
        try {
            db.execSQL("CREATE TABLE IF NOT EXISTS activity_log (" +
                    "id TEXT PRIMARY KEY, " +
                    "group_id TEXT NOT NULL, " +
                    "type TEXT NOT NULL, " +
                    "icon TEXT, " +
                    "title TEXT NOT NULL, " +
                    "subtitle TEXT NOT NULL, " +
                    "amount TEXT, " +
                    "raw_amount REAL, " +
                    "timestamp TEXT NOT NULL, " +
                    "date TEXT);");
        } catch (Exception ignored) {}
    }

    public void logActivity(String groupId, String type, String icon, String title, String subtitle, String amountStr, double rawAmount, String timestamp, String date) {
        try {
            SQLiteDatabase db = getWritableDatabase();
            ensureActivityTable(db);
            ContentValues cv = new ContentValues();
            cv.put("id", "act_" + UUID.randomUUID().toString());
            cv.put("group_id", groupId != null ? groupId : "");
            cv.put("type", type != null ? type : "EXPENSE_ADDED");
            cv.put("icon", icon != null ? icon : "📜");
            cv.put("title", title != null ? title : "");
            cv.put("subtitle", subtitle != null ? subtitle : "");
            cv.put("amount", amountStr);
            cv.put("raw_amount", rawAmount);
            cv.put("timestamp", timestamp != null ? timestamp : nowIso());
            cv.put("date", date != null ? date : todayDate());
            db.insert("activity_log", null, cv);
        } catch (Exception ignored) {}
    }

    public String getMemberName(String memberId) {
        if (memberId == null) return "Someone";
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT name FROM members WHERE id = ?", new String[]{memberId});
        String name = "Someone";
        if (c.moveToFirst()) {
            name = c.getString(0);
        }
        c.close();
        return name;
    }

    public String getGroupName(String groupId) {
        if (groupId == null) return "Unknown Group";
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT name FROM groups WHERE id = ?", new String[]{groupId});
        String name = "Unknown Group";
        if (c.moveToFirst()) {
            name = c.getString(0);
        }
        c.close();
        return name;
    }

    public String getCategoryIcon(String cat) {
        if (cat == null) return "🧾";
        if ("Groceries".equalsIgnoreCase(cat)) return "🥦";
        if ("Dining out".equalsIgnoreCase(cat)) return "🍔";
        if ("Rent".equalsIgnoreCase(cat)) return "🏠";
        if ("Household supplies".equalsIgnoreCase(cat)) return "🧻";
        if ("Cleaning".equalsIgnoreCase(cat)) return "🧹";
        if ("Payment".equalsIgnoreCase(cat)) return "🤝";
        if ("Utilities".equalsIgnoreCase(cat)) return "💡";
        if ("Transportation".equalsIgnoreCase(cat)) return "🚗";
        if ("Entertainment".equalsIgnoreCase(cat)) return "🎬";
        return "🧾";
    }

    private String parseHlcTimestamp(String hlc) {
        if (hlc == null || hlc.isEmpty()) return nowIso();
        try {
            String[] parts = hlc.split("-");
            long ms = Long.parseLong(parts[0]);
            if (ms > 0) {
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                return sdf.format(new Date(ms));
            }
        } catch (Exception ignored) {}
        return nowIso();
    }

    private String nowIso() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    private String todayDate() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
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
        upsertMember(UUID.randomUUID().toString(), groupId, name, deviceId, nowIso());
    }

    public void upsertMember(String id, String groupId, String name, String deviceId, String joinedAt) {
        SQLiteDatabase db = getWritableDatabase();
        String trimmedName = (name != null && !name.trim().isEmpty()) ? name.trim() : "Unknown";
        String devId = deviceId != null ? deviceId : "dev_" + UUID.randomUUID().toString().substring(0, 8);
        String jAt = joinedAt != null ? joinedAt : nowIso();

        Cursor c = db.rawQuery("SELECT id FROM members WHERE group_id = ? AND device_id = ?",
                new String[]{groupId, devId});
        if (c.moveToFirst()) {
            String existingId = c.getString(0);
            c.close();
            ContentValues cv = new ContentValues();
            cv.put("name", trimmedName);
            db.update("members", cv, "id = ?", new String[]{existingId});
            return;
        }
        c.close();

        ContentValues cv = new ContentValues();
        cv.put("id", id != null ? id : UUID.randomUUID().toString());
        cv.put("group_id", groupId);
        cv.put("name", trimmedName);
        cv.put("device_id", devId);
        cv.put("joined_at", jAt);
        db.insertWithOnConflict("members", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public void updateMemberNameForDevice(String deviceId, String newName) {
        if (deviceId == null || newName == null || newName.trim().isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("name", newName.trim());
        db.update("members", cv, "device_id = ?", new String[]{deviceId});
    }

    public JSONObject getOrCreateMember(String groupId, String name, String deviceId) {
        SQLiteDatabase db = getWritableDatabase();
        Cursor c = db.rawQuery("SELECT * FROM members WHERE group_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))",
                new String[]{groupId, name});
        JSONObject obj = null;
        try {
            if (c.moveToFirst()) {
                obj = new JSONObject();
                obj.put("id", c.getString(c.getColumnIndexOrThrow("id")));
                obj.put("group_id", c.getString(c.getColumnIndexOrThrow("group_id")));
                obj.put("name", c.getString(c.getColumnIndexOrThrow("name")));
                obj.put("device_id", c.getString(c.getColumnIndexOrThrow("device_id")));
            }
        } catch (Exception ignored) {
        } finally {
            c.close();
        }

        if (obj != null) return obj;

        String id = UUID.randomUUID().toString();
        String devId = deviceId != null ? deviceId : "dev_" + UUID.randomUUID().toString().substring(0, 8);
        ContentValues cv = new ContentValues();
        cv.put("id", id);
        cv.put("group_id", groupId);
        cv.put("name", name.trim());
        cv.put("device_id", devId);
        cv.put("joined_at", nowIso());
        db.insertWithOnConflict("members", null, cv, SQLiteDatabase.CONFLICT_IGNORE);

        try {
            obj = new JSONObject();
            obj.put("id", id);
            obj.put("group_id", groupId);
            obj.put("name", name.trim());
            obj.put("device_id", devId);
            return obj;
        } catch (Exception e) {
            return new JSONObject();
        }
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

    public void upsertGroupInfo(String groupId, String name, String createdBy, String createdAt) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("id", groupId);
        cv.put("name", name);
        cv.put("created_by", createdBy);
        cv.put("created_at", createdAt);
        db.insertWithOnConflict("groups", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
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

    public JSONObject addExpense(HlcClock clock, String groupId, String desc, double amount, String paidBy, JSONArray splitBetween, String category, String date, String deviceId) {
        SQLiteDatabase db = getWritableDatabase();
        String id = UUID.randomUUID().toString();
        String hlc = clock.tick();
        String expDate = date != null && !date.isEmpty() ? date : todayDate();
        String cat = category != null && !category.isEmpty() ? category : "General";

        ContentValues cv = new ContentValues();
        cv.put("id", id);
        cv.put("group_id", groupId);
        cv.put("description", desc);
        cv.put("amount", amount);
        cv.put("paid_by", paidBy);
        cv.put("split_between", splitBetween.toString());
        cv.put("category", cat);
        cv.put("date", expDate);
        cv.put("created_by_device", deviceId);
        cv.put("hlc", hlc);
        cv.put("deleted", 0);
        cv.put("updated_hlc", hlc);
        db.insert("expenses", null, cv);

        // Record initial addition in activity log
        String payerName = getMemberName(paidBy);
        String gName = getGroupName(groupId);
        String icon = getCategoryIcon(cat);
        String amtStr = "₹" + String.format(Locale.US, "%.2f", amount);
        logActivity(groupId, "EXPENSE_ADDED", icon, payerName + " added \"" + desc + "\"", "in " + gName + " • " + cat, amtStr, amount, nowIso(), expDate);

        try {
            JSONObject exp = new JSONObject();
            exp.put("id", id);
            exp.put("group_id", groupId);
            exp.put("description", desc);
            exp.put("amount", amount);
            exp.put("paid_by", paidBy);
            exp.put("split_between", splitBetween);
            exp.put("category", cat);
            exp.put("date", expDate);
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

        Cursor c = db.rawQuery("SELECT group_id, description, amount, paid_by FROM expenses WHERE id = ?", new String[]{expenseId});
        if (c.moveToFirst()) {
            String gid = c.getString(0);
            String desc = c.getString(1);
            double amt = c.getDouble(2);
            String payer = getMemberName(c.getString(3));
            String gName = getGroupName(gid);
            logActivity(gid, "EXPENSE_DELETED", "🗑️", payer + " deleted an expense", "\"" + desc + "\" (₹" + String.format(Locale.US, "%.2f", amt) + ") in " + gName, null, 0, nowIso(), todayDate());
        }
        c.close();

        ContentValues cv = new ContentValues();
        cv.put("deleted", 1);
        cv.put("updated_hlc", hlc);
        db.update("expenses", cv, "id = ?", new String[]{expenseId});
    }

    public JSONObject updateExpense(HlcClock clock, String expenseId, String desc, double amount, String paidBy, JSONArray splitBetween, String category, String date, String deviceId) {
        SQLiteDatabase db = getWritableDatabase();
        String hlc = clock.tick();
        String expDate = date != null && !date.isEmpty() ? date : todayDate();
        String cat = category != null && !category.isEmpty() ? category : "General";

        // 1. Fetch previous state before modifying
        String oldGid = "";
        String oldDesc = desc;
        double oldAmt = amount;
        Cursor oldCur = db.rawQuery("SELECT group_id, description, amount, paid_by FROM expenses WHERE id = ?", new String[]{expenseId});
        if (oldCur.moveToFirst()) {
            oldGid = oldCur.getString(0);
            oldDesc = oldCur.getString(1);
            oldAmt = oldCur.getDouble(2);
        }
        oldCur.close();

        // 2. Perform database update
        ContentValues cv = new ContentValues();
        cv.put("description", desc);
        cv.put("amount", amount);
        cv.put("paid_by", paidBy);
        cv.put("split_between", splitBetween.toString());
        cv.put("category", cat);
        cv.put("date", expDate);
        cv.put("updated_hlc", hlc);
        db.update("expenses", cv, "id = ?", new String[]{expenseId});

        // 3. Log the change to Activity Feed history (e.g. "Changed amount from ₹100.00 to ₹150.00")
        String payerName = getMemberName(paidBy);
        String gName = getGroupName(oldGid);
        String changeDetails;
        if (Math.abs(oldAmt - amount) > 0.001 && !oldDesc.equals(desc)) {
            changeDetails = "Changed \"" + oldDesc + "\" to \"" + desc + "\" & amount from ₹" + String.format(Locale.US, "%.2f", oldAmt) + " to ₹" + String.format(Locale.US, "%.2f", amount);
        } else if (Math.abs(oldAmt - amount) > 0.001) {
            changeDetails = "Changed amount from ₹" + String.format(Locale.US, "%.2f", oldAmt) + " to ₹" + String.format(Locale.US, "%.2f", amount);
        } else if (!oldDesc.equals(desc)) {
            changeDetails = "Changed name from \"" + oldDesc + "\" to \"" + desc + "\"";
        } else {
            changeDetails = "Updated expense details";
        }
        String amtStr = "₹" + String.format(Locale.US, "%.2f", amount);
        logActivity(oldGid, "EXPENSE_UPDATED", "✏️", payerName + " updated \"" + desc + "\"", changeDetails + " in " + gName, amtStr, amount, nowIso(), expDate);

        try {
            JSONObject exp = new JSONObject();
            exp.put("id", expenseId);
            exp.put("description", desc);
            exp.put("amount", amount);
            exp.put("paid_by", paidBy);
            exp.put("split_between", splitBetween);
            exp.put("category", cat);
            exp.put("date", expDate);
            exp.put("updated_hlc", hlc);
            return exp;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    public JSONArray listExpenses(String groupId, boolean includeDeleted) {
        SQLiteDatabase db = getReadableDatabase();
        JSONArray arr = new JSONArray();
        String q = includeDeleted
                ? "SELECT * FROM expenses WHERE group_id = ? ORDER BY date DESC, hlc DESC"
                : "SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY date DESC, hlc DESC";
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

                int catIdx = c.getColumnIndex("category");
                e.put("category", catIdx != -1 && !c.isNull(catIdx) ? c.getString(catIdx) : "General");

                int dateIdx = c.getColumnIndex("date");
                e.put("date", dateIdx != -1 && !c.isNull(dateIdx) ? c.getString(dateIdx) : todayDate());

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

    public Map<String, Double> computeBalances(String groupId) {
        JSONArray members = listMembers(groupId);
        JSONArray expenses = listExpenses(groupId, false);

        Map<String, Double> balances = new HashMap<>();
        for (int i = 0; i < members.length(); i++) {
            try {
                balances.put(members.getJSONObject(i).getString("id"), 0.0);
            } catch (Exception ignored) {}
        }

        for (int i = 0; i < expenses.length(); i++) {
            try {
                JSONObject exp = expenses.getJSONObject(i);
                double amount = exp.getDouble("amount");
                String paidBy = exp.getString("paid_by");
                JSONArray split = exp.getJSONArray("split_between");
                if (split.length() == 0) continue;

                balances.put(paidBy, balances.getOrDefault(paidBy, 0.0) + amount);

                boolean hasCustomShares = false;
                for (int j = 0; j < split.length(); j++) {
                    if (split.optJSONObject(j) != null) {
                        hasCustomShares = true;
                        break;
                    }
                }

                if (hasCustomShares) {
                    for (int j = 0; j < split.length(); j++) {
                        JSONObject item = split.optJSONObject(j);
                        if (item != null) {
                            String memId = item.getString("memberId");
                            double share = item.getDouble("share");
                            balances.put(memId, balances.getOrDefault(memId, 0.0) - share);
                        } else {
                            String memId = split.getString(j);
                            double share = amount / split.length();
                            balances.put(memId, balances.getOrDefault(memId, 0.0) - share);
                        }
                    }
                } else {
                    double share = amount / split.length();
                    for (int j = 0; j < split.length(); j++) {
                        String memId = split.getString(j);
                        balances.put(memId, balances.getOrDefault(memId, 0.0) - share);
                    }
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
        return addExpense(clock, groupId, "Payment settlement", amount, payerId, split, "Payment", todayDate(), deviceId);
    }

    // --- CSV Import & Export ---

    private List<String> parseCsvLine(String text) {
        List<String> result = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < text.length() && text.charAt(i + 1) == '"') {
                    cur.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                result.add(cur.toString().trim());
                cur = new StringBuilder();
            } else {
                cur.append(c);
            }
        }
        result.add(cur.toString().trim());
        return result;
    }

    public JSONObject importSplitwiseCsv(HlcClock clock, String csvContent, String groupId, String groupName, String deviceId) {
        JSONObject res = new JSONObject();
        try {
            String[] lines = csvContent.split("\\r?\\n");
            if (lines.length < 2) {
                res.put("error", "CSV is empty or missing headers");
                return res;
            }

            List<String> header = parseCsvLine(lines[0]);
            if (header.size() < 6) {
                res.put("error", "Invalid Splitwise CSV header (expected >= 6 columns)");
                return res;
            }

            List<String> memberNames = new ArrayList<>();
            for (int i = 5; i < header.size(); i++) {
                memberNames.add(header.get(i).trim());
            }

            String targetGroupId = groupId;
            if (targetGroupId == null || targetGroupId.isEmpty()) {
                JSONObject g = createGroup(groupName != null ? groupName : "Flat Expenses", deviceId, memberNames.get(0));
                targetGroupId = g.getString("id");
            }

            Map<String, JSONObject> memberMap = new HashMap<>();
            for (String name : memberNames) {
                memberMap.put(name, getOrCreateMember(targetGroupId, name, deviceId));
            }

            int count = 0;
            for (int i = 1; i < lines.length; i++) {
                String line = lines[i].trim();
                if (line.isEmpty()) continue;
                List<String> row = parseCsvLine(line);
                if (row.size() < 6) continue;

                String date = row.get(0);
                String desc = row.get(1);
                String cat = row.get(2).isEmpty() ? "General" : row.get(2);
                String costStr = row.get(3);
                double cost;
                try {
                    cost = Double.parseDouble(costStr);
                } catch (Exception e) {
                    continue;
                }

                if (desc.toLowerCase().contains("total balance") || cost <= 0) continue;

                Map<String, Double> memberVals = new HashMap<>();
                for (int m = 0; m < memberNames.size(); m++) {
                    double v = 0.0;
                    if (5 + m < row.size()) {
                        try { v = Double.parseDouble(row.get(5 + m)); } catch (Exception ignored) {}
                    }
                    memberVals.put(memberNames.get(m), v);
                }

                if ("payment".equalsIgnoreCase(cat) || desc.toLowerCase().contains(" paid ")) {
                    String payer = null, receiver = null;
                    for (Map.Entry<String, Double> e : memberVals.entrySet()) {
                        if (e.getValue() > 0) payer = e.getKey();
                        if (e.getValue() < 0) receiver = e.getKey();
                    }
                    if (payer != null && receiver != null && memberMap.containsKey(payer) && memberMap.containsKey(receiver)) {
                        JSONArray split = new JSONArray();
                        split.put(memberMap.get(receiver).getString("id"));
                        addExpense(clock, targetGroupId, desc, cost, memberMap.get(payer).getString("id"), split, "Payment", date, deviceId);
                        count++;
                        continue;
                    }
                }

                List<String> positivePayers = new ArrayList<>();
                List<Map.Entry<String, Double>> negativeMembers = new ArrayList<>();
                for (Map.Entry<String, Double> e : memberVals.entrySet()) {
                    if (e.getValue() > 0.001) positivePayers.add(e.getKey());
                    else if (e.getValue() < -0.001) negativeMembers.add(e);
                }

                if (positivePayers.size() == 1) {
                    String payer = positivePayers.get(0);
                    JSONObject payerObj = memberMap.get(payer);
                    if (payerObj == null) continue;

                    JSONArray splitArr = new JSONArray();
                    for (Map.Entry<String, Double> neg : negativeMembers) {
                        JSONObject splitItem = new JSONObject();
                        splitItem.put("memberId", memberMap.get(neg.getKey()).getString("id"));
                        splitItem.put("share", -neg.getValue());
                        splitArr.put(splitItem);
                    }
                    double payerShare = cost;
                    for (Map.Entry<String, Double> neg : negativeMembers) {
                        payerShare -= (-neg.getValue());
                    }
                    if (payerShare > 0.001) {
                        JSONObject payerSplit = new JSONObject();
                        payerSplit.put("memberId", payerObj.getString("id"));
                        payerSplit.put("share", Math.round(payerShare * 100.0) / 100.0);
                        splitArr.put(payerSplit);
                    }

                    addExpense(clock, targetGroupId, desc, cost, payerObj.getString("id"), splitArr, cat, date, deviceId);
                    count++;
                } else if (positivePayers.size() > 1) {
                    for (String payer : positivePayers) {
                        JSONObject payerObj = memberMap.get(payer);
                        if (payerObj == null) continue;
                        double val = memberVals.get(payer);
                        double totalShare = cost / memberNames.size();
                        double paidAmt = Math.round((val + totalShare) * 100.0) / 100.0;

                        JSONArray splitArr = new JSONArray();
                        for (String n : memberNames) {
                            splitArr.put(memberMap.get(n).getString("id"));
                        }
                        addExpense(clock, targetGroupId, desc + " (" + payer + ")", paidAmt, payerObj.getString("id"), splitArr, cat, date, deviceId);
                        count++;
                    }
                }
            }

            res.put("success", true);
            res.put("groupId", targetGroupId);
            res.put("importedCount", count);
        } catch (Exception e) {
            try { res.put("error", e.getMessage()); } catch (Exception ignored) {}
        }
        return res;
    }

    public String exportSplitwiseCsv(String groupId) {
        StringBuilder sb = new StringBuilder();
        JSONArray members = listMembers(groupId);
        JSONArray expenses = listExpenses(groupId, false);
        Map<String, Double> balances = computeBalances(groupId);

        sb.append("Date,Description,Category,Cost,Currency");
        for (int i = 0; i < members.length(); i++) {
            try { sb.append(",").append(members.getJSONObject(i).getString("name")); } catch (Exception ignored) {}
        }
        sb.append("\n");

        for (int i = expenses.length() - 1; i >= 0; i--) {
            try {
                JSONObject exp = expenses.getJSONObject(i);
                sb.append(exp.optString("date", todayDate())).append(",");
                sb.append("\"").append(exp.getString("description").replace("\"", "\"\"")).append("\",");
                sb.append(exp.optString("category", "General")).append(",");
                sb.append(String.format(Locale.US, "%.2f", exp.getDouble("amount"))).append(",");
                sb.append("INR");

                String paidBy = exp.getString("paid_by");
                JSONArray split = exp.getJSONArray("split_between");
                double amt = exp.getDouble("amount");

                for (int m = 0; m < members.length(); m++) {
                    String memId = members.getJSONObject(m).getString("id");
                    double val = 0.0;
                    if (paidBy.equals(memId)) val += amt;

                    for (int s = 0; s < split.length(); s++) {
                        JSONObject obj = split.optJSONObject(s);
                        if (obj != null && obj.getString("memberId").equals(memId)) {
                            val -= obj.getDouble("share");
                        } else if (memId.equals(split.optString(s))) {
                            val -= amt / split.length();
                        }
                    }
                    sb.append(",").append(String.format(Locale.US, "%.2f", val));
                }
                sb.append("\n");
            } catch (Exception ignored) {}
        }

        sb.append("Total balance, , , ,INR");
        for (int i = 0; i < members.length(); i++) {
            try {
                String memId = members.getJSONObject(i).getString("id");
                sb.append(",").append(String.format(Locale.US, "%.2f", balances.getOrDefault(memId, 0.0)));
            } catch (Exception ignored) {}
        }
        sb.append("\n");
        return sb.toString();
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

    public int mergeExpensesBatch(HlcClock clock, String groupId, JSONArray expenses) {
        SQLiteDatabase db = getWritableDatabase();
        int merged = 0;
        db.beginTransaction();
        try {
            for (int i = 0; i < expenses.length(); i++) {
                try {
                    JSONObject incoming = expenses.getJSONObject(i);
                    String expId = incoming.getString("id");
                    String incomingHlc = incoming.getString("updated_hlc");

                    clock.update(incomingHlc);

                    Cursor c = db.rawQuery("SELECT updated_hlc FROM expenses WHERE id = ?", new String[]{expId});
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
                        cv.put("category", incoming.optString("category", "General"));
                        cv.put("date", incoming.optString("date", todayDate()));
                        cv.put("created_by_device", incoming.getString("created_by_device"));
                        cv.put("hlc", incoming.getString("hlc"));
                        cv.put("deleted", incoming.optBoolean("deleted", false) ? 1 : 0);
                        cv.put("updated_hlc", incomingHlc);
                        db.insert("expenses", null, cv);
                        merged++;
                    } else {
                        String localHlc = c.getString(0);
                        c.close();
                        if (HlcClock.compare(incomingHlc, localHlc) > 0) {
                            ContentValues cv = new ContentValues();
                            cv.put("description", incoming.getString("description"));
                            cv.put("amount", incoming.getDouble("amount"));
                            cv.put("paid_by", incoming.getString("paid_by"));
                            cv.put("split_between", incoming.get("split_between").toString());
                            cv.put("category", incoming.optString("category", "General"));
                            cv.put("date", incoming.optString("date", todayDate()));
                            cv.put("deleted", incoming.optBoolean("deleted", false) ? 1 : 0);
                            cv.put("updated_hlc", incomingHlc);
                            db.update("expenses", cv, "id = ?", new String[]{expId});
                            merged++;
                        }
                    }
                } catch (Exception ignored) {}
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return merged;
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
                cv.put("category", incoming.optString("category", "General"));
                cv.put("date", incoming.optString("date", todayDate()));
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
                cv.put("category", incoming.optString("category", "General"));
                cv.put("date", incoming.optString("date", todayDate()));
                cv.put("deleted", incoming.optBoolean("deleted", false) ? 1 : 0);
                cv.put("updated_hlc", incomingHlc);
                db.update("expenses", cv, "id = ?", new String[]{expId});
                return 1;
            }
        } catch (Exception ignored) {}
        return 0;
    }

    public JSONArray getActivityFeed(String targetGroupId) {
        SQLiteDatabase db = getWritableDatabase();
        ensureActivityTable(db);
        JSONArray activities = new JSONArray();

        // 1. Group Map
        Map<String, String> groupMap = new HashMap<>();
        Cursor gCur = db.rawQuery("SELECT id, name FROM groups", null);
        try {
            while (gCur.moveToNext()) {
                groupMap.put(gCur.getString(0), gCur.getString(1));
            }
        } finally {
            gCur.close();
        }

        // 2. Member Map
        Map<String, String> memberMap = new HashMap<>();
        Cursor mCur = db.rawQuery("SELECT id, name FROM members", null);
        try {
            while (mCur.moveToNext()) {
                memberMap.put(mCur.getString(0), mCur.getString(1));
            }
        } finally {
            mCur.close();
        }

        // 3. Auto-backfill existing expenses into activity_log if missing
        try {
            Cursor bCur = db.rawQuery("SELECT e.id, e.group_id, e.description, e.amount, e.paid_by, e.category, e.date, e.hlc, e.deleted FROM expenses e WHERE NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.group_id = e.group_id AND a.title LIKE '%' || e.description || '%')", null);
            while (bCur.moveToNext()) {
                String eGid = bCur.getString(1);
                String eDesc = bCur.getString(2);
                double eAmt = bCur.getDouble(3);
                String ePayer = memberMap.getOrDefault(bCur.getString(4), "Someone");
                String eCat = bCur.getString(5);
                String eDate = bCur.getString(6);
                String eHlc = bCur.getString(7);
                int isDel = bCur.getInt(8);
                String ts = parseHlcTimestamp(eHlc);
                String amtStr = "₹" + String.format(Locale.US, "%.2f", eAmt);
                String gName = groupMap.getOrDefault(eGid, "Unknown Group");

                boolean isPay = (eCat != null && eCat.equalsIgnoreCase("Payment")) || eDesc.toLowerCase().startsWith("payment:");
                if (isDel == 1) {
                    logActivity(eGid, "EXPENSE_DELETED", "🗑️", ePayer + " deleted an expense", "\"" + eDesc + "\" (" + amtStr + ") in " + gName, null, 0, ts, eDate);
                } else if (isPay) {
                    logActivity(eGid, "PAYMENT_RECORDED", "🤝", ePayer + " recorded payment", "\"" + eDesc + "\" (" + amtStr + ") in " + gName, amtStr, eAmt, ts, eDate);
                } else {
                    logActivity(eGid, "EXPENSE_ADDED", getCategoryIcon(eCat), ePayer + " added \"" + eDesc + "\"", "in " + gName + " • " + (eCat != null ? eCat : "General"), amtStr, eAmt, ts, eDate);
                }
            }
            bCur.close();
        } catch (Exception ignored) {}

        List<JSONObject> list = new ArrayList<>();

        // 4. Query from activity_log table (contains both original adds and detailed update history!)
        String actSql = (targetGroupId != null && !targetGroupId.isEmpty())
                ? "SELECT * FROM activity_log WHERE group_id = ? ORDER BY timestamp DESC LIMIT 200"
                : "SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT 250";
        String[] actArgs = (targetGroupId != null && !targetGroupId.isEmpty()) ? new String[]{targetGroupId} : null;

        Cursor aCur = db.rawQuery(actSql, actArgs);
        try {
            while (aCur.moveToNext()) {
                try {
                    JSONObject act = new JSONObject();
                    String gid = aCur.getString(aCur.getColumnIndexOrThrow("group_id"));
                    act.put("id", aCur.getString(aCur.getColumnIndexOrThrow("id")));
                    act.put("type", aCur.getString(aCur.getColumnIndexOrThrow("type")));
                    act.put("icon", aCur.getString(aCur.getColumnIndexOrThrow("icon")));
                    act.put("title", aCur.getString(aCur.getColumnIndexOrThrow("title")));
                    act.put("subtitle", aCur.getString(aCur.getColumnIndexOrThrow("subtitle")));
                    String amt = aCur.getString(aCur.getColumnIndexOrThrow("amount"));
                    act.put("amount", (amt != null && !amt.isEmpty()) ? amt : JSONObject.NULL);
                    act.put("rawAmount", aCur.getDouble(aCur.getColumnIndexOrThrow("raw_amount")));
                    act.put("timestamp", aCur.getString(aCur.getColumnIndexOrThrow("timestamp")));
                    act.put("date", aCur.getString(aCur.getColumnIndexOrThrow("date")));
                    act.put("groupId", gid);
                    act.put("groupName", groupMap.getOrDefault(gid, "Unknown Group"));
                    list.add(act);
                } catch (Exception ignored) {}
            }
        } finally {
            aCur.close();
        }

        // 5. Member joins
        String mSql = (targetGroupId != null && !targetGroupId.isEmpty())
                ? "SELECT * FROM members WHERE group_id = ? ORDER BY joined_at DESC LIMIT 20"
                : "SELECT * FROM members ORDER BY joined_at DESC LIMIT 30";
        String[] mArgs = (targetGroupId != null && !targetGroupId.isEmpty())
                ? new String[]{targetGroupId} : null;
        Cursor mJoinCur = db.rawQuery(mSql, mArgs);
        try {
            while (mJoinCur.moveToNext()) {
                try {
                    String gid = mJoinCur.getString(mJoinCur.getColumnIndexOrThrow("group_id"));
                    String gName = groupMap.getOrDefault(gid, "Unknown Group");
                    String name = mJoinCur.getString(mJoinCur.getColumnIndexOrThrow("name"));
                    String joinedAt = mJoinCur.getString(mJoinCur.getColumnIndexOrThrow("joined_at"));
                    String id = mJoinCur.getString(mJoinCur.getColumnIndexOrThrow("id"));

                    JSONObject act = new JSONObject();
                    act.put("id", "mem_" + id);
                    act.put("type", "MEMBER_JOINED");
                    act.put("icon", "👤");
                    act.put("title", name + " joined the group");
                    act.put("subtitle", "in " + gName);
                    act.put("amount", JSONObject.NULL);
                    act.put("rawAmount", 0);
                    act.put("groupId", gid);
                    act.put("groupName", gName);
                    act.put("timestamp", joinedAt);
                    act.put("date", joinedAt != null && joinedAt.contains("T") ? joinedAt.split("T")[0] : null);
                    list.add(act);
                } catch (Exception ignored) {}
            }
        } finally {
            mJoinCur.close();
        }

        // 6. Group creations
        String gSql = (targetGroupId != null && !targetGroupId.isEmpty())
                ? "SELECT * FROM groups WHERE id = ?"
                : "SELECT * FROM groups ORDER BY created_at DESC LIMIT 20";
        String[] gArgs = (targetGroupId != null && !targetGroupId.isEmpty())
                ? new String[]{targetGroupId} : null;
        Cursor gCreateCur = db.rawQuery(gSql, gArgs);
        try {
            while (gCreateCur.moveToNext()) {
                try {
                    String gid = gCreateCur.getString(gCreateCur.getColumnIndexOrThrow("id"));
                    String gName = gCreateCur.getString(gCreateCur.getColumnIndexOrThrow("name"));
                    String createdAt = gCreateCur.getString(gCreateCur.getColumnIndexOrThrow("created_at"));

                    JSONObject act = new JSONObject();
                    act.put("id", "grp_" + gid);
                    act.put("type", "GROUP_CREATED");
                    act.put("icon", "👥");
                    act.put("title", "Group \"" + gName + "\" created");
                    act.put("subtitle", "Ready for offline mesh expense splitting");
                    act.put("amount", JSONObject.NULL);
                    act.put("rawAmount", 0);
                    act.put("groupId", gid);
                    act.put("groupName", gName);
                    act.put("timestamp", createdAt);
                    act.put("date", createdAt != null && createdAt.contains("T") ? createdAt.split("T")[0] : null);
                    list.add(act);
                } catch (Exception ignored) {}
            }
        } finally {
            gCreateCur.close();
        }

        // Sort descending by timestamp
        Collections.sort(list, (a, b) -> {
            String tA = a.optString("timestamp", "");
            String tB = b.optString("timestamp", "");
            return tB.compareTo(tA);
        });

        for (int i = 0; i < Math.min(100, list.size()); i++) {
            activities.put(list.get(i));
        }

        return activities;
    }
}
