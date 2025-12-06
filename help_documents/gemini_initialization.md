# Gemini Initialization Flow

This document explains what happens when you start the Gemini CLI and how it initializes the `pm-jarvis` MCP server.

## Configuration

The Gemini CLI uses a configuration file (typically `settings.md` or similar) to define available MCP servers.

**Example Configuration:**

```json
"mcpServers": {
  "pm-jarvis": {
    "command": "C:\\nvm4w\\nodejs\\node.exe",
    "args": [
      "C:\\Users\\jobin\\project\\pocs\\pmapp\\mcp-pmapp-base\\launcher.js"
    ]
  }
}
```

## Initialization Steps

When you start Gemini (e.g., via the CLI or IDE extension), the following sequence occurs:

1.  **Read Configuration**: Gemini reads the configuration to find the `pm-jarvis` server definition.
2.  **Execute Command**: Gemini executes the specified command: `node launcher.js`.
    *   It uses the absolute path provided in `args`.
3.  **Launcher Starts (`launcher.js`)**:
    *   The `launcher.js` script initializes.
    *   It defines the path to the actual server file (`server.js`) and a log file (`mcp_error.log`).
    *   It clears previous logs in `mcp_error.log`.
4.  **Spawn Server (`server.js`)**:
    *   `launcher.js` spawns a child process to run `server.js` using `spawn(process.execPath, [serverPath], ...)`.
    *   **CWD**: It sets the Current Working Directory (`cwd`) to the script's directory, ensuring relative paths in `server.js` work correctly.
    *   **Env**: It passes the parent process's environment variables (`process.env`) to the child.
    *   **Stdio**:
        *   `stdin` and `stdout` are inherited, allowing `server.js` to communicate directly with Gemini via standard input/output (MCP protocol).
        *   `stderr` is piped to capture errors.
5.  **Error Handling & Logging**:
    *   `launcher.js` listens to the child's `stderr`.
    *   Any errors from `server.js` are written to `mcp_error.log` AND passed back to Gemini's `stderr` so they are visible in the CLI/console.
    *   It also logs process exit codes and spawn errors ("BSOD").
6.  **Server Initialization (`server.js`)**:
    *   `server.js` starts running.
    *   It loads environment variables (`dotenv`).
    *   It connects to Supabase.
    *   It starts the Express web server on port 3000 (for the frontend).
    *   It initializes the MCP server and connects it to the `StdioServerTransport`.
    *   **Crucially**, `server.js` communicates with Gemini over `stdin`/`stdout` using the MCP protocol.

## Frontend Startup (localhost:3000)

You might wonder how the web interface at `http://localhost:3000` becomes available just by running the Gemini CLI. This happens inside step 6 above:

1.  **Express Server**: `server.js` creates an Express application (`const app = express();`).
2.  **Static Files**: It configures Express to serve static files from the current directory:
    ```javascript
    app.use(express.static(__dirname));
    ```
    This means `index.html`, `styles.css`, and `app.js` are automatically served.
3.  **Port Listening**: The server is told to listen on port 3000:
    ```javascript
    const httpServer = server.listen(3000, () => {
        console.error(`Task App running at http://localhost:3000`);
        // ...
    });
    ```
    *Note: It logs to `console.error` (stderr) so it doesn't interfere with the MCP protocol on `stdout`.*

So, the **MCP Server** and the **Web Server** are running in the **same process** (`server.js`). When Gemini starts the MCP server, it effectively starts the web server as a side effect.

## Why a Launcher?

The `launcher.js` acts as a **wrapper** or **supervisor**. Its main purposes are:

*   **Path Resolution**: Ensuring `server.js` runs with the correct working directory.
*   **Logging**: Capturing `stderr` output to a file (`mcp_error.log`) for easier debugging, as `stdout` is reserved for MCP protocol messages.
*   **Stability**: Providing a layer to catch spawn errors or immediate crashes.
