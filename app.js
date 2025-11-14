/*============================
  Lawyer Case Manager – app.js
  Handles login, signup, dashboard,
  storing & retrieving data via Google Apps Script
==============================*/

// ========================
// Google Apps Script API URL
// ========================
const API_URL = "https://script.google.com/macros/s/AKfycbyvSEkJ0E3k13msqzW2HtrU_jgwMEK68jfgXG2JdOdB9YfDUVAPR0coLfWRhe6Gy9csoQ/exec";


// ========================
// DARK MODE TOGGLE
// ========================
const darkToggle = document.getElementById("darkToggle");
if (darkToggle) {
  darkToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("darkMode", document.body.classList.contains("dark-mode"));
  });

  // Load dark mode
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
  }
}

// ========================
// LOGIN SYSTEM
// ========================
if (document.getElementById("loginForm")) {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    let email = document.getElementById("loginEmail").value;
    let password = document.getElementById("loginPassword").value;

    let response = await fetch(API_URL + "?action=login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });

    let result = await response.json();

    if (result.success) {
      localStorage.setItem("user", email);
      window.location.href = "index.html";
    } else {
      alert("Invalid login");
    }
  });
}

// ========================
// SIGNUP SYSTEM
// ========================
if (document.getElementById("signupForm")) {
  document.getElementById("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    let name = document.getElementById("signupName").value;
    let email = document.getElementById("signupEmail").value;
    let password = document.getElementById("signupPassword").value;

    let response = await fetch(API_URL + "?action=signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });

    let result = await response.json();

    if (result.success) {
      alert("Account created successfully");
      window.location.href = "login.html";
    } else {
      alert("Email already registered");
    }
  });
}

// ========================
// LOGOUT
// ========================
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("user");
    window.location.href = "login.html";
  });
}

// ========================
// ADD CASE
// ========================
if (document.getElementById("addCaseForm")) {
  document.getElementById("addCaseForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    let formData = new FormData();
    formData.append("action", "addCase");
    formData.append("caseTitle", document.getElementById("caseTitle").value);
    formData.append("clientName", document.getElementById("clientName").value);
    formData.append("contact", document.getElementById("contact").value);
    formData.append("courtNumber", document.getElementById("courtNumber").value);
    formData.append("judgeName", document.getElementById("judgeName").value);
    formData.append("currentHearing", document.getElementById("currentHearing").value);
    formData.append("nextHearing", document.getElementById("nextHearing").value);
    formData.append("remarks", document.getElementById("remarks").value);

    let files = document.getElementById("caseFiles").files;
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    let response = await fetch(API_URL, { method: "POST", body: formData });
    let result = await response.json();

    if (result.success) {
      alert("Case added successfully");
      window.location.href = "index.html";
    } else {
      alert("Error saving case");
    }
  });
}

// ========================
// LOAD DASHBOARD DATA
// ========================
async function loadCases() {
  let response = await fetch(API_URL + "?action=getCases");
  let data = await response.json();

  let tableBody = document.getElementById("caseTableBody");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  data.forEach(caseItem => {
    let row = `
      <tr>
        <td>${caseItem.caseTitle}</td>
        <td>${caseItem.clientName}</td>
        <td>${caseItem.currentHearing}</td>
        <td>${caseItem.nextHearing}</td>
        <td>
          <a href="view.html?id=${caseItem.id}" class="btn-small">View</a>
          <a href="edit.html?id=${caseItem.id}" class="btn-small warning">Edit</a>
          <button onclick="deleteCase('${caseItem.id}')" class="btn-small danger">Delete</button>
        </td>
      </tr>`;

    tableBody.innerHTML += row;
  });

  document.getElementById("totalCases").innerText = data.length;

  let upcoming = data.filter(x => new Date(x.currentHearing) > new Date()).length;
  document.getElementById("upcomingHearings").innerText = upcoming;
}

window.onload = () => {
  if (window.location.pathname.includes("index.html")) {
    loadCases();
  }
};

// ========================
// DELETE CASE
// ========================
async function deleteCase(id) {
  if (!confirm("Delete this case permanently?")) return;

  let response = await fetch(API_URL + "?action=deleteCase&id=" + id);
  let result = await response.json();

  if (result.success) {
    alert("Case deleted");
    loadCases();
  }
}
