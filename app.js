/* app.js — Lawyer Case Manager (Firebase + IndexedDB)
   ✅ Fix: Safe fillAuthLinks()
   ✅ Improved Firebase Auth sync
   ✅ Better handling for missing names
   ✅ Case auto-advance feature included
*/

const DB_NAME = 'LawyerCaseDB';
const STORE = 'cases';
const DB_VERSION = 4;

// --- Firebase setup ---
const firebaseConfig = {
  apiKey: "AIzaSyAeYlJB99zUH36t-sDREuiSK8LFFF64go0",
  authDomain: "lawyercasemanager-17972.firebaseapp.com",
  projectId: "lawyercasemanager-17972",
  storageBucket: "lawyercasemanager-17972.firebasestorage.app",
  messagingSenderId: "996102566916",
  appId: "1:996102566916:web:76d1cf6031eb74c06db151",
  measurementId: "G-BE79DPJY43"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
firebase.firestore().enablePersistence().catch(console.error);

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const fmt = d => d ? (new Date(d)).toISOString().slice(0,10) : '';
const addDays = (dateISO, days) => {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
};
const isImage = dataURL => typeof dataURL === 'string' && dataURL.startsWith('data:image');
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const shortName = n => n?.length > 16 ? n.slice(0,13) + '…' : n;

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('caseTitle', 'caseTitle', { unique: false });
      }
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e.target.error);
  });
}

function txPromise(db, mode, callback) {
  return new Promise((res, rej) => {
    const tx = db.transaction([STORE], mode);
    const store = tx.objectStore(STORE);
    let out;
    try { out = callback(store); } catch (err) { rej(err); }
    tx.oncomplete = () => res(out);
    tx.onerror = e => rej(e.target.error);
  });
}

// ---------- File Helper ----------
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ name: file.name, data: r.result });
    r.onerror = () => rej(new Error('File read error'));
    r.readAsDataURL(file);
  });
}

// ---------- App State ----------
let DB;
let cache = [];

// ---------- Start ----------
(async function start() {
  try {
    DB = await openDB();
    attachUIHandlers();
    fillAuthLinks();  // fixed safe version below
    protectPagesRequiringLogin();

    if ($('#casesList')) {
      await reloadCache();
      await advancePastHearings();
      await reloadCache();
      renderCases();
    }
    if ($('#caseForm')) {
      await initFormPage();
    }
  } catch (err) {
    console.error('Init error', err);
  }
})();

// ---------- Auto-advance ----------
async function advancePastHearings() {
  await reloadCache();
  const today = new Date(); today.setHours(0,0,0,0);
  const toUpdate = [];
  for (const it of cache) {
    if (!it.currentDate) continue;
    const cur = new Date(it.currentDate + 'T00:00:00');
    if (cur < today) {
      let newCurrent = it.nextDate || addDays(it.currentDate, 30);
      while (new Date(newCurrent + 'T00:00:00') < today)
        newCurrent = addDays(newCurrent, 30);
      const newNext = addDays(newCurrent, 30);
      toUpdate.push({ id: it.id, currentDate: newCurrent, nextDate: newNext });
    }
  }
  for (const u of toUpdate)
    await updateCase(u.id, { currentDate: u.currentDate, nextDate: u.nextDate });
}

// ---------- CRUD ----------
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
async function reloadCache() {
  cache = await txPromise(DB, 'readonly', store => store.getAll());
}

// ---------- UI ----------
function attachUIHandlers() {
  if ($('#search')) $('#search').addEventListener('input', renderCases);
}

function renderCases() {
  const list = $('#casesList');
  if (!list) return;
  list.innerHTML = '';
  if (!cache.length) {
    list.innerHTML = '<p>No cases found.</p>';
    return;
  }
  cache.forEach(it => {
    const div = document.createElement('div');
    div.className = 'case-item';
    div.innerHTML = `
      <h3>${escapeHtml(it.caseTitle)}</h3>
      <p>Client: ${escapeHtml(it.clientName || '')}</p>
      <p>Next Hearing: ${fmt(it.nextDate)}</p>
      <button class="btn" onclick="window.location.href='add.html?id=${it.id}'">Edit</button>
    `;
    list.appendChild(div);
  });
}

// ---------- Auth-Aware Navbar ----------
function fillAuthLinks() {
  const wrap = $('#authLinks');
  if (!wrap) return;

  const user = auth.currentUser;
  if (user) {
    const name = user.displayName || user.email || user.phoneNumber || "User";
    wrap.innerHTML = `
      <span class="muted">Hello, ${escapeHtml(name)}</span>
      <button id="logoutBtn" class="btn ghost small">Logout</button>
    `;
    $('#logoutBtn').addEventListener('click', async () => {
      await auth.signOut();
      window.location.href = "login.html";
    });
  } else {
    wrap.innerHTML = `
      <a class="btn" href="login.html">Login</a>
      <a class="btn ghost" href="signup.html">Signup</a>
    `;
  }
}

function protectPagesRequiringLogin() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const guarded = ['index.html', '', 'add.html'];
  if (guarded.includes(path)) {
    auth.onAuthStateChanged(user => {
      if (!user) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `login.html?next=${next}`;
      }
    });
  }
}

// ---------- Cloud Sync ----------
async function syncToCloud(uid) {
  if (!uid) return;
  const coll = db.collection("users").doc(uid).collection("cases");
  for (const c of cache) {
    // convert base64 files into plain objects before save
    const files = (c.files || []).map(f => ({ name: f.name || '', data: f.data || '' }));
    await coll.doc(String(c.id)).set({ ...c, files }, { merge: true });
  }
  console.log("✅ Synced to cloud");
}

async function syncFromCloud(uid) {
  if (!uid) return;
  const coll = db.collection("users").doc(uid).collection("cases");
  const snap = await coll.get();
  const docs = snap.docs.map(d => d.data());
  await clearLocal();
  for (const c of docs) await addCase(c);
  cache = docs;
  renderCases();
  console.log("✅ Loaded from cloud");
}

async function clearLocal() {
  return new Promise(resolve => {
    const tx = DB.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
  });
}

// ---------- Firebase Auth Events ----------
auth.onAuthStateChanged(async (user) => {
  if (user) {
    console.log("Signed in:", user.email);
    fillAuthLinks();
    await syncFromCloud(user.uid);
  } else {
    console.log("Signed out");
    fillAuthLinks();
  }
});
