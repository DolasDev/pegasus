# SES DMARC records for the Pegasus sending domains

## Context

`PegasusSesBootstrapStack` (dolas-infra) provisions verified SES domain
identities for `pegasus.dolas.dev` (prod) and `pegasus-qa.dolas.dev` (staging),
with Easy DKIM and a custom MAIL FROM (`mail.pegasus[.qa].dolas.dev`) that
gives SPF alignment through amazonses.com's published SPF record. That covers
the two authenticators receivers actually check (DKIM + SPF), but it does
**not** publish a DMARC policy. Without a `_dmarc` TXT record:

- Receivers don't know what we want them to do with mail that fails DKIM/SPF
  alignment for our domain — most fall back to neutral handling, which gives
  spoofers a free pass.
- We can't see aggregate reports of who is sending mail "as" our domain.
- Gmail and Yahoo's bulk-sender guidance (rolling out since 2024-02) treats
  the lack of `p=quarantine` or stronger as a deliverability penalty even
  for low-volume transactional senders. We're well below the 5k/day threshold
  today, but the easier we make this on receiver reputation engines, the less
  we have to fight to keep the inbox.

This work doesn't unblock anything in flight (Cognito invites are sending fine
via SES once production access is granted) but it's the obvious next reputation
upgrade and is cheap to land.

## Plan

Roll out DMARC in three phases per domain. The TXT records live inside each
Pegasus account's own delegated subzone (created by `PegasusDnsBootstrapStack`),
so the change is local to `PegasusSesBootstrapStack` — no cross-account
delegation, same shape as how DKIM records already land.

### Phase 1 — monitor mode (`p=none`)

Add a `_dmarc.pegasus[.qa].dolas.dev` TXT record per environment:

```
v=DMARC1; p=none; rua=mailto:dmarc-reports@pegasus[.qa].dolas.dev; adkim=s; aspf=s; fo=1
```

- `p=none` — receivers report but don't quarantine, so a misconfiguration
  doesn't immediately bury invites in spam folders.
- `rua=mailto:dmarc-reports@<sending-domain>` — same-domain reporting address
  bypasses RFC 7489 §7.1's cross-domain authorization TXT requirement. We
  don't need a real mailbox; aggregator services (dmarcian, Postmark DMARC,
  EasyDMARC free tier) provide an address and a parsing UI. Choose one before
  landing the record — `admin@dolas.dev` would work too but cross-domain
  reporting needs a verification TXT under `pegasus[.qa].dolas.dev._report._dmarc.dolas.dev`
  in the parent zone (i.e. a separate dolas-infra change).
- `adkim=s; aspf=s` — strict alignment. We already align both, so be explicit.
- `fo=1` — report on any auth failure, not just both-failed.

CDK shape (extend `PegasusSesBootstrapStack`):

```ts
new route53.TxtRecord(this, 'DmarcRecord', {
  zone: hostedZone,
  recordName: `_dmarc.${subdomain}`,
  values: ['v=DMARC1; p=none; rua=mailto:<reporter>@<aggregator>; adkim=s; aspf=s; fo=1'],
})
```

Observe aggregate reports for two reporting cycles (about a week each) and
confirm: (a) every report has 100% DKIM + SPF alignment for our own sending,
(b) no other source is sending as our domain.

### Phase 2 — quarantine (`p=quarantine; pct=10` → `pct=100`)

Move to `p=quarantine` with `pct=10` first, hold for a week, then `pct=100`.
This catches obvious spoofing while still letting receivers downgrade rather
than reject.

```
v=DMARC1; p=quarantine; pct=10; rua=mailto:…; adkim=s; aspf=s; fo=1
```

### Phase 3 — reject (`p=reject`)

After Phase 2's full coverage produces clean reports for two weeks:

```
v=DMARC1; p=reject; rua=mailto:…; adkim=s; aspf=s; fo=1
```

At this point any mail claiming to be from `pegasus[.qa].dolas.dev` that does
not pass DKIM or SPF alignment is hard-rejected by compliant receivers.

## Out of scope

- BIMI (brand indicators) — gated on `p=quarantine` or stronger + a VMC; not
  worth the cost for transactional invites.
- TLS-RPT / MTA-STS — receiver-side TLS reporting, orthogonal to DMARC.
- DMARC on the parent `dolas.dev` apex — owned by `dolas-infra`, and the
  Google Workspace SPF/DKIM there is already in place; revisit there if
  outbound Workspace mail benefits from DMARC too.

## Acceptance

- Both `_dmarc.pegasus.dolas.dev` and `_dmarc.pegasus-qa.dolas.dev` resolve
  to the Phase 3 record.
- Aggregate reports for the last two reporting cycles show 100% alignment
  on the only legitimate source (SES via the `pegasus-invite-emails`
  configuration set).
- No DMARC failure spikes in the SES feedback SNS topic
  (`pegasus-ses-feedback`) over the same window.
- This file moves to `plans/completed/`.
