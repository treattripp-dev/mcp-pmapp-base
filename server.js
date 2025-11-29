import 'dotenv/config'; // Load .env
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from 'url';
import { z } from "zod";
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
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
app.use(cors()); // Enable CORS for all origins
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- REST API for Frontend ---

app.get('/api/tasks', async (req, res) => {
    const { data, error } = await supabase.from('tasks').select('*').order('id');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/tasks', async (req, res) => {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const { data, error } = await supabase.from('tasks').insert({ title, description }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    broadcastTasks();
    res.status(201).json(data);
});

app.put('/api/tasks/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const updates = {};
    if (req.body.status) updates.status = req.body.status;
    if (req.body.title) updates.title = req.body.title;
    if (req.body.description) updates.description = req.body.description;

    const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    broadcastTasks();
    res.json(data);
});

app.delete('/api/tasks/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    broadcastTasks();
    res.status(204).send();
});

// --- Execute Endpoint ---
app.post('/api/tasks/:id/execute', async (req, res) => {
    const id = parseInt(req.params.id);

    // 1. Get the task
    const { data: task, error: fetchError } = await supabase.from('tasks').select('*').eq('id', id).single();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!task) return res.status(404).json({ error: "Task not found" });

    // 2. Execute via CLI
    const command = `gemini run "${task.title}"`;
    console.log(`Executing: ${command}`);

    exec(command, async (error, stdout, stderr) => {
        if (error) {
            console.error(`Execution error: ${error.message}`);
            // We might want to save the error to the description too, or just return 500
            // For now, let's return 500 but log it.
            return res.status(500).json({ error: `Execution failed: ${error.message}` });
        }
        if (stderr) {
            console.warn(`Execution stderr: ${stderr}`);
        }

        const output = stdout.trim();
        console.log(`Execution output: ${output}`);

        // 3. Update task description
        const { data: updatedTask, error: updateError } = await supabase
            .from('tasks')
            .update({ description: output })
            .eq('id', id)
            .select()
            .single();

        if (updateError) return res.status(500).json({ error: updateError.message });

        broadcastTasks();
        res.json(updatedTask);
    });
});

// --- WebSocket Logic ---
wss.on('connection', (ws) => {
    broadcastTasks(ws);
});

async function broadcastTasks(targetClient = null) {
    const { data: tasks, error } = await supabase.from('tasks').select('*').order('id');
    if (error) {
        console.error("Failed to fetch tasks for broadcast:", error);
        return;
    }

    const message = JSON.stringify({ type: 'update', tasks });

    if (targetClient) {
        if (targetClient.readyState === 1) targetClient.send(message);
    } else {
        wss.clients.forEach(client => {
            if (client.readyState === 1) client.send(message);
        });
    }
}

server.listen(3000, () => {
    console.error(`Task App running at http://localhost:3000`);
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
                name: "add_task",
                description: "Add a new task to the list",
                inputSchema: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Title of the task" }
                    },
                    required: ["title"]
                },
            },
            {
                name: "list_tasks",
                description: "List all current tasks",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "update_task",
                description: "Update a task's status (e.g., mark as completed)",
                inputSchema: {
                    type: "object",
                    properties: {
                        id: { type: "number", description: "ID of the task to update" },
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
                        id: { type: "number", description: "ID of the task to delete" }
                    },
                    required: ["id"]
                },
            }
        ],
    };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "add_task") {
        const { title } = args;
        const { data, error } = await supabase.from('tasks').insert({ title }).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        broadcastTasks();
        return { content: [{ type: "text", text: `Task added: #${data.id} - ${data.title}` }] };
    }

    if (name === "list_tasks") {
        const { data: tasks, error } = await supabase.from('tasks').select('*').order('id');
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        const taskList = tasks.map(t => `[${t.status === 'completed' ? 'X' : ' '}] #${t.id}: ${t.title}`).join('\n');
        return { content: [{ type: "text", text: taskList || "No tasks found." }] };
    }

    if (name === "update_task") {
        const { id, status } = args;
        const { data, error } = await supabase.from('tasks').update({ status }).eq('id', id).select().single();
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        broadcastTasks();
        return { content: [{ type: "text", text: `Task #${id} updated to ${status}` }] };
    }

    if (name === "delete_task") {
        const { id } = args;
        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) return { isError: true, content: [{ type: "text", text: `Error: ${error.message}` }] };

        broadcastTasks();
        return { content: [{ type: "text", text: `Task #${id} deleted` }] };
    }

    throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);