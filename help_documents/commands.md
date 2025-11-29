# Project Command Cheat Sheet

This document lists useful terminal commands for managing and debugging the MCP Counter POC.

## Server Management
- `node server.js`
  - Starts the MCP server and the Express web server on port 3000.

- `node verify_changes.js`
  - Runs the automated verification script to test the server and MCP connection.

## Debugging & Ports
- `netstat -ano | findstr :3000`
  - Checks if port 3000 is currently in use. Useful if you get "EADDRINUSE" errors.

- `taskkill /F /PID <PID>`
  - Forcefully kills a process by its Process ID (PID). Use the PID found from the `netstat` command.

## Setup
- `npm install`
  - Installs the project dependencies defined in `package.json`.

## MCP Client (Gemini)
- `gemini`
  - Starts the Gemini agent interface in the terminal.

- `/mcp list`
  - (Inside Gemini) Lists the configured MCP servers and their connection status.
