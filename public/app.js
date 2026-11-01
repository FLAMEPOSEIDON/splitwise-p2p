/**
 * app.js — Unified Client Application for Splitwise P2P.
 * Supports:
 *  - Indian Rupees (INR / ₹) currency formatting across all views
 *  - Official Splitwise CSV Import (e.g. export.csv) & Export
 *  - Category management (Groceries, Dining out, Rent, Cleaning, General, etc.)
 *  - Date-based expense tracking & real-time search/filters
 *  - 1-Tap Google Code Scanner & QR Code Generator
 *  - Offline Mesh Sync via Google Quick Share (Nearby Connections) & Local Wi-Fi
 *  - UPI 1-Tap settlement links (GPay, PhonePe, Paytm)
 *  - Dual Native Android APK + PWA Web mode
 */

// State
const state = {
  activeView: 'view-groups',
  activeGroupId: null,
  activeDetailTab: 'expenses',
  info: null,
  groups: [],
  currentGroupData: null,
  ws: null,
  wsConnected: false,
  deferredInstallPrompt: null,
  pendingSettlement: null,
  editingExpenseId: null,
  categoryFilter: 'ALL',
  searchQuery: '',
  splitMode: 'EQUAL', // 'EQUAL' or 'CUSTOM'
  activeActivityGroupFilter: 'ALL',
  latestUpdateData: null,
};

const CATEGORY_ICONS = {
  'Groceries': '🥦',
  'Dining out': '🍔',
  'Rent': '🏠',
  'Household supplies': '🧻',
  'Cleaning': '🧹',
  'Payment': '🤝',
  'Utilities': '💡',
  'Transportation': '🚗',
  'Entertainment': '🎬',
  'General': '🧾',
};

// DOM Elements
const el = {
  brandHome: document.getElementById('brand-home'),
  statusPill: document.getElementById('status-pill'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  installBanner: document.getElementById('install-banner'),
  btnInstallPwa: document.getElementById('btn-install-pwa'),
  btnCertHeader: document.getElementById('btn-cert-header'),
  btnHeaderScanQr: document.getElementById('btn-header-scan-qr'),
  btnHeaderUpdate: document.getElementById('btn-header-update'),

  // First-Time Registration & Profile
  modalWelcomeRegister: document.getElementById('modal-welcome-register'),
  formWelcomeRegister: document.getElementById('form-welcome-register'),
  inputWelcomeName: document.getElementById('input-welcome-name'),

  profileCardAvatar: document.getElementById('profile-card-avatar'),
  profileCardName: document.getElementById('profile-card-name'),
  profileCardDevId: document.getElementById('profile-card-dev-id'),
  btnEditProfileNetwork: document.getElementById('btn-edit-profile-network'),

  modalProfile: document.getElementById('modal-profile'),
  formProfileName: document.getElementById('form-profile-name'),
  inputProfileName: document.getElementById('input-profile-name'),
  profileModalAvatar: document.getElementById('profile-modal-avatar'),

  // CSV
  csvUploadTrigger: document.getElementById('csv-upload-trigger'),
  csvFileStatus: document.getElementById('csv-file-status'),

  // Views
  viewGroups: document.getElementById('view-groups'),
  viewActivity: document.getElementById('view-activity'),
  viewGroupDetail: document.getElementById('view-group-detail'),
  viewNetwork: document.getElementById('view-network'),
  viewCert: document.getElementById('view-cert'),
  viewMongo: document.getElementById('view-mongo'),

  // Activity Feed
  activityListContainer: document.getElementById('activity-list-container'),
  activityGroupFilterChips: document.getElementById('activity-group-filter-chips'),
  activityBadge: document.getElementById('activity-badge'),

  // Updates & GitHub
  modalUpdateAvailable: document.getElementById('modal-update-available'),
  updateModalTitle: document.getElementById('update-modal-title'),
  updateModalDesc: document.getElementById('update-modal-desc'),
  updateCommitMessage: document.getElementById('update-commit-message'),
  updateCommitMeta: document.getElementById('update-commit-meta'),
  btnPerformUpdate: document.getElementById('btn-perform-update'),
  appVersionLabel: document.getElementById('app-version-label'),
  updateStatusText: document.getElementById('update-status-text'),

  // Hero
  heroBalance: document.getElementById('hero-balance'),
  heroOwed: document.getElementById('hero-owed'),
  heroOwe: document.getElementById('hero-owe'),

  // Groups
  groupListContainer: document.getElementById('group-list-container'),
  btnCreateGroupModal: document.getElementById('btn-create-group-modal'),
  btnCreateFirstGroup: document.getElementById('btn-create-first-group'),
  btnJoinGroupModal: document.getElementById('btn-join-group-modal'),
  btnImportCsvHome: document.getElementById('btn-import-csv-home'),
  btnBackToGroups: document.getElementById('btn-back-to-groups'),

  // Group Detail
  detailGroupName: document.getElementById('detail-group-name'),
  detailGroupId: document.getElementById('detail-group-id'),
  detailGroupMeta: document.getElementById('detail-group-meta'),
  detailGroupBalance: document.getElementById('detail-group-balance'),
  btnShowGroupQr: document.getElementById('btn-show-group-qr'),
  btnImportCsvDetail: document.getElementById('btn-import-csv-detail'),
  btnExportCsv: document.getElementById('btn-export-csv'),

  tabContentExpenses: document.getElementById('tab-content-expenses'),
  tabContentBalances: document.getElementById('tab-content-balances'),
  tabContentMembers: document.getElementById('tab-content-members'),
  expensesListContainer: document.getElementById('expenses-list-container'),
  settlementsListContainer: document.getElementById('settlements-list-container'),
  balancesListContainer: document.getElementById('balances-list-container'),
  membersListContainer: document.getElementById('members-list-container'),
  groupQrContainer: document.getElementById('group-qr-container'),
  btnCopyGroupId: document.getElementById('btn-copy-group-id'),
  fabAddExpense: document.getElementById('fab-add-expense'),

  // Filters
  expenseSearchInput: document.getElementById('expense-search-input'),
  categoryFilterChips: document.getElementById('category-filter-chips'),

  // Network
  netDeviceId: document.getElementById('net-device-id'),
  netDeviceName: document.getElementById('net-device-name'),
  netLocalIp: document.getElementById('net-local-ip'),
  peersListContainer: document.getElementById('peers-list-container'),
  btnManualPeerModal: document.getElementById('btn-manual-peer-modal'),

  // Modals
  modalAddExpense: document.getElementById('modal-add-expense'),
  formAddExpense: document.getElementById('form-add-expense'),
  modalExpenseTitle: document.getElementById('modal-expense-title'),
  btnSubmitExpense: document.getElementById('btn-submit-expense'),
  expDesc: document.getElementById('exp-desc'),
  expAmount: document.getElementById('exp-amount'),
  expDate: document.getElementById('exp-date'),
  expCategory: document.getElementById('exp-category'),
  expPaidByLabel: document.getElementById('exp-paid-by-label'),
  expPaidBy: document.getElementById('exp-paid-by'),
  groupSplitMethod: document.getElementById('group-split-method'),
  expSplitCheckboxes: document.getElementById('exp-split-checkboxes'),
  expCustomSplitContainer: document.getElementById('exp-custom-split-container'),
  expCustomSplitInputs: document.getElementById('exp-custom-split-inputs'),
  btnSplitEqual: document.getElementById('btn-split-equal'),
  btnSplitCustom: document.getElementById('btn-split-custom'),

  // Split Math Bar
  splitMathBar: document.getElementById('split-math-bar'),
  mathTotal: document.getElementById('math-total'),
  mathAllocated: document.getElementById('math-allocated'),
  mathRemaining: document.getElementById('math-remaining'),
  btnAutoSplitRemaining: document.getElementById('btn-auto-split-remaining'),
  btnResetEqualShares: document.getElementById('btn-reset-equal-shares'),

  modalCreateGroup: document.getElementById('modal-create-group'),
  formCreateGroup: document.getElementById('form-create-group'),
  createGroupName: document.getElementById('create-group-name'),
  createYourName: document.getElementById('create-your-name'),

  modalJoinGroup: document.getElementById('modal-join-group'),
  formJoinGroup: document.getElementById('form-join-group'),
  joinGroupId: document.getElementById('join-group-id'),
  joinYourName: document.getElementById('join-your-name'),
  btnScanQrJoin: document.getElementById('btn-scan-qr-join'),

  modalImportCsv: document.getElementById('modal-import-csv'),
  btnQuickImportDownloads: document.getElementById('btn-quick-import-downloads'),
  csvFileInput: document.getElementById('csv-file-input'),
  csvGroupName: document.getElementById('csv-group-name'),
  btnRunCsvImport: document.getElementById('btn-run-csv-import'),

  modalGroupQr: document.getElementById('modal-group-qr'),
  modalQrDisplay: document.getElementById('modal-qr-display'),
  modalQrSubtext: document.getElementById('modal-qr-subtext'),
  btnModalCopyGid: document.getElementById('btn-modal-copy-gid'),

  modalManualPeer: document.getElementById('modal-manual-peer'),
  formManualPeer: document.getElementById('form-manual-peer'),
  peerHost: document.getElementById('peer-host'),
  peerPort: document.getElementById('peer-port'),

  modalSettleUp: document.getElementById('modal-settle-up'),
  settleSummaryText: document.getElementById('settle-summary-text'),
  btnConfirmSettle: document.getElementById('btn-confirm-settle'),

  toast: document.getElementById('toast'),
};

// -------------------------------------------------------------
// 1. Currency & Utility Helpers (INR / ₹)
// -------------------------------------------------------------

function formatMoney(amount) {
  const num = Math.abs(amount || 0);
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}₹${formatted}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) {
    return dateStr;
  }
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 3200);
}

// -------------------------------------------------------------
// 2. IndexedDB Offline Cache
// -------------------------------------------------------------
const IDB_NAME = 'SplitwiseP2P_DB';
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('groupData')) db.createObjectStore('groupData', { keyPath: 'groupId' });
      if (!db.objectStoreNames.contains('info')) db.createObjectStore('info', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(storeName, item) {
  try {
    const db = await openIDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
  } catch (_) {}
}

async function idbGet(storeName, key) {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

// -------------------------------------------------------------
// 3. Modals & View Switching
// -------------------------------------------------------------

function safeOn(element, event, handler) {
  if (element) {
    element.addEventListener(event, handler);
  }
}

function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('open');
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('open');
}

window.openModal = openModal;
window.closeModal = closeModal;
window.switchView = switchView;

document.querySelectorAll('.btn-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    const modalId = btn.getAttribute('data-close');
    if (modalId) closeModal(modalId);
  });
});

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

function switchView(viewId) {
  state.activeView = viewId;
  const views = ['view-groups', 'view-activity', 'view-group-detail', 'view-network', 'view-cert', 'view-mongo'];
  views.forEach((v) => {
    const elem = document.getElementById(v);
    if (elem) elem.style.display = v === viewId ? 'block' : 'none';
  });

  if (viewId === 'view-activity') {
    loadActivityFeed();
  }

  if (el.fabAddExpense) {
    el.fabAddExpense.style.display = viewId === 'view-group-detail' ? 'flex' : 'none';
  }

  document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
    if (item.getAttribute('data-view') === viewId) item.classList.add('active');
    else item.classList.remove('active');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// -------------------------------------------------------------
// 4. API Requests (Dual Native APK + Web/PWA)
// -------------------------------------------------------------
const isNativeApp = typeof window.AndroidBridge !== 'undefined';

if (isNativeApp) {
  window.onSyncUpdate = function(eventType) {
    if (eventType === 'DATA_MERGED') {
      refreshData();
      if (state.activeGroupId) {
        loadGroupDetail(state.activeGroupId, false);
      }
      if (state.activeView === 'view-activity') {
        loadActivityFeed();
      }
    } else if (eventType && eventType.includes('PEER')) {
      loadInfo();
    }
  };

  window.onGroupJoinedViaQr = async function(groupId) {
    showToast('Group joined via QR! Syncing...');
    await refreshData();
    openGroupDetail(groupId);
  };
}

async function fetchApi(endpoint, options = {}) {
  if (isNativeApp) {
    try {
      if (endpoint === '/api/info') {
        const info = JSON.parse(window.AndroidBridge.getDeviceInfo());
        const peers = JSON.parse(window.AndroidBridge.getPeers() || '[]');
        return {
          deviceId: info.deviceId,
          deviceName: info.deviceName,
          nameConfigured: info.nameConfigured === true,
          localIPs: [info.ip || '127.0.0.1'],
          httpsPort: info.port || 47811,
          peers: peers,
          isNativeApp: true,
        };
      }
      if (endpoint === '/api/groups' && (!options.method || options.method === 'GET')) {
        return JSON.parse(window.AndroidBridge.getGroups() || '[]');
      }
      if (endpoint === '/api/groups' && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        return JSON.parse(window.AndroidBridge.createGroup(body.name, body.yourName || 'Me'));
      }
      if (endpoint === '/api/groups/join' && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        return JSON.parse(window.AndroidBridge.joinGroup(body.groupId, body.yourName || 'Me'));
      }
      const matchDetail = endpoint.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)$/);
      if (matchDetail && (!options.method || options.method === 'GET')) {
        return JSON.parse(window.AndroidBridge.getGroupDetail(matchDetail[1]));
      }
      const matchAddExp = endpoint.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/expenses$/);
      if (matchAddExp && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        return JSON.parse(window.AndroidBridge.addExpense(
          matchAddExp[1],
          body.description,
          body.amount,
          body.paidBy,
          JSON.stringify(body.splitBetween || []),
          body.category || 'General',
          body.date || ''
        ));
      }
      const matchDelExp = endpoint.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/expenses\/([a-zA-Z0-9_-]+)$/);
      if (matchDelExp && options.method === 'DELETE') {
        window.AndroidBridge.deleteExpense(matchDelExp[1], matchDelExp[2]);
        return { success: true };
      }
      if (matchDelExp && options.method === 'PUT') {
        const body = JSON.parse(options.body || '{}');
        return JSON.parse(window.AndroidBridge.updateExpense(
          matchDelExp[1],
          matchDelExp[2],
          body.description,
          body.amount,
          body.paidBy,
          JSON.stringify(body.splitBetween || []),
          body.category || 'General',
          body.date || ''
        ));
      }
      const matchSettle = endpoint.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/settle$/);
      if (matchSettle && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        return JSON.parse(window.AndroidBridge.settleDebt(
          matchSettle[1],
          body.payerMemberId,
          body.receiverMemberId,
          body.amount
        ));
      }
      if (endpoint === '/api/groups/import-csv' && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.useLocalFile) {
          return JSON.parse(window.AndroidBridge.importLocalExportCsv());
        } else {
          return JSON.parse(window.AndroidBridge.importCsv(body.csv || '', body.groupId || '', body.groupName || 'Flat Expenses'));
        }
      }
      const matchExport = endpoint.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/export-csv$/);
      if (matchExport && (!options.method || options.method === 'GET')) {
        return window.AndroidBridge.exportCsv(matchExport[1]);
      }
      if (endpoint.startsWith('/api/activity')) {
        const urlParams = new URLSearchParams(endpoint.includes('?') ? endpoint.split('?')[1] : '');
        const gid = urlParams.get('groupId') || '';
        return JSON.parse(window.AndroidBridge.getActivityFeed(gid) || '[]');
      }
      if (endpoint === '/api/version') {
        const nativeVer = (typeof window.AndroidBridge.getAppVersion === 'function')
          ? window.AndroidBridge.getAppVersion()
          : '1.2.0';
        return {
          version: nativeVer,
          repo: 'FLAMEPOSEIDON/splitwise-p2p',
          branch: 'main',
          downloadUrl: 'https://github.com/FLAMEPOSEIDON/splitwise-p2p/releases/latest/download/SplitwiseP2P.apk',
          commitsApiUrl: 'https://api.github.com/repos/FLAMEPOSEIDON/splitwise-p2p/commits/main',
        };
      }
      if (endpoint === '/api/peers' && (!options.method || options.method === 'GET')) {
        const peers = JSON.parse(window.AndroidBridge.getPeers() || '[]');
        return { peers, connected: [] };
      }
      if (endpoint === '/api/peers/connect' && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        window.AndroidBridge.connectPeer(body.host, body.port);
        return { success: true, message: `Connecting to ${body.host}:${body.port}` };
      }
    } catch (e) {
      console.error('Android bridge error:', e);
      return null;
    }
  }

  // Web / PWA browser mode
  try {
    const res = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('text/csv')) {
      return await res.text();
    }
    return await res.json();
  } catch (err) {
    return null;
  }
}

// -------------------------------------------------------------
// 5. WebSocket Live Mesh Sync (Web Mode)
// -------------------------------------------------------------

function connectWebSocket() {
  if (isNativeApp) return;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws`;

  el.statusDot.className = 'status-dot syncing';
  el.statusText.textContent = 'Connecting...';

  try {
    state.ws = new WebSocket(wsUrl);
    state.ws.onopen = () => {
      state.wsConnected = true;
      el.statusDot.className = 'status-dot online';
      el.statusText.textContent = 'Wi-Fi Synced';
      refreshData();
    };
    state.ws.onmessage = (event) => {
      try {
        refreshData();
        if (state.activeGroupId) loadGroupDetail(state.activeGroupId, false);
        if (state.activeView === 'view-activity') loadActivityFeed();
      } catch (_) {}
    };
    state.ws.onclose = () => {
      state.wsConnected = false;
      el.statusDot.className = 'status-dot';
      el.statusText.textContent = 'Offline';
      setTimeout(connectWebSocket, 4000);
    };
    state.ws.onerror = () => state.ws.close();
  } catch (_) {
    el.statusDot.className = 'status-dot';
    el.statusText.textContent = 'Offline';
    setTimeout(connectWebSocket, 4000);
  }
}

// -------------------------------------------------------------
// 6. Device Info & Network Mesh Rendering
// -------------------------------------------------------------

async function loadInfo() {
  const info = await fetchApi('/api/info');
  if (info) {
    state.info = info;
    idbSave('info', { id: 'device_info', ...info });
    renderInfo();
  } else {
    const cached = await idbGet('info', 'device_info');
    if (cached) {
      state.info = cached;
      renderInfo();
    }
  }
}

function renderInfo() {
  if (!state.info) return;
  const dName = state.info.deviceName || 'You';
  const initial = (dName.replace(/^Android User /i, '')[0] || '👤').toUpperCase();

  // Profile Card in Network View
  if (el.profileCardName) el.profileCardName.textContent = dName;
  if (el.profileCardAvatar) el.profileCardAvatar.textContent = initial;
  if (el.profileCardDevId) el.profileCardDevId.textContent = 'Device: ' + (state.info.deviceId ? state.info.deviceId.slice(0, 8) : '...');

  if (el.profileModalAvatar) el.profileModalAvatar.textContent = initial;
  if (el.inputProfileName) el.inputProfileName.value = dName;

  if (el.netDeviceId) el.netDeviceId.textContent = state.info.deviceId;
  if (el.netDeviceName) el.netDeviceName.textContent = dName;

  // Universal pre-fill of user's name
  if (el.createYourName) el.createYourName.value = dName;
  if (el.joinYourName) el.joinYourName.value = dName;

  const primaryIp = state.info.localIPs && state.info.localIPs[0] ? state.info.localIPs[0] : window.location.hostname;
  const port = state.info.httpsPort || 47811;
  if (el.netLocalIp) el.netLocalIp.textContent = `${primaryIp}:${port}`;

  renderPeers(state.info.peers || []);

  // Automatic onboarding: if user name was never configured, prompt them with Welcome Registration!
  const hasRegistered = localStorage.getItem('splitwise_p2p_registered_name') || (state.info.nameConfigured === true && !dName.startsWith('Android User '));
  if (!hasRegistered) {
    if (el.inputWelcomeName && !el.inputWelcomeName.value) {
      el.inputWelcomeName.value = (!dName.startsWith('Android User ')) ? dName : '';
    }
    setTimeout(() => openModal('modal-welcome-register'), 350);
  }
}

function renderPeers(peers) {
  if (!el.peersListContainer) return;
  if (!peers || peers.length === 0) {
    el.peersListContainer.innerHTML = `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 22px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        <div style="font-size: 2rem; margin-bottom: 8px;">📡</div>
        <div style="font-weight: 700; color: var(--text); margin-bottom: 4px;">Scanning for Nearby Friends...</div>
        <div>Keep Splitwise P2P open on both phones.<br>They will appear here automatically with their custom name!</div>
      </div>
    `;
    return;
  }

  el.peersListContainer.innerHTML = peers
    .map((p) => {
      const displayName = p.name || 'Nearby Peer';
      const initial = (displayName.replace(/^Android User /i, '')[0] || '📱').toUpperCase();
      const isConnected = p.connected !== false;
      return `
    <div class="group-card" style="cursor: default; display: flex; align-items: center; justify-content: space-between; padding: 14px 16px;">
      <div class="group-info" style="display: flex; align-items: center; gap: 12px;">
        <div class="group-avatar" style="background: linear-gradient(135deg, var(--cyan), var(--primary)); width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; font-weight: bold; color: #fff;">${escapeHtml(initial)}</div>
        <div>
          <div class="group-name" style="font-size: 1rem; font-weight: 700;">${escapeHtml(displayName)}</div>
          <div class="group-meta" style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(p.type || 'Quick Share Mesh')} ${p.host ? '• ' + p.host : ''}</div>
        </div>
      </div>
      <div class="status-pill" style="border-color: ${isConnected ? 'var(--primary)' : 'var(--cyan)'}; background: ${isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(6, 182, 212, 0.15)'};">
        <div class="status-dot ${isConnected ? 'online' : 'syncing'}"></div>
        <span style="font-size: 0.78rem; font-weight: 600; color: ${isConnected ? 'var(--primary)' : 'var(--cyan)'};">${isConnected ? 'Connected' : 'Discovered'}</span>
      </div>
    </div>
  `;
    })
    .join('');
}

// -------------------------------------------------------------
// 7. Groups & Balance Overview (INR / ₹)
// -------------------------------------------------------------

async function refreshData() {
  await loadInfo();
  const groups = await fetchApi('/api/groups');
  if (groups) {
    state.groups = groups;
    idbSave('groups', { id: 'all_groups', list: groups });
    renderGroups();
  } else {
    const cached = await idbGet('groups', 'all_groups');
    if (cached && cached.list) {
      state.groups = cached.list;
      renderGroups();
    }
  }
}

function renderGroups() {
  let totalOwed = 0;
  let totalOwe = 0;

  if (state.groups.length === 0) {
    el.groupListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <h3>No groups yet</h3>
        <p>Create a group with your friends, join one, or import an existing Splitwise CSV export.</p>
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 10px;">
          <button class="btn btn-primary" onclick="openModal('modal-create-group')">Create a Group</button>
          <button class="btn btn-secondary" onclick="openModal('modal-import-csv')">📥 Import export.csv</button>
        </div>
      </div>
    `;
    updateHeroBalance(0, 0);
    return;
  }

  let html = '';
  for (const g of state.groups) {
    let myBalance = 0;
    if (state.info && g.members) {
      const me = g.members.find((m) => m.device_id === state.info.deviceId);
      if (me && g.balances && g.balances[me.id] !== undefined) {
        myBalance = g.balances[me.id];
      }
    }

    if (myBalance > 0.01) totalOwed += myBalance;
    else if (myBalance < -0.01) totalOwe += Math.abs(myBalance);

    let balanceHtml = '';
    if (myBalance > 0.01) {
      balanceHtml = `
        <div class="group-balance-status" style="color: var(--primary);">you are owed</div>
        <div class="group-balance-amount" style="color: var(--primary);">${formatMoney(myBalance)}</div>
      `;
    } else if (myBalance < -0.01) {
      balanceHtml = `
        <div class="group-balance-status" style="color: var(--rose);">you owe</div>
        <div class="group-balance-amount" style="color: var(--rose);">${formatMoney(myBalance)}</div>
      `;
    } else {
      balanceHtml = `
        <div class="group-balance-status">settled</div>
        <div class="group-balance-amount" style="color: var(--text-dim);">₹0.00</div>
      `;
    }

    html += `
      <div class="group-card" onclick="openGroupDetail('${g.id}')">
        <div class="group-info">
          <div class="group-avatar">${escapeHtml((g.name || 'G')[0]).toUpperCase()}</div>
          <div>
            <div class="group-name">${escapeHtml(g.name)}</div>
            <div class="group-meta">${g.members ? g.members.length : 0} members • ${g.expenseCount || 0} expenses</div>
          </div>
        </div>
        <div class="group-balance">${balanceHtml}</div>
      </div>
    `;
  }

  el.groupListContainer.innerHTML = html;
  updateHeroBalance(totalOwed, totalOwe);
}

function updateHeroBalance(totalOwed, totalOwe) {
  const net = totalOwed - totalOwe;
  el.heroOwed.textContent = formatMoney(totalOwed);
  el.heroOwe.textContent = formatMoney(totalOwe);

  if (net > 0.01) {
    el.heroBalance.className = 'hero-balance positive';
    el.heroBalance.textContent = `+${formatMoney(net)}`;
  } else if (net < -0.01) {
    el.heroBalance.className = 'hero-balance negative';
    el.heroBalance.textContent = `-${formatMoney(net)}`;
  } else {
    el.heroBalance.className = 'hero-balance zero';
    el.heroBalance.textContent = '₹0.00';
  }
}

// -------------------------------------------------------------
// 8. Group Detail View (Categories, Dates, Filters, Balances)
// -------------------------------------------------------------

async function openGroupDetail(groupId) {
  state.activeGroupId = groupId;
  state.categoryFilter = 'ALL';
  state.searchQuery = '';
  if (el.expenseSearchInput) el.expenseSearchInput.value = '';

  document.querySelectorAll('.filter-chip').forEach((c) => {
    if (c.getAttribute('data-cat') === 'ALL') c.classList.add('active');
    else c.classList.remove('active');
  });

  switchView('view-group-detail');
  await loadGroupDetail(groupId);
}

async function loadGroupDetail(groupId, showLoader = true) {
  if (showLoader) {
    el.expensesListContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Loading group ledger...</div>';
  }

  const data = await fetchApi(`/api/groups/${groupId}`);
  if (data) {
    state.currentGroupData = data;
    idbSave('groupData', { groupId, ...data });
    renderGroupDetail();
  } else {
    const cached = await idbGet('groupData', groupId);
    if (cached) {
      state.currentGroupData = cached;
      renderGroupDetail();
    }
  }
}

function renderGroupDetail() {
  const data = state.currentGroupData;
  if (!data || !data.group) return;

  el.detailGroupName.textContent = data.group.name;
  el.detailGroupId.textContent = `ID: ${data.group.id.slice(0, 8)}...`;
  el.detailGroupId.setAttribute('data-id', data.group.id);

  const totalSpend = (data.expenses || []).reduce((acc, e) => acc + (e.deleted ? 0 : e.amount), 0);
  el.detailGroupMeta.textContent = `${data.members.length} members • Total spend: ${formatMoney(totalSpend)}`;

  let myBalance = 0;
  if (state.info && data.members) {
    const me = data.members.find((m) => m.device_id === state.info.deviceId);
    if (me && data.balances && data.balances[me.id] !== undefined) {
      myBalance = data.balances[me.id];
    }
  }

  if (myBalance > 0.01) {
    el.detailGroupBalance.className = 'hero-balance positive';
    el.detailGroupBalance.textContent = `You are owed ${formatMoney(myBalance)}`;
  } else if (myBalance < -0.01) {
    el.detailGroupBalance.className = 'hero-balance negative';
    el.detailGroupBalance.textContent = `You owe ${formatMoney(myBalance)}`;
  } else {
    el.detailGroupBalance.className = 'hero-balance zero';
    el.detailGroupBalance.textContent = 'You are settled up';
  }

  renderExpensesList(data.expenses || [], data.members || []);
  renderBalancesAndSettlements(data.balances || {}, data.settlements || [], data.members || []);
  renderMembersList(data.members || [], data.group.id);
  renderGroupQrCode(data.group);
}

function renderExpensesList(expenses, members) {
  const myDeviceId = state.info && state.info.deviceId;
  const myDevName = state.info && state.info.deviceName;
  const memberMap = {};
  for (const m of members) {
    let name = m.name;
    if (myDeviceId && m.device_id === myDeviceId && myDevName) {
      name = myDevName;
    }
    memberMap[m.id] = (myDeviceId && m.device_id === myDeviceId) ? `${name} (You)` : name;
  }

  let activeExpenses = expenses.filter((e) => !e.deleted);

  // Category filter
  if (state.categoryFilter !== 'ALL') {
    activeExpenses = activeExpenses.filter((e) => (e.category || 'General').toLowerCase() === state.categoryFilter.toLowerCase());
  }

  // Search filter
  if (state.searchQuery.trim().length > 0) {
    const q = state.searchQuery.toLowerCase();
    activeExpenses = activeExpenses.filter((e) => {
      const payerName = (memberMap[e.paid_by] || '').toLowerCase();
      const desc = (e.description || '').toLowerCase();
      const cat = (e.category || '').toLowerCase();
      return desc.includes(q) || payerName.includes(q) || cat.includes(q);
    });
  }

  if (activeExpenses.length === 0) {
    el.expensesListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧾</div>
        <h3>No matching expenses</h3>
        <p>Tap + to record an expense or clear filters.</p>
      </div>
    `;
    return;
  }

  el.expensesListContainer.innerHTML = activeExpenses
    .map((e) => {
      const payerName = memberMap[e.paid_by] || 'Someone';
      const cat = e.category || (e.description.startsWith('Payment:') ? 'Payment' : 'General');
      const icon = CATEGORY_ICONS[cat] || '🧾';
      const formattedDate = formatDate(e.date);

      return `
      <div class="expense-item">
        <div class="expense-left">
          <div class="expense-icon">${icon}</div>
          <div>
            <div class="expense-title">${escapeHtml(e.description)}</div>
            <div class="expense-sub">
              ${escapeHtml(payerName)} paid ${formatMoney(e.amount)}
              ${formattedDate ? ` • <span class="expense-date">${formattedDate}</span>` : ''}
              <span class="cat-badge">${icon} ${escapeHtml(cat)}</span>
            </div>
          </div>
        </div>
        <div class="expense-right">
          <div class="expense-amount">${formatMoney(e.amount)}</div>
          <div class="expense-actions">
            <button class="btn-action btn-edit" onclick="openEditExpenseModal('${e.id}')" title="Edit">✏️</button>
            <button class="btn-action btn-del" onclick="deleteExpense('${e.id}')" title="Delete">&times;</button>
          </div>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderBalancesAndSettlements(balances, settlements, members) {
  const myDeviceId = state.info && state.info.deviceId;
  const myDevName = state.info && state.info.deviceName;
  const memberMap = {};
  for (const m of members) {
    let name = m.name;
    if (myDeviceId && m.device_id === myDeviceId && myDevName) {
      name = myDevName;
    }
    memberMap[m.id] = (myDeviceId && m.device_id === myDeviceId) ? `${name} (You)` : name;
  }

  // Settlements
  if (!settlements || settlements.length === 0) {
    el.settlementsListContainer.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-sm); padding: 14px; text-align: center; color: var(--primary); font-weight: 600; font-size: 0.9rem;">
        🎉 Everyone is all settled up!
      </div>
    `;
  } else {
    el.settlementsListContainer.innerHTML = settlements
      .map((s) => {
        const fromName = memberMap[s.from] || s.from;
        const toName = memberMap[s.to] || s.to;
        return `
        <div class="settlement-card">
          <div class="settlement-flow">
            <span>${escapeHtml(fromName)}</span>
            <span class="settlement-arrow">➔</span>
            <span>${escapeHtml(toName)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-weight: 700; color: var(--cyan);">${formatMoney(s.amount)}</span>
            <button class="btn btn-primary btn-sm" onclick="promptSettleUp('${s.from}', '${s.to}', ${s.amount}, '${escapeHtml(fromName)}', '${escapeHtml(toName)}')">Settle ₹</button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  // Individual Balances
  el.balancesListContainer.innerHTML = Object.entries(balances)
    .map(([memberId, amount]) => {
      const name = memberMap[memberId] || memberId;
      let text = 'Settled';
      let color = 'var(--text-dim)';
      if (amount > 0.01) {
        text = `gets back ${formatMoney(amount)}`;
        color = 'var(--primary)';
      } else if (amount < -0.01) {
        text = `owes ${formatMoney(Math.abs(amount))}`;
        color = 'var(--rose)';
      }

      return `
      <div class="member-item">
        <div class="member-avatar">${escapeHtml((name || 'M')[0]).toUpperCase()}</div>
        <div class="member-name">${escapeHtml(name)}</div>
        <div style="font-weight: 600; color: ${color}; font-size: 0.9rem;">${text}</div>
      </div>
    `;
    })
    .join('');
}

function renderMembersList(members, groupId) {
  const myDeviceId = state.info && state.info.deviceId;
  const myDevName = state.info && state.info.deviceName;
  el.membersListContainer.innerHTML = members
    .map(
      (m) => {
        const isMe = myDeviceId && m.device_id === myDeviceId;
        const displayName = isMe && myDevName ? myDevName : m.name;
        return `
    <div class="member-item">
      <div class="member-avatar">${escapeHtml((displayName || 'M')[0]).toUpperCase()}</div>
      <div>
        <div class="member-name">${escapeHtml(displayName)} ${isMe ? '<span style="font-size:0.75rem; color:var(--primary); font-weight:700;">(You)</span>' : ''}</div>
        <div style="font-size: 0.75rem; color: var(--text-dim); font-family: monospace;">Device: ${m.device_id.slice(0, 8)}</div>
      </div>
    </div>
  `;
      }
    )
    .join('');
}

function renderGroupQrCode(group) {
  const primaryIp = state.info && state.info.localIPs ? state.info.localIPs[0] : window.location.hostname;
  const port = state.info && state.info.httpsPort ? state.info.httpsPort : 47811;
  const qrData = `splitwise://join?gid=${group.id}&name=${encodeURIComponent(group.name)}&ip=${primaryIp}&port=${port}`;

  if (window.toSvg) {
    const svg = window.toSvg(qrData);
    if (el.groupQrContainer) el.groupQrContainer.innerHTML = svg;
    if (el.modalQrDisplay) el.modalQrDisplay.innerHTML = svg;
  }
  if (el.modalQrSubtext) {
    el.modalQrSubtext.textContent = `IP: ${primaryIp}:${port} • ID: ${group.id.slice(0, 8)}`;
  }
}

// -------------------------------------------------------------
// 9. Add Expense & Custom Share Splitting
// -------------------------------------------------------------

function setupAddExpenseModal() {
  state.editingExpenseId = null;
  const data = state.currentGroupData;
  if (!data || !data.members) return;

  const myDeviceId = state.info && state.info.deviceId;
  const myDevName = state.info && state.info.deviceName;

  if (el.modalExpenseTitle) el.modalExpenseTitle.textContent = 'Add an Expense';
  if (el.btnSubmitExpense) el.btnSubmitExpense.textContent = 'Save Expense';

  el.expDesc.value = '';
  el.expAmount.value = '';
  el.expDate.value = new Date().toISOString().split('T')[0];
  el.expCategory.value = 'General';
  state.splitMode = 'EQUAL';

  el.expPaidBy.innerHTML = data.members
    .map((m) => {
      const isMe = myDeviceId && m.device_id === myDeviceId;
      const displayName = isMe && myDevName ? myDevName : m.name;
      return `<option value="${m.id}">${escapeHtml(displayName)}${isMe ? ' (You)' : ''}</option>`;
    })
    .join('');

  if (state.info) {
    const me = data.members.find((m) => m.device_id === state.info.deviceId);
    if (me) el.expPaidBy.value = me.id;
  }

  el.expSplitCheckboxes.innerHTML = data.members
    .map(
      (m) => {
        const isMe = myDeviceId && m.device_id === myDeviceId;
        const displayName = isMe && myDevName ? myDevName : m.name;
        return `
    <label class="checkbox-label">
      <input type="checkbox" name="splitMember" value="${m.id}" checked>
      <span>${escapeHtml(displayName)}${isMe ? ' (You)' : ''}</span>
    </label>
  `;
      }
    )
    .join('');

  updateSplitModeUI();
  openModal('modal-add-expense');
}

function openEditExpenseModal(expenseId) {
  const data = state.currentGroupData;
  if (!data || !data.expenses) return;

  const expense = data.expenses.find((e) => e.id === expenseId);
  if (!expense) return;

  state.editingExpenseId = expenseId;
  const isPayment = (expense.category === 'Payment') || (expense.description && expense.description.startsWith('Payment'));

  if (el.modalExpenseTitle) el.modalExpenseTitle.textContent = isPayment ? 'Edit Payment' : 'Edit Expense';
  if (el.btnSubmitExpense) el.btnSubmitExpense.textContent = isPayment ? 'Update Payment' : 'Update Expense';

  el.expDesc.value = expense.description || '';
  el.expAmount.value = expense.amount || '';
  el.expDate.value = expense.date || new Date().toISOString().split('T')[0];
  el.expCategory.value = expense.category || (isPayment ? 'Payment' : 'General');

  const myDeviceId = state.info && state.info.deviceId;
  const myDevName = state.info && state.info.deviceName;

  el.expPaidBy.innerHTML = (data.members || [])
    .map((m) => {
      const isMe = myDeviceId && m.device_id === myDeviceId;
      const displayName = isMe && myDevName ? myDevName : m.name;
      return `<option value="${m.id}">${escapeHtml(displayName)}${isMe ? ' (You)' : ''}</option>`;
    })
    .join('');

  el.expPaidBy.value = expense.paid_by;

  // Determine split mode & prefill
  const split = expense.split_between || [];
  let isCustom = false;
  const customMap = {};

  for (const item of split) {
    if (typeof item === 'object' && item !== null && item.memberId) {
      isCustom = true;
      customMap[item.memberId] = item.share;
    }
  }

  if (isCustom) {
    state.splitMode = 'CUSTOM';
    updateSplitModeUI();
    (data.members || []).forEach((m) => {
      const inp = document.getElementById(`custom-share-${m.id}`);
      if (inp) {
        inp.value = (customMap[m.id] !== undefined ? customMap[m.id] : 0).toFixed(2);
      }
    });
    updateSplitMath();
  } else {
    state.splitMode = 'EQUAL';
    updateSplitModeUI();
    const splitMemberSet = new Set(split.map((s) => (typeof s === 'object' ? s.memberId : s)));
    document.querySelectorAll('input[name="splitMember"]').forEach((cb) => {
      cb.checked = splitMemberSet.size === 0 || splitMemberSet.has(cb.value);
    });
  }

  openModal('modal-add-expense');
}

function updateSplitMath() {
  if (state.splitMode !== 'CUSTOM') return;
  const total = parseFloat(el.expAmount.value) || 0;
  const inputs = el.expCustomSplitInputs ? el.expCustomSplitInputs.querySelectorAll('input') : [];
  let allocated = 0;
  inputs.forEach((inp) => {
    allocated += parseFloat(inp.value) || 0;
  });
  allocated = Math.round(allocated * 100) / 100;
  const remaining = Math.round((total - allocated) * 100) / 100;

  if (el.mathTotal) el.mathTotal.textContent = formatMoney(total);
  if (el.mathAllocated) el.mathAllocated.textContent = formatMoney(allocated);
  if (el.mathRemaining) {
    if (Math.abs(remaining) < 0.01) {
      el.mathRemaining.textContent = '₹0.00 (Balanced ✅)';
      el.mathRemaining.className = 'split-math-val balanced';
    } else if (remaining > 0) {
      el.mathRemaining.textContent = `+${formatMoney(remaining)} left`;
      el.mathRemaining.className = 'split-math-val under';
    } else {
      el.mathRemaining.textContent = `-${formatMoney(Math.abs(remaining))} over`;
      el.mathRemaining.className = 'split-math-val over';
    }
  }
}

function autoSplitRemaining() {
  const total = parseFloat(el.expAmount.value) || 0;
  const inputs = el.expCustomSplitInputs ? Array.from(el.expCustomSplitInputs.querySelectorAll('input')) : [];
  if (inputs.length === 0) return;

  let allocated = 0;
  inputs.forEach((inp) => {
    allocated += parseFloat(inp.value) || 0;
  });
  const remaining = Math.round((total - allocated) * 100) / 100;

  if (Math.abs(remaining) < 0.01) {
    showToast('Shares are already balanced!');
    return;
  }

  const lastInput = inputs[inputs.length - 1];
  const currentVal = parseFloat(lastInput.value) || 0;
  const newVal = Math.max(0, Math.round((currentVal + remaining) * 100) / 100);
  lastInput.value = newVal.toFixed(2);
  updateSplitMath();
}

function resetEqualShares() {
  const members = (state.currentGroupData && state.currentGroupData.members) || [];
  const total = parseFloat(el.expAmount.value) || 0;
  if (members.length === 0) return;

  const shareEach = Math.floor((total / members.length) * 100) / 100;
  const remainder = Math.round((total - shareEach * members.length) * 100) / 100;

  members.forEach((m, idx) => {
    const inp = document.getElementById(`custom-share-${m.id}`);
    if (inp) {
      const val = idx === members.length - 1 ? shareEach + remainder : shareEach;
      inp.value = val.toFixed(2);
    }
  });
  updateSplitMath();
}

function updateSplitModeUI() {
  if (state.splitMode === 'EQUAL') {
    el.btnSplitEqual.classList.add('active');
    el.btnSplitCustom.classList.remove('active');
    el.expSplitCheckboxes.style.display = 'grid';
    el.expCustomSplitContainer.style.display = 'none';
  } else {
    el.btnSplitEqual.classList.remove('active');
    el.btnSplitCustom.classList.add('active');
    el.expSplitCheckboxes.style.display = 'none';
    el.expCustomSplitContainer.style.display = 'block';

    const members = (state.currentGroupData && state.currentGroupData.members) || [];
    const total = parseFloat(el.expAmount.value) || 0;
    const shareEach = members.length > 0 ? (total / members.length).toFixed(2) : 0;

    if (el.expCustomSplitInputs) {
      el.expCustomSplitInputs.innerHTML = members
        .map(
          (m) => `
        <div class="custom-split-row">
          <span class="custom-split-name">${escapeHtml(m.name)}</span>
          <input type="number" step="0.01" class="custom-split-input" id="custom-share-${m.id}" value="${shareEach}">
        </div>
      `
        )
        .join('');

      el.expCustomSplitInputs.querySelectorAll('input').forEach((inp) => {
        inp.addEventListener('input', updateSplitMath);
      });
    }
    updateSplitMath();
  }
}

safeOn(el.btnSplitEqual, 'click', () => {
  state.splitMode = 'EQUAL';
  updateSplitModeUI();
});

safeOn(el.btnSplitCustom, 'click', () => {
  state.splitMode = 'CUSTOM';
  updateSplitModeUI();
});

safeOn(el.expAmount, 'input', () => {
  if (state.splitMode === 'CUSTOM') updateSplitMath();
});

safeOn(el.btnAutoSplitRemaining, 'click', autoSplitRemaining);
safeOn(el.btnResetEqualShares, 'click', resetEqualShares);

safeOn(el.fabAddExpense, 'click', setupAddExpenseModal);

safeOn(el.formAddExpense, 'submit', async (e) => {
  e.preventDefault();
  const description = el.expDesc.value.trim();
  const amount = parseFloat(el.expAmount.value);
  const date = el.expDate.value;
  const category = el.expCategory.value;
  const paidBy = el.expPaidBy.value;

  let splitBetween = [];
  if (state.splitMode === 'EQUAL') {
    const checkboxes = document.querySelectorAll('input[name="splitMember"]:checked');
    splitBetween = Array.from(checkboxes).map((cb) => cb.value);
    if (splitBetween.length === 0) {
      alert('Please select at least one person to split with.');
      return;
    }
  } else {
    const members = (state.currentGroupData && state.currentGroupData.members) || [];
    let allocatedTotal = 0;
    splitBetween = members.map((m) => {
      const inp = document.getElementById(`custom-share-${m.id}`);
      const shareVal = parseFloat(inp ? inp.value : 0) || 0;
      allocatedTotal += shareVal;
      return { memberId: m.id, share: shareVal };
    });

    allocatedTotal = Math.round(allocatedTotal * 100) / 100;
    const diff = Math.round((amount - allocatedTotal) * 100) / 100;
    if (Math.abs(diff) > 0.05) {
      const autoAdjust = confirm(
        `Shares total (${formatMoney(allocatedTotal)}) does not match expense amount (${formatMoney(amount)}).\nDifference: ${formatMoney(diff)}.\n\nWould you like to automatically adjust the difference to the last member?`
      );
      if (autoAdjust) {
        autoSplitRemaining();
        splitBetween = members.map((m) => {
          const inp = document.getElementById(`custom-share-${m.id}`);
          return { memberId: m.id, share: parseFloat(inp ? inp.value : 0) || 0 };
        });
      } else {
        return;
      }
    }
  }

  closeModal('modal-add-expense');

  let res;
  if (state.editingExpenseId) {
    res = await fetchApi(`/api/groups/${state.activeGroupId}/expenses/${state.editingExpenseId}`, {
      method: 'PUT',
      body: JSON.stringify({ description, amount, paidBy, splitBetween, category, date }),
    });
    if (res) {
      showToast('Expense updated & synced');
    }
  } else {
    res = await fetchApi(`/api/groups/${state.activeGroupId}/expenses`, {
      method: 'POST',
      body: JSON.stringify({ description, amount, paidBy, splitBetween, category, date }),
    });
    if (res) {
      showToast('Expense recorded & synced');
    }
  }

  state.editingExpenseId = null;
  if (res) {
    await loadGroupDetail(state.activeGroupId, false);
    refreshData();
    if (state.activeView === 'view-activity') {
      loadActivityFeed();
    }
  }
});

// Settle Up Handler (Direct Ledger Settlement — No Broken External Redirects)
function promptSettleUp(payerId, receiverId, amount, payerName, receiverName) {
  state.pendingSettlement = { payerId, receiverId, amount };
  if (el.settleSummaryText) {
    el.settleSummaryText.textContent = `${payerName} pays ${formatMoney(amount)} to ${receiverName}`;
  }
  openModal('modal-settle-up');
}

safeOn(el.btnConfirmSettle, 'click', async () => {
  if (!state.pendingSettlement) return;
  const { payerId, receiverId, amount } = state.pendingSettlement;
  closeModal('modal-settle-up');

  const res = await fetchApi(`/api/groups/${state.activeGroupId}/settle`, {
    method: 'POST',
    body: JSON.stringify({
      payerMemberId: payerId,
      receiverMemberId: receiverId,
      amount,
    }),
  });

  if (res) {
    showToast('Settlement recorded in ledger');
    await loadGroupDetail(state.activeGroupId, false);
    refreshData();
    if (state.activeView === 'view-activity') {
      loadActivityFeed();
    }
  }
});

async function deleteExpense(expenseId) {
  if (!confirm('Are you sure you want to delete this expense?')) return;
  const res = await fetchApi(`/api/groups/${state.activeGroupId}/expenses/${expenseId}`, {
    method: 'DELETE',
  });
  if (res) {
    showToast('Expense deleted');
    await loadGroupDetail(state.activeGroupId, false);
    refreshData();
    if (state.activeView === 'view-activity') {
      loadActivityFeed();
    }
  }
}

// -------------------------------------------------------------
// 10. Splitwise CSV Import & Export
// -------------------------------------------------------------

safeOn(el.btnImportCsvHome, 'click', () => openModal('modal-import-csv'));
safeOn(el.btnImportCsvDetail, 'click', () => {
  if (state.currentGroupData && state.currentGroupData.group) {
    el.csvGroupName.value = state.currentGroupData.group.name;
  }
  openModal('modal-import-csv');
});

// 1-Tap Quick Import from downloads/export.csv
safeOn(el.btnQuickImportDownloads, 'click', async () => {
  closeModal('modal-import-csv');
  showToast('Importing export.csv...');

  const res = await fetchApi('/api/groups/import-csv', {
    method: 'POST',
    body: JSON.stringify({
      useLocalFile: true,
      groupId: state.activeGroupId || null,
      groupName: el.csvGroupName.value || 'Flat Expenses',
    }),
  });

  if (res && res.success) {
    showToast(`Successfully imported ${res.importedCount} expenses!`);
    await refreshData();
    if (res.groupId) openGroupDetail(res.groupId);
  } else {
    alert('Import failed: ' + ((res && res.error) || 'Check that export.csv exists in Downloads'));
  }
});

// Manual File Picker Import
safeOn(el.btnRunCsvImport, 'click', async () => {
  const file = el.csvFileInput.files[0];
  if (!file) {
    alert('Please select a .csv file to import.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const csv = e.target.result;
    closeModal('modal-import-csv');
    showToast('Processing CSV...');

    const res = await fetchApi('/api/groups/import-csv', {
      method: 'POST',
      body: JSON.stringify({
        csv,
        groupId: state.activeGroupId || null,
        groupName: el.csvGroupName.value || file.name.replace('.csv', ''),
      }),
    });

    if (res && res.success) {
      showToast(`Imported ${res.importedCount} transactions!`);
      await refreshData();
      if (res.groupId) openGroupDetail(res.groupId);
    } else {
      alert('CSV import error: ' + ((res && res.error) || 'Invalid format'));
    }
  };
  reader.readAsText(file);
});

// Export CSV
safeOn(el.btnExportCsv, 'click', async () => {
  if (!state.activeGroupId) return;
  showToast('Generating Splitwise CSV...');

  const csv = await fetchApi(`/api/groups/${state.activeGroupId}/export-csv`);
  if (csv && typeof csv === 'string') {
    const groupName = (state.currentGroupData && state.currentGroupData.group && state.currentGroupData.group.name) || 'group';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `splitwise_${groupName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV downloaded');
  } else {
    alert('Export failed.');
  }
});

// -------------------------------------------------------------
// 11. In-App QR Scanner & QR Code Dialogs
// -------------------------------------------------------------

function triggerQrScan() {
  if (isNativeApp && window.AndroidBridge && window.AndroidBridge.scanQrCode) {
    window.AndroidBridge.scanQrCode();
  } else {
    // Web camera / manual fallback
    const id = prompt('Enter Group ID to join (or scan using Android camera):');
    if (id && id.trim()) {
      fetchApi('/api/groups/join', {
        method: 'POST',
        body: JSON.stringify({ groupId: id.trim() }),
      }).then((res) => {
        if (res && res.success) {
          refreshData();
          openGroupDetail(id.trim());
        }
      });
    }
  }
}

window.triggerQrScan = triggerQrScan;

safeOn(el.btnHeaderScanQr, 'click', triggerQrScan);
safeOn(el.btnScanQrJoin, 'click', () => {
  closeModal('modal-join-group');
  triggerQrScan();
});

safeOn(el.btnShowGroupQr, 'click', () => {
  if (state.currentGroupData && state.currentGroupData.group) {
    renderGroupQrCode(state.currentGroupData.group);
    openModal('modal-group-qr');
  }
});

safeOn(el.btnModalCopyGid, 'click', () => {
  if (state.activeGroupId) {
    navigator.clipboard.writeText(state.activeGroupId);
    showToast('Group ID copied');
  }
});

safeOn(el.btnCopyGroupId, 'click', () => {
  if (state.activeGroupId) {
    navigator.clipboard.writeText(state.activeGroupId);
    showToast('Group ID copied');
  }
});

// -------------------------------------------------------------
// 12. Search & Category Filter Chips
// -------------------------------------------------------------

if (el.expenseSearchInput) {
  el.expenseSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.currentGroupData) {
      renderExpensesList(state.currentGroupData.expenses || [], state.currentGroupData.members || []);
    }
  });
}

document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.categoryFilter = chip.getAttribute('data-cat') || 'ALL';
    if (state.currentGroupData) {
      renderExpensesList(state.currentGroupData.expenses || [], state.currentGroupData.members || []);
    }
  });
});

// -------------------------------------------------------------
// 13. Create & Join Group Forms & Profile
// -------------------------------------------------------------

// First-Time Registration Handler
safeOn(el.formWelcomeRegister, 'submit', async (e) => {
  e.preventDefault();
  const name = el.inputWelcomeName.value.trim();
  if (!name) return;

  closeModal('modal-welcome-register');
  if (isNativeApp && window.AndroidBridge && window.AndroidBridge.setDeviceName) {
    window.AndroidBridge.setDeviceName(name);
  }
  localStorage.setItem('splitwise_p2p_registered_name', name);
  if (state.info) {
    state.info.deviceName = name;
    state.info.nameConfigured = true;
  }
  if (el.createYourName) el.createYourName.value = name;
  if (el.joinYourName) el.joinYourName.value = name;
  renderInfo();
  showToast(`Welcome, ${name}! Your profile is ready.`);
  await refreshData();
});

safeOn(el.formProfileName, 'submit', async (e) => {
  e.preventDefault();
  const newName = el.inputProfileName.value.trim();
  if (!newName) return;

  closeModal('modal-profile');
  if (isNativeApp && window.AndroidBridge && window.AndroidBridge.setDeviceName) {
    window.AndroidBridge.setDeviceName(newName);
  }
  localStorage.setItem('splitwise_p2p_registered_name', newName);
  if (state.info) {
    state.info.deviceName = newName;
    state.info.nameConfigured = true;
  }
  if (el.createYourName) el.createYourName.value = newName;
  if (el.joinYourName) el.joinYourName.value = newName;
  renderInfo();
  showToast(`Profile name updated to "${newName}"!`);
  await refreshData();
  if (state.activeGroupId) {
    loadGroupDetail(state.activeGroupId, false);
  }
});

if (el.csvFileInput) {
  el.csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      if (el.csvFileStatus) {
        el.csvFileStatus.textContent = `✅ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      }
      if (el.csvGroupName && (!el.csvGroupName.value || el.csvGroupName.value === 'Flat Expenses')) {
        el.csvGroupName.value = file.name.replace(/\.[^/.]+$/, '');
      }
    }
  });
}

safeOn(el.formCreateGroup, 'submit', async (e) => {
  e.preventDefault();
  const name = el.createGroupName.value.trim();
  const yourName = el.createYourName.value.trim();

  closeModal('modal-create-group');
  const res = await fetchApi('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name, yourName }),
  });

  if (res && res.id) {
    showToast(`Group "${name}" created!`);
    await refreshData();
    openGroupDetail(res.id);
  }
});

safeOn(el.formJoinGroup, 'submit', async (e) => {
  e.preventDefault();
  const groupId = el.joinGroupId.value.trim();
  const yourName = el.joinYourName.value.trim();

  closeModal('modal-join-group');
  const res = await fetchApi('/api/groups/join', {
    method: 'POST',
    body: JSON.stringify({ groupId, yourName }),
  });

  if (res && res.success) {
    showToast('Joined group! Syncing data...');
    await refreshData();
    openGroupDetail(groupId);
  }
});

safeOn(el.formManualPeer, 'submit', async (e) => {
  e.preventDefault();
  const host = el.peerHost.value.trim();
  const port = parseInt(el.peerPort.value, 10);

  closeModal('modal-manual-peer');
  const res = await fetchApi('/api/peers/connect', {
    method: 'POST',
    body: JSON.stringify({ host, port }),
  });

  if (res) {
    showToast(res.message || 'Connecting to peer...');
    setTimeout(refreshData, 2000);
  }
});

// Detail Tabs
document.querySelectorAll('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const targetTab = tab.getAttribute('data-tab');
    if (el.tabContentExpenses) el.tabContentExpenses.style.display = targetTab === 'expenses' ? 'block' : 'none';
    if (el.tabContentBalances) el.tabContentBalances.style.display = targetTab === 'balances' ? 'block' : 'none';
    if (el.tabContentMembers) el.tabContentMembers.style.display = targetTab === 'members' ? 'block' : 'none';
  });
});

// Bottom Navigation items
document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const viewId = item.getAttribute('data-view');
    if (viewId) switchView(viewId);
  });
});

// Header navigation & Modal Openers (Safe bindings)
safeOn(el.btnEditProfileNetwork, 'click', () => openModal('modal-profile'));
safeOn(el.btnEditProfile, 'click', () => openModal('modal-profile'));
safeOn(el.brandHome, 'click', () => switchView('view-groups'));
safeOn(el.statusPill, 'click', () => switchView('view-network'));
safeOn(el.btnCertHeader, 'click', () => switchView('view-cert'));
safeOn(el.btnBackToGroups, 'click', () => switchView('view-groups'));
safeOn(el.btnCreateGroupModal, 'click', () => openModal('modal-create-group'));
safeOn(el.btnCreateFirstGroup, 'click', () => openModal('modal-create-group'));
safeOn(el.btnJoinGroupModal, 'click', () => openModal('modal-join-group'));
safeOn(el.btnManualPeerModal, 'click', () => openModal('modal-manual-peer'));
safeOn(el.btnImportCsvHome, 'click', () => openModal('modal-import-csv'));

// -------------------------------------------------------------
// 14. Activity Feed Logic
// -------------------------------------------------------------
let cachedActivities = [];

async function loadActivityFeed() {
  if (!el.activityListContainer) return;
  el.activityListContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">Loading activity...</div>';

  renderActivityGroupChips();

  const gid = state.activeActivityGroupFilter === 'ALL' ? '' : state.activeActivityGroupFilter;
  const endpoint = gid ? `/api/activity?groupId=${encodeURIComponent(gid)}` : '/api/activity';
  const data = await fetchApi(endpoint);

  if (Array.isArray(data)) {
    cachedActivities = data;
    renderActivityFeed(data);
  } else {
    el.activityListContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">No activity recorded yet.</div>';
  }
}

function renderActivityGroupChips() {
  if (!el.activityGroupFilterChips) return;
  let html = `<div class="filter-chip ${state.activeActivityGroupFilter === 'ALL' ? 'active' : ''}" onclick="filterActivityByGroup('ALL')">All Groups</div>`;

  for (const g of state.groups) {
    const isActive = state.activeActivityGroupFilter === g.id;
    html += `<div class="filter-chip ${isActive ? 'active' : ''}" onclick="filterActivityByGroup('${g.id}')">${escapeHtml(g.name)}</div>`;
  }
  el.activityGroupFilterChips.innerHTML = html;
}

function filterActivityByGroup(gid) {
  state.activeActivityGroupFilter = gid;
  renderActivityGroupChips();
  loadActivityFeed();
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const past = new Date(dateStr).getTime();
  if (isNaN(past)) return dateStr;
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return 'Yesterday';
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

  const d = new Date(past);
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderActivityFeed(activities) {
  if (!el.activityListContainer) return;

  if (activities.length === 0) {
    el.activityListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <h3>No activity yet</h3>
        <p>When expenses, payments, or group members are added or synced, they will appear here in chronological order.</p>
      </div>
    `;
    return;
  }

  let html = '';
  let lastDateHeader = '';

  for (const act of activities) {
    const d = act.timestamp ? new Date(act.timestamp) : new Date();
    let dateHeader = 'Earlier';
    if (!isNaN(d.getTime())) {
      const today = new Date();
      if (d.toDateString() === today.toDateString()) {
        dateHeader = 'Today';
      } else {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) {
          dateHeader = 'Yesterday';
        } else {
          dateHeader = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        }
      }
    }

    if (dateHeader !== lastDateHeader) {
      html += `<div class="activity-date-header">${dateHeader}</div>`;
      lastDateHeader = dateHeader;
    }

    const relTime = formatRelativeTime(act.timestamp);
    const amountHtml = act.amount
      ? `<div class="activity-amount">${act.amount}</div>`
      : '';

    html += `
      <div class="activity-item" onclick="openGroupDetail('${act.groupId}')">
        <div class="activity-icon-col">${act.icon || '🧾'}</div>
        <div class="activity-content">
          <div class="activity-title">${escapeHtml(act.title)}</div>
          <div class="activity-subtitle">${escapeHtml(act.subtitle)}</div>
          <div class="activity-meta">
            <span>${escapeHtml(act.groupName)}</span>
            <span>•</span>
            <span>${relTime}</span>
          </div>
        </div>
        ${amountHtml}
      </div>
    `;
  }

  el.activityListContainer.innerHTML = html;
}

// -------------------------------------------------------------
// 15. GitHub In-App Auto-Update System
// -------------------------------------------------------------
const GITHUB_REPO = 'FLAMEPOSEIDON/splitwise-p2p';
let latestUpdateData = null;

async function checkForUpdates(isManual = false) {
  if (isManual && el.updateStatusText) {
    el.updateStatusText.textContent = 'Checking GitHub repository for updates...';
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const commitData = await res.json();

    const latestSha = commitData.sha.substring(0, 7);
    const commitMsg = commitData.commit.message.split('\n')[0];
    const commitDate = new Date(commitData.commit.author.date).toLocaleString('en-IN');
    const commitAuthor = commitData.commit.author.name;

    const currentSha = localStorage.getItem('splitwise_installed_commit') || 'b6bb060';

    latestUpdateData = {
      sha: latestSha,
      fullSha: commitData.sha,
      message: commitMsg,
      date: commitDate,
      author: commitAuthor,
      downloadUrl: `https://github.com/FLAMEPOSEIDON/splitwise-p2p/releases/latest/download/SplitwiseP2P.apk`,
      repoUrl: `https://github.com/${GITHUB_REPO}`,
    };

    if (latestSha !== currentSha) {
      if (el.btnHeaderUpdate) el.btnHeaderUpdate.style.display = 'inline-flex';
      if (el.updateStatusText) {
        el.updateStatusText.innerHTML = `🚀 <strong style="color: var(--cyan);">Update Available:</strong> ${escapeHtml(commitMsg)} (${latestSha})`;
      }

      if (isManual) {
        openUpdateModal();
      }
    } else {
      if (el.btnHeaderUpdate) el.btnHeaderUpdate.style.display = 'none';
      if (el.updateStatusText) {
        el.updateStatusText.innerHTML = `✅ You are on the latest version (${latestSha}). Up to date!`;
      }
      if (isManual) {
        showToast('You are on the latest version!');
      }
    }
  } catch (err) {
    console.warn('Update check failed:', err);
    if (isManual) {
      if (el.updateStatusText) {
        el.updateStatusText.textContent = 'Could not reach GitHub. Check your internet connection.';
      }
      showToast('Could not reach GitHub.');
    }
  }
}

function openUpdateModal() {
  if (!latestUpdateData) {
    checkForUpdates(true);
    return;
  }

  if (el.updateCommitMessage) el.updateCommitMessage.textContent = `"${latestUpdateData.message}"`;
  if (el.updateCommitMeta) {
    el.updateCommitMeta.textContent = `Commit: ${latestUpdateData.sha} by ${latestUpdateData.author} on ${latestUpdateData.date}`;
  }

  openModal('modal-update-available');
}

function performAppUpdate() {
  if (!latestUpdateData) return;

  localStorage.setItem('splitwise_installed_commit', latestUpdateData.sha);
  closeModal('modal-update-available');

  if (isNativeApp && window.AndroidBridge && typeof window.AndroidBridge.installApkUpdate === 'function') {
    window.AndroidBridge.installApkUpdate(latestUpdateData.downloadUrl);
    showToast('Starting APK download & update...');
  } else {
    window.open(latestUpdateData.downloadUrl, '_blank');
    showToast('Opening download link...');
    setTimeout(() => {
      window.location.reload();
    }, 1500);
  }
}

window.loadActivityFeed = loadActivityFeed;
window.filterActivityByGroup = filterActivityByGroup;
window.checkForUpdates = checkForUpdates;
window.openUpdateModal = openUpdateModal;
window.performAppUpdate = performAppUpdate;
window.openEditExpenseModal = openEditExpenseModal;
window.deleteExpense = deleteExpense;
window.promptSettleUp = promptSettleUp;
window.autoSplitRemaining = autoSplitRemaining;
window.resetEqualShares = resetEqualShares;

safeOn(el.btnPerformUpdate, 'click', performAppUpdate);
safeOn(el.btnHeaderUpdate, 'click', openUpdateModal);

// Initialize on Load
function initApp() {
  connectWebSocket();
  refreshData();
  setTimeout(() => {
    checkForUpdates(false);
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
