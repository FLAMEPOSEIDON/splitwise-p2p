/**
 * expenses.js — Core Splitwise-style business logic with CSV Import/Export.
 *
 * Responsible for:
 *  - Creating/joining groups
 *  - Adding, editing, deleting expenses (all local writes, HLC-stamped)
 *  - Categorization (Groceries, Dining out, Rent, Cleaning, General, etc.)
 *  - Date support
 *  - Equal & custom/unequal share splits
 *  - Computing each member's balance in INR (₹)
 *  - Simplifying debts into the minimum number of payments
 *  - Full Splitwise CSV Import and Export
 */

const { randomUUID } = require('node:crypto');
const { db } = require('./db');

/**
 * Create a new group. Returns the group object.
 */
function createGroup(name, deviceId, memberName) {
  const groupId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`
  ).run(groupId, name, deviceId, now);

  addMember(groupId, memberName, deviceId);

  return { id: groupId, name, created_by: deviceId, created_at: now };
}

/**
 * Add a member (yourself, or a peer discovered during sync) to a group.
 */
function addMember(groupId, name, deviceId) {
  const id = randomUUID();
  const now = new Date().toISOString();

  try {
    db.prepare(
      `INSERT INTO members (id, group_id, name, device_id, joined_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, groupId, name, deviceId || `dev_${randomUUID().slice(0, 8)}`, now);
  } catch (err) {
    if (!String(err.message).includes('UNIQUE')) throw err;
  }
}

/**
 * Find or create a member by name in a group
 */
function getOrCreateMember(groupId, name, deviceId) {
  const existing = db.prepare(
    `SELECT * FROM members WHERE group_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))`
  ).get(groupId, name);

  if (existing) return existing;

  const id = randomUUID();
  const now = new Date().toISOString();
  const devId = deviceId || `dev_${randomUUID().slice(0, 8)}`;
  try {
    db.prepare(
      `INSERT INTO members (id, group_id, name, device_id, joined_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, groupId, name.trim(), devId, now);
    return { id, group_id: groupId, name: name.trim(), device_id: devId, joined_at: now };
  } catch (_) {
    return db.prepare(`SELECT * FROM members WHERE group_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))`).get(groupId, name);
  }
}

function joinGroupStub(groupId, deviceId, yourName) {
  const existing = getGroup(groupId);
  if (!existing) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`
    ).run(groupId, '(syncing...)', deviceId, now);
  }
  addMember(groupId, yourName, deviceId);
}

function updateGroupInfo(groupId, name, createdBy, createdAt) {
  db.prepare(
    `UPDATE groups SET name = ?, created_by = ?, created_at = ? WHERE id = ?`
  ).run(name, createdBy, createdAt, groupId);
}

function getGroup(groupId) {
  return db.prepare(`SELECT * FROM groups WHERE id = ?`).get(groupId);
}

function listGroups() {
  return db.prepare(`SELECT * FROM groups ORDER BY created_at DESC`).all();
}

function listMembers(groupId) {
  return db
    .prepare(`SELECT * FROM members WHERE group_id = ? ORDER BY joined_at ASC`)
    .all(groupId);
}

/**
 * Add an expense.
 * `splitBetween` can be:
 *   - Array of member IDs: ['id1', 'id2'] (Equal split)
 *   - Array of objects: [{ memberId: 'id1', share: 2500 }, { memberId: 'id2', share: 1500 }] (Custom/Exact split)
 */
function addExpense(hlcClock, {
  groupId,
  description,
  amount,
  paidBy,
  splitBetween,
  category = 'General',
  date = null,
  deviceId
}) {
  const id = randomUUID();
  const hlc = hlcClock.tick();
  const expenseDate = date || new Date().toISOString().split('T')[0];

  db.prepare(
    `INSERT INTO expenses
      (id, group_id, description, amount, paid_by, split_between, category, date, created_by_device, hlc, deleted, updated_hlc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    groupId,
    description,
    amount,
    paidBy,
    JSON.stringify(splitBetween),
    category,
    expenseDate,
    deviceId,
    hlc,
    hlc
  );

  return { id, groupId, description, amount, paidBy, splitBetween, category, date: expenseDate, hlc };
}

function deleteExpense(hlcClock, expenseId) {
  const hlc = hlcClock.tick();
  db.prepare(`UPDATE expenses SET deleted = 1, updated_hlc = ? WHERE id = ?`).run(
    hlc,
    expenseId
  );
}

function updateExpense(hlcClock, expenseId, {
  description,
  amount,
  paidBy,
  splitBetween,
  category = 'General',
  date = null,
  deviceId
}) {
  const hlc = hlcClock.tick();
  const expenseDate = date || new Date().toISOString().split('T')[0];

  db.prepare(
    `UPDATE expenses SET
       description = ?,
       amount = ?,
       paid_by = ?,
       split_between = ?,
       category = ?,
       date = ?,
       updated_hlc = ?
     WHERE id = ?`
  ).run(
    description,
    amount,
    paidBy,
    JSON.stringify(splitBetween),
    category,
    expenseDate,
    hlc,
    expenseId
  );

  return { id: expenseId, description, amount, paidBy, splitBetween, category, date: expenseDate, updated_hlc: hlc };
}

function listExpenses(groupId, { includeDeleted = false } = {}) {
  const query = includeDeleted
    ? `SELECT * FROM expenses WHERE group_id = ? ORDER BY date DESC, hlc DESC`
    : `SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY date DESC, hlc DESC`;

  return db
    .prepare(query)
    .all(groupId)
    .map((exp) => {
      let split = [];
      try {
        split = JSON.parse(exp.split_between);
      } catch (_) {}
      return {
        ...exp,
        category: exp.category || 'General',
        date: exp.date || exp.hlc.slice(0, 10),
        split_between: split,
      };
    });
}

/**
 * Compute balances in Indian Rupees (INR / ₹)
 * Supports both equal splits and exact custom shares.
 */
function computeBalances(groupId) {
  const members = listMembers(groupId);
  const expenses = listExpenses(groupId);

  const balances = {};
  for (const m of members) balances[m.id] = 0;

  for (const exp of expenses) {
    const split = exp.split_between || [];
    if (split.length === 0) continue;

    // Credit payer
    balances[exp.paid_by] = (balances[exp.paid_by] || 0) + exp.amount;

    // Check if custom shares are used
    let hasCustomShares = false;
    for (const item of split) {
      if (typeof item === 'object' && item !== null && typeof item.share === 'number') {
        hasCustomShares = true;
        break;
      }
    }

    if (hasCustomShares) {
      for (const item of split) {
        const memId = typeof item === 'object' ? item.memberId : item;
        const share = typeof item === 'object' ? item.share : (exp.amount / split.length);
        balances[memId] = (balances[memId] || 0) - share;
      }
    } else {
      // Equal split
      const share = exp.amount / split.length;
      for (const memberId of split) {
        balances[memberId] = (balances[memberId] || 0) - share;
      }
    }
  }

  // Round to 2 decimal places (paisa)
  for (const id of Object.keys(balances)) {
    balances[id] = Math.round(balances[id] * 100) / 100;
  }

  return balances;
}

/**
 * Greedy debt minimization algorithm (Splitwise Simplify Debts)
 */
function simplifyDebts(groupId) {
  const balances = computeBalances(groupId);

  const creditors = [];
  const debtors = [];

  for (const [memberId, balance] of Object.entries(balances)) {
    if (balance > 0.01) creditors.push({ memberId, amount: balance });
    else if (balance < -0.01) debtors.push({ memberId, amount: -balance });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settled = Math.min(debtor.amount, creditor.amount);

    settlements.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amount: Math.round(settled * 100) / 100,
    });

    debtor.amount -= settled;
    creditor.amount -= settled;

    if (debtor.amount < 0.01) i += 1;
    if (creditor.amount < 0.01) j += 1;
  }

  return settlements;
}

function settleDebt(hlcClock, { groupId, payerMemberId, receiverMemberId, amount, deviceId }) {
  const members = listMembers(groupId);
  const payer = members.find((m) => m.id === payerMemberId);
  const receiver = members.find((m) => m.id === receiverMemberId);
  const payerName = payer ? payer.name : 'Payer';
  const receiverName = receiver ? receiver.name : 'Receiver';

  const description = `${payerName} paid ${receiverName}`;
  return addExpense(hlcClock, {
    groupId,
    description,
    amount,
    paidBy: payerMemberId,
    splitBetween: [receiverMemberId],
    category: 'Payment',
    date: new Date().toISOString().split('T')[0],
    deviceId,
  });
}

// -------------------------------------------------------------------
// Splitwise CSV Parsing & Import / Export Logic
// -------------------------------------------------------------------

function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

/**
 * Import a full Splitwise export CSV file into a group.
 * Automatically adds members and creates all expenses with their dates and categories.
 */
function importSplitwiseCsv(hlcClock, csvContent, { groupId = null, groupName = 'Flat Expenses', deviceId }) {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV file is empty or missing headers');

  // Parse header
  const header = parseCsvLine(lines[0]);
  // Expected: Date, Description, Category, Cost, Currency, Member1, Member2, ...
  if (header.length < 6) throw new Error('Invalid Splitwise CSV format (too few columns)');

  const memberNames = header.slice(5);

  // If no groupId provided, create a new group
  let targetGroupId = groupId;
  if (!targetGroupId) {
    const newGroup = createGroup(groupName, deviceId, memberNames[0] || 'Me');
    targetGroupId = newGroup.id;
  }

  // Ensure all member names exist in this group
  const memberMap = {}; // name -> memberObject
  for (const name of memberNames) {
    const m = getOrCreateMember(targetGroupId, name, deviceId);
    memberMap[name] = m;
  }

  let importedCount = 0;

  for (let idx = 1; idx < lines.length; idx++) {
    const line = lines[idx];
    const row = parseCsvLine(line);
    if (row.length < 6) continue;

    const date = row[0];
    const description = row[1];
    const category = row[2] || 'General';
    const costStr = row[3];
    const cost = parseFloat(costStr);

    // Skip summary / total row
    if (description.toLowerCase().includes('total balance') || isNaN(cost) || cost <= 0) {
      continue;
    }

    const memberValues = {};
    for (let mIdx = 0; mIdx < memberNames.length; mIdx++) {
      const mName = memberNames[mIdx];
      const val = parseFloat(row[5 + mIdx]) || 0;
      memberValues[mName] = val;
    }

    // 1. Payment row handling
    if (category.toLowerCase() === 'payment' || description.toLowerCase().includes(' paid ')) {
      // Find payer (positive value) and receiver (negative value)
      let payerName = null;
      let receiverName = null;
      for (const [name, val] of Object.entries(memberValues)) {
        if (val > 0) payerName = name;
        if (val < 0) receiverName = name;
      }

      if (payerName && receiverName && memberMap[payerName] && memberMap[receiverName]) {
        addExpense(hlcClock, {
          groupId: targetGroupId,
          description: description || `${payerName} paid ${receiverName}`,
          amount: cost,
          paidBy: memberMap[payerName].id,
          splitBetween: [memberMap[receiverName].id],
          category: 'Payment',
          date,
          deviceId,
        });
        importedCount++;
        continue;
      }
    }

    // 2. Normal Expense row handling
    // In Splitwise: V_i = Paid_i - Share_i.
    // For non-payers: Paid_i = 0 => Share_i = -V_i.
    const positiveMembers = [];
    const negativeMembers = [];

    for (const [name, val] of Object.entries(memberValues)) {
      if (val > 0.001) positiveMembers.push({ name, val });
      else if (val < -0.001) negativeMembers.push({ name, share: -val });
    }

    // Single payer (standard case)
    if (positiveMembers.length === 1) {
      const payerName = positiveMembers[0].name;
      const payer = memberMap[payerName];
      if (!payer) continue;

      // Check if all shares are equal
      const splitShares = [];
      let allEqual = true;
      const totalNegShares = negativeMembers.reduce((sum, m) => sum + m.share, 0);
      const payerShare = Math.max(0, Math.round((cost - totalNegShares) * 100) / 100);

      const allMembersInvolved = [...negativeMembers];
      if (payerShare > 0.001) {
        allMembersInvolved.push({ name: payerName, share: payerShare });
      }

      const expectedEqual = Math.round((cost / allMembersInvolved.length) * 100) / 100;
      for (const m of allMembersInvolved) {
        if (Math.abs(m.share - expectedEqual) > 0.1) {
          allEqual = false;
        }
      }

      let splitBetween;
      if (allEqual && allMembersInvolved.length > 0) {
        splitBetween = allMembersInvolved.map((m) => memberMap[m.name].id);
      } else {
        splitBetween = allMembersInvolved.map((m) => ({
          memberId: memberMap[m.name].id,
          share: m.share,
        }));
      }

      addExpense(hlcClock, {
        groupId: targetGroupId,
        description,
        amount: cost,
        paidBy: payer.id,
        splitBetween,
        category,
        date,
        deviceId,
      });
      importedCount++;
    } else if (positiveMembers.length > 1) {
      // Multiple payers: Split into sub-expenses per contributor
      for (const pos of positiveMembers) {
        const payer = memberMap[pos.name];
        if (!payer) continue;

        // Share owed by this payer
        const totalCostShare = cost / memberNames.length;
        const amountPaid = Math.round((pos.val + totalCostShare) * 100) / 100;

        addExpense(hlcClock, {
          groupId: targetGroupId,
          description: `${description} (${pos.name})`,
          amount: amountPaid,
          paidBy: payer.id,
          splitBetween: memberNames.map((n) => memberMap[n].id),
          category,
          date,
          deviceId,
        });
        importedCount++;
      }
    }
  }

  return { groupId: targetGroupId, importedCount, members: Object.values(memberMap) };
}

/**
 * Export group expenses to standard Splitwise CSV format
 */
function exportSplitwiseCsv(groupId) {
  const group = getGroup(groupId);
  if (!group) throw new Error('Group not found');

  const members = listMembers(groupId);
  const expenses = listExpenses(groupId);
  const balances = computeBalances(groupId);

  const header = ['Date', 'Description', 'Category', 'Cost', 'Currency', ...members.map((m) => m.name)];
  const rows = [header.join(',')];

  const memberMap = Object.fromEntries(members.map((m) => [m.id, m.name]));

  for (const exp of expenses.slice().reverse()) {
    const isPayment = exp.category === 'Payment' || exp.description.startsWith('Payment:');
    const cols = [
      exp.date || exp.hlc.slice(0, 10),
      `"${exp.description.replace(/"/g, '""')}"`,
      exp.category || 'General',
      exp.amount.toFixed(2),
      'INR',
    ];

    const split = exp.split_between || [];
    const shareCount = split.length;

    for (const m of members) {
      let val = 0;
      if (exp.paid_by === m.id) {
        val += exp.amount;
      }

      // Check if m is in split
      let memberShare = 0;
      for (const item of split) {
        if (typeof item === 'object' && item !== null && item.memberId === m.id) {
          memberShare = item.share;
        } else if (item === m.id) {
          memberShare = exp.amount / shareCount;
        }
      }
      val -= memberShare;

      cols.push(val.toFixed(2));
    }

    rows.push(cols.join(','));
  }

  // Summary row at the bottom
  const summaryCols = ['Total balance', ' ', ' ', 'INR', ...members.map((m) => (balances[m.id] || 0).toFixed(2))];
  rows.push(summaryCols.join(','));

  return rows.join('\n');
}

/**
 * Retrieve a rich, chronological activity feed of all actions:
 * - Expenses added
 * - Payments settled
 * - Expenses deleted
 * - Members joined
 * - Groups created
 */
function getActivityFeed(limit = 100, targetGroupId = null) {
  const activities = [];

  // 1. Group names & members cache
  const groups = listGroups();
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const allMembers = db.prepare(`SELECT * FROM members`).all();
  const memberMap = Object.fromEntries(allMembers.map((m) => [m.id, m.name]));

  // 2. Query expenses
  const expQuery = targetGroupId
    ? db.prepare(`SELECT * FROM expenses WHERE group_id = ? ORDER BY hlc DESC LIMIT ?`).all(targetGroupId, limit)
    : db.prepare(`SELECT * FROM expenses ORDER BY hlc DESC LIMIT ?`).all(limit);

  for (const exp of expQuery) {
    const groupName = groupMap[exp.group_id] || 'Unknown Group';
    const payerName = memberMap[exp.paid_by] || 'Someone';

    // Parse timestamp from HLC: format is "<physical_ms_padded>-<counter>-<deviceId>"
    let timestamp = null;
    try {
      const parts = exp.updated_hlc ? exp.updated_hlc.split('-') : exp.hlc.split('-');
      const ms = parseInt(parts[0], 10);
      if (!isNaN(ms) && ms > 0) {
        timestamp = new Date(ms).toISOString();
      }
    } catch (_) {}

    if (!timestamp) {
      timestamp = exp.date ? new Date(exp.date).toISOString() : new Date().toISOString();
    }

    const isPayment = (exp.category && exp.category.toLowerCase() === 'payment') ||
      exp.description.toLowerCase().startsWith('payment:');

    if (exp.deleted) {
      activities.push({
        id: `del_${exp.id}`,
        type: 'EXPENSE_DELETED',
        icon: '🗑️',
        title: `${payerName} deleted an expense`,
        subtitle: `"${exp.description}" (₹${exp.amount.toFixed(2)}) in ${groupName}`,
        amount: null,
        rawAmount: exp.amount,
        groupId: exp.group_id,
        groupName,
        timestamp,
        date: exp.date,
      });
    } else if (isPayment) {
      let receiverName = 'Someone';
      try {
        const split = JSON.parse(exp.split_between);
        if (split.length > 0) {
          const recId = typeof split[0] === 'object' ? split[0].memberId : split[0];
          receiverName = memberMap[recId] || receiverName;
        }
      } catch (_) {}

      activities.push({
        id: `pay_${exp.id}`,
        type: 'PAYMENT_RECORDED',
        icon: '🤝',
        title: `${payerName} paid ${receiverName}`,
        subtitle: `Settled ₹${exp.amount.toFixed(2)} in ${groupName}`,
        amount: `₹${exp.amount.toFixed(2)}`,
        rawAmount: exp.amount,
        groupId: exp.group_id,
        groupName,
        timestamp,
        date: exp.date,
      });
    } else {
      activities.push({
        id: `exp_${exp.id}`,
        type: 'EXPENSE_ADDED',
        icon: exp.category === 'Groceries' ? '🥦' :
              exp.category === 'Dining out' ? '🍔' :
              exp.category === 'Rent' ? '🏠' :
              exp.category === 'Household supplies' ? '🧻' :
              exp.category === 'Cleaning' ? '🧹' :
              exp.category === 'Transportation' ? '🚗' : '🧾',
        title: `${payerName} added "${exp.description}"`,
        subtitle: `in ${groupName} • ${exp.category || 'General'}`,
        amount: `₹${exp.amount.toFixed(2)}`,
        rawAmount: exp.amount,
        groupId: exp.group_id,
        groupName,
        timestamp,
        date: exp.date,
      });
    }
  }

  // 3. Member joins
  const memberQuery = targetGroupId
    ? db.prepare(`SELECT * FROM members WHERE group_id = ? ORDER BY joined_at DESC LIMIT 20`).all(targetGroupId)
    : db.prepare(`SELECT * FROM members ORDER BY joined_at DESC LIMIT 30`).all();

  for (const m of memberQuery) {
    const groupName = groupMap[m.group_id] || 'Unknown Group';
    activities.push({
      id: `mem_${m.id}`,
      type: 'MEMBER_JOINED',
      icon: '👤',
      title: `${m.name} joined the group`,
      subtitle: `in ${groupName}`,
      amount: null,
      rawAmount: 0,
      groupId: m.group_id,
      groupName,
      timestamp: m.joined_at,
      date: m.joined_at ? m.joined_at.split('T')[0] : null,
    });
  }

  // 4. Group creations
  const groupQuery = targetGroupId
    ? db.prepare(`SELECT * FROM groups WHERE id = ?`).all(targetGroupId)
    : db.prepare(`SELECT * FROM groups ORDER BY created_at DESC LIMIT 20`).all();

  for (const g of groupQuery) {
    activities.push({
      id: `grp_${g.id}`,
      type: 'GROUP_CREATED',
      icon: '👥',
      title: `Group "${g.name}" created`,
      subtitle: `Ready for offline mesh expense splitting`,
      amount: null,
      rawAmount: 0,
      groupId: g.id,
      groupName: g.name,
      timestamp: g.created_at,
      date: g.created_at ? g.created_at.split('T')[0] : null,
    });
  }

  // Sort all activities in descending order (newest first)
  activities.sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    return timeB - timeA;
  });

  return activities.slice(0, limit);
}

module.exports = {
  createGroup,
  joinGroupStub,
  updateGroupInfo,
  addMember,
  getOrCreateMember,
  getGroup,
  listGroups,
  listMembers,
  addExpense,
  updateExpense,
  deleteExpense,
  settleDebt,
  listExpenses,
  computeBalances,
  simplifyDebts,
  importSplitwiseCsv,
  exportSplitwiseCsv,
  getActivityFeed,
};
