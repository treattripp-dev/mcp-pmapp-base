import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Promisify exec for easier async/await usage
const execPromise = util.promisify(exec);

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY/SUPABASE_ANON_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log(`[Worker] Started. Polling for tasks...`);

async function runLoop() {
    while (true) {
        try {
            // 1. Find a QUEUED task
            // We search for titles starting with [QUEUED] and status not completed.
            // We'll take the oldest one first.
            const { data: tasks, error } = await supabase
                .from('tasks')
                .select('*')
                .ilike('title', '[QUEUED]%')
                .neq('status', 'completed')
                .order('created_at', { ascending: true })
                .limit(1);

            if (error) {
                console.error(`[Worker] Error fetching tasks: ${error.message}`);
                await sleep(5000);
                continue;
            }

            if (tasks && tasks.length > 0) {
                const task = tasks[0];
                console.log(`[Worker] Found task: ${task.title}`);

                // 2. Execute the task
                // Strip the [QUEUED] prefix for the actual execution prompt if needed, 
                // but 'gemini run' usually takes the whole string. 
                // Let's pass the raw title or maybe clean it up? 
                // The previous prompt implementation just passed the title. 
                // Let's pass the Title + Description as the goal.

                // Helper to clean title for display/execution if needed, but for now passing full title is fine.
                // We'll trust 'gemini run' to handle it.

                const cleanTitle = task.title.replace('[QUEUED]', '').trim();
                // Use the globally registered "pm-jarvis-sse" server
                const command = `gemini run --allowed-mcp-server-names pm-jarvis-sse "Task: ${cleanTitle}. Context: ${task.description || ''}"`;

                console.log(`[Worker] Executing: ${command}`);

                // Mark as In Progress (optional, but good for UI if we had that state)
                // For now, we just run it.

                try {
                    const { stdout, stderr } = await execPromise(command);
                    const output = (stdout + stderr).trim();
                    console.log(`[Worker] Execution complete. Output len: ${output.length}`);

                    // 3. Update execution results
                    // We remove [QUEUED] from title to indicate it's processed? 
                    // Or keep it? The requirement was to execute it.
                    // Let's remove [QUEUED] and update description.

                    await supabase
                        .from('tasks')
                        .update({
                            title: cleanTitle, // Remove tag
                            description: output || "Executed (No Output)",
                            // We don't mark as completed automatically? 
                            // The prompt says "Once done... Complete: Call update_task".
                            // If we use 'gemini run', the AGENT inside that run command should call 'update_task' to complete it.
                            // BUT, if the agent fails or just returns text, we might want to minimally update the description so it doesn't stay QUEUED forever.
                            // SAFEGUARD: We definitely must rename it from [QUEUED] otherwise we will loop forever on the same task!
                        })
                        .eq('id', task.id);

                } catch (execErr) {
                    console.error(`[Worker] Execution failed: ${execErr.message}`);
                    // Update task with error and remove QUEUED tag so we don't retry forever
                    await supabase
                        .from('tasks')
                        .update({
                            title: cleanTitle,
                            description: `[Execution Failed] ${execErr.message}`
                        })
                        .eq('id', task.id);
                }

            } else {
                // No tasks, wait
                // console.log('[Worker] No tasks. Waiting...');
            }

        } catch (err) {
            console.error(`[Worker] Unexpected error: ${err.message}`);
        }

        // Sleep 5 seconds
        await sleep(5000);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

runLoop();
