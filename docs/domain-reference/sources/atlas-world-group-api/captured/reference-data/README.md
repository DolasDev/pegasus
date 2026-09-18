# Atlas reference-data captures — EMPTY

**Nothing has been captured here.** This folder is the intended home for the responses of Atlas's
reference-data (code-list) endpoints. As of **2026-09-17** none have been called.

**Why:** the capture requires an `Ocp-Apim-Subscription-Key`, and **no key exists in this repo**.
The QA key described in `docs/atlas-world-group-api/README.md` §1 was issued by Atlas admin-side,
is not visible in the developer portal (`/users/{uid}/subscriptions` → `count: 0`), and was never
committed — that README states plainly that "no fetch script is committed here because it needs
portal credentials". No authentication was attempted and no value was guessed.

**What belongs here when a key is available.** 63 reference-data endpoints exist across the
catalog; **47 are reachable** on the measured 6-API grant and **16 are not**. The full table, with
required parameters and response schemas, is in
[`../../analysis-supplement-vocabulary.md`](../../analysis-supplement-vocabulary.md) § "The exact
capture list".

**Three cautions for whoever runs the capture:**

1. **Eleven of the reachable endpoints are tariff- or date-scoped** (`tariffName`, `effectiveDate`,
   `accountType`, `postalCode`, `referralEntityCode`). There is no single Atlas code list for those
   concepts — capture each one **per tariff**, and record the tariff and effective date alongside
   the response. `GET /Estimating/Tariffs` is the seed call that enumerates the tariffs.
2. **Budget.** No per-minute throttle was observed at ~24 calls/min, but a weekly quota may exist
   and is unreadable (no `X-RateLimit-*` headers) — `docs/atlas-world-group-api/README.md` § "Rate
   limits". A per-tariff sweep multiplies 47 endpoints by the tariff count; scope it deliberately.
3. **Do not send `On-Behalf-Of`.** It returns 400 on every API that declares it — same README,
   § "The `On-Behalf-Of` header".

Sibling folder [`../spec-derived-vocabulary/`](../spec-derived-vocabulary/) holds the vocabulary
that **was** recoverable without a key, from the committed OpenAPI documents alone. It is a
partial substitute, not a replacement: it covers one API (`estimating-v2`) and its lists are
samples, not complete code lists.
