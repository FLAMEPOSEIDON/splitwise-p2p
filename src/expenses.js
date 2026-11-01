/**
 * expenses.js — Core Splitwise-style business logic.
 *
 * Responsible for:
 *  - Creating/joining groups
 *  - Adding, editing, deleting expenses (all local writes, HLC-stamped)
 *  - Computing each member's balance
 *  - Simplifying debts into the minimum number of payments
 *
 * This file knows nothing about networking or sync — it only reads/writes
 * the local DB. sync.js is responsible for reconciling data between devices.
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
    ).run(id, groupId, name, deviceId, now);
  } catch (err) {
    // UNIQUE constraint (group_id, device_id) — member already exists, ignore
    if (!String(err.message).includes('UNIQUE')) throw err;
  }
}

/**
 * Create a local placeholder for a group you're JOINING (not creating).
 * The real name/created_at will arrive automatically once sync.js pulls
 * data from a peer who already has this group. Safe to call multiple
 * times — does nothing if the group already exists locally.
 */
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

/**
 * Update a group's real name/metadata once we learn it from a peer
 * (used when we joined via a stub and are now getting the real data).
 */
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
 * Add an expense. `splitBetween` is an array of member IDs sharing the cost
 * equally. `paidBy` is the member ID who fronted the money.
 *
 * hlcClock is the HybridLogicalClock instance for this device (see hlc.js).
 */
function addExpense(hlcClock, { groupId, description, amount, paidBy, splitBetween, deviceId }) {
  const id = randomUUID();
  const hlc = hlcClock.tick();

  db.prepare(
    `INSERT INTO expenses
      (id, group_id, description, amount, paid_by, split_between, created_by_device, hlc, deleted, updated_hlc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    groupId,
    description,
    amount,
    paidBy,
    JSON.stringify(splitBetween),
    deviceId,
    hlc,
    hlc
  );

  return { id, groupId, description, amount, paidBy, splitBetween, hlc };
}

/**
 * Soft-delete an expense (so the deletion itself can propagate during sync,
 * instead of just vanishing locally while other devices still have it).
 */
function deleteExpense(hlcClock, expenseId) {
  const hlc = hlcClock.tick();
  db.prepare(`UPDATE expenses SET deleted = 1, updated_hlc = ? WHERE id = ?`).run(
    hlc,
    expenseId
  );
}

function listExpenses(groupId, { includeDeleted = false } = {}) {
  const query = includeDeleted
    ? `SELECT * FROM expenses WHERE group_id = ? ORDER BY hlc ASC`
    : `SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY hlc ASC`;

  return db
    .prepare(query)
    .all(groupId)
    .map((e) => ({ ...e, split_between: JSON.parse(e.split_between) }));
}

/**
 * Compute net balance per member: positive = is owed money, negative = owes money.
 */
function computeBalances(groupId) {
  const members = listMembers(groupId);
  const expenses = listExpenses(groupId);

  const balances = {};
  for (const m of members) balances[m.id] = 0;

  for (const exp of expenses) {
    const shareCount = exp.split_between.length;
    if (shareCount === 0) continue;
    const share = exp.amount / shareCount;

    // Payer gets credited the full amount
    balances[exp.paid_by] = (balances[exp.paid_by] || 0) + exp.amount;

    // Everyone in the split (including payer, if included) owes their share
    for (const memberId of exp.split_between) {
      balances[memberId] = (balances[memberId] || 0) - share;
    }
  }

  // Round to avoid floating point noise
  for (const id of Object.keys(balances)) {
    balances[id] = Math.round(balances[id] * 100) / 100;
  }

  return balances; // { memberId: netBalance }
}

/**
 * Simplify debts into the minimum number of payments using a greedy
 * max-debtor-pays-max-creditor approach.
 * Returns an array of { from, to, amount } (from owes to).
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

/**
 * Record a settlement payment between two members.
 * In Splitwise's ledger model, a settlement is an expense where
 * `payerMemberId` pays the full amount, split solely with `receiverMemberId`.
 * This credits payer +amount and debits receiver -amount, reducing the debt to 0.
 */
function settleDebt(hlcClock, { groupId, payerMemberId, receiverMemberId, amount, deviceId }) {
  const members = listMembers(groupId);
  const payer = members.find((m) => m.id === payerMemberId);
  const receiver = members.find((m) => m.id === receiverMemberId);
  const payerName = payer ? payer.name : 'Payer';
  const receiverName = receiver ? receiver.name : 'Receiver';

  const description = `Payment: ${payerName} paid ${receiverName}`;
  return addExpense(hlcClock, {
    groupId,
    description,
    amount,
    paidBy: payerMemberId,
    splitBetween: [receiverMemberId],
    deviceId,
  });
}

module.exports = {
  createGroup,
  joinGroupStub,
  updateGroupInfo,
  addMember,
  getGroup,
  listGroups,
  listMembers,
  addExpense,
  deleteExpense,
  settleDebt,
  listExpenses,
  computeBalances,
  simplifyDebts,
};
