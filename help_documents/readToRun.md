# How to Run PM Jarvis (Full Setup)

Follow these steps to set up the project, deploy the frontend, and connect your mobile device.

## 1. Prerequisites
- Node.js installed.
- Vercel CLI installed (`npm i -g vercel`).
- Gemini CLI installed.

## 2. Backend Setup
1.  Open a terminal in the project root.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the backend server:
    ```bash
    node server.js
    ```

## 3. MCP Configuration (Gemini)
Add the following configuration to your Gemini settings file (usually `C:\Users\<User>\.gemini\settings.json`):

```json
{
  "mcpServers": {
    "pm-jarvis": {
      "command": "C:\\nvm4w\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\jobin\\project\\pocs\\pmapp\\mcp-pmapp-base\\launcher.js"
      ]
    }
  }
}
```
*Note: Adjust the paths if your project location differs.*

## 4. Frontend Deployment (Vercel)
1.  Deploy the frontend to Vercel:
    ```bash
    vercel deploy --prod
    ```
2.  Note the **Production URL** provided in the output.

## 5. Mobile Connection (Localtunnel)
To control the app from your phone, you need to expose your local backend.

1.  Open a **new** terminal window.
2.  Run Localtunnel:
    ```bash
    npx localtunnel --port 3000
    ```
3.  Copy the URL provided (e.g., `https://funny-cat-42.loca.lt`).
4.  **Crucial Step:** Open this URL in your **phone's browser** first.
    - It will ask for a password.
    - The password is your public IP address. Get it from [https://loca.lt/mypip](https://loca.lt/mypip).
    - Submit the password to open the tunnel.

## 6. Connect App
1.  Open your **Vercel App URL** on your phone.
2.  Click the **Settings (⚙️)** icon.
3.  Paste your **Localtunnel URL** into the "Backend URL" field.
4.  Click **Save**.

The status indicator should turn **Green**, and you can now manage tasks from your phone!
