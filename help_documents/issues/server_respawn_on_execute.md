# Issue: Server Respawn on Execution

## Symptom
Every time the "Execute" button is clicked in the web interface, it appears that the server is restarting or a new server instance is being spawned.

## Cause
This behavior is **expected** and is a direct result of how the `gemini run` command works in conjunction with the MCP server configuration.

### The Chain of Events

1.  **User Action**: You click "Execute" on the frontend.
2.  **Backend Request**: The frontend sends a request to the *running* backend (Server A) at `/api/tasks/:id/execute`.
3.  **Command Execution**: Server A executes the shell command: `gemini run "Task Title"`.
4.  **Gemini Initialization**: The `gemini` CLI starts. It reads its configuration to identify available MCP servers.
5.  **MCP Server Spawn**: Gemini sees `pm-jarvis` is configured to run `launcher.js`.
6.  **New Process**: Gemini spawns a **new instance** of `launcher.js`, which in turn spawns a **new instance** of `server.js` (Server B).

### Why this happens
The `gemini` CLI does not know about the already running Server A. It is designed to spin up its own set of MCP servers to fulfill the request. Therefore, it starts Server B to use as a tool provider.

### Port Conflict (The "Silent" Error)
When Server B starts, it attempts to listen on port 3000 (just like Server A).
*   **Conflict**: Port 3000 is already occupied by Server A.
*   **Handling**: `server.js` has logic to detect `EADDRINUSE`. When Server B hits this error, it **silently ignores it** and continues running.
*   **Result**: Server B runs *without* the web server part, purely as an MCP server communicating with Gemini via `stdin/stdout`.

### Lifecycle
Once `gemini run` completes its task:
1.  Gemini closes the connection to Server B.
2.  Server B terminates.
3.  Server A (the persistent web server) continues running unaffected.

## Conclusion
The "respawning" you observe is actually a **temporary, secondary instance** of the server being created solely for the duration of the `gemini run` command. This is necessary for Gemini to access the MCP tools defined in your project.
