import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get the absolute path of the current folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logFile = path.join(__dirname, 'mcp_error.log');
const serverPath = path.join(__dirname, 'server.js');

// 1. Clear previous logs
fs.writeFileSync(logFile, `[${new Date().toISOString()}] Launcher started...\n`);

// 2. Spawn the real server
//We use the full path to node (process.execPath) to avoid "command not found"
const child = spawn(process.execPath, [serverPath], {
    cwd: __dirname, // <--- THIS FIXES THE PATH/FILE LOADING ISSUES
    env: process.env,
    stdio: ['inherit', 'inherit', 'pipe'] // We capture stderr to log it
});

// 3. Log any errors
child.stderr.on('data', (data) => {
    const msg = data.toString();
    fs.appendFileSync(logFile, `ERROR: ${msg}`);
    process.stderr.write(data); // Pass it to MCP as well
});

child.on('error', (err) => {
    fs.appendFileSync(logFile, `BSOD (Spawn Error): ${err.message}\n`);
});

child.on('close', (code) => {
    fs.appendFileSync(logFile, `Process exited with code: ${code}\n`);
});