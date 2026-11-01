/**
 * discovery.js — LAN peer discovery using mDNS (via bonjour-service).
 *
 * Each device advertises itself as a "_splitwisep2p._tcp" service on the
 * local network, and simultaneously browses for other instances of the
 * same service. When a peer appears or disappears, we notify sync.js
 * via the callbacks passed into start().
 *
 * No internet, no central server — this only works on the same LAN/WiFi.
 */

const { Bonjour } = require('bonjour-service');

const SERVICE_TYPE = 'splitwisep2p';

class Discovery {
  constructor({ deviceId, deviceName, port }) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.port = port;
    this.bonjour = new Bonjour();
    this.peers = new Map(); // deviceId -> { name, host, port, addresses }
    this.onPeerUp = null;
    this.onPeerDown = null;
  }

  /**
   * Start advertising this device and browsing for peers.
   * onPeerUp(peer) and onPeerDown(deviceId) are called as peers come/go.
   */
  start({ onPeerUp, onPeerDown } = {}) {
    this.onPeerUp = onPeerUp;
    this.onPeerDown = onPeerDown;

    // Advertise ourselves
    this.service = this.bonjour.publish({
      name: `${this.deviceName}-${this.deviceId}`,
      type: SERVICE_TYPE,
      port: this.port,
      txt: {
        deviceId: this.deviceId,
        deviceName: this.deviceName,
      },
    });

    // Browse for others
    this.browser = this.bonjour.find({ type: SERVICE_TYPE }, (service) => {
      this._handleServiceUp(service);
    });

    this.browser.on('up', (service) => this._handleServiceUp(service));
    this.browser.on('down', (service) => this._handleServiceDown(service));
  }

  _handleServiceUp(service) {
    const remoteDeviceId = service.txt && service.txt.deviceId;
    if (!remoteDeviceId || remoteDeviceId === this.deviceId) return; // ignore self

    const addresses = service.addresses || [];
    // Prefer an IPv4 address for simplicity
    const ipv4 = addresses.find((a) => a.includes('.')) || addresses[0];

    const peer = {
      deviceId: remoteDeviceId,
      name: service.txt.deviceName || service.name,
      host: ipv4,
      port: service.port,
    };

    const isNew = !this.peers.has(remoteDeviceId);
    this.peers.set(remoteDeviceId, peer);

    if (isNew && this.onPeerUp) {
      this.onPeerUp(peer);
    }
  }

  _handleServiceDown(service) {
    const remoteDeviceId = service.txt && service.txt.deviceId;
    if (!remoteDeviceId) return;

    if (this.peers.has(remoteDeviceId)) {
      this.peers.delete(remoteDeviceId);
      if (this.onPeerDown) this.onPeerDown(remoteDeviceId);
    }
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  stop() {
    if (this.service) this.service.stop();
    if (this.browser) this.browser.stop();
    this.bonjour.destroy();
  }
}

module.exports = { Discovery };
