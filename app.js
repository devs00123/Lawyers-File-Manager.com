/* Frontend JS matched to GAS backend (Option B) */
const API_URL = "https://script.google.com/macros/s/AKfycbyvSEkJ0E3k13msqzW2HtrU_jgwMEK68jfgXG2JdOdB9YfDUVAPR0coLfWRhe6Gy9csoQ/exec";

// Login
if (document.getElementById("loginForm")) {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let email = document.getElementById("loginEmail").value;
    let password = document.getElementById("loginPassword").value;
    let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, password }) });
    let j = await resp.json();
    if (j.success) { localStorage.setItem("userEmail", j.email || email); localStorage.setItem("token", j.token); window.location.href="index.html"; }
    else alert(j.message);
  });
}

// Signup
if (document.getElementById("signupForm")) {
  document.getElementById("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let displayName = document.getElementById("signupName").value;
    let email = document.getElementById("signupEmail").value;
    let password = document.getElementById("signupPassword").value;
    let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, password, displayName }) });
    let j = await resp.json();
    if (j.success) { alert("Created. Please login."); window.location.href="login.html"; } else alert(j.message);
  });
}

// Add case
if (document.getElementById("addCaseForm")) {
  document.getElementById("addCaseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let ownerEmail = localStorage.getItem("userEmail");
    let caseData = {
      case_number: document.getElementById("caseNumber").value,
      case_title: document.getElementById("caseTitle").value,
      client_name: document.getElementById("clientName").value,
      mobile: document.getElementById("contact").value,
      email: document.getElementById("clientEmail") ? document.getElementById("clientEmail").value : "",
      court_number: document.getElementById("courtNumber").value,
      judge_name: document.getElementById("judgeName").value,
      current_hearing: document.getElementById("currentHearing").value,
      next_hearing: document.getElementById("nextHearing").value,
      purpose: document.getElementById("remarks").value,
      files: ""
    };
    let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ caseData, ownerEmail, action:"add" }) });
    let j = await resp.json();
    if (j.success) { alert("Case added"); window.location.href="index.html"; } else alert(j.message);
  });
}

// Load cases
async function loadCases() {
  let ownerEmail = localStorage.getItem("userEmail");
  let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ownerEmail, getCases:true }) });
  let data = await resp.json();
  if (!Array.isArray(data)) return;
  let tableBody = document.getElementById("caseTableBody");
  if (!tableBody) return;
  tableBody.innerHTML = "";
  data.forEach(c => {
    let row = `<tr>
      <td>${c.case_title}</td><td>${c.client_name}</td><td>${c.current_hearing}</td><td>${c.next_hearing}</td>
      <td>
        <a href="view.html?id=${c.id}" class="btn-small">View</a>
        <a href="edit.html?id=${c.id}" class="btn-small warning" onclick="location.href='edit.html?id=${c.id}'">Edit</a>
        <button class="btn-small danger" onclick="deleteCase('${c.id}')">Delete</button>
      </td></tr>`;
    tableBody.innerHTML += row;
  });
  document.getElementById("totalCases").innerText = data.length;
  let upcoming = data.filter(x => new Date(x.current_hearing) > new Date()).length;
  document.getElementById("upcomingHearings").innerText = upcoming;
}
window.onload = () => { if (window.location.pathname.includes("index.html")) loadCases(); }

// Delete case
async function deleteCase(id) {
  if (!confirm("Delete this case?")) return;
  let ownerEmail = localStorage.getItem("userEmail");
  let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ caseId:id, ownerEmail, action:"delete" }) });
  let j = await resp.json();
  if (j.success) { alert("Deleted"); loadCases(); } else alert(j.message);
}

// Edit page loader & submit
if (document.getElementById("editForm")) {
  // populate fields from query id by fetching cases and finding id
  (async ()=>{
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) return;
    let ownerEmail = localStorage.getItem("userEmail");
    let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ownerEmail, getCases:true }) });
    let data = await resp.json();
    let c = data.find(x=>String(x.id)===String(id));
    if (!c) return;
    document.getElementById("caseNumber").value = c.case_number || "";
    document.getElementById("caseTitle").value = c.case_title || "";
    document.getElementById("clientName").value = c.client_name || "";
    document.getElementById("contact").value = c.mobile || "";
    document.getElementById("courtNumber").value = c.court_number || "";
    document.getElementById("judgeName").value = c.judge_name || "";
    document.getElementById("currentHearing").value = c.current_hearing || "";
    document.getElementById("nextHearing").value = c.next_hearing || "";
    document.getElementById("remarks").value = c.purpose || "";
    // submit
    document.getElementById("editForm").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const updatedData = {
        case_number: document.getElementById("caseNumber").value,
        case_title: document.getElementById("caseTitle").value,
        client_name: document.getElementById("clientName").value,
        mobile: document.getElementById("contact").value,
        court_number: document.getElementById("courtNumber").value,
        judge_name: document.getElementById("judgeName").value,
        current_hearing: document.getElementById("currentHearing").value,
        next_hearing: document.getElementById("nextHearing").value,
        purpose: document.getElementById("remarks").value
      };
      let ownerEmail = localStorage.getItem("userEmail");
      let resp = await fetch(API_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ caseId:id, updatedData, ownerEmail, action:"update" }) });
      let j = await resp.json();
      if (j.success) { alert("Updated"); window.location.href="index.html"; } else alert(j.message);
    });
  })();
}
