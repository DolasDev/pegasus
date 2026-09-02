# Store listing copy

Draft copy for both listings. Character limits are the hard store caps — the
count after each field is the current draft's length.

> **Unresolved:** the app calls itself three different things. `app.json` says
> **Pegasus Move Manager** (the chosen store name), the drawer header says
> **Pegasus**, and the login screen says **Moving & Storage / Driver Portal**.
> The login copy is what a reviewer and every driver sees first. Worth aligning
> before submission; not done here because it is a product-copy decision.

---

## Google Play

**App name** (30 max) — `Pegasus Move Manager` — 20

**Short description** (80 max) — 74

> Trips, shipments and paperwork for professional movers — built for the cab.

**Full description** (4000 max)

> Pegasus Move Manager is the driver app for moving and storage companies
> running on the Pegasus platform. It puts the day's work on the phone already
> in the driver's pocket: what is offered, what is loaded, where it is going,
> and what paperwork still has to be captured.
>
> **See the day at a glance**
> Offered trips, active shipments and the week's completed work on one screen,
> so a driver knows what needs a decision without calling dispatch.
>
> **Work the trip, not the paperwork**
> Every trip carries its shipments, its origin and destination, planned and
> actual dates, weights and estimated linehaul. Filter by status — offered,
> accepted, in transit, delivered — and open any trip for the full picture.
>
> **Shipment detail that matches dispatch**
> Account, booker, move type, pack/load/delivery spreads and actuals, origin and
> destination addresses, estimated and actual weight, plus the special
> instructions and survey remarks that decide how a job actually goes.
>
> **Capture documents from the cab**
> Scan multi-page documents with the camera or attach a file from the device.
> Pages are assembled into a single PDF and uploaded straight to the shipment,
> so bills of lading, inventories and weight tickets reach the office the day
> they are signed instead of at the end of the run.
>
> **Built for real crews**
> Single sign-on or password login, multi-company support for drivers who haul
> for more than one agency, and push notifications when a trip is assigned.
>
> Pegasus Move Manager requires an account with a moving company that uses the
> Pegasus platform. It is not a consumer moving app.

**Category** — Business
**Content rating** — questionnaire; no user-generated public content, no ads
**Contains ads** — No
**In-app purchases** — No

---

## Apple App Store

**App name** (30 max) — `Pegasus Move Manager` — 20

**Subtitle** (30 max) — `Driver trips & paperwork` — 24

**Promotional text** (170 max) — 138

> Scan a bill of lading from the cab and it reaches the office before you pull
> out. Trips, shipments and documents in one driver app.

**Keywords** (100 max, comma-separated, no spaces after commas) — 96

```
moving,mover,driver,trucking,dispatch,shipment,freight,household,logistics,haul,linehaul,delivery
```

**Description** — reuse the Play full description above (both cap well above it).

**Category** — Business
**Age rating** — 4+

### App Review Information — required, and the most common rejection

The app is login-walled behind Cognito. A reviewer who cannot get in files a
Guideline 2.1 rejection, and an empty dashboard reads as an incomplete app under
4.2. Supply, in App Store Connect:

- [ ] A working **demo tenant + driver login** that has seeded trips and
      shipments. Make it permanent — every future update is re-reviewed.
- [ ] Notes covering tenant selection and the hosted-UI SSO flow, since neither
      is obvious from the login screen.
- [ ] Support URL and marketing URL.

### App Privacy questionnaire

Declare what is **actually** collected:

- Contact info (email) — account
- Identifiers (Cognito `sub`, tenant) — app functionality
- Camera / photos — document capture, uploaded to the shipment
- **Do not declare location.** `app.json` carries
  `NSLocationWhenInUseUsageDescription` claiming route optimization, but nothing
  in `src/` imports `expo-location`. Either drop the unused usage string or ship
  the feature — declaring collection that does not happen is its own problem.

---

## Both stores

- **Privacy policy URL**: https://pegasus.dolas.dev/privacy.html (live).
  Verify by content, not status code — the SPA fallback turns 404 into 200.
- Screenshots: `../ios/screenshots/` and `../android/screenshots/`.
- Icons: `../ios/icon-1024.png`, `../android/icon-512.png`.
- Feature graphic (Play only): `../android/feature-graphic.png`.
