/**
 * Hybrid Logical Clock (HLC)
 *
 * Produces timestamps that are comparable and totally ordered across
 * multiple devices, even when their system clocks are not in sync.
 *
 * Format of a timestamp: "<physical_ms>-<logical_counter>-<device_id>"
 * e.g. "1751702400000-0003-a1b2c3d4"
 *
 * Rules:
 *  - Every local event (e.g. adding an expense) calls tick()
 *  - Every time we receive an event from a peer, we call update(remoteTs)
 *    to fold the peer's clock into ours, so our clock never falls behind
 *    the rest of the network.
 *  - Comparing two HLC timestamps with compare() gives a consistent,
 *    total order — used to decide "last write wins" during merges.
 */

class HybridLogicalClock {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.lastPhysical = 0;
    this.counter = 0;
  }

  /**
   * Generate a new timestamp for a local event.
   */
  tick() {
    const now = Date.now();

    if (now > this.lastPhysical) {
      this.lastPhysical = now;
      this.counter = 0;
    } else {
      // Clock hasn't advanced (or went backwards) — bump the counter
      // to keep events ordered.
      this.counter += 1;
    }

    return this._format();
  }

  /**
   * Fold in a timestamp received from a peer. Call this whenever we
   * receive an event during sync, BEFORE persisting it, so our own
   * clock stays ahead of anything we've seen.
   */
  update(remoteTsString) {
    const { physical: remotePhysical, counter: remoteCounter } =
      this._parse(remoteTsString);
    const now = Date.now();

    const maxPhysical = Math.max(this.lastPhysical, remotePhysical, now);

    if (maxPhysical === this.lastPhysical && maxPhysical === remotePhysical) {
      this.counter = Math.max(this.counter, remoteCounter) + 1;
    } else if (maxPhysical === this.lastPhysical) {
      this.counter += 1;
    } else if (maxPhysical === remotePhysical) {
      this.counter = remoteCounter + 1;
    } else {
      this.counter = 0;
    }

    this.lastPhysical = maxPhysical;
    return this._format();
  }

  _format() {
    const physicalStr = String(this.lastPhysical).padStart(15, '0');
    const counterStr = String(this.counter).padStart(4, '0');
    return `${physicalStr}-${counterStr}-${this.deviceId}`;
  }

  _parse(tsString) {
    const [physicalStr, counterStr] = tsString.split('-');
    return {
      physical: parseInt(physicalStr, 10),
      counter: parseInt(counterStr, 10),
    };
  }
}

/**
 * Compare two HLC timestamp strings.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * Because of the zero-padded format, plain string comparison
 * already gives the correct total order.
 */
function compareHLC(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

module.exports = { HybridLogicalClock, compareHLC };
