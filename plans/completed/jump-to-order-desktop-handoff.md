# Handoff: `pegasus-desktop://` protocol — WinForms desktop team

_Created 2026-05-27. Web-side shipped in commit `638b356` (config-gated,
default-off). This document is the desktop-side spec; the feature is inert in any
deployment until the desktop app registers the scheme AND that deployment flips
`features.jumpToOrder.enabled: true`. Related: `plans/todo/longhaul-phase5-decommission.md`._

## What the web app now does

When a dispatcher clicks an order number in the driver-planning **Shipment Detail**
pane, the browser navigates to:

```
pegasus-desktop://order/{order_num}
```

- `{order_num}` is always a **positive integer** (validated web-side; only `[0-9]`
  ever reaches the URI — no escaping, no injection vectors).
- Fire-and-forget. The browser **cannot** tell whether the app opened — it shows an
  optimistic "Opening order N…" toast and, ~2.5s later, a follow-up: "Could not open
  Pegasus desktop app. Make sure the Pegasus desktop app is open and try again."
- **Enabled on QA + prod** (set in CDK `frontend-assets-stack.ts` via
  `jumpToOrderEnabled: envName === 'staging' || envName === 'prod'`; dev stays off).
  The scheme is `features.jumpToOrder.scheme` (default `"pegasus-desktop"`) —
  **whatever the desktop registers must match this.** Until the desktop app
  registers the scheme, clicks produce the "Could not open…" follow-up (no handler
  catches the URI), so registering it is the gating work to make this functional.

This replaces the legacy Electron→named-pipe path. The existing named-pipe server is
still useful — reuse it as the _internal_ redirect target (step 2).

## What the desktop app must implement

### Step 1 — Register the `pegasus-desktop` URI scheme (both install modes)

**Classic install (MSI / ClickOnce / InstallShield):** registry keys (per-user
`HKCU\Software\Classes` preferred; `HKCR` needs admin):

```
HKEY_CURRENT_USER\Software\Classes\pegasus-desktop
    (Default)      = "URL:Pegasus Desktop Protocol"
    "URL Protocol" = ""               ; empty value, just must exist
HKEY_CURRENT_USER\Software\Classes\pegasus-desktop\shell\open\command
    (Default)      = "\"C:\Path\To\Pegasus.exe\" \"%1\""
```

`%1` receives the full URI (`pegasus-desktop://order/123`) as `args[0]` in the entry point.

**MSIX:** registry writes don't apply (the package runs containerized). Declare it in
the package manifest instead:

```xml
<Extensions>
  <uap:Extension Category="windows.protocol">
    <uap:Protocol Name="pegasus-desktop">
      <uap:DisplayName>Pegasus Desktop</uap:DisplayName>
    </uap:Protocol>
  </uap:Extension>
</Extensions>
```

The OS registers it at install time and delivers **protocol activation events** rather
than a command-line arg.

> A custom URI scheme is _not_ a localhost HTTP server, so MSIX loopback/network-
> isolation restrictions (`CheckNetIsolation`) do **not** apply here. That's the main
> reason we chose this over a local listener.

### Step 2 — Single-instance activation redirection (Pegasus is usually already running)

A protocol launch must **not** spawn a second Pegasus. Route the URI to the running instance:

- **Classic:** on startup take a named Mutex. If another instance holds it, forward
  `args[0]` (the URI) **over the existing named-pipe server** to the running instance,
  then exit. The running instance's pipe handler opens the order. (Same pipe you already
  have — it just receives a URI string now instead of the old IPC message.)
- **MSIX:** use Windows App SDK AppLifecycle — `AppInstance.FindOrRegisterForKey(...)` +
  `RedirectActivationTo(...)`. The running instance receives an `Activated` event whose
  `ProtocolActivatedEventArgs.Uri` is the launched URI. No second process starts.

### Step 3 — Parse and dispatch

- Match strictly: `^pegasus-desktop://order/(\d+)/?$`. Reject anything else (other
  "nouns", query strings, non-numeric id, extra path segments).
- Marshal the order-open onto the UI thread (pipe-listener / activation callback runs
  off the UI thread).
- Open the existing order form for that id.

### Step 4 — Security (mandatory — the web side cannot enforce this)

**Any web page on the machine can invoke `pegasus-desktop://order/999`**, not just
Pegasus's own web app. Therefore the desktop app must:

- Treat the id as **untrusted**: validate it's a positive integer the app actually owns;
  show a normal "not found / not authorized" if not.
- Confirm the **logged-in user is authorized** to view that order before displaying it.
- Prefer requiring Pegasus to **already be running and authenticated** over auto-launching
  into a privileged state from a cold protocol activation.
- Never shell out, build file paths, or run SQL string-built from the URI. The only thing
  extracted is an integer.

### Step 5 — Test matrix

- Classic install, app **closed** → protocol launches it, opens order.
- Classic install, app **running** → redirects to existing instance, opens order (no 2nd process).
- MSIX install, both closed/running cases (verify `RedirectActivationTo`).
- Malformed URIs (`…/order/abc`, `…/order/1/2`, `…/trip/5`, query strings) → rejected cleanly.
- Unauthorized order id for the current user → access denied, not opened.

## Coordination back to the web side

Once registered and tested in a deployment, flip that deployment's `tenant-web`
`config.json`:

```json
"features": { "jumpToOrder": { "enabled": true, "scheme": "pegasus-desktop" } }
```

(If a different scheme name is registered, set `scheme` to match.)
