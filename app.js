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
const autoRunToggle = document.getElementById('autoRunToggle');

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



async function checkWorkerStatus() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/worker/status`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            updateAutoRunUI(data.active);
        }
    } catch (err) {
        console.error("Failed to check worker status", err);
    }
}

async function toggleAutoRun() {
    const isChecked = autoRunToggle.checked;
    const endpoint = isChecked ? '/api/worker/start' : '/api/worker/stop';

    try {
        const res = await fetch(`${BACKEND_URL}${endpoint}`, { method: 'POST', credentials: 'include' });
        if (!res.ok) {
            // Revert UI if failed
            autoRunToggle.checked = !isChecked;
            alert("Failed to toggle worker");
        }
    } catch (err) {
        console.error(err);
        autoRunToggle.checked = !isChecked;
    }
}

function updateAutoRunUI(active) {
    if (autoRunToggle) autoRunToggle.checked = active;
}

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

        // Show success state briefly
        btn.innerHTML = '✅ Queued';
        setTimeout(() => {
            if (document.body.contains(btn)) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }, 1500);
    } catch (err) {
        alert("Execution failed: " + err.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function executeTaskSpawn(id, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '🚀...';
    btn.disabled = true;
    try {
        // This request might take a long time or timeout, but the server will process it.
        // We don't want to block the UI forever, but we should show activity.
        const res = await fetch(`${BACKEND_URL}/api/tasks/${id}/execute-spawn`, { method: 'POST', credentials: 'include' });
        if (!res.ok) throw new Error((await res.json()).error);
    } catch (err) {
        console.log("Spawn execution initiated (might be running in bg): " + err.message);
    } finally {
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000); // Re-enable after a short delay so user knows it was sent
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

        // Content Container
        const content = document.createElement('div');

        // Header
        const header = document.createElement('div');
        header.style.cssText = "display:flex; justify-content:space-between; align-items:start;";

        const title = document.createElement('div');
        title.className = 'project-title';
        title.textContent = p.name;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Delete Project';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteProject(e, p.id);
        };

        header.appendChild(title);
        header.appendChild(deleteBtn);

        // Description
        const desc = document.createElement('div');
        desc.className = 'project-desc';
        desc.textContent = p.description || '';

        content.appendChild(header);
        content.appendChild(desc);

        // Progress Container
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';

        const progressLabel = document.createElement('div');
        progressLabel.className = 'progress-label';

        const labelText = document.createElement('span');
        labelText.textContent = 'Progress';
        const labelValue = document.createElement('span');
        labelValue.textContent = `${p.progress}%`;

        progressLabel.appendChild(labelText);
        progressLabel.appendChild(labelValue);

        const progressBarBg = document.createElement('div');
        progressBarBg.className = 'progress-bar-bg';

        const progressBarFill = document.createElement('div');
        progressBarFill.className = 'progress-bar-fill';
        progressBarFill.style.width = `${p.progress}%`;

        progressBarBg.appendChild(progressBarFill);

        progressContainer.appendChild(progressLabel);
        progressContainer.appendChild(progressBarBg);

        card.appendChild(content);
        card.appendChild(progressContainer);

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

        // Checkbox
        const checkbox = document.createElement('div');
        checkbox.className = 'checkbox';
        checkbox.onclick = (e) => {
            e.stopPropagation();
            toggleTask(t.id, t.status);
        };

        // Content
        const content = document.createElement('div');
        content.className = 'task-content';

        const title = document.createElement('div');
        title.className = 'task-title';
        title.textContent = t.title;

        content.appendChild(title);

        if (t.description) {
            const desc = document.createElement('div');
            desc.className = 'task-desc';
            desc.textContent = t.description;
            content.appendChild(desc);
        }

        // Execute Button (Session)
        const executeBtn = document.createElement('button');
        executeBtn.className = 'btn-secondary';
        executeBtn.style.cssText = "padding: 5px 10px; margin-right: 5px;";
        executeBtn.innerHTML = '▶️';
        executeBtn.title = "Execute in Current Session (Fast)";
        executeBtn.onclick = (e) => {
            e.stopPropagation();
            executeTask(t.id, executeBtn);
        };

        // Execute Button (Spawn)
        const spawnBtn = document.createElement('button');
        spawnBtn.className = 'btn-secondary';
        spawnBtn.style.cssText = "padding: 5px 10px; margin-right: 5px;";
        spawnBtn.innerHTML = '🚀';
        spawnBtn.title = "Execute via New Process (Clean Context)";
        spawnBtn.onclick = (e) => {
            e.stopPropagation();
            executeTaskSpawn(t.id, spawnBtn);
        };

        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteTask(t.id);
        };

        li.appendChild(checkbox);
        li.appendChild(content);
        li.appendChild(executeBtn);
        li.appendChild(spawnBtn);
        li.appendChild(deleteBtn);

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
        checkWorkerStatus(); // Check worker status on connection
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
// Expose toggle
window.toggleAutoRun = toggleAutoRun;

// Expose functions to window for inline onclick handlers
window.showProject = showProject;
window.deleteProject = deleteProject;
window.toggleTask = toggleTask;
window.executeTask = executeTask;
window.executeTaskSpawn = executeTaskSpawn;
window.deleteTask = deleteTask;
