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

This installs all root and workspace dependencies, including `node-windows` (declared as an `optionalDependency` of `apps/api`, so it downloads on Windows and is skipped on other platforms).

### 3. Environment Configuration

Navigate to the API package directory and configure your environment variables:

```bash
cd apps\api
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

From within the `apps\api` directory in your **Administrator** PowerShell, run:

```bash
npm run service:install
```

This registers and starts the service. The first run takes 30–60s while `winsw.exe` is unpacked into a `daemon\` folder; do not interrupt it. You should see `Service installed. Starting...` followed by `Service started.`.

The installer reads `apps\api\.env` and bakes `DATABASE_URL`, `SKIP_AUTH`, and `COGNITO_*` into the service definition. The service runs as **LocalSystem** by default, which does not inherit per-user environment variables, so values must come from `.env` (or be set system-wide via `setx /M`). If you change `.env`, run `npm run service:uninstall && npm run service:install` to refresh the service's baked-in env vars.

**Logs:** the installer writes Node stdout/stderr (and the wrapper log) to `C:\apps\pegasus\logs\` by default — `pegasusapi.out.log`, `pegasusapi.err.log`, and `pegasusapi.wrapper.log`, all rotated. Override the location by setting `PEGASUS_LOG_DIR` in the shell before running `service:install` (the path gets baked into the service XML, so changing it later requires a re-install). The directory is auto-created if it doesn't exist.

If the install errors with `Cannot find module 'node-windows'`, the optional dependency was skipped during `npm install` (e.g. `--no-optional` was passed, or the install ran on a non-Windows machine and the `node_modules` was copied over). Re-run `npm install` from the repo root on the Windows server to pull it in, or install it directly with `npm install --no-save node-windows` inside `apps\api`.

- This will register a new Windows Service named **"Pegasus API"**.
- The service will begin running immediately.
- You can view and manage it natively via the Windows Services UI (`services.msc`).

> **Updating the API:** If you pull new code, remember to run `npm run build` again and restart the service via `services.msc` to apply the changes.

#### Uninstalling the Service

If you ever need to remove the Windows Service smoothly, run:

```bash
npm run service:uninstall
```

### 7. Legacy MSSQL Database Connection

The on-prem deployment supports connecting to the legacy SQL Server database used by the original VB.NET WinForms application. This enables the `pegii`, `efwk`, and `longhaul` API routes, which read from and write to the legacy schema.

> **Note:** These routes are only available in the on-prem standalone server (`server.ts`). They are excluded from the AWS Lambda bundle.

#### How It Works

The MSSQL connection string is stored **per-tenant** in the PostgreSQL `tenants` table (`mssql_connection_string` column). When a request hits a legacy route, middleware looks up the tenant's connection string and opens a pooled connection to the SQL Server instance.

#### Configuration

After the PostgreSQL database is migrated (step 4), set the tenant's legacy connection string by updating the tenant row directly:

```sql
UPDATE tenants
SET mssql_connection_string = 'Server=LEGACYHOST;Database=PegDB;User Id=pegasus;Password=YOURPASSWORD;Encrypt=false;TrustServerCertificate=true'
WHERE id = 'your-tenant-id';
```

**Connection string requirements:**

- The SQL Server instance must be network-reachable from the Windows Server running the API.
- Use `Encrypt=false;TrustServerCertificate=true` for on-prem instances that don't have TLS configured.
- The database user needs read/write access to the tables used by the legacy application.

If the connection string is not set for a tenant, legacy route requests will return a `422` response with code `MSSQL_NOT_CONFIGURED`.
