/**
 * webServer.js — Local HTTPS and HTTP Web Server with WebSocket Sync Hub.
 *
 * Responsibilities:
 *  1. Serves the Progressive Web App (PWA) over HTTPS so modern browsers
 *     (Chrome, Safari, Firefox, Edge) treat it as a Secure Context.
 *  2. Serves the Root CA certificate (splitwise-root-ca.crt) over both HTTP and HTTPS
 *     with appropriate MIME types for direct 1-tap installation on Android & iOS.
 *  3. Provides a clean REST API for group management, expenses, balances, and settlements.
 *  4. Provides WebSocket (/ws) connection for real-time live synchronization
 *     with browser clients and mesh peers on the local Wi-Fi.
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const WebSocket = require('ws');

const { ensureCertificates, getLocalIPs } = require('./cert');
const { toSvg } = require('./qrcode');
const { MongoSyncManager } = require('./mongoSync');
const expenses = require('./expenses');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

class WebServer {
  constructor({ deviceId, deviceName, hlcClock, sync, discovery, httpsPort = 8443, httpPort = 8080 }) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.hlcClock = hlcClock;
    this.sync = sync;
    this.discovery = discovery;
    this.httpsPort = httpsPort;
    this.httpPort = httpPort;

    this.tlsConfig = null;
    this.httpsServer = null;
    this.httpServer = null;
    this.wss = null;
    this.browserClients = new Set();

    // Initialize MongoDB Cloud Addon
    this.mongoSync = new MongoSyncManager({
      hlcClock: this.hlcClock,
      onLog: (msg) => console.log(`[mongo] ${msg}`),
    });
  }

  start() {
    this.tlsConfig = ensureCertificates();

    // 1. Create HTTPS Server (Primary interface for PWA)
    this.httpsServer = https.createServer(
      {
        key: this.tlsConfig.key,
        cert: this.tlsConfig.cert,
      },
      (req, res) => this._handleRequest(req, res, true)
    );

    // Attach WebSocket server for real-time sync with browser clients
    this.wss = new WebSocket.Server({ server: this.httpsServer, path: '/ws' });
    this.wss.on('connection', (ws) => this._handleBrowserSocket(ws));

    // 2. Create HTTP Server (Helper for downloading Root CA and redirection)
    this.httpServer = http.createServer((req, res) => this._handleRequest(req, res, false));

    this.httpsServer.listen(this.httpsPort, '0.0.0.0');
    this.httpServer.listen(this.httpPort, '0.0.0.0');
  }

  stop() {
    if (this.wss) this.wss.close();
    if (this.httpsServer) this.httpsServer.close();
    if (this.httpServer) this.httpServer.close();
  }

  /**
   * Broadcast an update event to all connected web browsers
   * (e.g. when an expense is added or synced).
   */
  broadcastUpdate(eventType, data = {}) {
    // Notify MongoDB Cloud Addon if enabled
    if (this.mongoSync) {
      this.mongoSync.notifyLocalChange(eventType, data).catch(() => {});
    }

    const payload = JSON.stringify({ type: eventType, data });
    for (const client of this.browserClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  _handleBrowserSocket(ws) {
    this.browserClients.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        } else if (msg.type === 'REFRESH_REQUEST') {
          ws.send(JSON.stringify({ type: 'REFRESH_RESPONSE', timestamp: Date.now() }));
        }
      } catch {}
    });

    ws.on('close', () => {
      this.browserClients.delete(ws);
    });

    ws.on('error', () => {
      this.browserClients.delete(ws);
    });
  }

  _handleRequest(req, res, isHttps) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // CORS Headers for local network discovery & testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Certificate Download Endpoints
    if (
      pathname === '/ca.crt' ||
      pathname === '/splitwise-root-ca.crt' ||
      pathname === '/cert'
    ) {
      const caPath = this.tlsConfig.caDownloadPath;
      if (fs.existsSync(caPath)) {
        const certData = fs.readFileSync(caPath);
        res.writeHead(200, {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="splitwise-root-ca.crt"',
          'Content-Length': certData.length,
          'Cache-Control': 'no-cache',
        });
        res.end(certData);
        return;
      }
    }

    // 2. REST API Endpoints
    if (pathname.startsWith('/api/')) {
      this._handleApiRequest(req, res, pathname, parsed.query);
      return;
    }

    // 3. Static Files (PWA)
    this._handleStaticFile(req, res, pathname);
  }

  _handleApiRequest(req, res, pathname, query) {
    const sendJson = (statusCode, data) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(data));
    };

    const parseBody = (callback) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          callback(null, parsed);
        } catch (err) {
          callback(err);
        }
      });
    };

    // GET /api/info
    if (pathname === '/api/info' && req.method === 'GET') {
      const localIPs = getLocalIPs();
      const peers = this.discovery ? this.discovery.getPeers() : [];
      const connectedCount = this.sync ? this.sync.connectedPeers.size : 0;

      sendJson(200, {
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        localIPs,
        httpsPort: this.httpsPort,
        httpPort: this.httpPort,
        peers,
        connectedCount,
        hasCert: fs.existsSync(this.tlsConfig.caDownloadPath),
        mongoStatus: this.mongoSync ? this.mongoSync.getStatus() : null,
      });
      return;
    }

    // GET /api/qr?text=...
    if (pathname === '/api/qr' && req.method === 'GET') {
      const text = query.text || `https://${getLocalIPs()[0]}:${this.httpsPort}`;
      const svg = toSvg(text);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(svg);
      return;
    }

    // GET /api/groups
    if (pathname === '/api/groups' && req.method === 'GET') {
      const groups = expenses.listGroups();
      const detailed = groups.map((g) => {
        const members = expenses.listMembers(g.id);
        const expList = expenses.listExpenses(g.id);
        const totalAmount = expList.reduce((sum, e) => sum + e.amount, 0);
        const balances = expenses.computeBalances(g.id);
        return {
          ...g,
          members,
          expenseCount: expList.length,
          totalAmount: Math.round(totalAmount * 100) / 100,
          balances,
        };
      });
      sendJson(200, detailed);
      return;
    }

    // POST /api/groups (Create group)
    if (pathname === '/api/groups' && req.method === 'POST') {
      parseBody((err, body) => {
        if (err || !body.name) {
          sendJson(400, { error: 'Group name is required' });
          return;
        }
        const memberName = body.yourName || this.deviceName;
        const group = expenses.createGroup(body.name, this.deviceId, memberName);
        this.broadcastUpdate('GROUP_CREATED', { groupId: group.id });
        sendJson(201, group);
      });
      return;
    }

    // POST /api/groups/join (Join group by ID)
    if (pathname === '/api/groups/join' && req.method === 'POST') {
      parseBody((err, body) => {
        if (err || !body.groupId) {
          sendJson(400, { error: 'Group ID is required' });
          return;
        }
        const memberName = body.yourName || this.deviceName;
        expenses.joinGroupStub(body.groupId.trim(), this.deviceId, memberName);
        this.broadcastUpdate('GROUP_JOINED', { groupId: body.groupId.trim() });
        sendJson(200, { success: true, groupId: body.groupId.trim() });
      });
      return;
    }

    // GET /api/groups/:id
    const groupDetailMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)$/);
    if (groupDetailMatch && req.method === 'GET') {
      const groupId = groupDetailMatch[1];
      const group = expenses.getGroup(groupId);
      if (!group) {
        sendJson(404, { error: 'Group not found' });
        return;
      }
      const members = expenses.listMembers(groupId);
      const expList = expenses.listExpenses(groupId);
      const balances = expenses.computeBalances(groupId);
      const settlements = expenses.simplifyDebts(groupId);

      sendJson(200, {
        group,
        members,
        expenses: expList,
        balances,
        settlements,
      });
      return;
    }

    // POST /api/groups/:id/expenses
    const addExpenseMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/expenses$/);
    if (addExpenseMatch && req.method === 'POST') {
      const groupId = addExpenseMatch[1];
      parseBody((err, body) => {
        if (err || !body.description || !body.amount || !body.paidBy || !body.splitBetween) {
          sendJson(400, { error: 'Invalid expense parameters' });
          return;
        }
        const amount = parseFloat(body.amount);
        if (isNaN(amount) || amount <= 0) {
          sendJson(400, { error: 'Amount must be a positive number' });
          return;
        }

        const exp = expenses.addExpense(this.hlcClock, {
          groupId,
          description: body.description,
          amount,
          paidBy: body.paidBy,
          splitBetween: body.splitBetween,
          deviceId: this.deviceId,
        });

        this.broadcastUpdate('EXPENSE_ADDED', { groupId, expense: exp });
        sendJson(201, exp);
      });
      return;
    }

    // DELETE /api/groups/:id/expenses/:expenseId
    const delExpenseMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/expenses\/([a-zA-Z0-9_-]+)$/);
    if (delExpenseMatch && req.method === 'DELETE') {
      const groupId = delExpenseMatch[1];
      const expenseId = delExpenseMatch[2];

      expenses.deleteExpense(this.hlcClock, expenseId);
      this.broadcastUpdate('EXPENSE_DELETED', { groupId, expenseId });
      sendJson(200, { success: true });
      return;
    }

    // POST /api/groups/:id/settle (Settle debts)
    const settleMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/settle$/);
    if (settleMatch && req.method === 'POST') {
      const groupId = settleMatch[1];
      parseBody((err, body) => {
        if (err || !body.payerMemberId || !body.receiverMemberId || !body.amount) {
          sendJson(400, { error: 'payerMemberId, receiverMemberId and amount required' });
          return;
        }

        const amount = parseFloat(body.amount);
        const record = expenses.settleDebt(this.hlcClock, {
          groupId,
          payerMemberId: body.payerMemberId,
          receiverMemberId: body.receiverMemberId,
          amount,
          deviceId: this.deviceId,
        });

        this.broadcastUpdate('SETTLEMENT_RECORDED', { groupId, record });
        sendJson(201, record);
      });
      return;
    }

    // GET /api/peers
    if (pathname === '/api/peers' && req.method === 'GET') {
      const peers = this.discovery ? this.discovery.getPeers() : [];
      const connected = this.sync ? Array.from(this.sync.connectedPeers) : [];
      sendJson(200, { peers, connected });
      return;
    }

    // POST /api/peers/connect
    if (pathname === '/api/peers/connect' && req.method === 'POST') {
      parseBody((err, body) => {
        if (!body.host || !body.port) {
          sendJson(400, { error: 'host and port required' });
          return;
        }
        if (this.sync) {
          this.sync.connectManual(body.host, parseInt(body.port, 10));
          sendJson(200, { success: true, message: `Connecting to ${body.host}:${body.port}` });
        } else {
          sendJson(500, { error: 'Sync module not ready' });
        }
      });
      return;
    }

    // --- MongoDB Addon Endpoints ---

    // GET /api/addon/mongo
    if (pathname === '/api/addon/mongo' && req.method === 'GET') {
      sendJson(200, this.mongoSync.getStatus());
      return;
    }

    // POST /api/addon/mongo (Save and test config)
    if (pathname === '/api/addon/mongo' && req.method === 'POST') {
      parseBody(async (err, body) => {
        if (err) {
          sendJson(400, { error: 'Invalid JSON body' });
          return;
        }
        const result = await this.mongoSync.saveConfig(body);
        this.broadcastUpdate('MONGO_CONFIG_CHANGED', this.mongoSync.getStatus());
        sendJson(result.success ? 200 : 400, result);
      });
      return;
    }

    // DELETE /api/addon/mongo (Disable addon)
    if (pathname === '/api/addon/mongo' && req.method === 'DELETE') {
      this.mongoSync.saveConfig({ enabled: false }).then((result) => {
        this.broadcastUpdate('MONGO_CONFIG_CHANGED', this.mongoSync.getStatus());
        sendJson(200, result);
      });
      return;
    }

    // POST /api/addon/mongo/sync (Manual sync trigger)
    if (pathname === '/api/addon/mongo/sync' && req.method === 'POST') {
      this.mongoSync.sync().then((result) => {
        this.broadcastUpdate('MONGO_SYNC_COMPLETE', result);
        sendJson(200, result);
      }).catch((err) => {
        sendJson(500, { error: err.message });
      });
      return;
    }

    sendJson(404, { error: 'API endpoint not found' });
  }

  _handleStaticFile(req, res, pathname) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      // Fallback to index.html for SPA client-side routing
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        this._sendFile(res, indexPath, 'text/html; charset=utf-8');
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.crt': 'application/x-x509-ca-cert',
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const isServiceWorker = path.basename(fullPath) === 'sw.js';

    const extraHeaders = {};
    if (isServiceWorker) {
      // Service worker must never be cached and needs root scope access
      extraHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      extraHeaders['Service-Worker-Allowed'] = '/';
    } else if (ext === '.html') {
      extraHeaders['Cache-Control'] = 'no-cache';
    } else {
      extraHeaders['Cache-Control'] = 'public, max-age=3600';
    }

    this._sendFile(res, fullPath, contentType, extraHeaders);
  }

  _sendFile(res, filePath, contentType, extraHeaders = {}) {
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        ...extraHeaders,
      });
      res.end(data);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading asset');
    }
  }
}

module.exports = { WebServer };
