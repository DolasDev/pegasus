# Atlas — outstanding questions

Draft correspondence. Rewritten **2026-08-20** after the first working QA subscription key let us
test the API instead of inferring from specs. Every question below is one that measurement could
not settle; the evidence for each is in [`README.md`](./README.md).

**Still no recipient.** Nothing on the developer portal publishes a support or developer contact —
no mailto, no support page, no address in any product description. This needs to go to the Atlas
account manager or integration contact.

**What changed from the 2026-08-06 draft.** The old Q4 ("please provision a QA subscription key")
is **done**. Q5 ("is `On-Behalf-Of` required, and what identifier?") is answered mechanically —
never send it — but reopened as an identity question, now Q3. Q1 (push feed) is unchanged. Two
questions are new and outrank everything else: settlements (Q1) and subscription scope (Q2).

---

## Draft

**Subject:** Pegasus ↔ Atlas API — settlement data, subscription scope, and identity

Hi <name>,

Thanks for the QA subscription key — it's working, and we've now exercised the API properly. That
turned up a few things we can't resolve from the published specs.

**1. Where does settlement data live?**

Our integration's first use case is pulling settlement / agent-compensation records. We can't find
them. Searching all 24 published specs, "settlement" appears twice and both look like incidental
field names; "remittance" and "disbursement" don't appear at all. The APIs that do carry invoice
data — `RatingSystem-v1`, `atlasorder-v1`, `authorizations-v1` — all return 401 for our key.

The closest we can reach is `GET /shipment-management/v1/shipments/{orderNumber}`, which has an
`invoices` property, but the spec declares it with no schema so we can't tell what it contains.

Two asks: is there an endpoint (published or otherwise) that serves settlement or agent-payable
records? And could you share **one QA order number** with representative invoice data, so we can
see the real payload shape? This is currently our main blocker.

**2. What product is our subscription actually on?**

We understood we were scoped to Agent-Limited. The portal lists `RadsSupport-v1` under that
product, but our key gets 401 on it. In practice we can reach six APIs — `estimating-v2`,
`documents-v1`, `customers-v2`, `agents-v1`, `cubesheets-v1`, `shipment-management-v1` — and not
`RadsSupport-v1`. Is that exclusion intentional, or has the subscription been scoped differently?

Related: the subscription doesn't appear in our developer-portal account, which shows zero
subscriptions. That means we can't view or rotate the key ourselves. Could it be attached to
`dolasllc@gmail.com`?

**3. Whose identity does our key act as?**

Sending `On-Behalf-Of` returns 400 — _"User is not allowed to make request on behalf of another
user."_ That's fine, and we've stopped sending it. But it implies calls run as some fixed identity
on your side, and we'd like to know which, and what data that identity can see. When
`agents/v1/Companies` returns an empty list, we can't currently tell whether that reflects
permissions or just sparse QA data.

The reason this matters: our platform is multi-tenant, and different customers of ours may be
different Atlas agents. Is the intended model one subscription per agent, or would you grant
impersonation so a single subscription can act for several agents via `On-Behalf-Of`? That choice
changes our design, so we'd rather build to the right one now.

**4. What's the rate limit, including any weekly quota?**

We saw no throttling at roughly 24 calls/minute, and responses carry no rate-limit headers. The
only published figure anywhere is on the Starter product (5/min, 100/week). Since we'll be polling,
knowing the real per-minute and per-week budget up front would save us discovering it through 429s.
We do honor `Retry-After` and back off.

**5. Is there a push or event feed?**

Everything published is request/response. The webhook-shaped paths we found (`/WebHooks/Atlas/Order`,
`/WebHooks/HubSpot/Survey`, Move4U `/callbacks`) all look like endpoints Atlas _receives_ on rather
than ones that call out. If there's any push mechanism outside the catalog — webhooks, a change
feed, a notification service, even a scheduled file drop or SFTP export — we'd much rather build
shipment status against that than poll.

**6. Production access.**

What's the process for production credentials, and does the production catalog match QA? We noticed
a third environment (`dev-azapi`) as well — is that one relevant to partners, or internal only?

Thanks,
Steve Dolatowski
Dolas LLC

---

## Notes (not part of the email)

- **Q1 is the one that matters.** It blocks the `settlements` pilot in
  `plans/in-progress/vanline-source-binding.md`, and no amount of engineering routes around a
  dataset that isn't exposed. If the answer is "we don't publish that," the fallback is piloting a
  capability we _can_ reach — the plan doesn't freeze capability names, so that's a substitution
  rather than a redesign.
- **Q3 has the widest design blast radius.** "One subscription per agent" costs nothing — per-tenant
  credentials already work that way. "We'll grant impersonation" means the fetch descriptor needs
  per-principal substitution plus a Pegasus-user → Atlas-user mapping.
- **Q4 is worth pressing on the weekly figure specifically.** A per-minute limit we'd discover
  safely; a weekly cap we'd discover by exhausting it mid-month.
- **Trim freely** — Q5 and Q6 are lower stakes and can be dropped if you'd rather keep the ask short.
