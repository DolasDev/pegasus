# Pegasus API

This package contains the core Hono REST API for the Pegasus platform. It is designed to be fully deployable either as an AWS Lambda function (cloud) or as a standalone Windows Service (on-premise).

## On-Premise Windows Server Deployment Guide

The following instructions will guide you through setting up and deploying the Pegasus API on a bare-metal or virtual Windows Server.

### 1. Prerequisites Installation

You need Node.js and npm installed on the server to build and run the API.

**Installing Node.js:**

1. Open a browser on the Windows Server and go to the official Node.js website: [https://nodejs.org/](https://nodejs.org/)
2. Download the LTS (Long Term Support) Windows Installer (`.msi`). (Node.js version 18 or higher is recommended).
3. Run the installer. Follow the prompts and ensure you select the option to **Add to PATH**.
4. Once installed, open a new command prompt or PowerShell window and verify the installation:
   ```bash
   node -v
   npm -v
   ```

**Database Requirements:**

- You must have a running PostgreSQL database accessible from the Windows Server.

### 2. Prepare the Repository

Clone the Pegasus repository to your desired location on the server (e.g., `C:\apps\pegasus`).

Open PowerShell or Command Prompt as an **Administrator** (required for service installation later) and run:

```bash
# From the repository root
cd path\to\pegasus
npm install
```

This will install all root and workspace dependencies, including `node-windows` (which is needed to run the API as a service).

### 3. Environment Configuration

Navigate to the API package directory and configure your environment variables:

```bash
cd packages\api
copy .env.example .env
```

Open `.env` in a text editor and update the follow settings:

- `DATABASE_URL` and `DIRECT_URL`: Set these to your PostgreSQL connection string.
- `PORT`: (Optional) Uncomment and set to the desired port (default is `3000`).
- `HOST`: (Optional) Uncomment and set to `0.0.0.0` to allow external connections context on the network.
- `SKIP_AUTH` / `DEFAULT_TENANT_ID`: If deploying into an isolated internal network and bypassing AWS Cognito, uncomment `SKIP_AUTH=true` and provide a default tenant ID.

### 4. Database Setup

Ensure your PostgreSQL database is running, then initialize the tables from the API directory:

```bash
npm run db:generate
npm run db:migrate
```

_(Note: The database schema is already pre-configured to build for the `"windows"` binary target)._

### 5. Build the API

Compile the TypeScript source code into plain JavaScript:

```bash
npm run build
```

This generates a `dist/` directory containing the `server.js` entry point.

### 6. Install as a Windows Service

To ensure the API stays running in the background, starts automatically on server reboots, and restarts on crashes, we install it as a Windows Service using `node-windows`.

From within the `packages\api` directory (in your Administrator terminal), run:

```bash
npm run service:install
```

- This will register a new Windows Service named **"Pegasus API"**.
- The service will begin running immediately.
- You can view and manage it natively via the Windows Services UI (`services.msc`).

> **Updating the API:** If you pull new code, remember to run `npm run build` again and restart the service via `services.msc` to apply the changes.

#### Uninstalling the Service

If you ever need to remove the Windows Service smoothly, run:

```bash
npm run service:uninstall
```
