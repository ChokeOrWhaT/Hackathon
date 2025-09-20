function getLoggedUser() {
  return JSON.parse(localStorage.getItem("disasterx_logged_in"));
}


function logout() {
  localStorage.removeItem("disasterx_logged_in");
  if (document.getElementById("authArea")) {
    updateNavbar();
  }
  window.location.href = "login.html";
}


function updateNavbar() {
  const authArea = document.getElementById("authArea");
  if (!authArea) return;

  const loggedUser = getLoggedUser();

  if (loggedUser) {
    authArea.innerHTML = `
      <span class="me-3 fw-bold" style="color:#fff">Welcome, ${loggedUser.name}</span>
      <button class="btn btn-sm btn-outline-danger" onclick="logout()">Logout</button>
    `;
  } else {
    authArea.innerHTML = `
      <a href="login.html" class="btn btn-outline-primary btn-sm">Log In</a>
      <a href="signup.html" class="btn btn-primary btn-sm">Sign Up</a>
    `;
  }
}


function protectPage() {
  if (!getLoggedUser()) {
    window.location.href = "login.html";
  }
}


function preventAuthAccess() {
  if (getLoggedUser()) {
    window.location.href = "dashboard.html";
  }
}


window.addEventListener("load", updateNavbar);