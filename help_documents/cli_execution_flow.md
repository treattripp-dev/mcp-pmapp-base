# CLI Execution Flow and Deployment

This document outlines the current behavior of the "Execute" button in the application and how the CLI is triggered. It also covers the deployment setup.

## Execute Button Flow

The "Execute" button functionality is split between the frontend (`app.js`) and the backend (`server.js`).

### 1. Frontend (`app.js`)

When the "Execute" button (▶️) is clicked on a task:

1.  The `executeTask(id, btn)` function is called.
2.  The button text changes to '⏳' and is disabled to indicate processing.
3.  A `POST` request is sent to the backend endpoint `/api/tasks/:id/execute`.
4.  Upon completion (success or failure), the button is re-enabled and the text reverts.

**Code Snippet (`app.js`):**

```javascript
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
```

### 2. Backend (`server.js`)

The backend handles the execution request at the `/api/tasks/:id/execute` endpoint:

1.  **Fetch Task**: Retrieves the task details from Supabase using the provided `id`.
2.  **Execute Command**: Constructs a shell command `gemini run "<task_title>"` and executes it using Node.js `child_process.exec`.
3.  **Capture Output**: Captures the `stdout` (standard output) and `stderr` (standard error) from the command.
4.  **Update Task**: Updates the task's `description` field in Supabase with the command's output.
5.  **Broadcast**: Uses WebSockets to broadcast the updated task to all connected clients.

**Code Snippet (`server.js`):**

```javascript
app.post('/api/tasks/:id/execute', async (req, res) => {
    const id = req.params.id;

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
            return res.status(500).json({ error: `Execution failed: ${error.message}` });
        }
        
        const output = stdout.trim();

        // 3. Update task description
        const { data: updatedTask, error: updateError } = await supabase
            .from('tasks')
            .update({ description: output })
            .eq('id', id)
            .select()
            .single();

        if (updateError) return res.status(500).json({ error: updateError.message });

        broadcastTasks(null, updatedTask.project_id);
        broadcastProjects();
        res.json(updatedTask);
    });
});
```

## Deployment

The application is set up for a hybrid deployment:

*   **Frontend**: Deployed statically via Vercel.
    *   `vercel.json` configures the build to serve `index.html` for all routes.
    *   It expects to connect to a backend URL (stored in `localStorage` or defaulting to `localhost:3000`).
*   **Backend**: Runs locally.
    *   The `package.json` does not have specific start scripts, implying it is run directly with `node server.js`.
    *   The backend handles CORS to allow connections from `localhost` and `localtunnel` domains, facilitating mobile access to the local server.

**`vercel.json`:**

```json
{
    "version": 2,
    "builds": [
        {
            "src": "index.html",
            "use": "@vercel/static"
        }
    ],
    "routes": [
        {
            "src": "/(.*)",
            "dest": "/index.html"
        }
    ]
}
```
