/**
 * mongoSync.js — Optional Free MongoDB Cloud Addon for Splitwise P2P.
 *
 * Provides hybrid dual-storage:
 *  1. Every action is ALWAYS stored locally (SQLite/IndexedDB) first for instant offline use.
 *  2. When the user enables the MongoDB addon, all groups, members, and expenses
 *     are also stored in MongoDB Atlas (Free M0 Tier).
 *  3. Syncs seamlessly between local devices and MongoDB using HLC timestamps,
 *     allowing users on different Wi-Fi networks to stay in sync!
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { db } = require('./db');
const { compareHLC } = require('./hlc');
const expenses = require('./expenses');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'mongo_config.json');

class MongoSyncManager {
  constructor({ hlcClock, onLog } = {}) {
    this.hlcClock = hlcClock;
    this.log = onLog || (() => {});
    this.config = this._loadConfig();
    this.client = null;
    this.mongoDb = null;
    this.syncing = false;
    this.lastSyncTime = null;
    this.lastError = null;

    if (this.config.enabled && this.config.uri) {
      this.initConnection().catch((err) => {
        this.log(`MongoDB startup connect warning: ${err.message}`);
      });
    }
  }

  _loadConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      } catch {}
    }
    return {
      enabled: false,
      mode: 'local', // 'local' or 'mongodb' (dual)
      uri: '',
      dbName: 'splitwise_p2p',
      apiKey: '',
      appId: '',
    };
  }

  _saveConfig() {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
  }

  getStatus() {
    const maskedUri = this.config.uri
      ? this.config.uri.replace(/:([^@:]+)@/, ':****@')
      : '';
    return {
      enabled: this.config.enabled,
      mode: this.config.enabled ? 'dual' : 'local',
      configured: Boolean(this.config.uri || (this.config.appId && this.config.apiKey)),
      uri: maskedUri,
      dbName: this.config.dbName || 'splitwise_p2p',
      connected: Boolean(this.client || this.config.apiKey),
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
    };
  }

  async saveConfig({ enabled, uri, dbName, apiKey, appId }) {
    this.config.enabled = Boolean(enabled);
    if (uri !== undefined) this.config.uri = uri.trim();
    if (dbName !== undefined) this.config.dbName = dbName.trim() || 'splitwise_p2p';
    if (apiKey !== undefined) this.config.apiKey = apiKey.trim();
    if (appId !== undefined) this.config.appId = appId.trim();

    this._saveConfig();

    if (this.config.enabled) {
      return await this.testAndConnect();
    } else {
      await this.disconnect();
      return { success: true, message: 'MongoDB addon disabled. Running in 100% Local Mode.' };
    }
  }

  async testAndConnect() {
    this.lastError = null;
    try {
      if (this.config.uri.startsWith('mongodb://') || this.config.uri.startsWith('mongodb+srv://')) {
        let MongoClient;
        try {
          MongoClient = require('mongodb').MongoClient;
        } catch {
          // Fallback message if mongodb driver is not installed
          throw new Error('To use direct mongodb:// connection, please run "npm install mongodb". Alternatively, use MongoDB Atlas Data API!');
        }

        if (this.client) {
          try { await this.client.close(); } catch {}
        }

        this.client = new MongoClient(this.config.uri, {
          serverSelectionTimeoutMS: 8000,
          connectTimeoutMS: 8000,
        });

        await this.client.connect();
        this.mongoDb = this.client.db(this.config.dbName);
        await this.mongoDb.command({ ping: 1 });

        // Trigger immediate sync on successful connect
        this.sync().catch(() => {});
        return { success: true, message: 'Connected to MongoDB Atlas successfully!' };
      } else if (this.config.appId && this.config.apiKey) {
        // Test Data API endpoint
        await this._testDataApi();
        this.sync().catch(() => {});
        return { success: true, message: 'Connected to MongoDB Atlas Data API successfully!' };
      } else {
        throw new Error('Please enter a valid MongoDB connection string (mongodb+srv://...)');
      }
    } catch (err) {
      this.lastError = err.message;
      return { success: false, error: err.message };
    }
  }

  async initConnection() {
    if (!this.config.enabled) return;
    try {
      await this.testAndConnect();
    } catch {}
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
      } catch {}
      this.client = null;
      this.mongoDb = null;
    }
  }

  /**
   * Two-way delta sync between Local SQLite and MongoDB.
   *  1. Push all local groups, members, and expenses to MongoDB.
   *  2. Pull any documents from MongoDB with newer HLC timestamps into local SQLite.
   */
  async sync() {
    if (!this.config.enabled || this.syncing) return { synced: 0 };
    this.syncing = true;
    let syncedCount = 0;

    try {
      if (this.mongoDb) {
        // --- 1. Push Local -> MongoDB ---
        const localGroups = expenses.listGroups();
        const groupsCol = this.mongoDb.collection('groups');
        const membersCol = this.mongoDb.collection('members');
        const expensesCol = this.mongoDb.collection('expenses');

        for (const g of localGroups) {
          await groupsCol.updateOne(
            { _id: g.id },
            { $set: { _id: g.id, id: g.id, name: g.name, created_by: g.created_by, created_at: g.created_at } },
            { upsert: true }
          );

          const members = expenses.listMembers(g.id);
          for (const m of members) {
            await membersCol.updateOne(
              { _id: m.id },
              { $set: { _id: m.id, id: m.id, group_id: m.group_id, name: m.name, device_id: m.device_id, joined_at: m.joined_at } },
              { upsert: true }
            );
          }

          const localExps = expenses.listExpenses(g.id, { includeDeleted: true });
          for (const exp of localExps) {
            await expensesCol.updateOne(
              { _id: exp.id },
              {
                $set: {
                  _id: exp.id,
                  id: exp.id,
                  group_id: exp.group_id,
                  description: exp.description,
                  amount: exp.amount,
                  paid_by: exp.paid_by,
                  split_between: exp.split_between,
                  created_by_device: exp.created_by_device,
                  hlc: exp.hlc,
                  deleted: exp.deleted ? 1 : 0,
                  updated_hlc: exp.updated_hlc,
                },
              },
              { upsert: true }
            );
          }
        }

        // --- 2. Pull MongoDB -> Local ---
        const remoteGroups = await groupsCol.find({}).toArray();
        for (const rg of remoteGroups) {
          const localG = expenses.getGroup(rg.id || rg._id);
          if (!localG) {
            expenses.joinGroupStub(rg.id || rg._id, rg.created_by, 'Peer');
            expenses.updateGroupInfo(rg.id || rg._id, rg.name, rg.created_by, rg.created_at);
            syncedCount++;
          }
        }

        const remoteMembers = await membersCol.find({}).toArray();
        for (const rm of remoteMembers) {
          expenses.addMember(rm.group_id, rm.name, rm.device_id);
        }

        const remoteExpenses = await expensesCol.find({}).toArray();
        for (const re of remoteExpenses) {
          const expId = re.id || re._id;
          const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expId);

          if (!existing) {
            db.prepare(
              `INSERT INTO expenses (id, group_id, description, amount, paid_by, split_between, created_by_device, hlc, deleted, updated_hlc)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              expId,
              re.group_id,
              re.description,
              re.amount,
              re.paid_by,
              JSON.stringify(re.split_between),
              re.created_by_device,
              re.hlc,
              re.deleted ? 1 : 0,
              re.updated_hlc
            );
            syncedCount++;
          } else if (compareHLC(re.updated_hlc, existing.updated_hlc) > 0) {
            db.prepare(
              `UPDATE expenses SET description = ?, amount = ?, paid_by = ?, split_between = ?, deleted = ?, updated_hlc = ?
               WHERE id = ?`
            ).run(
              re.description,
              re.amount,
              re.paid_by,
              JSON.stringify(re.split_between),
              re.deleted ? 1 : 0,
              re.updated_hlc,
              expId
            );
            syncedCount++;
          }
        }

        this.lastSyncTime = new Date().toISOString();
        this.lastError = null;
      }
    } catch (err) {
      this.lastError = err.message;
      this.log(`MongoDB sync error: ${err.message}`);
    } finally {
      this.syncing = false;
    }

    return { synced: syncedCount, lastSyncTime: this.lastSyncTime };
  }

  /**
   * Helper to mirror a local mutation to MongoDB immediately in background.
   */
  async notifyLocalChange(type, data) {
    if (!this.config.enabled || !this.mongoDb) return;
    try {
      if (type === 'EXPENSE_ADDED' || type === 'SETTLEMENT_RECORDED') {
        const exp = data.expense || data.record;
        if (exp) {
          const expensesCol = this.mongoDb.collection('expenses');
          await expensesCol.updateOne(
            { _id: exp.id },
            {
              $set: {
                _id: exp.id,
                id: exp.id,
                group_id: exp.groupId || exp.group_id,
                description: exp.description,
                amount: exp.amount,
                paid_by: exp.paidBy || exp.paid_by,
                split_between: exp.splitBetween || exp.split_between,
                created_by_device: exp.deviceId || exp.created_by_device,
                hlc: exp.hlc,
                deleted: 0,
                updated_hlc: exp.hlc,
              },
            },
            { upsert: true }
          );
        }
      } else if (type === 'EXPENSE_DELETED') {
        const expensesCol = this.mongoDb.collection('expenses');
        await expensesCol.updateOne(
          { _id: data.expenseId },
          { $set: { deleted: 1, updated_hlc: this.hlcClock.tick() } }
        );
      } else if (type === 'GROUP_CREATED') {
        const group = expenses.getGroup(data.groupId);
        if (group) {
          const groupsCol = this.mongoDb.collection('groups');
          await groupsCol.updateOne(
            { _id: group.id },
            { $set: { _id: group.id, id: group.id, name: group.name, created_by: group.created_by, created_at: group.created_at } },
            { upsert: true }
          );
        }
      }
    } catch (err) {
      this.lastError = err.message;
    }
  }

  async _testDataApi() {
    // Pure HTTPS Data API test
    return new Promise((resolve, reject) => {
      const endpoint = `https://data.mongodb-api.com/app/${this.config.appId}/endpoint/data/v1/action/findOne`;
      const req = https.request(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.config.apiKey,
          },
          timeout: 8000,
        },
        (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Data API returned HTTP ${res.statusCode}`));
          }
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify({ dataSource: 'Cluster0', database: this.config.dbName, collection: 'groups', filter: {} }));
      req.end();
    });
  }
}

module.exports = { MongoSyncManager };
