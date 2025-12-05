# Useful Commands

## Development
- **Start Backend Server**: `node server.js`
- **Start Frontend (Vercel Dev)**: `vercel dev`

## Deployment (Vercel)
- **Deploy to Production**: `vercel deploy --prod`

## Remote Access (Localtunnel)
- **Start Tunnel**: `npx localtunnel --port 3000`
  - *Note: This exposes your local backend to the internet.*
  - *Password: Your public IP (found at https://loca.lt/mypip)*

## MCP Integration
- **Run Gemini CLI**: `gemini`


Option 2: If already pushed to remote (recommended for security)
If the .env file is already on GitHub with secrets, you should:

Rotate all secrets immediately - assume they're compromised
Remove from history using git-filter-branch or BFG Repo-Cleaner:
bash
# Using BFG (simpler):
bfg --delete-files .env

# Or using git-filter-branch:
git filter-branch --tree-filter 'rm -f .env' HEAD
Force push (only do this if you own the repo and no one else is working on it):
bash
git push origin --force-with-lease