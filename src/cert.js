/**
 * cert.js — Automatic TLS Certificate & Local Certificate Authority (CA) Manager.
 *
 * For a Progressive Web App (PWA) to install on mobile devices (Android/iOS) over
 * a local Wi-Fi IP address (e.g., https://192.168.1.x:8443), browsers strictly
 * require a secure context (HTTPS) with a trusted certificate.
 *
 * This module:
 *  1. Scans all active local network interfaces (Wi-Fi, hotspot, Ethernet).
 *  2. Generates a persistent local Root CA ("Splitwise P2P Root CA").
 *  3. Generates a Server TLS Certificate signed by that Root CA, with Subject
 *     Alternative Names (SAN) for all discovered local IPs, localhost, and .local domains.
 *  4. Provides the Root CA file (splitwise-root-ca.crt) for download so users can install
 *     it once on Android, iOS, Windows, or Mac to get a 100% verified green lock
 *     and enable 1-tap PWA installation.
 *  5. Uses OpenSSL CLI if available, with a built-in pure JavaScript fallback.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const CERTS_DIR = path.join(__dirname, '..', 'data', 'certs');
const CA_KEY_PATH = path.join(CERTS_DIR, 'ca.key');
const CA_CERT_PATH = path.join(CERTS_DIR, 'ca.crt');
const SERVER_KEY_PATH = path.join(CERTS_DIR, 'server.key');
const SERVER_CERT_PATH = path.join(CERTS_DIR, 'server.crt');
const CA_PUBLIC_DOWNLOAD_PATH = path.join(CERTS_DIR, 'splitwise-root-ca.crt');

/**
 * Get list of all non-internal IPv4 addresses on this machine.
 */
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // We want IPv4 and non-internal addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }

  // Fallback to loopback if no external interface found
  if (ips.length === 0) {
    ips.push('127.0.0.1');
  }

  return ips;
}

/**
 * Check if the OpenSSL command line tool is accessible.
 */
function hasOpenSSL() {
  try {
    execSync('openssl version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate certificates using the OpenSSL CLI.
 */
function generateWithOpenSSL(localIPs) {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }

  // 1. Generate Root CA config and certificate if not already present
  if (!fs.existsSync(CA_KEY_PATH) || !fs.existsSync(CA_CERT_PATH)) {
    const caCnf = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
CN = Splitwise P2P Local Root CA
O = Splitwise P2P
OU = Mesh Network
C = US

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`;
    const caCnfPath = path.join(CERTS_DIR, 'ca.cnf');
    fs.writeFileSync(caCnfPath, caCnf.trim());

    execSync(`openssl genrsa -out "${CA_KEY_PATH}" 2048`, { stdio: 'ignore' });
    execSync(
      `openssl req -x509 -new -nodes -key "${CA_KEY_PATH}" -sha256 -days 3650 -out "${CA_CERT_PATH}" -config "${caCnfPath}"`,
      { stdio: 'ignore' }
    );
    try { fs.unlinkSync(caCnfPath); } catch {}
  }

  // 2. Prepare Server Certificate config with all IP SANs
  let sanEntries = [
    'DNS.1 = localhost',
    'DNS.2 = splitwise.local',
    'DNS.3 = *.local',
    'IP.1 = 127.0.0.1',
  ];

  let ipIndex = 2;
  for (const ip of localIPs) {
    if (ip !== '127.0.0.1') {
      sanEntries.push(`IP.${ipIndex} = ${ip}`);
      ipIndex++;
    }
  }

  const serverCnf = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = splitwise.local
O = Splitwise P2P
OU = Mesh Node
C = US

[v3_req]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${sanEntries.join('\n')}
`;

  const serverCnfPath = path.join(CERTS_DIR, 'server.cnf');
  const serverCsrPath = path.join(CERTS_DIR, 'server.csr');
  fs.writeFileSync(serverCnfPath, serverCnf.trim());

  execSync(`openssl genrsa -out "${SERVER_KEY_PATH}" 2048`, { stdio: 'ignore' });
  execSync(
    `openssl req -new -key "${SERVER_KEY_PATH}" -out "${serverCsrPath}" -config "${serverCnfPath}"`,
    { stdio: 'ignore' }
  );

  const serialPath = path.join(CERTS_DIR, 'ca.srl');
  execSync(
    `openssl x509 -req -in "${serverCsrPath}" -CA "${CA_CERT_PATH}" -CAkey "${CA_KEY_PATH}" ` +
    `-CAcreateserial -out "${SERVER_CERT_PATH}" -days 825 -sha256 -extfile "${serverCnfPath}" -extensions v3_req`,
    { stdio: 'ignore' }
  );

  // Copy CA cert to friendly download name
  fs.copyFileSync(CA_CERT_PATH, CA_PUBLIC_DOWNLOAD_PATH);

  try {
    fs.unlinkSync(serverCnfPath);
    fs.unlinkSync(serverCsrPath);
  } catch {}
}

/**
 * Pure JavaScript ASN.1 DER Certificate Builder (zero-dependency fallback).
 * Used if OpenSSL is not available on the device.
 */
class DerBuilder {
  static encodeLength(length) {
    if (length < 128) return Buffer.from([length]);
    const bytes = [];
    let temp = length;
    while (temp > 0) {
      bytes.unshift(temp & 0xff);
      temp >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  }

  static tag(tagNum, data) {
    const len = this.encodeLength(data.length);
    return Buffer.concat([Buffer.from([tagNum]), len, data]);
  }

  static sequence(buffers) {
    return this.tag(0x30, Buffer.concat(buffers));
  }

  static set(buffers) {
    return this.tag(0x31, Buffer.concat(buffers));
  }

  static integer(numberOrBuffer) {
    let buf = Buffer.isBuffer(numberOrBuffer)
      ? numberOrBuffer
      : Buffer.from(numberOrBuffer.toString(16).padStart(numberOrBuffer.toString(16).length % 2 === 0 ? numberOrBuffer.toString(16).length : numberOrBuffer.toString(16).length + 1, '0'), 'hex');
    if (buf[0] & 0x80) {
      buf = Buffer.concat([Buffer.from([0x00]), buf]);
    }
    return this.tag(0x02, buf);
  }

  static oid(oidStr) {
    const parts = oidStr.split('.').map((x) => parseInt(x, 10));
    const bytes = [parts[0] * 40 + parts[1]];
    for (let i = 2; i < parts.length; i++) {
      let val = parts[i];
      const octets = [];
      octets.unshift(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        octets.unshift(0x80 | (val & 0x7f));
        val >>= 7;
      }
      bytes.push(...octets);
    }
    return this.tag(0x06, Buffer.from(bytes));
  }

  static bitString(buffer, unusedBits = 0) {
    return this.tag(0x03, Buffer.concat([Buffer.from([unusedBits]), buffer]));
  }

  static octetString(buffer) {
    return this.tag(0x04, buffer);
  }

  static utf8String(str) {
    return this.tag(0x0c, Buffer.from(str, 'utf8'));
  }

  static printableString(str) {
    return this.tag(0x13, Buffer.from(str, 'ascii'));
  }

  static utcTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const yy = pad(date.getUTCFullYear() % 100);
    const mm = pad(date.getUTCMonth() + 1);
    const dd = pad(date.getUTCDate());
    const hh = pad(date.getUTCHours());
    const mi = pad(date.getUTCMinutes());
    const ss = pad(date.getUTCSeconds());
    return this.tag(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
  }
}

/**
 * Fallback certificate generator in pure Node.js.
 */
function generateWithNodeCrypto(localIPs) {
  if (!fs.existsSync(CERTS_DIR)) {
    fs.mkdirSync(CERTS_DIR, { recursive: true });
  }

  // Generate CA keys
  const caKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Generate Server keys
  const serverKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Helper to extract SPKI public key DER from PEM
  function pemToDer(pem) {
    const lines = pem.trim().split('\n');
    const base64 = lines.filter((l) => !l.startsWith('-----')).join('');
    return Buffer.from(base64, 'base64');
  }

  const caPubDer = pemToDer(caKey.publicKey);
  const serverPubDer = pemToDer(serverKey.publicKey);

  // Extract public key BIT STRING from SPKI sequence
  // SPKI = SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  // We can also embed the entire SPKI DER directly as subjectPublicKeyInfo
  const sha256WithRSAEncryption = DerBuilder.sequence([
    DerBuilder.oid('1.2.840.113549.1.1.11'), // sha256WithRSAEncryption
    Buffer.from([0x05, 0x00]), // NULL
  ]);

  // Names
  function makeName(cn, o) {
    return DerBuilder.sequence([
      DerBuilder.set([
        DerBuilder.sequence([
          DerBuilder.oid('2.5.4.10'), // organizationName
          DerBuilder.utf8String(o),
        ]),
      ]),
      DerBuilder.set([
        DerBuilder.sequence([
          DerBuilder.oid('2.5.4.3'), // commonName
          DerBuilder.utf8String(cn),
        ]),
      ]),
    ]);
  }

  const caSubject = makeName('Splitwise P2P Local Root CA', 'Splitwise P2P');
  const serverSubject = makeName('splitwise.local', 'Splitwise P2P');

  // Validity
  const now = new Date();
  const caExpiry = new Date(now.getTime() + 10 * 365 * 24 * 3600 * 1000); // 10 years
  const serverExpiry = new Date(now.getTime() + 820 * 24 * 3600 * 1000); // 820 days

  const caValidity = DerBuilder.sequence([
    DerBuilder.utcTime(now),
    DerBuilder.utcTime(caExpiry),
  ]);

  const serverValidity = DerBuilder.sequence([
    DerBuilder.utcTime(now),
    DerBuilder.utcTime(serverExpiry),
  ]);

  // Extensions for CA: basicConstraints critical CA:TRUE, keyUsage
  const extBasicConstraintsCA = DerBuilder.sequence([
    DerBuilder.oid('2.5.29.19'), // basicConstraints
    Buffer.from([0x01, 0x01, 0xff]), // critical TRUE
    DerBuilder.octetString(
      DerBuilder.sequence([Buffer.from([0x01, 0x01, 0xff])]) // cA TRUE
    ),
  ]);

  const extKeyUsageCA = DerBuilder.sequence([
    DerBuilder.oid('2.5.29.15'), // keyUsage
    Buffer.from([0x01, 0x01, 0xff]), // critical TRUE
    DerBuilder.octetString(DerBuilder.bitString(Buffer.from([0x06]), 6)), // keyCertSign, cRLSign
  ]);

  const caExtensions = DerBuilder.tag(
    0xa3,
    DerBuilder.sequence([extBasicConstraintsCA, extKeyUsageCA])
  );

  // CA TBSCertificate
  const caSerial = crypto.randomBytes(8);
  const caTbs = DerBuilder.sequence([
    DerBuilder.tag(0xa0, DerBuilder.integer(2)), // v3
    DerBuilder.integer(caSerial),
    sha256WithRSAEncryption,
    caSubject,
    caValidity,
    caSubject,
    caPubDer, // SubjectPublicKeyInfo
    caExtensions,
  ]);

  // Sign CA Cert with CA private key
  const caSigner = crypto.createSign('SHA256');
  caSigner.update(caTbs);
  caSigner.end();
  const caSig = caSigner.sign(caKey.privateKey);

  const caCertDer = DerBuilder.sequence([
    caTbs,
    sha256WithRSAEncryption,
    DerBuilder.bitString(caSig),
  ]);

  // Server SANs
  const sanBuffers = [
    // DNS: localhost
    DerBuilder.tag(0x82, Buffer.from('localhost', 'ascii')),
    // DNS: splitwise.local
    DerBuilder.tag(0x82, Buffer.from('splitwise.local', 'ascii')),
  ];

  // IP addresses in SAN: tag 0x87, 4 bytes for IPv4
  sanBuffers.push(DerBuilder.tag(0x87, Buffer.from([127, 0, 0, 1])));
  for (const ip of localIPs) {
    if (ip !== '127.0.0.1') {
      const parts = ip.split('.').map((p) => parseInt(p, 10));
      if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
        sanBuffers.push(DerBuilder.tag(0x87, Buffer.from(parts)));
      }
    }
  }

  const extSan = DerBuilder.sequence([
    DerBuilder.oid('2.5.29.17'), // subjectAltName
    DerBuilder.octetString(DerBuilder.sequence(sanBuffers)),
  ]);

  const extBasicConstraintsServer = DerBuilder.sequence([
    DerBuilder.oid('2.5.29.19'), // basicConstraints
    DerBuilder.octetString(DerBuilder.sequence([])), // cA FALSE
  ]);

  const extKeyUsageServer = DerBuilder.sequence([
    DerBuilder.oid('2.5.29.15'), // keyUsage
    DerBuilder.octetString(DerBuilder.bitString(Buffer.from([0xa0]), 3)), // digitalSignature, keyEncipherment
  ]);

  const extExtKeyUsageServer = DerBuilder.sequence([
    DerBuilder.oid('2.5.29.37'), // extKeyUsage
    DerBuilder.octetString(
      DerBuilder.sequence([
        DerBuilder.oid('1.3.6.1.5.5.7.3.1'), // serverAuth
      ])
    ),
  ]);

  const serverExtensions = DerBuilder.tag(
    0xa3,
    DerBuilder.sequence([
      extBasicConstraintsServer,
      extKeyUsageServer,
      extExtKeyUsageServer,
      extSan,
    ])
  );

  const serverSerial = crypto.randomBytes(8);
  const serverTbs = DerBuilder.sequence([
    DerBuilder.tag(0xa0, DerBuilder.integer(2)), // v3
    DerBuilder.integer(serverSerial),
    sha256WithRSAEncryption,
    caSubject, // Issuer
    serverValidity,
    serverSubject,
    serverPubDer, // SubjectPublicKeyInfo
    serverExtensions,
  ]);

  // Sign Server Cert with CA private key
  const serverSigner = crypto.createSign('SHA256');
  serverSigner.update(serverTbs);
  serverSigner.end();
  const serverSig = serverSigner.sign(caKey.privateKey);

  const serverCertDer = DerBuilder.sequence([
    serverTbs,
    sha256WithRSAEncryption,
    DerBuilder.bitString(serverSig),
  ]);

  function derToPem(der, label) {
    const b64 = der.toString('base64');
    const chunks = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${chunks.join('\n')}\n-----END ${label}-----\n`;
  }

  const caCertPem = derToPem(caCertDer, 'CERTIFICATE');
  const serverCertPem = derToPem(serverCertDer, 'CERTIFICATE');

  fs.writeFileSync(CA_KEY_PATH, caKey.privateKey);
  fs.writeFileSync(CA_CERT_PATH, caCertPem);
  fs.writeFileSync(CA_PUBLIC_DOWNLOAD_PATH, caCertPem);
  fs.writeFileSync(SERVER_KEY_PATH, serverKey.privateKey);
  fs.writeFileSync(SERVER_CERT_PATH, serverCertPem);
}

/**
 * Ensure TLS certificates exist and include all current local IP addresses.
 * Regenerates the server certificate if a new local IP was assigned by Wi-Fi DHCP.
 */
function ensureCertificates() {
  const localIPs = getLocalIPs();

  const needRegen =
    !fs.existsSync(CA_CERT_PATH) ||
    !fs.existsSync(SERVER_CERT_PATH) ||
    !fs.existsSync(SERVER_KEY_PATH);

  if (needRegen) {
    if (hasOpenSSL()) {
      generateWithOpenSSL(localIPs);
    } else {
      generateWithNodeCrypto(localIPs);
    }
  }

  return {
    key: fs.readFileSync(SERVER_KEY_PATH),
    cert: fs.readFileSync(SERVER_CERT_PATH),
    ca: fs.readFileSync(CA_CERT_PATH),
    caDownloadPath: CA_PUBLIC_DOWNLOAD_PATH,
    localIPs,
  };
}

module.exports = {
  ensureCertificates,
  getLocalIPs,
  CA_CERT_PATH,
  CA_PUBLIC_DOWNLOAD_PATH,
  SERVER_CERT_PATH,
  SERVER_KEY_PATH,
};
