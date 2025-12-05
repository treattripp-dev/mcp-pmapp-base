# Execute Function and Description Update Issue

This document details the workflow of the `execute` function in `server.js` and the associated issue with recursive server execution, referencing the structure defined in `help_documents/server.md`.

## Current Implementation: `POST /api/tasks/:id/execute`

As described in the **REST API Endpoints** section of `help_documents/server.md`, the execution flow is as follows:

1.  **Request**: The client sends a `POST` request to `/api/tasks/:id/execute`.
2.  **Task Retrieval**: The server fetches the task details from Supabase using the provided `id`.
3.  **CLI Execution**:
    - The server constructs a command: `gemini run "<task_title>"`.
    - It uses `child_process.exec` to run this command.
    - **Crucial Context**: The `gemini run` command, by default, spins up an instance of the MCP server (which is `server.js` itself) to handle tool calls.
4.  **Output Capture**:
    - The `stdout` (standard output) from the `gemini run` command is captured.
5.  **Description Update**:
    - The captured `stdout` is treated as the result of the task.
    - The server updates the `description` field of the task in the Supabase `tasks` table with this output.
6.  **Broadcast**:
    - The updated task is broadcasted to all connected WebSocket clients via `broadcastTasks` and `broadcastProjects` to reflect the change in the UI immediately.

## The Issue: Port Conflict (`EADDRINUSE`)

### Problem Description
When `gemini run` executes, it starts a new instance of `server.js` to serve the MCP tools.
- The **primary** `server.js` instance is already running and listening on port **3000**.
- The **secondary** (subprocess) `server.js` instance also attempts to listen on port **3000** because it executes the same code:
  ```javascript
  server.listen(3000, () => { ... });
  ```
- This results in an `EADDRINUSE: address already in use :::3000` error, causing the subprocess to crash.
- Consequently, the `gemini run` command fails, and the task execution is aborted.

### Proposed Solution
We need to modify `server.js` to gracefully handle this port conflict. The secondary instance (used for MCP tools) does **not** need to run the HTTP web server; it only needs to communicate via `stdio`.

**Plan:**
1.  Add error handling to the `server.listen` call.
2.  If `EADDRINUSE` is detected:
    - Log a message indicating that the port is busy (likely due to the primary instance).
    - **Skip** the web server startup or allow the process to continue without it.
    - Ensure the **MCP Server** initialization (which uses `StdioServerTransport`) still proceeds, as this is the only requirement for the subprocess.

### Update (Recent Findings)
The `EADDRINUSE` error persists even with error handling on the HTTP server because the **WebSocketServer (`wss`)** attached to the HTTP server also emits an `'error'` event when the underlying server fails to listen. This event was unhandled, causing the Node.js process to crash.

**Root Cause Detail**:
- When `gemini run` is executed, it initializes the environment (potentially via `launcher.js` or similar mechanism) which might already be using port 3000 or triggering the conflict when `server.js` is spawned.
- The `gemini` tool spawns `server.js` to access MCP tools.
- Since `server.js` attempts to `listen(3000)` and attach a `WebSocketServer`, both components fail when the port is busy.
- We must handle the error on **both** the `httpServer` and the `wss` instance to prevent the crash.

This approach ensures that the primary server handles web requests, while the subprocess successfully provides tools to the Gemini CLI without fighting for the HTTP port.
