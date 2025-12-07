import 'dotenv/config'; // Load .env
import { exec, spawn } from 'child_process';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from 'url';
import { z } from "zod";
import { createClient } from '@supabase/supabase-js';

import cors from 'cors';

// Paths setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Web Server
const app = express();
app.use(express.json()); // Enable JSON body parsing
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        // Allow localhost and localtunnel domains
        if (origin.startsWith('http://localhost') || origin.includes('.loca.lt')) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
const server = http.createServer(app);
let wss = null;

// Serve static files (css, js)
app.use(express.static(__dirname));

// Serve static files (css, js)
app.use(express.static(__dirname));

// middleware to log all requests to stderr (for debugging/mcp_error.log)
import fs from 'fs';
app.use((req, res, next) => {
    const msg = `[${new Date().toISOString()}] REQUEST: ${req.method} ${req.url}\n`;
    try {
        fs.appendFileSync('mcp_error.log', msg);
    } catch (e) {
        console.error("Failed to write to log:", e);
    }
    console.error(msg.trim());
    next();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- REST API for Projects ---

app.get('/api/projects', async (req, res) => {
    const { data: projects, error } = await supabase
        .from('projects')
        .select('*, tasks(id, status)')
        .order('created_at');

    if (error) return res.status(500).json({ error: error.message });

    // Calculate progress
    const projectsWithProgress = projects.map(p => {
        const totalTasks = p.tasks.length;
        const completedTasks = p.tasks.filter(t => t.status === 'completed').length;
        const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
        return { ...p, progress, totalTasks, completedTasks };
    });

    res.json(projectsWithProgress);
});

app.post('/api/projects', async (req, res) => {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const { data, error } = await supabase.from('projects').insert({ name: title, description }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    broadcastProjects();
    res.status(201).json(data);
});

app.delete('/api/projects/:id', async (req, res) => {
    const id = req.params.id; // UUID is a string
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    broadcastProjects();
    res.status(204).send();
});

// --- REST API for Tasks ---

app.get('/api/tasks', async (req, res) => {
    let query = supabase.from('tasks').select('*').order('id');
    if (req.query.project_id) {
        query = query.eq('project_id', req.query.project_id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/tasks', async (req, res) => {
    const { title, description, project_id } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!project_id) return res.status(400).json({ error: "Project ID is required" });

    const { data, error } = await supabase.from('tasks').insert({ title, description, project_id }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    broadcastTasks(null, project_id);
    broadcastProjects();
    res.status(201).json(data);
});

app.put('/api/tasks/:id', async (req, res) => {
    const id = req.params.id; // UUID is a string
    const updates = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.title) updates.title = req.body.title;
    if (req.body.description) updates.description = req.body.description;

    const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    broadcastTasks(null, data.project_id);
    broadcastProjects();
    res.json(data);
});

app.delete('/api/tasks/:id', async (req, res) => {
    const id = req.params.id; // UUID is a string
    // Get task first to know project_id for broadcast
    const { data: task } = await supabase.from('tasks').select('project_id').eq('id', id).single();

    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    if (task) {
        broadcastTasks(null, task.project_id);
        broadcastProjects();
    }
    res.status(204).send();
});

// --- Execute Endpoint ---
app.post('/api/tasks/:id/execute', async (req, res) => {
    const id = req.params.id; // UUID is a string

    // 1. Get the task
    const { data: task, error: fetchError } = await supabase.from('tasks').select('*').eq('id', id).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // 2. Mark as QUEUED (Pull-based pattern)
    // Instead of pushing via Sampling (which fails on CLI), we mark it for the Agent to pick up.
    if (task.title.startsWith('[QUEUED]')) {
        return res.json(task); // Already queued
    }

    const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update({ title: `[QUEUED] ${task.title}` })
        .eq('id', id)
        .select()
        .single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    broadcastTasks(null, updatedTask.project_id);
    broadcastProjects();
    res.json(updatedTask);
});

app.post('/api/tasks/:id/execute-spawn', async (req, res) => {
    const id = req.params.id; // UUID is a string

    // 1. Get the task
    const { data: task, error: fetchError } = await supabase.from('tasks').select('*').eq('id', id).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // 2. Execute via CLI (Spawn Mode)
    // This allows a fresh context, useful for when the current session context is polluted or insufficient.
    const command = `gemini run "${task.title.replace(/"/g, '\\"')}"`; // Simple escaping
    console.log(`[Spawn Mode] Executing: ${command}`);

    exec(command, async (error, stdout, stderr) => {
        if (error) {
            console.error(`[Spawn Mode] Execution error: ${error.message}`);
            // We verify if it was just a timeout or a real error, but for now we log it.
            // Note: gemini run might return non-zero if the agent failed, but we still validly attempted it.
        }

        const output = (stdout + stderr).trim();
        console.log(`[Spawn Mode] Output length: ${output.length} characters`);

        // 3. Update task description
        const { data: updatedTask, error: updateError } = await supabase
            .from('tasks')
            .update({ description: output || "Executed (No Output)" })
            .eq('id', id)
            .select()
            .single();

        if (updateError) return res.status(500).json({ error: updateError.message });

        broadcastTasks(null, updatedTask.project_id);
        broadcastProjects();
        // Since this is async/spawned, we might have already responded. 
        // But here we respond to the HTTP request now that it's done (or timed out).
        // For very long tasks, the HTTP request might timeout on the client side, 
        // but the server logic still runs.
        if (!res.headersSent) {
            res.json(updatedTask);
        }
    });
});



// --- Worker Management ---
let workerProcess = null;

app.get('/api/worker/status', (req, res) => {
    res.json({ active: !!workerProcess, pid: workerProcess?.pid });
});

app.post('/api/worker/start', (req, res) => {
    if (workerProcess) {
        return res.json({ message: "Worker already running", pid: workerProcess.pid });
    }

    console.log("Starting worker process...");
    // Spawn detached so it survives if main process restarts? No, we want it managed.
    workerProcess = spawn(process.execPath, ['worker_loop.js'], {
        stdio: 'inherit', // Pipe output to main console
        cwd: __dirname
    });

    workerProcess.on('spawn', () => {
        console.log(`Worker started with PID: ${workerProcess.pid}`);
    });

    workerProcess.on('error', (err) => {
        console.error(`Worker failed to start: ${err.message}`);
        workerProcess = null;
    });

    workerProcess.on('exit', (code, signal) => {
        console.log(`Worker exited with code ${code} and signal ${signal}`);
        workerProcess = null;
    });

    res.json({ message: "Worker started" });
});

app.post('/api/worker/stop', (req, res) => {
    if (!workerProcess) {
        return res.json({ message: "Worker not running" });
    }

    console.log("Stopping worker process...");
    workerProcess.kill(); // SIGTERM
    workerProcess = null;
    res.json({ message: "Worker stopped" });
});

// --- WebSocket Logic ---
async function broadcastTasks(targetClient = null, projectId = null) {
    if (!wss) return; // Skip if WebSocket server is not initialized

    let query = supabase.from('tasks').select('*').order('id');
    if (projectId) {
        query = query.eq('project_id', projectId);
    }
    const { data: tasks, error } = await query;

    if (error) {
        console.error("Failed to fetch tasks for broadcast:", error);
        return;
    }

    const message = JSON.stringify({ type: 'update_tasks', tasks, projectId });

    if (targetClient) {
        if (targetClient.readyState === 1) targetClient.send(message);
    } else {
        wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(message);
        });
    }
}

async function broadcastProjects() {
    if (!wss) return; // Skip if WebSocket server is not initialized

    const { data: projects, error } = await supabase
        .from('projects')
        .select('*, tasks(id, status)')
        .order('created_at');

    if (error) return;

    const projectsWithProgress = projects.map(p => {
        const totalTasks = p.tasks.length;
        const completedTasks = p.tasks.filter(t => t.status === 'completed').length;
        const progress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
        return { ...p, progress, totalTasks, completedTasks };
    });

    const message = JSON.stringify({ type: 'update_projects', projects: projectsWithProgress });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(message);
    });
}

const httpServer = server.listen(3000, () => {
    console.error(`Task App running at http://localhost:3000`);

    // Initialize WebSocketServer only after successful listen
    wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        // Optionally send initial state? 
        // For now, client fetches initial state via REST.
    });

    wss.on('error', (e) => {
        console.error('WebSocketServer error:', e);
    });
});

httpServer.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        // SILENT EXIT REQUIRED:
        // We must NOT use console.log here because it writes to stdout.
        // The MCP CLI reads stdout for protocol messages (JSON-RPC).
        // Any non-JSON output (like this log) corrupts the protocol, causing the CLI to hang or error.
        // This process is likely a subprocess started by 'gemini run', so we just exit silently.
    } else {
        console.error('Server error:', e);
        process.exit(1);
    }
});

// --- MCP Server ---
const mcpServer = new Server(
    { name: "task-manager", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "add_project",
                description: "Create a new project",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Project title" },
                        description: { type: "string", description: "Project description" }
                    },
                    required: ["title"]
                },
            },
            {
                name: "list_projects",
                description: "List all projects",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "add_task",
                description: "Add a new task to a project",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Title of the task" },
                        project_id: { type: "string", description: "ID of the project to add the task to" }
                    },
                    required: ["title", "project_id"]
                },
            },
            {
                name: "list_tasks",
                description: "List tasks for a project",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { type: "string", description: "Project ID to filter by" }
                    }
                    // No required properties, project_id is optional
                },
            },
            {
                name: "update_task",
                description: "Update a task's status (e.g., mark as completed)",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "ID of the task to update" },
                        status: { type: "string", enum: ["pending", "completed"], description: "New status" }
                    },
                    required: ["id", "status"]
                },
            },
            {
                name: "delete_task",
                description: "Delete a task by ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "ID of the task to delete" }
                    },
                    required: ["id"]
                },
            }
        ],
    };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "add_project") {
        const { title, description } = args;
        const { data, error } = await supabase.from('projects').insert({ name: title, description }).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        broadcastProjects();
        return { content: [{ type: "text", text: `Project created: #${data.id} - ${data.name}` }] };
    }

    if (name === "list_projects") {
        const { data: projects, error } = await supabase.from('projects').select('*').order('created_at');
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };
        const list = projects.map(p => `#${p.id}: ${p.name || p.title}`).join('\n');
        return { content: [{ type: "text", text: list || "No projects found." }] };
    }

    if (name === "add_task") {
        const { title, project_id } = args;
        const { data, error } = await supabase.from('tasks').insert({ title, project_id }).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        broadcastTasks(null, project_id);
        broadcastProjects();
        return { content: [{ type: "text", text: `Task added to Project #${project_id}: #${data.id} - ${data.title}` }] };
    }

    if (name === "list_tasks") {
        let query = supabase.from('tasks').select('*').order('id');
        if (args.project_id) {
            query = query.eq('project_id', args.project_id);
        }
        const { data: tasks, error } = await query;
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        const taskList = tasks.map(t => `[${t.status === 'completed' ? 'X' : ' '}] #${t.id}: ${t.title}`).join('\n');
        return { content: [{ type: "text", text: taskList || "No tasks found." }] };
    }

    if (name === "update_task") {
        const { id, status } = args;
        const { data, error } = await supabase.from('tasks').update({ status }).eq('id', id).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        broadcastTasks(null, data.project_id);
        broadcastProjects();
        return { content: [{ type: "text", text: `Task #${id} updated to ${status}` }] };
    }

    if (name === "delete_task") {
        const { id } = args;
        const { data: task } = await supabase.from('tasks').select('project_id').eq('id', id).single();
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        if (task) {
            broadcastTasks(null, task.project_id);
            broadcastProjects();
        }
        return { content: [{ type: "text", text: `Task #${id} deleted` }] };
    }

    throw new Error("Tool not found");
});



// --- SSE Transport ---
let sseTransport = null;

app.get('/sse', async (req, res) => {
    console.log("New SSE connection established");
    sseTransport = new SSEServerTransport("/messages", res);
    await mcpServer.connect(sseTransport);

    req.on('close', () => {
        console.log("SSE connection closed");
        sseTransport = null;
    });
});

app.post('/messages', async (req, res) => {
    if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
    } else {
        res.status(404).json({ error: "No active SSE connection" });
    }
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);