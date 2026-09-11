# Company website — pegasusmovemanager.com

**Branch:** `feat/company-website` · **Goal:** a modern, simple static company site for Pegasus Move Manager, hosted in the Pegasus AWS accounts (S3 + CloudFront), served at `pegasusmovemanager.com` + `www.`.

## Context (so any agent can resume)

- **Source material:** the old site `pegasussd.com` (now expired/parked). Recovered from the Wayback Machine — 14 pages, 2004–2016 captures; the 2011 home page is byte-identical to the 2022/2025 captures (site frozen Nov 2009). Raw captures are in the session scratchpad, not committed.
  - Company: **Pegasus Software Development, LLC** — custom software for Moving & Storage, Warehousing and Logistics. **In business since 1989** (user-confirmed; the old site's own copyright only went back to 2003). Footer: `© <year> Pegasus Software Development, LLC`. Heritage line: 35+ years, not "20+".
  - Mission (keep, lightly edited): _"bring advanced technology to our clients, assisting them in making each and every move more efficient and helping them to exceed their customers' expectations."_
  - Old modules: Move Management (domestic), International Move Management, Household Goods Forwarding, Warehousing & Storage, Reporting. Old news: automated move-status emails, electronic order upload, Crystal Reports.
  - Brand mark: pegasus horse logo (`PegLogo.jpg`, 150×145 JPEG — low-res; reuse as a heritage image, not as a crisp logo).
- **User decisions (2026-09-11):**
  - Domain **pegasusmovemanager.com** (registered at Squarespace; user will point registrar NS at Route 53 when asked).
  - Contact: **4495 Hidden Stream Drive, Loganville, GA 30052** · **admin@dolas.dev** · Gigi is owner; Bernd is no longer involved; no phone/fax.
  - Copy: **updated for today's Pegasus** (cloud platform as the product; heritage as the story).
- **Product naming:** "Pegasus Move Manager" — already used by the live privacy policy at `https://pegasus.dolas.dev/privacy.html` (link it from the footer). Sign-in CTA → `https://pegasus.dolas.dev`.
- **Copy guardrail:** only claim features that exist in the repo (quotes, moves/dispatch, customers, invoicing, long-haul trip + driver planning, driver mobile app, reporting dashboards, partner/van-line integrations + workflow automation SDK, SSO, documents, customer feedback surveys, RingCentral SMS capture). Do **not** copy `apps/tenant-web/src/routes/landing.tsx`'s invented stats ("10× faster quoting", "40% fewer dispatch errors", "SOC 2-ready").

## Design

### Site — `apps/company-web/` (plain HTML/CSS, no build, no framework, no package.json)

One-page site with anchor nav + a real 404:

- `index.html` — header (logo, nav: Platform · Heritage · Contact, "Sign in" button) → hero → platform capabilities grid → "Built on 20+ years in moving & storage" heritage + mission → contact (address, email, `mailto:`) → footer (© Pegasus Software Development, Inc., privacy link).
- `404.html`, `styles.css`, `assets/` (logo + favicon), `robots.txt`, `sitemap.xml`.
- No forms (static site can't POST — the old Information Request/Feedback forms become a `mailto:` CTA). No third-party JS/fonts ⇒ strict CSP works.
- Brand color from `packages/theme` (`brand: #285785`, slate neutrals). Light + dark via `prefers-color-scheme`. Responsive to 360px.

### Infra (this repo) — `packages/infra/lib/stacks/company-site-stack.ts`

- S3 bucket: BLOCK_ALL, S3-managed SSE, RETAIN. OAC origin.
- CloudFront: redirect-to-https, compress, CACHING_OPTIMIZED, HTTP/2+3, TLS1.2_2021, `defaultRootObject: index.html`.
- **Error responses 403/404 → `/404.html` with status 404** (NOT the SPA 200→index.html rewrite; OAC returns 403 for missing keys).
- Response headers: HSTS, nosniff, frame DENY, referrer policy, and an **enforced** CSP `default-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (own policy — do not reuse FrontendStack's tenant/Cognito CSP).
- `BucketDeployment` from `apps/company-web` (prune: true — no hashed chunks to protect), invalidates `/*`.
- Always publishes SSM `/dolas/pegasus/company/distribution-domain` (the distribution domain doesn't change when aliases are added — lets dolas-infra create alias records before the domain is attached).
- `attachCustomDomain` prop: reads `/dolas/pegasus/company/{domain-name,cert-arn}` from SSM; `domainNames: [apex, www.apex]`; CloudFront Function (viewer-request) 301s `www.` → apex.
- `bin/app.ts`: instantiate for **staging + prod** as `CompanySiteStack` (`pegasus-<env>-company-site`). `attachCustomDomain: envName === 'prod' && COMPANY_SITE_DOMAIN_READY`, constant `false` in this PR (code constant, not a context flag — CI doesn't pass context). Output `CompanySiteUrl`.
- **Do not touch** `cognito-stack.ts` / `FrontendStack` (UserPoolClient edits have wiped SSO IdPs before).

### CI wiring — new deploy component `company-web`

- `.github/deploy-manifest.json`: `"company-web": { "paths": ["apps/company-web"], "stacks": ["CompanySiteStack"] }`; `envConditionalStacks.CompanySiteStack: ["staging","prod"]`.
- `.github/workflows/deploy.yml`: dispatch option `company-web`; `changes` output `company_web`; case arm; path detection + required-paths guard; `any` includes it; summary row; pass `deploy-company` to staging + prod calls.
- `.github/workflows/_deploy.yml`: input `deploy-company` (default `'false'` so callers that don't pass it keep working); `--all` only when all four are true; `add_stacks company-web`. No Turbo build (no build step).
- `.github/workflows/rollback.yml`: resolve + pass `deploy-company`.

### DNS (dolas-infra repo — direct-to-main per its solo-operator convention), staged

- `config/pegasus.ts`: `companyDomain?: string` — prod `pegasusmovemanager.com`, staging unset.
- New `PegasusCompanyDnsStack` (prod only): `PublicHostedZone` for the apex; SSM `/dolas/pegasus/company/{hosted-zone-id,domain-name}`; `Nameservers` output. Gated by context `pegasus:companySite:certEnabled`: ACM cert (apex + `www` SAN, DNS-validated in the zone) → SSM `/dolas/pegasus/company/cert-arn`, plus apex + `www` A/AAAA aliases to the SSM-published distribution domain.
- Add `Dolas-PegasusCompanyDns-Prod` to `deploy.yml` prod deploy list. Jest test for zone-only vs cert-enabled synth.

## Rollout order

1. [ ] **Pegasus PR** (this plan): site + CompanySiteStack + CI wiring. Merge → site live on `*.cloudfront.net` in staging, then prod (prod approval gate). SSM distribution-domain now exists in prod.
2. [ ] **dolas-infra**: zone-only (`certEnabled` false) → deploy → hand the 4 Route 53 NS values to the user.
3. [ ] **User**: set those 4 NS at Squarespace for pegasusmovemanager.com. Verify `dig NS` shows awsdns.
4. [ ] **dolas-infra**: `certEnabled: true` → cert validates + apex/www aliases created.
5. [ ] **Pegasus PR**: flip `COMPANY_SITE_DOMAIN_READY = true` → domain attached. Verify `https://pegasusmovemanager.com` + `www` 301 by **content**, not status (SPA fallbacks elsewhere return 200 for anything).

## Checklist (step 1)

- [x] `apps/company-web/*` (index, 404, css, assets, robots, sitemap) — logo reused from
      `apps/mobile/assets/logo-mark.png` (the current winged mark); the 1990s pegasus-horse
      JPEG from the archive is kept only as the heritage figure.
- [x] `company-site-stack.ts` + `__tests__/company-site-stack.test.ts` (10 tests)
- [x] `bin/app.ts` wiring (`COMPANY_SITE_DOMAIN_READY = false` until DNS is cut over)
- [x] `deploy-manifest.json`, `deploy.yml`, `_deploy.yml`, `rollback.yml`
- [x] `npm run typecheck` + infra `vitest` green (391 tests; deploy-manifest drift guard passes
      for dev/staging/prod)
- [x] Local render check (Playwright, desktop + dark + 390px) — no horizontal overflow, no
      console errors, all anchors and images resolve
- [x] Docs: CLAUDE.md package map (`apps/company-web`), `dolas/agents/project/PATTERNS.md`
      ("Static sites are not SPAs — keep the 404 a 404")
- [ ] Archive plan → `plans/completed/` in the impl commit; PR via `/workstream-finish`

## Risks / side effects

- `packages/infra` change ⇒ first merge forces a full `--all` deploy of every stack (normal for infra PRs).
- New workflow input: any `_deploy.yml` caller missed would silently skip the company site (default `'false'`), never fail.
- Pegasus deploy role creates CloudFront Functions — already has CloudFront via CDK exec role; verify on staging deploy.
- **Squarespace records as of 2026-09-11** (checked): apex A → 198.185.159.144/145, 198.49.23.144/145 (Squarespace parking), `www` CNAME → ext-sq.squarespace.com, TXT `v=spf1 -all`, **no MX**. After NS cutover all of these stop resolving — no mail is configured, so nothing breaks. **Carry the `v=spf1 -all` TXT into the Route 53 zone** so the cutover doesn't loosen mail policy on a domain that sends nothing.
