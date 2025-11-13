/* app.js — Light Professional Lawyer Case Manager (IndexedDB v4)
   + Added:
     - auto-advance hearing dates when currentDate has passed
     - lightweight auth scaffolding (localStorage) and UI hooks
     - dynamic topbar auth links (fills #authLinks)
*/

const DB_NAME = 'LawyerCaseDB';
const STORE = 'cases';
const DB_VERSION = 4;
// --- Firebase setup ---
const firebaseConfig = {
  apiKey: "AIzaSyAeYlJB99zUH36t-sDREuiSK8LFFF64go0",
  authDomain: "lawyercasemanager-17972.firebaseapp.com",
  projectId: "lawyercasemanager-17972",
  storageBucket: "lawyercasemanager-17972.appspot.com",   // ✅ important: use .appspot.com
  messagingSenderId: "996102566916",
  appId: "1:996102566916:web:76d1cf6031eb74c06db151",
  measurementId: "G-BE79DPJY43"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
firebase.firestore()
  .enablePersistence({ synchronizeTabs: true })
  .catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn("⚠️ Persistence disabled: multiple tabs open.");
    } else if (err.code === 'unimplemented') {
      console.warn("⚠️ Browser does not support persistence.");
    } else {
      console.error(err);
    }
  });


/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const fmt = d => d ? (new Date(d)).toISOString().slice(0,10) : '';
const addDays = (dateISO, days) => {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
};
const isImage = dataURL => typeof dataURL === 'string' && dataURL.startsWith('data:image');

/* ---------- IndexedDB Promises ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('caseTitle', 'caseTitle', { unique: false });
        store.createIndex('clientName', 'clientName', { unique: false });
        store.createIndex('judgeName', 'judgeName', { unique: false });
        store.createIndex('courtNumber', 'courtNumber', { unique: false });
        store.createIndex('currentDate', 'currentDate', { unique: false });
        store.createIndex('nextDate', 'nextDate', { unique: false });
      }
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = (e) => rej(e.target.error);
  });
}

function txPromise(db, mode, callback) {
  return new Promise((res, rej) => {
    const tx = db.transaction([STORE], mode);
    const store = tx.objectStore(STORE);
    let out;
    try { out = callback(store); } catch (err) { rej(err); }
    tx.oncomplete = () => res(out);
    tx.onerror = (e) => rej(e.target.error);
  });
}

/* ---------- File helpers ---------- */
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: file.name, data: r.result });
    r.onerror = () => rej(new Error('File read error'));
    r.readAsDataURL(file);
  });
}

/* ---------- App State ---------- */
let DB;
let cache = [];

/* ---------- Simple Auth (localStorage) ---------- */
const AUTH_USERS_KEY = 'lcm_users'; // json object { id: { name, email, phone, passHash } }
const AUTH_SESSION_KEY = 'lcm_session'; // stores logged-in user id (email or phone)

function getUsersStore() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || '{}');
  } catch (e) { return {}; }
}
function saveUsersStore(u) { localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(u)); }
function loginSessionSet(id) { localStorage.setItem(AUTH_SESSION_KEY, id); }
function loginSessionClear(){ localStorage.removeItem(AUTH_SESSION_KEY); }
function currentUserId(){ return localStorage.getItem(AUTH_SESSION_KEY) || null; }
function isLoggedIn(){ return !!currentUserId(); }
function getCurrentUser(){ const id = currentUserId(); if (!id) return null; const u = getUsersStore(); return u[id] || null; }

/* logout helper exposed for nav */
function logout() {
  loginSessionClear();
  // reload so UI adapts
  if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/') || window.location.pathname.endsWith('add.html')) {
    window.location.href = 'login.html';
  } else {
    window.location.reload();
  }
}
window.lcm_logout = logout;

/* ---------- Start ---------- */
(async function start() {
  try {
    DB = await openDB();
    attachUIHandlers();
    // Populate auth-aware topbar
    fillAuthLinks();

    // Protect pages that need login
    protectPagesRequiringLogin();

    if ($('#casesList')) {
      await reloadCache();
      // Automatically advance cases with past currentDate
      await advancePastHearings();
      await reloadCache(); // refresh after updates
      renderCases();
    }
    if ($('#caseForm')) {
      await initFormPage();
    }
  } catch (err) {
    console.error('Init error', err);
    alert('Initialization error: ' + (err.message || err));
  }
})();

/* ---------- Advance past hearings ----------
   For any case where currentDate < today:
     - set currentDate = nextDate (if nextDate exists)
     - set nextDate = currentDate + 30 days
     - save updated case
*/
async function advancePastHearings() {
  await reloadCache();
  const today = new Date(); today.setHours(0,0,0,0);
  const toUpdate = [];
  for (const it of cache) {
    if (!it.currentDate) continue;
    const cur = new Date(it.currentDate + 'T00:00:00');
    if (cur < today) {
      // only proceed if nextDate exists (if not, use currentDate +30)
      let newCurrent = it.nextDate || addDays(it.currentDate, 30);
      // if newCurrent still in past (rare) move forward until >= today by increments of 30 days
      while (new Date(newCurrent + 'T00:00:00') < today) {
        newCurrent = addDays(newCurrent, 30);
      }
      const newNext = addDays(newCurrent, 30);
      toUpdate.push({ id: it.id, currentDate: newCurrent, nextDate: newNext });
    }
  }
  for (const u of toUpdate) {
    try {
      await updateCase(u.id, { currentDate: u.currentDate, nextDate: u.nextDate });
      console.log('Advanced case', u.id, u.currentDate, u.nextDate);
    } catch (e) {
      console.error('Advance failed for', u.id, e);
    }
  }
}

/* ---------- CRUD operations ---------- */
async function addCase(obj) {
  await txPromise(DB, 'readwrite', store => store.add(obj));
  await reloadCache();
}
async function updateCase(id, obj) {
  await txPromise(DB, 'readwrite', store => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result || {};
      const merged = { ...existing, ...obj };
      store.put(merged);
    };
  });
  await reloadCache();
}
async function deleteCase(id) {
  await txPromise(DB, 'readwrite', store => store.delete(id));
  await reloadCache();
}
async function getCase(id) {
  return await txPromise(DB, 'readonly', store => store.get(id)).then(res => {
    return new Promise((res2, rej2) => {
      const tx = DB.transaction([STORE], 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = e => res2(e.target.result);
      r.onerror = e => rej2(e.target.error);
    });
  });
}
async function reloadCache() {
  cache = await txPromise(DB, 'readonly', store => store.getAll()).then(res => {
    if (Array.isArray(res)) return res;
    if (res && res.result) return res.result;
    return [];
  });
}

/* ---------- UI Attach ---------- */
function attachUIHandlers() {
  if ($('#search')) $('#search').addEventListener('input', renderCases);
  if ($('#sortBy')) $('#sortBy').addEventListener('change', renderCases);
  if ($('#sortOrder')) $('#sortOrder').addEventListener('change', renderCases);
  if ($('#filterJudge')) $('#filterJudge').addEventListener('change', renderCases);
  if ($('#filterCourt')) $('#filterCourt').addEventListener('change', renderCases);
  if ($('#filterHasFiles')) $('#filterHasFiles').addEventListener('change', renderCases);
  if ($('#filterUpcoming')) $('#filterUpcoming').addEventListener('input', renderCases);
  if ($('#dateFrom')) $('#dateFrom').addEventListener('change', renderCases);
  if ($('#dateTo')) $('#dateTo').addEventListener('change', renderCases);
  if ($('#clearFilters')) $('#clearFilters').addEventListener('click', resetFilters);
  if ($('#todayBtn')) $('#todayBtn').addEventListener('click', todaysHearing);
  if ($('#exportBtn')) $('#exportBtn').addEventListener('click', exportJSON);
  if ($('#importInput')) $('#importInput').addEventListener('change', importJSON);
  if ($('#clearDB')) $('#clearDB').addEventListener('click', clearDB);
}

/* ---------- Render (index) ---------- */
function getFilters() {
  return {
    q: ($('#search')?.value || '').trim().toLowerCase(),
    sortBy: $('#sortBy')?.value || 'caseTitle',
    sortOrder: $('#sortOrder')?.value || 'asc',
    judge: ($('#filterJudge')?.value || '').trim().toLowerCase(),
    court: ($('#filterCourt')?.value || '').trim().toLowerCase(),
    hasFiles: !!$('#filterHasFiles')?.checked,
    upcoming: ($('#filterUpcoming')?.value) ? parseInt($('#filterUpcoming').value,10) : null,
    from: $('#dateFrom')?.value || null,
    to: $('#dateTo')?.value || null
  };
}

function renderCases() {
  if (!$('#casesList')) return;
  populateFilterOptions();
  const tpl = $('#caseTpl');
  const list = $('#casesList');
  const f = getFilters();

  let items = cache.slice();

  // filtering
  items = items.filter(it => {
    if (f.q) {
      const hay = [it.caseTitle, it.clientName, it.judgeName, it.courtNumber, it.remarks, it.contact].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (f.judge && !(it.judgeName || '').toLowerCase().includes(f.judge)) return false;
    if (f.court && !(it.courtNumber || '').toLowerCase().includes(f.court)) return false;
    if (f.hasFiles && !(it.files && it.files.length)) return false;
    if (f.upcoming !== null && !isNaN(f.upcoming)) {
      const now = new Date(); now.setHours(0,0,0,0);
      const lim = new Date(); lim.setDate(lim.getDate() + f.upcoming); lim.setHours(23,59,59,999);
      const dates = [it.currentDate, it.nextDate].filter(Boolean);
      if (!dates.some(ds => {
        const d = new Date(ds + 'T00:00:00');
        return d >= now && d <= lim;
      })) return false;
    }
    if (f.from || f.to) {
      const inRange = (ds) => {
        if (!ds) return false;
        const d = new Date(ds + 'T00:00:00');
        if (f.from && d < new Date(f.from + 'T00:00:00')) return false;
        if (f.to && d > new Date(f.to + 'T23:59:59')) return false;
        return true;
      };
      if (!(inRange(it.currentDate) || inRange(it.nextDate))) return false;
    }
    return true;
  });

  // sort
  const sb = f.sortBy;
  const ord = f.sortOrder === 'desc' ? -1 : 1;
  items.sort((a,b) => {
    let va = a[sb] || '';
    let vb = b[sb] || '';
    if (sb === 'currentDate' || sb === 'nextDate') {
      va = va ? new Date(va + 'T00:00:00').getTime() : 0;
      vb = vb ? new Date(vb + 'T00:00:00').getTime() : 0;
    } else {
      va = (''+va).toLowerCase();
      vb = (''+vb).toLowerCase();
    }
    if (va < vb) return -1 * ord;
    if (va > vb) return 1 * ord;
    return 0;
  });

  // display
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<p class="hint">No cases found.</p>';
    return;
  }
  items.forEach(it => {
    const node = tpl.content.cloneNode(true);
    node.querySelector('.title').textContent = it.caseTitle || '-';
    node.querySelector('.client').textContent = it.clientName || '-';
    node.querySelector('.court').textContent = it.courtNumber || '-';
    node.querySelector('.judge').textContent = it.judgeName || '-';
    node.querySelector('.current').textContent = fmt(it.currentDate);
    node.querySelector('.next').textContent = fmt(it.nextDate);
    node.querySelector('.filesCount').textContent = (it.files && it.files.length) || 0;

    const previewWrap = node.querySelector('.file-preview');
    if (it.files && it.files.length) {
      it.files.slice(0,3).forEach(f => {
        const el = document.createElement('div');
        el.className = 'file-item';
        if (isImage(f.data)) {
          el.innerHTML = `<img src="${f.data}" alt="${escapeHtml(f.name)}" /> <a href="${f.data}" download="${escapeHtml(f.name)}">${shortName(f.name)}</a>`;
        } else {
          el.innerHTML = `<div style="font-size:28px">📄</div><a href="${f.data}" download="${escapeHtml(f.name)}">${shortName(f.name)}</a>`;
        }
        previewWrap.appendChild(el);
      });
    } else {
      previewWrap.innerHTML = '<em style="color:var(--muted)">No files</em>';
    }

    node.querySelector('.viewBtn').addEventListener('click', () => {
      window.location.href = `add.html?id=${it.id}`;
    });
    node.querySelector('.delBtn').addEventListener('click', async () => {
      if (confirm('Delete this case?')) {
        await deleteCase(it.id);
        renderCases();
      }
    });

    list.appendChild(node);
  });
}

/* ---------- filter helpers ---------- */
function populateFilterOptions() {
  if (!$('#filterJudge') || !$('#filterCourt')) return;
  const judges = Array.from(new Set(cache.map(c => c.judgeName).filter(Boolean))).sort();
  const courts = Array.from(new Set(cache.map(c => c.courtNumber).filter(Boolean))).sort();
  const judgeSel = $('#filterJudge'); const courtSel = $('#filterCourt');
  const curJ = judgeSel.value; const curC = courtSel.value;
  judgeSel.innerHTML = '<option value="">All</option>' + judges.map(j => `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`).join('');
  courtSel.innerHTML = '<option value="">All</option>' + courts.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (judges.includes(curJ)) judgeSel.value = curJ;
  if (courts.includes(curC)) courtSel.value = curC;
}

/* ---------- Add/edit form page ---------- */
async function initFormPage() {
  const form = $('#caseForm');
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  const editId = params.get('id') ? parseInt(params.get('id'),10) : null;
  const filesInput = $('#filesInput');
  const existingFilesWrap = $('#existingFiles');
  const formTitle = $('#formTitle');

  // auto next date
  $('#currentDate').addEventListener('change', () => {
    const cur = $('#currentDate').value;
    if (cur) $('#nextDate').value = addDays(cur, 30);
  });

  // load if editing
  if (editId) {
    formTitle.textContent = 'Edit Case';
    const it = await new Promise((res,rej) => {
      const tx = DB.transaction([STORE], 'readonly');
      const req = tx.objectStore(STORE).get(editId);
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
    if (it) {
      $('#caseId').value = it.id;
      $('#caseTitle').value = it.caseTitle || '';
      $('#clientName').value = it.clientName || '';
      $('#contact').value = it.contact || '';
      $('#phone').value = it.phone || '';
      $('#courtNumber').value = it.courtNumber || '';
      $('#judgeName').value = it.judgeName || '';
      $('#remarks').value = it.remarks || '';
      $('#currentDate').value = it.currentDate || '';
      $('#nextDate').value = it.nextDate || '';

      existingFilesWrap.innerHTML = '';
      (it.files || []).forEach((f, idx) => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        if (isImage(f.data)) {
          chip.innerHTML = `<img src="${f.data}" alt="${escapeHtml(f.name)}" /><div>
            <a href="${f.data}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>
            <div style="margin-top:6px"><button class="btn small" data-idx="${idx}">Remove</button></div>
          </div>`;
        } else {
          chip.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><div style="font-size:22px">📄</div>
            <div><a href="${f.data}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>
            <div style="margin-top:6px"><button class="btn small" data-idx="${idx}">Remove</button></div></div></div>`;
        }
        existingFilesWrap.appendChild(chip);
      });

      // attach remove handlers
      existingFilesWrap.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const idx = parseInt(btn.dataset.idx,10);
          if (!confirm('Remove this file?')) return;
          const fresh = await new Promise((res,rej) => {
            const tx = DB.transaction([STORE], 'readonly');
            const req = tx.objectStore(STORE).get(editId);
            req.onsuccess = e => res(e.target.result);
            req.onerror = e => rej(e.target.error);
          });
          const files = (fresh.files || []);
          files.splice(idx,1);
          await updateCase(editId, { files });
          btn.closest('.file-chip').remove();
          await reloadCache();
        });
      });
    }
  }

  // submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#caseId').value ? parseInt($('#caseId').value,10) : null;
    const payload = {
      caseTitle: $('#caseTitle').value.trim(),
      clientName: $('#clientName').value.trim(),
      contact: $('#contact').value.trim(), // email or phone quick field
      phone: $('#phone')?.value?.trim() || '',
      courtNumber: $('#courtNumber').value.trim(),
      judgeName: $('#judgeName').value.trim(),
      remarks: $('#remarks').value.trim(),
      currentDate: $('#currentDate').value || '',
      nextDate: $('#nextDate').value || '',
      files: []
    };

    const newFiles = filesInput.files ? Array.from(filesInput.files) : [];
    if (newFiles.length) {
      const arr = await Promise.all(newFiles.map(fileToDataURL));
      payload.files = arr;
    }

    if (id) {
      const existing = await new Promise((res,rej) => {
        const tx = DB.transaction([STORE], 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = e => res(e.target.result);
        req.onerror = e => rej(e.target.error);
      });
      const mergedFiles = (existing.files || []).concat(payload.files || []);
      const updated = { ...payload, files: mergedFiles };
      await updateCase(id, updated);
      alert('Case updated.');
      window.location.href = 'index.html';
    } else {
      if (!payload.nextDate && payload.currentDate) payload.nextDate = addDays(payload.currentDate, 30);
      await addCase(payload);
      alert('Case added.');
      window.location.href = 'index.html';
    }
  });
  const user = auth.currentUser;
  if (user) await syncToCloud(user.uid);

}

/* ---------- Export / Import / Clear DB ---------- */
async function exportJSON() {
  await reloadCache();
  const blob = new Blob([JSON.stringify(cache, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cases-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const arr = JSON.parse(reader.result);
      if (!Array.isArray(arr)) throw new Error('Invalid JSON');
      for (const item of arr) {
        const toInsert = { ...item };
        delete toInsert.id;
        await txPromise(DB, 'readwrite', store => store.add(toInsert));
      }
      await reloadCache();
      renderCases();
      alert('Import complete.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      ev.target.value = '';
    }
  };
  reader.readAsText(file);
}

async function clearDB() {
  if (!confirm('Clear all cases and attachments from this browser?')) return;
  await txPromise(DB, 'readwrite', store => store.clear());
  await reloadCache();
  renderCases();
  alert('Database cleared.');
}

/* ---------- Utility helpers ---------- */
function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}
function shortName(n) {
  return n.length > 16 ? n.slice(0,13) + '…' : n;
}

/* ---------- Extras ---------- */
function resetFilters() {
  if ($('#search')) $('#search').value = '';
  if ($('#sortBy')) $('#sortBy').value = 'caseTitle';
  if ($('#sortOrder')) $('#sortOrder').value = 'asc';
  if ($('#filterJudge')) $('#filterJudge').value = '';
  if ($('#filterCourt')) $('#filterCourt').value = '';
  if ($('#filterHasFiles')) $('#filterHasFiles').checked = false;
  if ($('#filterUpcoming')) $('#filterUpcoming').value = '';
  if ($('#dateFrom')) $('#dateFrom').value = '';
  if ($('#dateTo')) $('#dateTo').value = '';
  renderCases();
}
function todaysHearing() {
  const s = (new Date()).toISOString().slice(0,10);
  if ($('#dateFrom')) $('#dateFrom').value = s;
  if ($('#dateTo')) $('#dateTo').value = s;
  renderCases();
}

/* ---------- Auth UI helpers & page protection ---------- */
function fillAuthLinks() {
  const wrap = $('#authLinks');
  if (!wrap) return;

  const user = auth.currentUser;
  if (!user) {
    wrap.innerHTML = `
      <a class="btn" href="login.html">Login</a>
      <a class="btn ghost" href="signup.html">Signup</a>
    `;
    return;
  }

  const name = user.displayName || user.email || user.phoneNumber || "User";
  wrap.innerHTML = `
    <span class="muted">Hello, ${escapeHtml(name)}</span>
    <button id="logoutBtn" class="btn ghost small">Logout</button>
  `;

  $('#logoutBtn').addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = "login.html";
  });
}

// 🧠 New: Run this only after Firebase Auth finishes loading
auth.onAuthStateChanged(user => {
  fillAuthLinks();
});



function protectPagesRequiringLogin() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const guarded = ['index.html', '', 'add.html', '']; // guard index and add
  if (guarded.includes(path)) {
    // if user not logged in, redirect to login
    if (!isLoggedIn()) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `login.html?next=${next}`;
    }
  }
}

/* expose some helpers for login page scripts if needed */
/* ---------- Firebase Auth Integration ---------- */
window.lcm_auth = {
  async signup(name, email, password) {
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      await db.collection("users").doc(uid).set({ name, email });
      loginSessionSet(uid);
      console.log("✅ User registered:", uid);
      window.location.href = "index.html";
    } catch (err) {
      alert("Signup failed: " + err.message);
    }
  },

  async login(email, password) {
    try {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      loginSessionSet(uid);
      console.log("✅ Logged in:", uid);
      window.location.href = "index.html";
    } catch (err) {
      alert("Login failed: " + err.message);
    }
  },

  async logout() {
    await auth.signOut();
    loginSessionClear();
    console.log("🚪 Signed out");
    window.location.href = "login.html";
  },

  currentUser: () => auth.currentUser,
  isLoggedIn: () => !!auth.currentUser
};

// Keep top bar links updated dynamically
auth.onAuthStateChanged((user) => {
  fillAuthLinks();
  if (!user && ['index.html', 'add.html'].includes(location.pathname.split('/').pop())) {
    window.location.href = "login.html";
  }
});

/* ---------- Cloud Sync ---------- */
async function syncToCloud(uid) {
  if (!uid) return;
  const coll = db.collection("users").doc(uid).collection("cases");

  for (const c of cache) {
    const caseId = String(c.id);

    // Deep copy
    const cleanCase = JSON.parse(JSON.stringify(c));

    // Upload files if they exist
    if (Array.isArray(c.files) && c.files.length) {
      const uploaded = [];

      for (const f of c.files) {
        // Only upload valid file objects with base64 data
        if (f && typeof f.data === "string" && f.data.startsWith("data:")) {
          try {
            const ref = storage.ref(`users/${uid}/cases/${caseId}/${f.name}`);
            const snap = await ref.putString(f.data, "data_url");
            const url = await snap.ref.getDownloadURL();
            uploaded.push({ name: f.name, url });
          } catch (err) {
            console.error("⚠️ File upload failed:", f.name, err);
          }
        } else if (f && f.url) {
          // Already uploaded file with URL
          uploaded.push({ name: f.name, url: f.url });
        }
      }

      cleanCase.files = uploaded;
    } else {
      delete cleanCase.files;
    }

    await coll.doc(caseId).set(cleanCase, { merge: true });
  }

  console.log("✅ Synced to cloud (files uploaded safely)");
}



async function syncFromCloud(uid) {
  if (!uid) return;
  const coll = db.collection("users").doc(uid).collection("cases");
  const snap = await coll.get();
  const docs = snap.docs.map(d => d.data());

  // 🔹 Merge cloud and local data
  await reloadCache();
  const localMap = new Map(cache.map(c => [c.id, c]));
  for (const c of docs) localMap.set(c.id, c);

  // save back merged data locally
  await txPromise(DB, 'readwrite', store => {
    store.clear();
    for (const item of localMap.values()) store.add(item);
  });

  cache = Array.from(localMap.values());
  renderCases();
  console.log("✅ Synced (merged) from cloud");
}


async function clearLocal() {
  return new Promise(resolve => {
    const tx = DB.transaction("cases", "readwrite");
    tx.objectStore("cases").clear();
    tx.oncomplete = resolve;
  });
}
auth.onAuthStateChanged(async (user) => {
  if (user) {
    console.log("Signed in:", user.email);
    await syncFromCloud(user.uid);
  } else {
    console.log("Signed out");
  }
});
/* ---------- Animated Dark Mode Toggle ---------- */
(function darkModeSetup() {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  // Detect saved or system theme
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = localStorage.getItem('lcm_theme') || (prefersDark ? 'dark' : 'light');

  if (saved === 'dark') {
    root.setAttribute('data-theme', 'dark');
    toggle.checked = true;
  }

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('lcm_theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
      localStorage.setItem('lcm_theme', 'light');
    }
  });
})();
