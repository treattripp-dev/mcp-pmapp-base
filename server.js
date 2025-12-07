import 'dotenv/config'; // Load .env
import { exec } from 'child_process';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
//need to chechk what it is used for 
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

// // Shared Spawn Logic
// async function executeViaSpawn(task, res) {
//     const command = `gemini run "${task.title.replace(/"/g, '\\"')}"`;
//     console.error(`[Spawn Mode] Executing (Fallback/Direct): ${command}`);

//     exec(command, async (error, stdout, stderr) => {
//         if (error) {
//             console.error(`[Spawn Mode] Execution error: ${error.message}`);
//         }

//         const output = (stdout + stderr).trim();
//         console.error(`[Spawn Mode] Output length: ${output.length} characters`);

//         const { data: updatedTask, error: updateError } = await supabase
//             .from('tasks')
//             .update({ description: output || "Executed (No Output)" })
//             .eq('id', task.id)
//             .select()
//             .single();

//         if (updateError) {
//             if (!res.headersSent) return res.status(500).json({ error: updateError.message });
//             return;
//         }

//         broadcastTasks(null, updatedTask.project_id);
//         broadcastProjects();

//         if (!res.headersSent) {
//             res.json(updatedTask);
//         }
//     });
// }

// --- Execute Endpoint (Pull Model) ---
// This endpoint marks a task as "queued" for execution.
// The actual execution is done by ChatGPT polling via the list_tasks tool.
// NOTE: We use [QUEUED] prefix in description instead of status column due to DB constraint.
app.post('/api/tasks/:id/execute', async (req, res) => {
    const id = req.params.id;

    // 1. Get the task
    const { data: task, error: fetchError } = await supabase.from('tasks').select('*').eq('id', id).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // 2. Mark as "queued" by adding [QUEUED] prefix to description
    const queuedDescription = task.description?.startsWith('[QUEUED]')
        ? task.description
        : `[QUEUED] ${task.description || 'Pending execution...'}`;

    const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update({ description: queuedDescription })
        .eq('id', id)
        .select()
        .single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    console.error(`[Session Mode] Task "${task.title}" marked as QUEUED. Waiting for ChatGPT Worker to pick it up.`);

    broadcastTasks(null, updatedTask.project_id);
    broadcastProjects();

    res.json({ message: "Task queued for execution. ChatGPT Worker will execute it.", task: updatedTask });
});

app.post('/api/tasks/:id/execute-spawn', async (req, res) => {
    const id = req.params.id;
    const { data: task, error: fetchError } = await supabase.from('tasks').select('*').eq('id', id).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!task) return res.status(404).json({ error: "Task not found" });

    executeViaSpawn(task, res);
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
        // SILENT EXIT / CONTINUE REQUIRED:
        // We must NOT use console.log here because it writes to stdout.
        // The MCP CLI reads stdout for protocol messages (JSON-RPC).
        // Any non-JSON output (like this log) corrupts the protocol, causing the CLI to hang or error.

        // In "Spawn Mode", we are likely a subprocess. If the port is taken, it just means
        // the main dashboard is already running. We can safely ignore this error and
        // continue running as a pure MCP server (stdio only).
        console.error('[Wait Mode] Port 3000 in use. Web UI disabled, running as MCP CLient only.');
        // Do NOT exit process.
    } else {
        console.error('Server error:', e);
        process.exit(1);
    }
});

// --- MCP Server ---
const mcpServer = new Server(
    { name: "task-manager", version: "1.0.0" },
    { capabilities: { tools: {}, prompts: {} } }
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
                description: "Update a task's status and/or description",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "string", description: "ID of the task to update" },
                        status: { type: "string", enum: ["pending", "completed"], description: "New status" },
                        description: { type: "string", description: "New description (result of execution)" }
                    },
                    required: ["id"]
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

mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
        prompts: [
            {
                name: "execute_task",
                description: "Load a task into the context for execution",
                arguments: [
                    {
                        name: "task_id",
                        description: "The ID of the task to execute",
                        required: true
                    }
                ]
            }
        ]
    };
});

mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "execute_task") {
        const taskId = args?.task_id;
        if (!taskId) {
            throw new Error("task_id argument is required");
        }

        const { data: task, error } = await supabase.from('tasks').select('*').eq('id', taskId).single();
        if (error || !task) {
            return {
                messages: [
                    { role: "user", content: { type: "text", text: `Error: Task not found or failed to fetch (ID: ${taskId})` } }
                ]
            };
        }

        return {
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `Please execute this task: "${task.title}".\n\nTask Description: ${task.description || ''}\n\nProject ID: ${task.project_id}`
                    }
                }
            ]
        };
    }

    throw new Error("Prompt not found");
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

        // Include description to show [QUEUED] status
        const taskList = tasks.map(t => {
            const statusMark = t.status === 'completed' ? 'X' : (t.description?.startsWith('[QUEUED]') ? 'Q' : ' ');
            const desc = t.description ? ` | ${t.description.substring(0, 50)}` : '';
            return `[${statusMark}] #${t.id}: ${t.title}${desc}`;
        }).join('\n');
        return { content: [{ type: "text", text: taskList || "No tasks found." }] };
    }

    if (name === "update_task") {
        const { id, status, description } = args;
        const updates = {};
        if (status) updates.status = status;
        if (description) updates.description = description;

        const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        broadcastTasks(null, data.project_id);
        broadcastProjects();
        return { content: [{ type: "text", text: `Task #${id} updated. Status: ${data.status}, Description: ${data.description?.substring(0, 50)}...` }] };
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


const transport = new StdioServerTransport();
await mcpServer.connect(transport);