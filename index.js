/**
 * index.js — Entry point.
 * Wires together storage, discovery, sync, HTTPS web server, PWA, and CLI.
 *
 * Run with: node index.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const inquirer = require('inquirer');
const chalk = require('chalk');

const { Discovery } = require('./src/discovery');
const { Sync } = require('./src/sync');
const { HybridLogicalClock } = require('./src/hlc');
const { WebServer } = require('./src/webServer');
const { toTerminal } = require('./src/qrcode');
const { getLocalIPs } = require('./src/cert');
const { mainMenu } = require('./src/cli');

const DATA_DIR = path.join(__dirname, 'data');
const IDENTITY_PATH = path.join(DATA_DIR, 'identity.json');
const SYNC_PORT = 47811; // fixed port for peer mDNS WebSocket sync
const HTTPS_PORT = 8443;  // primary HTTPS port for PWA app
const HTTP_PORT = 8080;   // HTTP port for certificate download & helper

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load or create a persistent device identity.
 */
async function loadOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_PATH)) {
    return JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
  }

  console.log(chalk.bold('\nWelcome to Splitwise P2P — first time setup on this device.\n'));
  const { deviceName } = await inquirer.prompt([
    { type: 'input', name: 'deviceName', message: 'What should we call this device? (e.g. your name)' },
  ]);

  const identity = {
    deviceId: randomUUID().slice(0, 8),
    deviceName: deviceName || 'Unnamed Device',
  };

  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2));
  return identity;
}

async function main() {
  const identity = await loadOrCreateIdentity();
  const { deviceId, deviceName } = identity;

  const hlcClock = new HybridLogicalClock(deviceId);

  let webServer = null;

  const sync = new Sync({
    deviceId,
    deviceName,
    port: SYNC_PORT,
    hlcClock,
    onLog: (msg) => console.log(chalk.gray(`[sync] ${msg}`)),
    onSyncComplete: ({ peerDeviceId, mergedCount }) => {
      if (mergedCount > 0) {
        console.log(chalk.cyan(`\n[sync] Received ${mergedCount} update(s) from a peer. Balances updated.\n`));
        if (webServer) {
          webServer.broadcastUpdate('SYNC_COMPLETE', { peerDeviceId, mergedCount });
        }
      }
    },
  });
  sync.start();

  const discovery = new Discovery({ deviceId, deviceName, port: SYNC_PORT });
  discovery.start({
    onPeerUp: (peer) => {
      console.log(chalk.gray(`[discovery] Found peer: ${peer.name} at ${peer.host}:${peer.port}`));
      sync.connectToPeer(peer);
      if (webServer) {
        webServer.broadcastUpdate('PEER_UP', { peer });
      }
    },
    onPeerDown: (peerDeviceId) => {
      console.log(chalk.gray(`[discovery] Peer disconnected: ${peerDeviceId}`));
      if (webServer) {
        webServer.broadcastUpdate('PEER_DOWN', { peerDeviceId });
      }
    },
  });

  // Start the HTTPS & HTTP Web Server
  webServer = new WebServer({
    deviceId,
    deviceName,
    hlcClock,
    sync,
    discovery,
    httpsPort: HTTPS_PORT,
    httpPort: HTTP_PORT,
  });
  webServer.start();

  const localIPs = getLocalIPs();
  const primaryIp = localIPs[0] || '127.0.0.1';
  const httpsUrl = `https://${primaryIp}:${HTTPS_PORT}`;
  const httpUrl = `http://${primaryIp}:${HTTP_PORT}`;
  const caUrl = `http://${primaryIp}:${HTTP_PORT}/ca.crt`;

  // Print startup banner and Wi-Fi QR Code
  console.log(chalk.bold('\n======================================================'));
  console.log(chalk.bold.green('       Splitwise P2P — Local Mesh Edition'));
  console.log(chalk.bold('======================================================'));
  console.log(`  Device Name     : ${chalk.bold(deviceName)} (${chalk.cyan(deviceId)})`);
  console.log(`  HTTPS App (PWA) : ${chalk.bold.green.underline(httpsUrl)}`);
  console.log(`  HTTP Helper     : ${chalk.underline(httpUrl)}`);
  console.log(`  Root CA Cert    : ${chalk.underline(caUrl)}`);
  console.log(chalk.gray('\n  Scan with phone camera on this Wi-Fi to open & install:'));
  console.log(toTerminal(httpsUrl));
  console.log(chalk.bold('======================================================\n'));

  const ctx = { deviceId, deviceName, hlcClock, discovery, sync, webServer };

  process.on('SIGINT', () => {
    console.log(chalk.gray('\nShutting down...'));
    if (webServer) webServer.stop();
    discovery.stop();
    process.exit(0);
  });

  await mainMenu(ctx);

  console.log(chalk.gray('Background sync and web server are still active. Press Ctrl+C to fully quit.'));
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
