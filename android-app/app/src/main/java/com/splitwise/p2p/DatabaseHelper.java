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
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        try {
            db.execSQL("ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'General';");
        } catch (Exception ignored) {}
        try {
            db.execSQL("ALTER TABLE expenses ADD COLUMN date TEXT;");
        } catch (Exception ignored) {}
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
        SQLiteDatabase db = getWritableDatabase();
        ContentValues cv = new ContentValues();
        cv.put("id", UUID.randomUUID().toString());
        cv.put("group_id", groupId);
        cv.put("name", name.trim());
        cv.put("device_id", deviceId != null ? deviceId : "dev_" + UUID.randomUUID().toString().substring(0, 8));
        cv.put("joined_at", nowIso());
        db.insertWithOnConflict("members", null, cv, SQLiteDatabase.CONFLICT_IGNORE);
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
        ContentValues cv = new ContentValues();
        cv.put("deleted", 1);
        cv.put("updated_hlc", hlc);
        db.update("expenses", cv, "id = ?", new String[]{expenseId});
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
}
