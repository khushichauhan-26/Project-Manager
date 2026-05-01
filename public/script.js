
const logs = document.getElementById("logs");
const authInfo = document.getElementById("authInfo");
const dashboardInfo = document.getElementById("dashboardInfo");
const taskList = document.getElementById("taskList");
const projectSelect = document.getElementById("projectSelect");

const authScreen = document.getElementById("authScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const signupCard = document.getElementById("signupCard");
const loginCard = document.getElementById("loginCard");

const state = {
  token: localStorage.getItem("token") || "",
  projects: [],
};

function log(message, data) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${message}`;
  logs.textContent = data ? `${line}\n${JSON.stringify(data, null, 2)}\n\n${logs.textContent}` : `${line}\n${logs.textContent}`;
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

function showSignup() {
  signupCard.classList.remove("hidden");
  loginCard.classList.add("hidden");
}

function showLogin() {
  loginCard.classList.remove("hidden");
  signupCard.classList.add("hidden");
}

function showDashboard() {
  authScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
}

function showAuth() {
  dashboardScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  showSignup();
}

function setAuthInfo(user) {
  authInfo.textContent = user ? JSON.stringify(user, null, 2) : "Not logged in";
}

function fillProjects(projects) {
  projectSelect.innerHTML = "";
  if (!projects.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No projects available";
    projectSelect.appendChild(option);
    return;
  }

  for (const p of projects) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = `${p.name} (tasks: ${p.task_count || 0})`;
    projectSelect.appendChild(option);
  }
}

function getSelectedProjectId() {
  const projectId = Number(projectSelect.value);
  if (!projectId) {
    throw new Error("Please load and select a project first");
  }
  return projectId;
}

async function handleAuthSuccess(data, message) {
  state.token = data.token;
  localStorage.setItem("token", data.token);
  setAuthInfo(data.user);
  showDashboard();
  log(message, data.user);
  await loadProjects();
}

document.getElementById("gotoLoginBtn").onclick = showLogin;
document.getElementById("gotoSignupBtn").onclick = showSignup;

document.getElementById("signupBtn").onclick = async () => {
  try {
    const data = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("signupName").value,
        email: document.getElementById("signupEmail").value,
        password: document.getElementById("signupPassword").value,
        role: document.getElementById("signupRole").value,
      }),
    });
    await handleAuthSuccess(data, "Signup success");
  } catch (error) {
    setAuthInfo(null);
    log(`Signup failed: ${error.message}`);
  }
};

document.getElementById("loginBtn").onclick = async () => {
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value,
      }),
    });
    await handleAuthSuccess(data, "Login success");
  } catch (error) {
    setAuthInfo(null);
    log(`Login failed: ${error.message}`);
  }
};

document.getElementById("logoutBtn").onclick = () => {
  state.token = "";
  localStorage.removeItem("token");
  setAuthInfo(null);
  showAuth();
  log("Logged out");
};

document.getElementById("createProjectBtn").onclick = async () => {
  try {
    const data = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("projectName").value,
        description: document.getElementById("projectDescription").value,
      }),
    });
    log("Project created", data);
    await loadProjects();
  } catch (error) {
    log(`Create project failed: ${error.message}`);
  }
};

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data;
  fillProjects(data);
  return data;
}

document.getElementById("loadProjectsBtn").onclick = async () => {
  try {
    const data = await loadProjects();
    log("Projects loaded", data);
  } catch (error) {
    log(`Load projects failed: ${error.message}`);
  }
};

document.getElementById("addMemberBtn").onclick = async () => {
  try {
    const projectId = getSelectedProjectId();
    const data = await api(`/api/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("memberEmail").value,
        role: document.getElementById("memberRole").value,
      }),
    });
    log("Member updated", data);
  } catch (error) {
    log(`Add member failed: ${error.message}`);
  }
};

document.getElementById("createTaskBtn").onclick = async () => {
  try {
    const projectId = getSelectedProjectId();
    const assignRaw = document.getElementById("taskAssignTo").value.trim();
    const assignedTo = assignRaw ? Number(assignRaw) : null;
    const dueDate = document.getElementById("taskDueDate").value || null;

    const data = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        title: document.getElementById("taskTitle").value,
        details: document.getElementById("taskDetails").value,
        priority: document.getElementById("taskPriority").value,
        dueDate,
        assignedTo,
      }),
    });
    log("Task created", data);
  } catch (error) {
    log(`Create task failed: ${error.message}`);
  }
};

document.getElementById("loadTasksBtn").onclick = async () => {
  try {
    const projectId = getSelectedProjectId();
    const tasks = await api(`/api/tasks?projectId=${projectId}`);
    taskList.innerHTML = "";
    if (!tasks.length) {
      const li = document.createElement("li");
      li.textContent = "No tasks found for this project.";
      taskList.appendChild(li);
      log("Tasks loaded", tasks);
      return;
    }

    for (const task of tasks) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${task.title}</strong> | ${task.status} | priority ${task.priority} | assigned: ${
        task.assigned_to_name || "N/A"
      }`;

      const select = document.createElement("select");
      ["TODO", "IN_PROGRESS", "DONE"].forEach((status) => {
        const opt = document.createElement("option");
        opt.value = status;
        opt.textContent = status;
        if (status === task.status) opt.selected = true;
        select.appendChild(opt);
      });
      select.onchange = async () => {
        try {
          await api(`/api/tasks/${task.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value }),
          });
          log(`Task #${task.id} updated to ${select.value}`);
        } catch (error) {
          log(`Status update failed: ${error.message}`);
        }
      };
      li.appendChild(document.createTextNode(" "));
      li.appendChild(select);
      taskList.appendChild(li);
    }
    log("Tasks loaded", tasks);
  } catch (error) {
    log(`Load tasks failed: ${error.message}`);
  }
};

document.getElementById("loadDashboardBtn").onclick = async () => {
  try {
    const data = await api("/api/dashboard");
    dashboardInfo.textContent = JSON.stringify(data, null, 2);
    log("Dashboard loaded", data);
  } catch (error) {
    log(`Dashboard failed: ${error.message}`);
  }
};

async function bootstrap() {
  showAuth();

  if (!state.token) {
    setAuthInfo(null);
    return;
  }

  try {
    const me = await api("/api/me");
    setAuthInfo(me);
    showDashboard();
    await loadProjects();
    log("Session restored", me);
  } catch (_error) {
    state.token = "";
    localStorage.removeItem("token");
    setAuthInfo(null);
    showAuth();
  }
}

bootstrap();
