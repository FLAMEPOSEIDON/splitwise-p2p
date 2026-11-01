/**
 * sync.js — Peer-to-peer sync protocol.
 *
 * Each device runs a WebSocket SERVER (so peers can connect to it) and
 * also acts as a WebSocket CLIENT (connecting out to peers discovered
 * via discovery.js).
 *
 * Protocol (JSON messages over WebSocket):
 *
 *  1. HELLO          — sent right after connecting. Announces deviceId
 *                       and the list of group IDs this device knows about.
 *  2. SYNC_REQUEST    — "send me everything you have for these groups,
 *                       after this HLC checkpoint"
 *  3. SYNC_DATA       — the actual members + expenses payload
 *
 * Merge rules:
 *  - Members: insert if not already present (identity is group_id + device_id)
 *  - Expenses: insert if unseen locally. If already present, keep whichever
 *    version has the higher `updated_hlc` (last-write-wins, deterministic
 *    across devices because HLC strings compare consistently everywhere)
 */

const WebSocket = require('ws');
const { db } = require('./db');
const { compareHLC } = require('./hlc');
const { listGroups, listMembers, addMember, listExpenses, getGroup, updateGroupInfo } = require('./expenses');

class Sync {
  constructor({ deviceId, deviceName, port, hlcClock, onSyncComplete, onLog }) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.port = port;
    this.hlcClock = hlcClock;
    this.onSyncComplete = onSyncComplete || (() => {});
    this.log = onLog || (() => {});
    this.connectedPeers = new Set();
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on('connection', (ws) => {
      this._handleIncomingConnection(ws);
    });

    this.log(`Sync server listening on port ${this.port}`);
  }

  /**
   * Called by index.js whenever discovery.js finds a new peer.
   */
  /**
   * Connect directly to a peer by IP:port, bypassing mDNS discovery.
   * Useful on networks/platforms (e.g. Android/Termux) where multicast
   * traffic needed for mDNS is blocked.
   */
  connectManual(host, port) {
    const ws = new WebSocket(`ws://${host}:${port}`);

    ws.on('open', () => {
      this.log(`Manually connected to ${host}:${port}, saying hello...`);
      this._sendHello(ws);
    });

    ws.on('message', (raw) => this._handleMessage(ws, raw));

    ws.on('close', () => {
      this.log(`Connection to ${host}:${port} closed`);
    });

    ws.on('error', (err) => {
      this.log(`Manual connection error to ${host}:${port}: ${err.message}`);
    });

    return ws;
  }

  connectToPeer(peer) {
    if (this.connectedPeers.has(peer.deviceId)) return;
    if (!peer.host || !peer.port) return;

    const ws = new WebSocket(`ws://${peer.host}:${peer.port}`);

    ws.on('open', () => {
      this.connectedPeers.add(peer.deviceId);
      this.log(`Connected to peer ${peer.name} (${peer.deviceId})`);
      this._sendHello(ws);
    });

    ws.on('message', (raw) => this._handleMessage(ws, raw));

    ws.on('close', () => {
      this.connectedPeers.delete(peer.deviceId);
    });

    ws.on('error', (err) => {
      this.log(`Connection error with peer ${peer.name}: ${err.message}`);
      this.connectedPeers.delete(peer.deviceId);
    });
  }

  _handleIncomingConnection(ws) {
    ws.on('message', (raw) => this._handleMessage(ws, raw));
    ws.on('close', () => {});
  }

  _sendHello(ws) {
    const groups = listGroups().map((g) => g.id);
    this._send(ws, { type: 'HELLO', deviceId: this.deviceId, groups });
  }

  _send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  _handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return; // ignore malformed messages
    }

    switch (msg.type) {
      case 'HELLO':
        this._onHello(ws, msg);
        break;
      case 'SYNC_REQUEST':
        this._onSyncRequest(ws, msg);
        break;
      case 'SYNC_DATA':
        this._onSyncData(ws, msg);
        break;
      default:
        break;
    }
  }

  /**
   * We received a HELLO from a peer. Reply with our own HELLO (if we
   * initiated, we already sent ours) and figure out which groups we
   * have in common, then request their data for those groups.
   */
  _onHello(ws, msg) {
    const myGroups = new Set(listGroups().map((g) => g.id));
    const sharedGroupIds = msg.groups.filter((gid) => myGroups.has(gid));

    // Reply with our HELLO too, in case this peer connected to us
    // (not the other way around).
    this._send(ws, { type: 'HELLO', deviceId: this.deviceId, groups: Array.from(myGroups) });

    if (sharedGroupIds.length === 0) return;

    const checkpoints = {};
    for (const groupId of sharedGroupIds) {
      const row = db
        .prepare(
          `SELECT last_seen_hlc FROM sync_state WHERE group_id = ? AND peer_device_id = ?`
        )
        .get(groupId, msg.deviceId);
      checkpoints[groupId] = row ? row.last_seen_hlc : '000000000000000-0000-0000';
    }

    this._send(ws, {
      type: 'SYNC_REQUEST',
      deviceId: this.deviceId,
      groups: sharedGroupIds,
      checkpoints,
    });
  }

  /**
   * Peer asked us for everything since certain checkpoints. Send it.
   */
  _onSyncRequest(ws, msg) {
    const payload = { type: 'SYNC_DATA', deviceId: this.deviceId, groups: {} };

    for (const groupId of msg.groups) {
      const since = msg.checkpoints[groupId] || '000000000000000-0000-0000';

      const members = listMembers(groupId);
      const expenses = listExpenses(groupId, { includeDeleted: true }).filter(
        (e) => compareHLC(e.updated_hlc, since) > 0
      );
      const info = getGroup(groupId);

      payload.groups[groupId] = { info, members, expenses };
    }

    this._send(ws, payload);
  }

  /**
   * Received actual data from a peer — merge it into our local DB.
   */
  _onSyncData(ws, msg) {
    let mergedCount = 0;

    for (const [groupId, data] of Object.entries(msg.groups)) {
      const localGroup = getGroup(groupId);
      if (localGroup && localGroup.name === '(syncing...)' && data.info) {
        updateGroupInfo(groupId, data.info.name, data.info.created_by, data.info.created_at);
      }

      for (const member of data.members) {
        addMember(groupId, member.name, member.device_id);
      }

      for (const incoming of data.expenses) {
        mergedCount += this._mergeExpense(groupId, incoming);
      }

      // Advance our checkpoint for this peer/group to "now" so we don't
      // re-request the same data next time.
      const nowHlc = this.hlcClock.tick();
      db.prepare(
        `INSERT INTO sync_state (group_id, peer_device_id, last_seen_hlc)
         VALUES (?, ?, ?)
         ON CONFLICT(group_id, peer_device_id) DO UPDATE SET last_seen_hlc = excluded.last_seen_hlc`
      ).run(groupId, msg.deviceId, nowHlc);
    }

    this.log(`Synced ${mergedCount} expense change(s) from peer ${msg.deviceId}`);
    this.onSyncComplete({ peerDeviceId: msg.deviceId, mergedCount });
  }

  /**
   * Insert or reconcile a single incoming expense against our local copy.
   * Returns 1 if something changed locally, 0 otherwise.
   */
  _mergeExpense(groupId, incoming) {
    const existing = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(incoming.id);

    // Fold the incoming HLC into our own clock so our clock stays consistent
    // with the rest of the network.
    this.hlcClock.update(incoming.updated_hlc);

    if (!existing) {
      db.prepare(
        `INSERT INTO expenses
          (id, group_id, description, amount, paid_by, split_between, created_by_device, hlc, deleted, updated_hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        incoming.id,
        groupId,
        incoming.description,
        incoming.amount,
        incoming.paid_by,
        JSON.stringify(incoming.split_between),
        incoming.created_by_device,
        incoming.hlc,
        incoming.deleted ? 1 : 0,
        incoming.updated_hlc
      );
      return 1;
    }

    // Both devices have this expense — last-write-wins by comparing HLCs.
    if (compareHLC(incoming.updated_hlc, existing.updated_hlc) > 0) {
      db.prepare(
        `UPDATE expenses SET description = ?, amount = ?, paid_by = ?, split_between = ?, deleted = ?, updated_hlc = ?
         WHERE id = ?`
      ).run(
        incoming.description,
        incoming.amount,
        incoming.paid_by,
        JSON.stringify(incoming.split_between),
        incoming.deleted ? 1 : 0,
        incoming.updated_hlc,
        incoming.id
      );
      return 1;
    }

    return 0; // our local version is already newer or equal, keep it
  }
}

module.exports = { Sync };
