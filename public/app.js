/**
 * app.js — Client Application for Splitwise P2P.
 *
 * Provides:
 *  - Offline storage & local caching via IndexedDB
 *  - Real-time WebSocket sync with server & peers
 *  - Dynamic balance computation & debt settlement
 *  - PWA installation prompt handling
 *  - Responsive tab and view transitions
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

  // Views
  viewGroups: document.getElementById('view-groups'),
  viewGroupDetail: document.getElementById('view-group-detail'),
  viewNetwork: document.getElementById('view-network'),
  viewCert: document.getElementById('view-cert'),
  viewMongo: document.getElementById('view-mongo'),

  // MongoDB Addon
  modeBtnLocal: document.getElementById('mode-btn-local'),
  modeBtnMongo: document.getElementById('mode-btn-mongo'),
  formMongoAddon: document.getElementById('form-mongo-addon'),
  mongoUri: document.getElementById('mongo-uri'),
  mongoDbname: document.getElementById('mongo-dbname'),
  btnSaveMongo: document.getElementById('btn-save-mongo'),
  btnDisableMongo: document.getElementById('btn-disable-mongo'),
  btnSyncMongoNow: document.getElementById('btn-sync-mongo-now'),
  mongoStatusBadge: document.getElementById('mongo-status-badge'),
  mongoSyncInfo: document.getElementById('mongo-sync-info'),
  mongoLastSyncTime: document.getElementById('mongo-last-sync-time'),

  // Hero
  heroBalance: document.getElementById('hero-balance'),
  heroOwed: document.getElementById('hero-owed'),
  heroOwe: document.getElementById('hero-owe'),

  // Groups
  groupListContainer: document.getElementById('group-list-container'),
  btnCreateGroupModal: document.getElementById('btn-create-group-modal'),
  btnCreateFirstGroup: document.getElementById('btn-create-first-group'),
  btnJoinGroupModal: document.getElementById('btn-join-group-modal'),
  btnBackToGroups: document.getElementById('btn-back-to-groups'),

  // Group Detail
  detailGroupName: document.getElementById('detail-group-name'),
  detailGroupId: document.getElementById('detail-group-id'),
  detailGroupMeta: document.getElementById('detail-group-meta'),
  detailGroupBalance: document.getElementById('detail-group-balance'),
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

  // Network
  netDeviceId: document.getElementById('net-device-id'),
  netDeviceName: document.getElementById('net-device-name'),
  netLocalIp: document.getElementById('net-local-ip'),
  peersListContainer: document.getElementById('peers-list-container'),
  btnManualPeerModal: document.getElementById('btn-manual-peer-modal'),
  networkQrContainer: document.getElementById('network-qr-container'),

  // Modals
  modalAddExpense: document.getElementById('modal-add-expense'),
  formAddExpense: document.getElementById('form-add-expense'),
  expDesc: document.getElementById('exp-desc'),
  expAmount: document.getElementById('exp-amount'),
  expPaidBy: document.getElementById('exp-paid-by'),
  expSplitCheckboxes: document.getElementById('exp-split-checkboxes'),

  modalCreateGroup: document.getElementById('modal-create-group'),
  formCreateGroup: document.getElementById('form-create-group'),
  createGroupName: document.getElementById('create-group-name'),
  createYourName: document.getElementById('create-your-name'),

  modalJoinGroup: document.getElementById('modal-join-group'),
  formJoinGroup: document.getElementById('form-join-group'),
  joinGroupId: document.getElementById('join-group-id'),
  joinYourName: document.getElementById('join-your-name'),

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
// 1. IndexedDB Offline Storage Helper
// -------------------------------------------------------------
const IDB_NAME = 'SplitwiseP2P_DB';
const IDB_VERSION = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('groupData')) {
        db.createObjectStore('groupData', { keyPath: 'groupId' });
      }
      if (!db.objectStoreNames.contains('info')) {
        db.createObjectStore('info', { keyPath: 'id' });
      }
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
  } catch {}
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
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// 2. Toast & Utilities
// -------------------------------------------------------------
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 3000);
}

function formatMoney(amount) {
  const n = parseFloat(amount || 0);
  return '$' + Math.abs(n).toFixed(2);
}

// -------------------------------------------------------------
// 3. Navigation & Views
// -------------------------------------------------------------
function switchView(viewId) {
  state.activeView = viewId;
  const views = [el.viewGroups, el.viewGroupDetail, el.viewNetwork, el.viewCert, el.viewMongo];
  views.forEach((v) => {
    if (v) v.style.display = 'none';
  });

  const target = document.getElementById(viewId);
  if (target) target.style.display = 'block';

  // Toggle FAB
  el.fabAddExpense.style.display = viewId === 'view-group-detail' ? 'flex' : 'none';

  // Update bottom nav active state
  document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
    if (item.getAttribute('data-view') === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// -------------------------------------------------------------
// 4. WebSocket & Sync Engine
// -------------------------------------------------------------
function connectWebSocket() {
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
        const msg = JSON.parse(event.data);
        if (
          msg.type === 'GROUP_CREATED' ||
          msg.type === 'GROUP_JOINED' ||
          msg.type === 'EXPENSE_ADDED' ||
          msg.type === 'EXPENSE_DELETED' ||
          msg.type === 'SETTLEMENT_RECORDED'
        ) {
          refreshData();
          if (state.activeGroupId) {
            loadGroupDetail(state.activeGroupId, false);
          }
          showToast('Database synced across Wi-Fi');
        }
      } catch {}
    };

    state.ws.onclose = () => {
      state.wsConnected = false;
      el.statusDot.className = 'status-dot';
      el.statusText.textContent = 'Offline (Local)';
      setTimeout(connectWebSocket, 4000);
    };

    state.ws.onerror = () => {
      state.ws.close();
    };
  } catch {
    el.statusDot.className = 'status-dot';
    el.statusText.textContent = 'Offline';
    setTimeout(connectWebSocket, 4000);
  }
}

// -------------------------------------------------------------
// 5. API Requests & Local Fallbacks (Dual Native APK + Web/PWA)
// -------------------------------------------------------------
const isNativeApp = typeof window.AndroidBridge !== 'undefined';

// Setup listener for Native Android Sync events
if (isNativeApp) {
  window.onSyncUpdate = function(eventType) {
    refreshData();
    if (state.activeGroupId) {
      loadGroupDetail(state.activeGroupId, false);
    }
    showToast('Synced via Android Wi-Fi Mesh');
  };
}

async function fetchApi(endpoint, options = {}) {
  // If running inside the standalone Android APK, route through native bridge!
  if (isNativeApp) {
    try {
      if (endpoint === '/api/info') {
        const info = JSON.parse(window.AndroidBridge.getDeviceInfo());
        const peers = JSON.parse(window.AndroidBridge.getPeers() || '[]');
        return {
          deviceId: info.deviceId,
          deviceName: info.deviceName,
          localIPs: ['Android Device'],
          httpsPort: 8443,
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
          JSON.stringify(body.splitBetween || [])
        ));
      }
      const matchDelExp = endpoint.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/expenses\/([a-zA-Z0-9_-]+)$/);
      if (matchDelExp && options.method === 'DELETE') {
        window.AndroidBridge.deleteExpense(matchDelExp[1], matchDelExp[2]);
        return { success: true };
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
    return await res.json();
  } catch (err) {
    return null;
  }
}

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
  el.netDeviceId.textContent = state.info.deviceId;
  el.netDeviceName.textContent = state.info.deviceName;
  el.createYourName.value = state.info.deviceName;
  el.joinYourName.value = state.info.deviceName;

  const primaryIp = state.info.localIPs && state.info.localIPs[0] ? state.info.localIPs[0] : window.location.hostname;
  el.netLocalIp.textContent = `${primaryIp}:${state.info.httpsPort || 8443}`;

  // QR Code for network share
  const shareUrl = `https://${primaryIp}:${state.info.httpsPort || 8443}`;
  el.networkQrContainer.innerHTML = `<img src="/api/qr?text=${encodeURIComponent(shareUrl)}" style="width: 100%; height: auto; display: block;" alt="Wi-Fi QR">`;

  renderPeers(state.info.peers || []);
}

function renderPeers(peers) {
  if (peers.length === 0) {
    el.peersListContainer.innerHTML = `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No other devices detected on this Wi-Fi yet.<br>
        Make sure other phones/laptops are on the same Wi-Fi network.
      </div>
    `;
    return;
  }

  el.peersListContainer.innerHTML = peers
    .map(
      (p) => `
    <div class="group-card" style="cursor: default;">
      <div class="group-info">
        <div class="group-avatar" style="background: linear-gradient(135deg, var(--cyan), var(--primary));">📱</div>
        <div>
          <div class="group-name">${escapeHtml(p.name)}</div>
          <div class="group-meta">${p.host}:${p.port} • ID: ${p.deviceId}</div>
        </div>
      </div>
      <div class="status-pill">
        <div class="status-dot online"></div>
        <span>Connected</span>
      </div>
    </div>
  `
    )
    .join('');
}

// -------------------------------------------------------------
// 6. Groups & Balances
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
        <p>Create a group with your friends or join an existing one to start splitting expenses offline.</p>
        <button class="btn btn-primary" onclick="openModal('modal-create-group')">Create a Group</button>
      </div>
    `;
    updateHeroBalance(0, 0);
    return;
  }

  let html = '';
  for (const g of state.groups) {
    // Determine your balance in this group
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
        <div class="group-balance-amount" style="color: var(--text-dim);">$0.00</div>
      `;
    }

    html += `
      <div class="group-card" onclick="openGroupDetail('${g.id}')">
        <div class="group-info">
          <div class="group-avatar">${escapeHtml(g.name[0] || 'G').toUpperCase()}</div>
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
    el.heroBalance.textContent = '$0.00';
  }
}

// -------------------------------------------------------------
// 7. Group Detail View
// -------------------------------------------------------------
async function openGroupDetail(groupId) {
  state.activeGroupId = groupId;
  switchView('view-group-detail');
  await loadGroupDetail(groupId);
}

async function loadGroupDetail(groupId, showLoader = true) {
  if (showLoader) {
    el.expensesListContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Loading group data...</div>';
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

  // Find user's balance in this group
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
}

function renderExpensesList(expenses, members) {
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const activeExpenses = expenses.filter((e) => !e.deleted).reverse();

  if (activeExpenses.length === 0) {
    el.expensesListContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧾</div>
        <h3>No expenses yet</h3>
        <p>Tap the + button below to add your first expense.</p>
      </div>
    `;
    return;
  }

  el.expensesListContainer.innerHTML = activeExpenses
    .map((e) => {
      const payerName = memberMap[e.paid_by] || 'Someone';
      const isSettlement = e.description.startsWith('Payment:');
      const icon = isSettlement ? '🤝' : '🍔';

      return `
      <div class="expense-item">
        <div class="expense-left">
          <div class="expense-icon">${icon}</div>
          <div>
            <div class="expense-title">${escapeHtml(e.description)}</div>
            <div class="expense-sub">${payerName} paid ${formatMoney(e.amount)}</div>
          </div>
        </div>
        <div class="expense-right">
          <div class="expense-amount">${formatMoney(e.amount)}</div>
          <button class="btn-del" onclick="deleteExpense('${e.id}')" title="Delete expense">&times;</button>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderBalancesAndSettlements(balances, settlements, members) {
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m.name]));

  // 1. Settlements
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
            <button class="btn btn-primary btn-sm" onclick="promptSettleUp('${s.from}', '${s.to}', ${s.amount}, '${escapeHtml(fromName)}', '${escapeHtml(toName)}')">Settle</button>
          </div>
        </div>
      `;
      })
      .join('');
  }

  // 2. Individual Balances
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
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px;">
        <span style="font-weight: 600;">${escapeHtml(name)}</span>
        <span style="font-weight: 700; color: ${color};">${text}</span>
      </div>
    `;
    })
    .join('');
}

function renderMembersList(members, groupId) {
  el.groupQrContainer.innerHTML = `<img src="/api/qr?text=${encodeURIComponent(groupId)}" style="width: 100%; height: auto; display: block;" alt="Group QR">`;

  el.membersListContainer.innerHTML = members
    .map(
      (m) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px;">
      <div>
        <div style="font-weight: 600;">${escapeHtml(m.name)}</div>
        <div style="font-size: 0.75rem; color: var(--text-dim); font-family: monospace;">Device: ${m.device_id}</div>
      </div>
      <span style="font-size: 0.75rem; color: var(--text-muted);">${new Date(m.joined_at).toLocaleDateString()}</span>
    </div>
  `
    )
    .join('');
}

// -------------------------------------------------------------
// 8. Modals & Actions
// -------------------------------------------------------------
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('open');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

document.querySelectorAll('.btn-close, .modal-overlay').forEach((el) => {
  el.addEventListener('click', (e) => {
    if (e.target === el || el.classList.contains('btn-close')) {
      const modal = el.closest('.modal-overlay');
      if (modal) modal.classList.remove('open');
    }
  });
});

// Setup Add Expense Modal
function setupAddExpenseModal() {
  const data = state.currentGroupData;
  if (!data || !data.members) return;

  el.expDesc.value = '';
  el.expAmount.value = '';

  // Populate Paid By dropdown
  el.expPaidBy.innerHTML = data.members
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
    .join('');

  // Default payer to current device if in members
  if (state.info) {
    const me = data.members.find((m) => m.device_id === state.info.deviceId);
    if (me) el.expPaidBy.value = me.id;
  }

  // Populate Split checkboxes (all checked by default)
  el.expSplitCheckboxes.innerHTML = data.members
    .map(
      (m) => `
    <label class="checkbox-label">
      <input type="checkbox" name="splitMember" value="${m.id}" checked>
      <span>${escapeHtml(m.name)}</span>
    </label>
  `
    )
    .join('');

  openModal('modal-add-expense');
}

el.fabAddExpense.addEventListener('click', setupAddExpenseModal);

el.formAddExpense.addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = el.expDesc.value.trim();
  const amount = parseFloat(el.expAmount.value);
  const paidBy = el.expPaidBy.value;

  const checkboxes = document.querySelectorAll('input[name="splitMember"]:checked');
  const splitBetween = Array.from(checkboxes).map((cb) => cb.value);

  if (splitBetween.length === 0) {
    alert('Please select at least one person to split with.');
    return;
  }

  closeModal('modal-add-expense');

  const res = await fetchApi(`/api/groups/${state.activeGroupId}/expenses`, {
    method: 'POST',
    body: JSON.stringify({ description, amount, paidBy, splitBetween }),
  });

  if (res) {
    showToast('Expense recorded & synced');
    await loadGroupDetail(state.activeGroupId, false);
    refreshData();
  }
});

// Settle Up Handler
function promptSettleUp(payerId, receiverId, amount, payerName, receiverName) {
  state.pendingSettlement = { payerId, receiverId, amount };
  el.settleSummaryText.textContent = `${payerName} pays ${formatMoney(amount)} to ${receiverName}`;
  openModal('modal-settle-up');
}

el.btnConfirmSettle.addEventListener('click', async () => {
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
    showToast('Settlement recorded');
    await loadGroupDetail(state.activeGroupId, false);
    refreshData();
  }
});

// Delete Expense
async function deleteExpense(expenseId) {
  if (!confirm('Are you sure you want to delete this expense?')) return;
  const res = await fetchApi(`/api/groups/${state.activeGroupId}/expenses/${expenseId}`, {
    method: 'DELETE',
  });
  if (res) {
    showToast('Expense deleted');
    await loadGroupDetail(state.activeGroupId, false);
    refreshData();
  }
}

// Create Group Form
el.formCreateGroup.addEventListener('submit', async (e) => {
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

// Join Group Form
el.formJoinGroup.addEventListener('submit', async (e) => {
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

// Manual Peer Connect Form
el.formManualPeer.addEventListener('submit', async (e) => {
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

// -------------------------------------------------------------
// 9. Event Listeners & Navigation
// -------------------------------------------------------------
el.brandHome.addEventListener('click', () => switchView('view-groups'));
el.statusPill.addEventListener('click', () => switchView('view-network'));
el.btnCertHeader.addEventListener('click', () => switchView('view-cert'));
el.btnBackToGroups.addEventListener('click', () => switchView('view-groups'));

el.btnCreateGroupModal.addEventListener('click', () => openModal('modal-create-group'));
if (el.btnCreateFirstGroup) el.btnCreateFirstGroup.addEventListener('click', () => openModal('modal-create-group'));
el.btnJoinGroupModal.addEventListener('click', () => openModal('modal-join-group'));
el.btnManualPeerModal.addEventListener('click', () => openModal('modal-manual-peer'));

// Copy Group ID
el.btnCopyGroupId.addEventListener('click', () => {
  const id = el.detailGroupId.getAttribute('data-id');
  if (id) {
    navigator.clipboard.writeText(id);
    showToast('Group ID copied to clipboard');
  }
});

// Detail Tabs (Expenses / Balances / Members)
document.querySelectorAll('.tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const targetTab = tab.getAttribute('data-tab');
    el.tabContentExpenses.style.display = targetTab === 'expenses' ? 'block' : 'none';
    el.tabContentBalances.style.display = targetTab === 'balances' ? 'block' : 'none';
    el.tabContentMembers.style.display = targetTab === 'members' ? 'block' : 'none';
  });
});

// Bottom Navigation items
document.querySelectorAll('.bottom-nav .nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const viewId = item.getAttribute('data-view');
    if (viewId) switchView(viewId);
  });
});

// -------------------------------------------------------------
// 10. MongoDB Cloud Addon Logic
// -------------------------------------------------------------
async function loadMongoStatus() {
  const status = await fetchApi('/api/addon/mongo');
  if (status) {
    renderMongoStatus(status);
  }
}

function renderMongoStatus(status) {
  if (!el.mongoStatusBadge) return;

  if (status.enabled) {
    el.mongoStatusBadge.textContent = 'Status: Cloud + Local Dual Active';
    el.mongoStatusBadge.style.color = '#00ed64';
    if (el.btnSyncMongoNow) el.btnSyncMongoNow.style.display = 'inline-block';
    if (el.formMongoAddon) el.formMongoAddon.style.display = 'block';
    if (el.mongoSyncInfo) el.mongoSyncInfo.style.display = 'block';

    if (el.modeBtnLocal) {
      el.modeBtnLocal.style.borderColor = 'var(--border)';
      el.modeBtnLocal.style.background = 'var(--bg-card)';
    }
    if (el.modeBtnMongo) {
      el.modeBtnMongo.style.borderColor = 'var(--primary)';
      el.modeBtnMongo.style.background = 'rgba(16, 185, 129, 0.15)';
    }
  } else {
    el.mongoStatusBadge.textContent = 'Status: 100% Local Only (Offline Mesh)';
    el.mongoStatusBadge.style.color = 'var(--text-muted)';
    if (el.btnSyncMongoNow) el.btnSyncMongoNow.style.display = 'none';
    if (el.formMongoAddon) el.formMongoAddon.style.display = 'none';
    if (el.mongoSyncInfo) el.mongoSyncInfo.style.display = 'none';

    if (el.modeBtnLocal) {
      el.modeBtnLocal.style.borderColor = 'var(--primary)';
      el.modeBtnLocal.style.background = 'rgba(16, 185, 129, 0.15)';
    }
    if (el.modeBtnMongo) {
      el.modeBtnMongo.style.borderColor = 'var(--border)';
      el.modeBtnMongo.style.background = 'var(--bg-card)';
    }
  }

  if (status.uri && el.mongoUri) {
    el.mongoUri.value = status.uri;
  }
  if (status.dbName && el.mongoDbname) {
    el.mongoDbname.value = status.dbName;
  }
  if (status.lastSyncTime && el.mongoLastSyncTime) {
    el.mongoLastSyncTime.textContent = new Date(status.lastSyncTime).toLocaleTimeString();
  }
}

if (el.modeBtnLocal) {
  el.modeBtnLocal.addEventListener('click', async () => {
    await fetchApi('/api/addon/mongo', { method: 'DELETE' });
    showToast('Switched to 100% Local Mode');
    loadMongoStatus();
  });
}

if (el.modeBtnMongo) {
  el.modeBtnMongo.addEventListener('click', () => {
    if (el.formMongoAddon) el.formMongoAddon.style.display = 'block';
    if (el.modeBtnMongo) {
      el.modeBtnMongo.style.borderColor = 'var(--primary)';
      el.modeBtnMongo.style.background = 'rgba(16, 185, 129, 0.15)';
    }
    if (el.modeBtnLocal) {
      el.modeBtnLocal.style.borderColor = 'var(--border)';
      el.modeBtnLocal.style.background = 'var(--bg-card)';
    }
  });
}

if (el.formMongoAddon) {
  el.formMongoAddon.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uri = el.mongoUri.value.trim();
    const dbName = el.mongoDbname.value.trim();

    if (el.btnSaveMongo) {
      el.btnSaveMongo.textContent = 'Connecting...';
      el.btnSaveMongo.disabled = true;
    }

    const res = await fetchApi('/api/addon/mongo', {
      method: 'POST',
      body: JSON.stringify({ enabled: true, uri, dbName }),
    });

    if (el.btnSaveMongo) {
      el.btnSaveMongo.textContent = 'Save & Connect';
      el.btnSaveMongo.disabled = false;
    }

    if (res && res.success) {
      showToast('Connected to MongoDB! Dual storage active.');
      loadMongoStatus();
      refreshData();
    } else {
      alert('MongoDB connection failed: ' + ((res && res.error) || 'Check URI or network'));
    }
  });
}

if (el.btnDisableMongo) {
  el.btnDisableMongo.addEventListener('click', async () => {
    await fetchApi('/api/addon/mongo', { method: 'DELETE' });
    showToast('MongoDB addon disabled');
    loadMongoStatus();
  });
}

if (el.btnSyncMongoNow) {
  el.btnSyncMongoNow.addEventListener('click', async () => {
    el.btnSyncMongoNow.textContent = 'Syncing...';
    const res = await fetchApi('/api/addon/mongo/sync', { method: 'POST' });
    el.btnSyncMongoNow.textContent = '☁️ Sync Now';
    if (res && res.lastSyncTime) {
      showToast(`Synced ${res.synced || 0} updates with MongoDB`);
      loadMongoStatus();
      refreshData();
    }
  });
}

// -------------------------------------------------------------
// 11. PWA Installation Handler
// -------------------------------------------------------------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  el.installBanner.style.display = 'flex';
});

el.btnInstallPwa.addEventListener('click', async () => {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    const { outcome } = await state.deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      el.installBanner.style.display = 'none';
    }
    state.deferredInstallPrompt = null;
  }
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {})
      .catch(() => {});
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start app
if (isNativeApp) {
  el.statusDot.className = 'status-dot online';
  el.statusText.textContent = 'Native Wi-Fi Mesh';
  el.installBanner.style.display = 'none';
} else {
  connectWebSocket();
}
refreshData();
loadMongoStatus();
