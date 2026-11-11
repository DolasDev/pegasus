# Atlas — outstanding questions

Draft correspondence. Rewritten **2026-11-11**, after `settlement-v1` appeared in the catalog and
our integration was built against it. Every question below is one that measurement could not
settle; the evidence for each is in [`README.md`](./README.md) and the spec we exported to
[`openapi/settlement-v1.json`](./openapi/settlement-v1.json).

**Still no recipient.** Nothing on the developer portal publishes a support or developer contact —
no mailto, no support page, no address in any product description. This needs to go to the Atlas
account manager or integration contact. _That is the only thing blocking this from being sent._

**What changed from the 2026-08-20 draft.** The old Q1 — "where does settlement data live?" — is
**answered**: Atlas published `settlement-v1`, it is in our grant, and it needs no `On-Behalf-Of`.
That retires the single biggest blocker in the previous draft. The settlement question is still
first, but it is now **one narrow, answerable thing** instead of an open-ended hunt, and it comes
with a specific structural question that a knowledgeable person can answer _without_ sending us any
data. Old Q2 (subscription scope) is reduced to a footnote: the grant is stable and now includes
`settlement-v1`. Q3–Q6 are unchanged in substance, trimmed in length.

---

## Draft

**Subject:** Pegasus ↔ Atlas — one settlement date with data, and a question about Document grain

Hi <name>,

Thanks for publishing `settlement-v1` — that was exactly the gap we flagged in August, and our
integration is now built against it end to end. Two things we can't resolve ourselves.

**1. Could you point us at one QA `settlementDate` that has data?**

Every date we've tried comes back successful but empty. We've tested 14 values spanning 2024-12 to
2026-11; each returns `200` with `agentSettlements: []`, `netSettlement: 0.0`, and
`settlementDate: "0001-01-01T00:00:00"`. That last value is .NET's zero date, which we read as "no
record found" rather than "found, but empty" — so we don't think we're asking wrongly, just asking
for dates that have nothing behind them.

We don't need much: **one date in QA that returns a populated payload** would be enough. If
settlement data simply isn't loaded in QA, knowing that is just as useful — we'd stop guessing at
dates and plan around a production read instead.

**2. Is a `Document` always about exactly one `orderNumber`?**

This is the question the data would answer, and you may be able to answer it directly.

`orderNumber` appears at three levels of the response: on `Document`, and again on each
`DetailRecord` and `AdjustmentRecord` inside it. So we can't tell from the spec whether:

- **(a)** a `Document` is one order's settlement, and the `orderNumber` on its detail and
  adjustment records always repeats the parent's; or
- **(b)** a `Document` can span several orders, with the per-record `orderNumber` being the
  meaningful one.

It matters because our model binds one settlement record to one move. Under (a) we can read each
`Document` as a record directly. Under (b) we have to regroup the response by `orderNumber` before
we can map it — a different and more fragile piece of code, which we'd rather write knowingly than
discover in production.

A related detail if it's easy: for a single order's settlement, should we take `documentAmount` on
the `Document` as the authoritative figure, or sum the `detailRecords`? We'd prefer to read the
number you consider canonical rather than compute our own and risk disagreeing with your statement.

**3. A small bug report, offered as a courtesy.**

The settlement response body is **double-encoded**: it arrives as a JSON _string_ whose contents
are JSON, rather than as a JSON object. Most clients will need an extra decode step that no other
Atlas endpoint requires. We handle both shapes, so **if you fix this it will not break us** — we
mention it only because it's likely unintended and will trip other integrators.

**4. Whose identity does our subscription key act as?**

Sending `On-Behalf-Of` returns 400 — _"User is not allowed to make request on behalf of another
user."_ We've stopped sending it. But it implies calls run as a fixed identity on your side, and
we'd like to know which, and what data it can see. When a list endpoint comes back empty we
currently can't tell permissions from sparse QA data — which is part of why question 1 is hard for
us to diagnose alone.

The design reason this matters: our platform is multi-tenant and different customers of ours may be
different Atlas agents. Is the intended model **one subscription per agent**, or would you grant
impersonation so one subscription can act for several agents? One subscription per agent costs us
nothing; impersonation changes our design. We'd rather build to the right one now.

**5. What's the rate limit — specifically, is there a weekly quota?**

We've seen no throttling at roughly 24 calls/minute across two separate sessions, and responses
carry no rate-limit headers. The only published figure anywhere is on the Starter product (5/min,
100/week). Since settlement reads will be scheduled, the **weekly** number is the one we can't
discover safely: a per-minute limit announces itself, a weekly cap announces itself by running out
mid-month. We honor `Retry-After` and back off.

**6. Is there a push or event feed, and what's the path to production?**

Everything published is request/response. If there's any push mechanism outside the catalog —
webhooks, a change feed, even a scheduled file drop — we'd rather build against that than poll.
Separately: what's the process for production credentials, and does the production catalog match
QA?

Thanks,
Steve Dolatowski
Dolas LLC

---

## Notes (not part of the email)

- **Q1 and Q2 are the same blocker, split so either can unblock us.** Q2 is the thing we actually
  need to know; Q1 is how we'd find out ourselves. A good respondent may answer Q2 outright and
  make Q1 unnecessary — which is why Q2 is phrased as a question about _their_ model rather than a
  request for data.
- **What Q2 gates on our side.** Branch (a) ⇒ the Atlas settlement source is publishable as
  configuration alone, which is the whole property the declarative-fetch work exists to buy.
  Branch (b) ⇒ the regrouping has to live in a bespoke workflow, and this pilot stops demonstrating
  "new partner = config only." See `plans/in-progress/atlas-fetch-phase2.md` → gotcha 1.
- **Q3 is safe to send.** Our decode step accepts both the double-encoded string and a plain
  object, so Atlas fixing it cannot break us. Verified by test, not assumed.
- **Q4 still has the widest design blast radius**, unchanged from August: "one subscription per
  agent" costs nothing, "we'll grant impersonation" means the fetch descriptor needs per-principal
  substitution plus a Pegasus-user → Atlas-user mapping.
- **Q5: press on the weekly figure.** Measured twice now (Aug and Nov) with no per-minute
  throttling observed, so the per-minute number is the one we care least about.
- **Dropped from the August draft:** the subscription-scope question. The grant has been stable
  across both measurement sessions and now includes `settlement-v1`; `RadsSupport-v1` is still 401
  but no longer blocks anything. Not worth the words. (`RadsData-v1` and `yembo-v2`, new in the
  catalog, remain unprobed — not worth asking about until we want them.)
- **Trim freely.** Q6 is lowest stakes. Do not trim Q1 or Q2.
