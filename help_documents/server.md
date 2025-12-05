# Server Documentation (`server.js`)

This document provides a detailed overview of the `server.js` file, which serves as the backend for the Task Management Application. It acts as both a standard Express web server and a Model Context Protocol (MCP) server.

## 1. Imports and Setup
The file begins with necessary imports and initial configuration.
- **Imports**:
    - `dotenv/config`: Loads environment variables from `.env`.
    - `@modelcontextprotocol/sdk`: SDK for creating the MCP server.
    - `express`: Web framework for REST APIs.
    - `ws`: WebSocket library for real-time updates.
    - `http`: Node.js built-in HTTP module.
    - `path`, `url`: Node.js utilities for file paths.
    - `@supabase/supabase-js`: Client for interacting with the Supabase database.
    - `child_process`: Used to execute CLI commands.
    - `cors`: Middleware for Cross-Origin Resource Sharing.

- **Setup**:
    - `__filename`, `__dirname`: configured for ES module compatibility.
    - `supabase`: Initialized using `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`/`SUPABASE_ANON_KEY`.

## 2. Web Server Configuration
The Express app is configured with middleware and a basic route.
- **Middleware**:
    - `express.json()`: Parses incoming JSON payloads.
    - `cors(...)`: Configured to allow requests from `localhost` and `localtunnel` domains, as well as mobile apps (no origin).
    - `express.static(__dirname)`: Serves static files (HTML, CSS, JS) from the root directory.
- **Routes**:
    - `GET /`: Serves the `index.html` file.

## 3. REST API Endpoints
The server exposes several REST endpoints for managing projects and tasks.

### Projects
- **`GET /api/projects`**
    - **Purpose**: Fetches all projects with their associated tasks.
    - **Logic**: Queries Supabase for projects and tasks, calculates progress percentage for each project, and returns the enriched data.
- **`POST /api/projects`**
    - **Purpose**: Creates a new project.
    - **Body**: `{ title, description }`
    - **Logic**: Inserts a new project into Supabase and broadcasts the update via WebSockets.
- **`DELETE /api/projects/:id`**
    - **Purpose**: Deletes a project by ID.
    - **Logic**: Deletes the project from Supabase and broadcasts the update.

### Tasks
- **`GET /api/tasks`**
    - **Purpose**: Fetches tasks, optionally filtered by `project_id`.
    - **Query Params**: `project_id` (optional)
- **`POST /api/tasks`**
    - **Purpose**: Creates a new task.
    - **Body**: `{ title, description, project_id }`
    - **Logic**: Inserts a new task into Supabase and broadcasts updates for both tasks and projects.
- **`PUT /api/tasks/:id`**
    - **Purpose**: Updates a task's details (status, title, description).
    - **Body**: `{ status, title, description }`
    - **Logic**: Updates the task in Supabase and broadcasts updates.
- **`DELETE /api/tasks/:id`**
    - **Purpose**: Deletes a task by ID.
    - **Logic**: Deletes the task from Supabase and broadcasts updates.
- **`POST /api/tasks/:id/execute`**
    - **Purpose**: Executes a task using the `gemini run` CLI command and updates the UI with the result.
    - **Detailed Flow**:
        1.  **Frontend Trigger**: The user clicks the "Execute" button in the web interface.
        2.  **API Request**: The frontend sends a `POST` request to `/api/tasks/:id/execute`.
        3.  **Backend Processing**:
            -   **Fetch Task**: The server queries Supabase for the task details using the provided `id`.
            -   **Construct Command**: It creates a shell command: `gemini run "<task_title>"`.
            -   **Execute Command**: The command is executed using Node.js `child_process.exec`.
                -   *Note*: This spawns a new process. If the MCP server is also running in this process, it detects the port conflict and runs in "subprocess mode" (skipping web server startup).
            -   **Capture Output**: The server captures the `stdout` (standard output) from the command.
        4.  **Database Update**:
            -   The server updates the task's `description` field in the Supabase `tasks` table with the captured output.
        5.  **Real-time Broadcast**:
            -   The server calls `broadcastTasks` and `broadcastProjects`.
            -   It sends a WebSocket message (type: `update_tasks` or `update_projects`) containing the updated task data to all connected clients.
        6.  **Frontend Update**:
            -   The web client receives the WebSocket message.
            -   The React/frontend state is updated with the new task list.
            -   The UI re-renders, displaying the command output in the task's description field.

## 4. WebSocket Logic
Real-time updates are handled via the `ws` library.
- **Initialization**: `const wss = new WebSocketServer({ server });`
- **Connection**: Listens for connections (currently no initial state push on connection, relies on client fetch).
- **Helper Functions**:
    - **`broadcastTasks(targetClient, projectId)`**: Fetches tasks (optionally filtered by project) and sends an `update_tasks` message to connected clients.
    - **`broadcastProjects()`**: Fetches projects, calculates progress, and sends an `update_projects` message to connected clients.

## 5. Server Startup
- **`server.listen(3000, ...)`**: Starts the HTTP server on port 3000.
    - **Note**: To prevent crashes when running as a subprocess (e.g., during `gemini run`), error handling for `EADDRINUSE` should be implemented here.

## 6. MCP Server
The file implements an MCP server to expose tools to AI agents.
- **Initialization**: `new Server(...)` with name "task-manager".
- **`ListToolsRequestSchema`**: Defines the available tools:
    - `add_project`: Create a project.
    - `list_projects`: List all projects.
    - `add_task`: Add a task to a project.
    - `list_tasks`: List tasks for a project.
    - `update_task`: Update a task's status.
    - `delete_task`: Delete a task.
- **`CallToolRequestSchema`**: Handles the execution of these tools.
    - Matches the tool name (e.g., "add_project") and executes the corresponding Supabase logic.
    - Returns the result as a text content list.
- **Transport**: Uses `StdioServerTransport` to communicate via standard input/output.

## Syntax & Structure Notes
- **Async/Await**: Most database operations are asynchronous and use `await`. Ensure functions containing them are marked `async`.
- **Error Handling**: API endpoints return 500 status codes on database errors. MCP tools return `{ isError: true, ... }`.
- **Closures**: Ensure `app.get`, `app.post`, and `mcpServer.setRequestHandler` callbacks are properly closed with `});`.
