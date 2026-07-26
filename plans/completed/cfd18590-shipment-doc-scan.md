# feat(mobile,api): retire Paperwork, add shipment document scanning

## Context / root cause

`steve@dolas.dev` (a `tenant_admin` on the **Nelson Westerberg** tenant,
`9d869236-518f-4fe4-90d3-274a1b957c38`) saw **"No orders assigned / Pull down to
refresh"** on the mobile app. Investigation (prod read-only logs + code) showed:

- That message is the **legacy `Paperwork` screen** (`app/(drawer)/paperwork.tsx`)
  reading the empty cloud `GET /api/v1/moves`. As a non-driver admin the crew
  filter is skipped, so the endpoint returns `200` with an empty array — the
  cloud `Move` table has no rows for this tenant (its orders live in legacy
  pegII/longhaul).
- The **longhaul-sourced orders feature already exists** as **"My Trips"**
  (`tripService` → `/me/driver` → `/api/v1/onprem/longhaul/trips?filters`). So no
  new "moves-from-longhaul" wiring is needed.

**User decisions:**

- Moves = orders; for now sourced from the longhaul endpoints (already done via
  My Trips; the pegII bridge is future).
- **Remove** the legacy Paperwork screen; instead add a **document scanning**
  feature to the shipment drill-down (Documents tab → Add new → scan one/multiple
  pages → pick doc type → save → upload; Google-Drive-style).
- Driver mapping (`TenantUser.longhaulDriverId`) handled separately by the user —
  code only.
- Scan capture: **dedicated scanner plugin** (`react-native-document-scanner-plugin`).
- Also allow **picking an existing file from the device** (PDF/image) as an
  alternative to camera scanning, via `expo-document-picker`.

## Backend (apps/api) — minimal

1. `src/handlers/documents.ts`: add `'shipment'` to `ALLOWED_ENTITY_TYPES`
   (`entityId` = longhaul `order_num`, a string — no FK needed).
2. Extend the documents handler test to cover `entityType: 'shipment'`.
3. Follow-up note (NOT in scope): documents endpoints have no Cedar RBAC gate —
   any authenticated tenant user can upload/list/delete. Flag for a later PR.

## Mobile — remove legacy moves/Paperwork

Delete:

- `app/(drawer)/paperwork.tsx`
- `app/order/[id].tsx`, `app/order/_layout.tsx`
- `src/services/orderService.ts` (+ `orderService.test.ts`)
- `src/components/OrderCard.tsx` (+ `OrderCard.test.tsx`)
- `src/components/StatusBadge.tsx` (+ `__tests__/StatusBadge.snapshot.test.tsx`)
- `src/services/mockData.ts`, `src/services/__fixtures__/mockData.ts`

Edit:

- `app/(drawer)/_layout.tsx` — drop `<Drawer.Screen name="paperwork" />`
- `src/components/DrawerContent.tsx` — drop the Paperwork `DrawerItem`
- `app/_layout.tsx` — drop `<Stack.Screen name="order" />`
- `src/types/index.ts` — drop `TruckingOrder`, `OrderStatus`, `InventoryItem`
  (and unused `Move` re-exports); keep `DriverMetrics`, `Driver`
- `src/api/client.test.ts` — replace `/api/v1/moves` placeholder path with a
  neutral one
- Prune now-unused `logger` order helpers only if trivially safe

Verify: no remaining refs to `OrderService` / `TruckingOrder` / `/api/v1/moves`;
dashboard (`index.tsx`, `driverMetrics.ts`) and My Trips untouched.

## Mobile — document scanning on shipment detail

Deps (via `expo install` where applicable, matching SDK ~55):

- `react-native-document-scanner-plugin` (+ app.json config plugin + camera
  permission usage strings)
- `expo-file-system` (read file size, binary S3 PUT via `uploadAsync`)
- `expo-print` (assemble scanned pages into one multi-page PDF)

Work:

- `app/shipment/[orderNum].tsx`: introduce a **Details / Documents** tab
  (local segmented control). Details = current sections. Documents = list from
  `GET /api/v1/documents/entity/shipment/:orderNum` (filename, type, date,
  status; tap → `download-url` → open/view) + **Add new** button.
- `src/services/documentService.ts`:
  - `listForShipment(orderNum)` → `GET /documents/entity/shipment/:orderNum`
  - `getDownloadUrl(documentId, variant?)`
  - `uploadDocument({ orderNum, documentType, fileUri, mimeType, filename, sizeBytes })`: 1. `POST /api/v1/documents/upload-url` (JSON via api client) 2. `FileSystem.uploadAsync(uploadUrl, fileUri, { httpMethod:'PUT',
uploadType: BINARY_CONTENT, headers:{ 'Content-Type': mimeType } })`
    (Content-Type/Length must match the presign) 3. `POST /api/v1/documents/:id/finalize`
- Scan flow (modal route under `app/shipment/`, e.g. `[orderNum]/scan` or a
  sibling `scan/[orderNum]`): source pages either by **scanning** (`scanDocument`,
  multi-page) OR **choosing a file from the device** (`expo-document-picker`,
  accepting PDF + images) → thumbnail/preview review (reorder/remove/add-more) →
  **document type** picker (BOL, POD, Weight Ticket, Inventory, Invoice, Receipt,
  Photo, Other) → assemble captured images to one PDF (`expo-print`); a picked
  PDF uploads as-is, a picked image is treated as a page → compute size
  (`expo-file-system`) → `uploadDocument` with progress + error states → on
  success pop back and refresh the Documents list.
- Add dep: `expo-document-picker` (device file pick alternative).
- Reuse `@pegasus/theme` tokens + existing card/section styles.

## Tests / gates

- Jest: mock `react-native-document-scanner-plugin`, `expo-file-system`,
  `expo-print` (jest setup / moduleNameMapper); add them to
  `transformIgnorePatterns` if needed.
- Add `documentService.test.ts` (mock api client + FileSystem: assert the
  3-step upload sequence + error paths).
- Remove `orderService.test.ts`, `OrderCard.test.tsx`,
  `StatusBadge.snapshot.test.tsx`.
- Run mobile `lint`, `typecheck`, `jest`; run api tests for the documents change.

## Ship

- One PR `feat(mobile,api): …`; land via merge queue.
- Dispatch `mobile-release.yml` (env `prod`, submit ON → alpha / closed-testing
  track). Promotion to Production remains manual in Play Console.
