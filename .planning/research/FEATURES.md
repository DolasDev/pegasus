# Feature Landscape: Mobile Cognito Auth with Multi-Tenant Support

**Domain:** Mobile driver portal login — email/password authentication backed by AWS Cognito, multi-tenant resolution via API, persistent session.
**Researched:** 2026-03-27
**Confidence:** HIGH (requirements defined, existing code understood, Cognito error behavior verified against official docs)

---

## Baseline: What Already Exists

Understanding what the existing login screen and AuthContext provide is essential for scoping what needs building vs. what needs replacing.

| Already Exists                                                                                  | State                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Login screen UI (email field, password field, LOG IN button, keyboard avoidance)                | Production-quality, keep largely unchanged    |
| `isLoading` state that disables inputs and changes button text to "LOGGING IN..."               | Keep as-is                                    |
| `AuthProvider` / `AuthContext` with `login()`, `logout()`, session persistence via AsyncStorage | Replace the mock internals; keep the contract |
| `checkSession()` on app start — reads AsyncStorage and restores auth state                      | Keep pattern; replace stored payload          |
| Auth routing guard — `_layout.tsx` redirects unauthenticated users to `/(auth)/login`           | Keep as-is                                    |
| `POST /api/auth/resolve-tenants` — returns tenants for an email                                 | Exists on server, not yet called from mobile  |
| `POST /api/auth/select-tenant` — records tenant selection                                       | Exists on server, not yet called from mobile  |
| `POST /api/auth/validate-token` — verifies Cognito ID token, returns session claims             | Exists on server, not yet called from mobile  |

The login screen currently shows both email and password simultaneously and treats any 4+ character password as valid. The two-step flow and all real auth calls are entirely absent.

---

## Table Stakes

Features that users expect and that the product is contractually incomplete without. Missing any of these means the app is not safe to ship to real drivers.

### 1. Two-Step Login: Email First, Tenant Resolution Second, Password Third

**Why expected:** Drivers belong to a specific company (tenant). The app cannot know which Cognito user pool client to use until it knows the tenant. Asking for a password before knowing the company is impossible — there is nowhere to authenticate against. This is also the established pattern on the web app, so drivers who also use the web interface will find it familiar.

**What the user experiences:**

- Screen 1 shows the email field and a NEXT / CONTINUE button.
- Tapping NEXT triggers tenant resolution (loading spinner on button, field disabled). This is a network call.
- If one tenant is returned, the app proceeds silently to the password step — no tenant picker appears.
- If multiple tenants are returned, the tenant picker screen appears.
- Screen 2 shows the password field, the resolved company name displayed for confirmation, and the LOG IN button.
- The user can navigate back to change their email (back chevron, or re-tapping the email display at the top).

**Complexity:** Medium. Requires form state machine (email → resolving → [picker] → password → authenticating → done) plus screen transition.

**Notes:** The two-step split has a known UX cost — it breaks password-manager autofill on the single screen that autofills both fields. Mitigation: use `autoComplete="email"` on the email field and `autoComplete="password"` on the password field. React Native Expo has password manager support when these props are set correctly.

---

### 2. Tenant Picker Screen (When Email Belongs to Multiple Tenants)

**Why expected:** An email address may appear in multiple tenant's driver rosters (e.g. a contractor who works for two companies, or a company group with separate tenant accounts). Without a picker, the system cannot know which company's Cognito credentials to load. The server already has `POST /api/auth/select-tenant` for exactly this purpose.

**What the user experiences:**

- A scrollable list of company names, each as a tappable row.
- Tapping a row calls `select-tenant` (brief loading indicator on the row), then proceeds to the password step.
- Only shown when `resolve-tenants` returns more than one result. Never shown when there is exactly one match.

**Complexity:** Low. Simple flat list, one network call.

**Notes:** The picker must clearly show company names, not tenant IDs or UUIDs. The server returns the display name; use it verbatim.

---

### 3. Cognito SRP Authentication via `amazon-cognito-identity-js`

**Why expected:** This is the actual authentication step. Without real Cognito SRP there is no real auth — just mock credentials.

**What the user experiences:** Invisible to the user. They tap LOG IN; the spinner appears; they land on the home screen (or see an error). The SRP challenge-response exchange happens entirely in the background.

**Implementation notes:**

- Uses pool ID and mobile client ID fetched from `GET /api/auth/mobile-config` (after tenant resolution). Credentials are never baked into the app bundle.
- `amazon-cognito-identity-js` is the correct library — pure JS, no native modules, works in Expo managed workflow. AWS Amplify is explicitly out of scope (too heavy).
- Cognito SRP requires `ALLOW_USER_SRP_AUTH` to be enabled on the mobile app client — this is an AWS configuration concern, not a code concern.

**Complexity:** Medium. The `amazon-cognito-identity-js` API is callback-based and requires wrapping in a Promise. The `userPool.storage.sync()` async call is required before using the pool in React Native.

---

### 4. Session Persistence: Survive App Restart Without Re-Login

**Why expected:** Drivers open the app many times per shift. If they had to log in every time they switched apps or the OS suspended the process, the app would be unusable. Every production mobile app maintains session across restarts.

**What the user experiences:** Opens the app, sees a brief loading state (checking stored session), and lands directly on the home screen without any login prompt — until the session actually expires.

**Implementation notes:**

- The current AsyncStorage approach works for non-sensitive metadata (name, email, tenantId, role, expiresAt).
- Cognito tokens themselves (ID token, access token, refresh token) should be stored in `expo-secure-store` (iOS Keychain / Android Keystore backed encrypted storage) rather than plain AsyncStorage, because they are bearer credentials.
- `expo-secure-store` has a practical per-value limit of ~2048 bytes on older iOS. JWT tokens can exceed this. Mitigation: store each token under a separate key, not as a single JSON blob. Alternatively, store only the claims-derived session object in AsyncStorage (already non-sensitive once tokens are validated server-side) and discard the raw Cognito tokens after `validate-token` confirms them. Since `validate-token` returns the session claims, and the server holds the source of truth, storing only the claims is a valid approach for this architecture.
- The stored session must include `expiresAt` so the app can detect expiry on startup without a network call.

**Complexity:** Low-Medium. Largely keep the existing `checkSession` pattern; change the stored shape and add expiry check.

---

### 5. Session Expiry Detection on App Startup (Redirect to Login)

**Why expected:** If the stored session is expired and the app silently accepts it as valid, the first API call will return 401. The user sees a confusing failure screen instead of a clean login prompt. Detecting expiry proactively and redirecting to login is the minimum baseline for a production app.

**What the user experiences:** Opens the app after not using it for several days. The loading state appears briefly, then the login screen appears. No error message — this is normal behaviour, not a failure. Optionally: a brief "Your session has expired. Please log in again." message.

**Implementation notes:**

- Check `expiresAt` in `checkSession()`. If `Date.now() > expiresAt`, clear the stored session and set `isAuthenticated = false`.
- Token refresh (using the Cognito refresh token to silently re-authenticate) is explicitly out of scope for v1 per PROJECT.md. The user re-logs in manually when the session expires. This is the right call for a v1 driver portal — drivers re-log in at the start of their shift.

**Complexity:** Trivial. One comparison in `checkSession`.

---

### 6. Logout: Clears Session and Returns to Login

**Why expected:** Drivers share devices. When a driver's shift ends, they must be able to hand the device to the next driver, who logs in with their own credentials. Without logout, the app is single-user-per-device-forever.

**What the user experiences:** Taps a logout button (presumably in a settings/profile screen that exists or will exist). Returns to the login screen. The next person to open the app starts fresh at the email step.

**Implementation notes:**

- Call `CognitoUser.signOut()` from `amazon-cognito-identity-js` to clear the in-memory Cognito session.
- Remove all persisted tokens from SecureStore.
- Clear the AsyncStorage session record.
- The existing `logout()` method in AuthContext handles most of this; it needs to be extended to call the Cognito signout and clear SecureStore.

**Complexity:** Low.

---

### 7. Comprehensive Error States with Human-Readable Messages

**Why expected:** Users expect failures to be explained clearly. Raw Cognito error codes (`NotAuthorizedException`, `UserNotFoundException`) leaked to the UI destroy trust. A specific, actionable message tells the user what to do next.

**Cognito errors that must be mapped to UI messages:**

| Cognito Signal                                                                | User-Facing Message                                                        | Notes                                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `resolve-tenants` returns empty array                                         | "No account found for this email address. Contact your company admin."     | Email not in any tenant roster                                          |
| Network error during resolve                                                  | "Unable to connect. Check your internet connection."                       | Offline or API unreachable                                              |
| `NotAuthorizedException` with message "Incorrect username or password"        | "Incorrect email or password."                                             | Generic — do not say which is wrong (prevents enumeration)              |
| `NotAuthorizedException` with message "Password attempts exceeded"            | "Too many failed attempts. Please wait a few minutes before trying again." | Cognito lockout: doubles from 1s after 5 failures, up to ~15 min max    |
| `UserNotFoundException` (rare — only when PreventUserExistenceErrors is off)  | "Incorrect email or password."                                             | Treat same as NotAuthorizedException                                    |
| `UserNotConfirmedException`                                                   | "Your account has not been confirmed. Contact your company admin."         | Account exists but email not verified; driver admins provision accounts |
| `NotAuthorizedException` during token validation (account suspended/disabled) | "Your account has been disabled. Contact your company admin."              | Different context — token exchange, not password auth                   |
| `validate-token` returns non-driver role                                      | "This account does not have driver access."                                | Non-driver user (admin, billing) trying to log in to driver portal      |
| Network error during Cognito SRP                                              | "Unable to connect. Check your internet connection."                       |                                                                         |
| Any unexpected / unclassified error                                           | "Something went wrong. Please try again." + log full error server-side     | Never expose stack traces                                               |

**Implementation notes:**

- Cognito distinguishes "incorrect password" from "too many attempts" via the `message` property on the `NotAuthorizedException` error, not a separate error code. The string comparison `error.message === 'Password attempts exceeded'` is the standard pattern (confirmed in amplify-js issue #1234).
- Never show raw `error.message` from the Cognito library in the UI. Always map through a translation layer.
- Error messages appear inline below the relevant field or at the form level — not only as `Alert.alert()` popups. Alerts block the UI and prevent password-manager interaction; inline messages are accessible and dismissable.

**Complexity:** Low. String mapping table, one error-display component.

---

### 8. Loading States at Every Async Step

**Why expected:** Every async operation that takes more than ~100ms needs a loading indicator. Without one, the user taps the button a second time (double-submit) or assumes the app is broken.

**Required loading states:**

| Step                                              | Loading Behaviour                                               |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Email submitted — resolving tenants               | NEXT button shows spinner, email field disabled                 |
| Tenant selected in picker                         | Tapped row shows spinner or dimmed state                        |
| Password submitted — Cognito SRP + validate-token | LOG IN button shows "LOGGING IN...", both fields disabled       |
| App start — checking stored session               | Full-screen splash / loading overlay (already exists partially) |

**Implementation notes:**

- The existing login screen already does `isLoading` — disable inputs and change button text. This pattern is correct; it must be extended to each step of the two-step flow separately.
- A spinner inside the button (or button text change) is sufficient. A full-screen overlay is appropriate only for the initial session check, not for each auth step.

**Complexity:** Trivial.

---

### 9. Field Validation: Email Format Before Network Call

**Why expected:** Submitting a malformed email address to `resolve-tenants` wastes a network round-trip and returns a confusing result. Basic format validation on the email field before the network call is a hygiene baseline.

**What the user experiences:** Taps NEXT with "notanemail" in the field → sees "Please enter a valid email address." inline, no network call made.

**Implementation notes:**

- Simple regex or `z.string().email()` from Zod (already a dependency in the monorepo). No server call until format passes.
- Do not over-validate — the server is the source of truth for whether the email exists.

**Complexity:** Trivial.

---

### 10. Cognito Config Fetched from API (Mobile Config Endpoint)

**Why expected (security baseline):** Hardcoding Cognito pool ID and client ID in the app bundle means any app update to rotate credentials requires an app store release. More critically, it means the credentials are embedded in a distributable binary. The `GET /api/auth/mobile-config` endpoint decouples credential management from app releases and is the architecture decision already made in PROJECT.md.

**What the user experiences:** Invisible. The config is fetched after tenant selection, before the password step.

**Complexity:** Low. One GET request; cache the result for the lifetime of the auth session.

---

## Differentiators

Features that are valued and improve the experience, but users will not abandon the app if they are absent in v1.

### A. "Back to Email" Navigation in Two-Step Flow

**Value proposition:** A user who mis-typed their email is stuck unless they can return to the email step. Back navigation is technically a differentiator because the alternative (restart the app) works — but it makes the app feel broken.

**Complexity:** Low. Back chevron or tapping the displayed email address re-enters the email step and clears the resolution state.

**Recommendation:** Include in v1. The implementation cost is trivial relative to the UX improvement.

---

### B. Password Show/Hide Toggle

**Value proposition:** Drivers type passwords on small screens, often with gloves or in poor lighting. A visibility toggle reduces mis-entry without compromising security (the eye icon is a standard affordance).

**Complexity:** Trivial. `secureTextEntry` toggle on state.

**Recommendation:** Include in v1. One line of state, one icon button.

---

### C. Inline Error Display (vs. Alert popups)

**Value proposition:** The existing implementation uses `Alert.alert()` for errors. Modal alerts block all interaction, cannot be dismissed by tapping elsewhere, and interrupt password-manager flows. Inline error text below the relevant field is the standard — and better — pattern.

**Complexity:** Low. Replaces Alert calls with a state-driven `errorText` string rendered below the input.

**Recommendation:** Include in v1. The project already has `Alert.alert('Error', ...)` calls that should be replaced; doing so now prevents regressions.

---

### D. Show Resolved Company Name Before Password Entry

**Value proposition:** After tenant resolution, showing "Logging in to: Acme Moving Co." before the password field gives the user confidence they are authenticating against the right company. This is especially useful for multi-tenant users who just selected a tenant.

**Complexity:** Trivial. Render the tenant display name (available from `resolve-tenants` or `select-tenant` response) above the password field.

**Recommendation:** Include in v1. Zero implementation risk.

---

### E. "Session Expired" Notice on Login Screen

**Value proposition:** When the app redirects to login because the stored session expired, a brief contextual message ("Your session has expired — please log in again.") explains why they are seeing the login screen without warning. Without it, a driver who logged in yesterday and reopens the app may be confused.

**Complexity:** Trivial. Pass a flag through the navigation params; render a notice when present.

**Recommendation:** Include in v1. One navigation param, one conditional text render.

---

## Anti-Features

Features to explicitly NOT build in this milestone. These are scoped out for valid reasons — building them would increase complexity, risk, or maintenance burden without a commensurate user benefit at this stage.

### 1. Token Refresh / Silent Re-Authentication

**Why deferred:** Cognito refresh tokens work, but implementing silent re-auth correctly requires background token rotation, race condition handling (concurrent requests during refresh), and secure refresh token storage. For a driver portal where drivers log in at the start of a shift, silent refresh adds complexity for minimal gain. Drivers accept manual re-login after a day.

**What to do instead:** Detect session expiry on app startup and redirect to login with a "session expired" message. This is table stake 5 above.

**When to reconsider:** If telemetry shows drivers are being forced to re-login mid-shift (i.e. within a normal 8-hour shift), revisit token refresh as a priority.

---

### 2. Forgot Password / Password Reset

**Why deferred:** Drivers are provisioned by tenant admins. The admin resets passwords through the web admin portal. A self-service forgot-password flow requires either a Cognito hosted UI redirect (browser takeover — bad UX) or a custom code-based reset flow (significant implementation). Not needed for v1.

**What to do instead:** Show "Forgot your password? Contact your company admin." as static text below the LOG IN button. No link, no action — just contact guidance.

---

### 3. Self-Service Sign-Up

**Why not building:** Drivers are invited by tenant admins; they do not self-register. A sign-up flow would require email verification, admin approval, and tenant assignment — none of which belong to this app.

---

### 4. SSO / SAML / Federated Identity (Google, Microsoft, etc.)

**Why deferred:** Per PROJECT.md: drivers use email + password. They do not use corporate SSO providers. The web app's SSO flow uses browser redirects (`expo-web-browser`), which is a heavier integration pattern. Exclude entirely from v1.

---

### 5. Biometric Authentication (Face ID / Touch ID)

**Why deferred:** Valuable, but requires `expo-local-authentication`, adds platform-specific code paths, and should layer on top of a working Cognito auth flow — not be built before it. Post-v1 enhancement.

---

### 6. Device Trust / Remember This Device

**Why deferred:** Cognito has a "remember this device" feature that issues device-specific tokens. It adds Cognito API surface, device management UX, and admin configuration. Not needed at this stage.

---

### 7. Multi-Account / Account Switching Without Logout

**Why deferred:** The multi-tenant picker already handles the "which company" question at login time. An in-session account switcher (like Slack's workspace switcher) is a distinct, more complex feature. If a driver works for two companies they log out and log back in. Defer until there is demonstrated demand.

---

### 8. Offline / Cached Credentials

**Why not building:** Allowing authentication while offline (e.g., by caching a credential hash) has serious security implications and is architecturally complex. Drivers should have network connectivity. Offline mode is a separate and large feature.

---

## Feature Dependencies

```
Email field (exists) → Email validation (trivial)
                     → Tenant resolution API call
                          ↓
                     Single tenant → Fetch mobile-config → Password step
                     Multiple tenants → Tenant picker screen → select-tenant → Fetch mobile-config → Password step
                                                                                    ↓
                                                                         Cognito SRP (amazon-cognito-identity-js)
                                                                                    ↓
                                                                         validate-token API call
                                                                                    ↓
                                                                         Store session (AsyncStorage + SecureStore)
                                                                                    ↓
                                                                         AuthContext sets isAuthenticated = true
                                                                                    ↓
                                                                         Auth guard navigates to home screen
```

Session persistence depends on all of the above completing at least once successfully.
Session expiry detection depends on session persistence existing.
Logout depends on session persistence to know what to clear.

---

## MVP Recommendation

Build in this order (driven by dependency chain and risk):

1. **Mobile config endpoint** (`GET /api/auth/mobile-config`) — unblocks all Cognito calls; lowest risk change
2. **Auth service layer** — wraps `resolve-tenants`, `select-tenant`, `validate-token`, `amazon-cognito-identity-js` SRP into typed functions; fully testable in isolation
3. **Two-step login form** — email step first (with validation + loading + inline errors), then password step; includes show/hide toggle and company name display
4. **Tenant picker screen** — only needed when >1 tenant; small screen, one API call
5. **Updated AuthContext** — replaces mock `login()` with auth service calls; updates stored session shape
6. **Logout** — extend existing `logout()` to call Cognito signOut and clear SecureStore
7. **Session expiry detection** — add `expiresAt` check in `checkSession()`; render "session expired" message if navigated-to with expiry flag

Defer: token refresh, biometric, password reset, SSO.

---

## UX Expectations by Step

### Email Step

- Email keyboard type shows automatically (label type="email-address")
- Keyboard NEXT / Done action submits the form (same as tapping the button)
- Error appears inline below the email field, not as a modal alert
- Button is disabled and shows a spinner while the API call is in flight
- Field is not cleared on error — the user can correct in place

### Tenant Picker

- List renders immediately from the `resolve-tenants` response (no additional loading)
- Tapping a row gives immediate visual feedback (highlight/dim) before the `select-tenant` call completes
- If `select-tenant` fails, a toast or inline error appears; the picker remains visible

### Password Step

- Company name is visible above the password field ("Signing in to Acme Moving Co.")
- Back navigation to change email is accessible
- Password field is focused automatically when the step renders
- Eye icon toggles password visibility
- Keyboard action (Done / Go) submits the form
- Error appears inline below the password field
- Both fields are disabled while the Cognito call is in flight
- On success, navigation to home is automatic — no user action needed

### Session Restore (App Start)

- A brief loading state renders while AsyncStorage is read (already exists)
- If session is valid and not expired: navigate to home silently
- If session is expired or absent: navigate to login; show "session expired" message only if session was previously valid

### Logout

- Immediately transitions to login screen
- All local state is cleared before navigation completes
- No confirmation dialog needed for a driver portal (low risk of accidental logout vs. friction cost)

---

## Confidence Assessment

| Area                                                                               | Confidence | Basis                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| Cognito error codes and lockout behaviour                                          | HIGH       | Verified against AWS official docs and amplify-js issues                                                 |
| Two-step UX pattern                                                                | HIGH       | Established pattern; web tenant app already uses it                                                      |
| SecureStore size limitation                                                        | MEDIUM     | Known issue; workaround (per-key storage) is well-documented; exact byte threshold varies by iOS version |
| `amazon-cognito-identity-js` React Native behaviour (`storage.sync()` requirement) | MEDIUM     | Community sources; confirmed in multiple RN integration articles                                         |
| Multi-tenant picker UX expectations                                                | HIGH       | Standard B2B pattern; documented in Auth0, WorkOS, Clerk references                                      |

---

## Sources

- [Managing user existence error responses — Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-managing-errors.html)
- [Cognito lockout policy — ilearnaws.com](https://blog.ilearnaws.com/2020/05/10/dive-deep-on-the-lockout-policy-of-aws-cognito/)
- [Password attempts exceeded needs its own error code — amplify-js #1234](https://github.com/aws-amplify/amplify-js/issues/1234)
- [SecureStore — Expo Documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [SecureStore size issue — expo/expo #6231](https://github.com/expo/expo/issues/6231)
- [Token Storage — React Native App Auth (nearform)](https://nearform.com/open-source/react-native-app-auth/docs/token-storage/)
- [Security — React Native official docs](https://reactnative.dev/docs/security)
- [Authentication in Expo and React Native — Expo Documentation](https://docs.expo.dev/develop/authentication/)
- [2-Page Login Pattern critique — Vitaly Friedman / Smashing Magazine](https://smart-interface-design-patterns.com/articles/2-page-login-pattern/)
- [Login UX Guide 2025 — Authgear](https://www.authgear.com/post/login-signup-ux-guide)
- [Building better logins — UX Collective](https://uxdesign.cc/building-better-logins-a-ux-and-accessibility-guide-for-developers-9bb356f0a132)
- [How to Handle Cognito Token Refresh — OneUptime, 2026](https://oneuptime.com/blog/post/2026-02-12-cognito-token-refresh-applications/view)
- [Multi-Tenant Apps Best Practices — Auth0](https://auth0.com/docs/get-started/auth0-overview/create-tenants/multi-tenant-apps-best-practices)
