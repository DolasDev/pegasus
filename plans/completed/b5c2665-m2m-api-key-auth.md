# M2M API Key Authentication Frontend UI (Developer Settings)

**Branch:** main
**Goal:** Create a "Developer Settings" UI in the tenant frontend (`packages/web`) to allow administrators to manage Machine-to-Machine (M2M) API clients.

---

## Context

The backend API and database for M2M API Keys (API Clients) are fully implemented. However, the tenant frontend currently lacks a UI for creating, viewing, rotating, and revoking these keys. This plan adds a new `developer-settings.tsx` route to the frontend along with the necessary API integration code to connect to the existing `/api/v1/api-clients` endpoints.

A critical security requirement is that the `plainKey` is only returned once by the API upon creation or rotation. The UI must display this key clearly to the user, instruct them to copy it, and warn them it will not be shown again.

---

## Checklist

### Task 1 — API Integration Layer

- [x] Add `packages/web/src/api/api-clients.ts` to encapsulate the REST calls for the API clients (`GET`, `POST`, `PATCH`, `POST /revoke`, `POST /rotate`).
- [x] Export the new API functions from `packages/web/src/api/index.ts` (if such an index exists) or prepare to import them directly.

### Task 2 — UI Components & Routing

- [x] Create `packages/web/src/routes/settings.developer.tsx` (originally planned as `developer-settings.tsx`).
- [x] Build the Data Table view showing existing API clients (Name, Prefix, Scopes, Created, Last Used, Status).
- [x] Build the Create/Edit Modal with form fields for Name and Scopes.
- [x] Build the one-time Key Display Modal to show the newly generated `plainKey` with a copy-to-clipboard button and security warning.
- [x] Build Rotate and Revoke action handlers and confirmation dialogs.

### Task 3 — Navigation Integration

- [x] Update navigation via `AppShell.tsx` (instead of `__root.tsx`) to add a "Developer Settings" link.
- [x] Ensure the link is only visible/accessible to users with the `tenant_admin` role.

---

## Files Created

- `packages/web/src/api/api-clients.ts`
- `packages/web/src/api/queries/api-clients.ts`
- `packages/web/src/routes/settings.developer.tsx`
- `packages/web/src/__tests__/developer-settings.test.tsx`

## Files Modified

- `packages/web/src/components/AppShell.tsx`
- `packages/web/src/router.tsx`

## Risks & Side Effects

- **Security:** The plain text API key MUST be displayed properly upon creation/rotation. If the modal fails to render or is accidentally closed before copying, the user will have to rotate the key immediately. We must ensure the UI state for the one-time key display is robust.
- **Routing:** Adding a new top-level route to the tenant app. Should be safe, non-destructive to existing routes.
