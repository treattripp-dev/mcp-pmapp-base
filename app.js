// State
let currentProjectId = null;
let projects = [];
let tasks = [];

// Elements
const dashboardView = document.getElementById('dashboardView');
const projectView = document.getElementById('projectView');
const projectGrid = document.getElementById('projectGrid');
const taskListEl = document.getElementById('taskList');
const currentProjectTitle = document.getElementById('currentProjectTitle');
const newProjectModal = document.getElementById('newProjectModal');
const settingsModal = document.getElementById('settingsModal');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');

// Config
let BACKEND_URL = localStorage.getItem('backend_url') || 'http://localhost:3000';
// Remove trailing slash if present
BACKEND_URL = BACKEND_URL.replace(/\/$/, '');
const WS_URL = BACKEND_URL.replace(/^http/, 'ws');

// --- Navigation ---

function showDashboard() {
    currentProjectId = null;
    projectView.style.display = 'none';
    dashboardView.style.display = 'block';
    fetchProjects();
}

function showProject(id) {
    currentProjectId = id;
    const project = projects.find(p => p.id === id);
    if (project) {
        currentProjectTitle.textContent = project.name;
        dashboardView.style.display = 'none';
        projectView.style.display = 'block';
        fetchTasks(id);
    }
}

function openNewProjectModal() {
    document.getElementById('newProjectTitle').value = '';
    document.getElementById('newProjectDesc').value = '';
    newProjectModal.classList.add('active');
    setTimeout(() => document.getElementById('newProjectTitle').focus(), 100);
}

function closeNewProjectModal() {
    newProjectModal.classList.remove('active');
}

function openSettingsModal() {
    const input = document.getElementById('backendUrlInput');
    input.value = BACKEND_URL;
    settingsModal.classList.add('active');
    setTimeout(() => {
        input.focus();
        input.select();
    }, 100);
}

function closeSettingsModal() {
    settingsModal.classList.remove('active');
}

function saveSettings() {
    const url = document.getElementById('backendUrlInput').value.trim();
    if (url) {
        localStorage.setItem('backend_url', url);
        location.reload();
    }
}

// --- API & Logic ---

async function fetchProjects() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/projects`, { credentials: 'include' });
        if (res.ok) {
            projects = await res.json();
            renderProjects();
            updateStatus(true);
        }
    } catch (err) {
        console.error(err);
        updateStatus(false);
    }
}

async function createProject() {
    const title = document.getElementById('newProjectTitle').value.trim();
    const description = document.getElementById('newProjectDesc').value.trim();
    if (!title) return;

    try {
        await fetch(`${BACKEND_URL}/api/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description }),
            credentials: 'include'
        });
        closeNewProjectModal();
    } catch (err) {
        console.error(err);
    }
}

async function deleteProject(e, id) {
    e.stopPropagation();
    if (!confirm('Delete this project and all its tasks?')) return;

    try {
        await fetch(`${BACKEND_URL}/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch (err) {
        console.error(err);
    }
}

async function fetchTasks(projectId) {
    try {
        const res = await fetch(`${BACKEND_URL}/api/tasks?project_id=${projectId}`, { credentials: 'include' });
        if (res.ok) {
            tasks = await res.json();
            renderTasks();
        }
    } catch (err) {
        console.error(err);
    }
}

async function addTask() {
    const input = document.getElementById('taskInput');
    const title = input.value.trim();
    if (!title || !currentProjectId) return;

    try {
        await fetch(`${BACKEND_URL}/api/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, project_id: currentProjectId }),
            credentials: 'include'
        });
        input.value = '';
    } catch (err) {
        console.error(err);
    }
}

async function toggleTask(id, currentStatus) {
    const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
    try {
        await fetch(`${BACKEND_URL}/api/tasks/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
            credentials: 'include'
        });
    } catch (err) {
        console.error(err);
    }
}

async function deleteTask(id) {
    try {
        await fetch(`${BACKEND_URL}/api/tasks/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch (err) {
        console.error(err);
    }
}

async function executeTask(id, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳';
    btn.disabled = true;
    try {
        const res = await fetch(`${BACKEND_URL}/api/tasks/${id}/execute`, { method: 'POST', credentials: 'include' });
        if (!res.ok) throw new Error((await res.json()).error);
    } catch (err) {
        alert("Execution failed: " + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// --- Rendering ---

function renderProjects() {
    projectGrid.innerHTML = '';
    if (projects.length === 0) {
        document.getElementById('noProjects').style.display = 'block';
        return;
    }
    document.getElementById('noProjects').style.display = 'none';

    projects.forEach(p => {
        const card = document.createElement('div');
        card.className = 'glass-card project-card';
        card.onclick = () => showProject(p.id);

        card.innerHTML = `
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:start;">
                            <div class="project-title">${escapeHtml(p.name)}</div>
                            <button class="btn-danger" onclick="deleteProject(event, ${p.id})" title="Delete Project">&times;</button>
                        </div>
                        <div class="project-desc">${escapeHtml(p.description || '')}</div>
                    </div>
                    <div class="progress-container">
                        <div class="progress-label">
                            <span>Progress</span>
                            <span>${p.progress}%</span>
                        </div>
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill" style="width: ${p.progress}%"></div>
                        </div>
                    </div>
                `;
        projectGrid.appendChild(card);
    });
}

function renderTasks() {
    taskListEl.innerHTML = '';
    if (tasks.length === 0) {
        document.getElementById('noTasks').style.display = 'block';
        return;
    }
    document.getElementById('noTasks').style.display = 'none';

    tasks.forEach(t => {
        const li = document.createElement('li');
        li.className = `task-item ${t.status === 'completed' ? 'completed' : ''}`;
        li.innerHTML = `
                    <div class="checkbox" onclick="toggleTask(${t.id}, '${t.status}')"></div>
                    <div class="task-content">
                        <div class="task-title">${escapeHtml(t.title)}</div>
                        ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
                    </div>
                    <button class="btn-secondary" style="padding: 5px 10px; margin-right: 5px;" onclick="executeTask(${t.id}, this)">▶️</button>
                    <button class="btn-danger" onclick="deleteTask(${t.id})">&times;</button>
                `;
        taskListEl.appendChild(li);
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateStatus(connected) {
    if (connected) {
        statusIndicator.className = 'status-indicator status-connected';
        statusText.textContent = 'Connected';
    } else {
        statusIndicator.className = 'status-indicator status-disconnected';
        statusText.textContent = 'Disconnected';
    }
}

// --- WebSocket ---

let ws;
function connectWs() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => updateStatus(true);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'update_projects') {
            projects = data.projects;
            if (!currentProjectId) renderProjects();
        }
        if (data.type === 'update_tasks') {
            // Only update if we are viewing the relevant project
            if (currentProjectId && data.projectId === currentProjectId) {
                tasks = data.tasks;
                renderTasks();
            }
        }
    };
    ws.onclose = () => {
        updateStatus(false);
        setTimeout(connectWs, 3000);
    };
}

// Init
fetchProjects();
connectWs();
