// ---------------------------------------------------------------------------
// Demo Partner golden corpus — the `__corpus__/demo_partner/*.json` fixtures as
// a typed, importable `GateCorpusCase[]`. Publish-time data, ordered by
// filename, asserted equal to the on-disk files by corpus.test.ts, and never
// bundled into the Lambda hot path (the registry overlay uses only mapping +
// rules).
// ---------------------------------------------------------------------------

import type { GateCorpusCase } from '../gate-pipeline'

import c01 from '../__corpus__/demo_partner/01-valid-accepted.json'
import c02 from '../__corpus__/demo_partner/02-forbidden-status-awarded.json'
import c03 from '../__corpus__/demo_partner/03-submit-missing-contact.json'
import c04 from '../__corpus__/demo_partner/04-submit-ok.json'
import c05 from '../__corpus__/demo_partner/05-invalid-email.json'
import c06 from '../__corpus__/demo_partner/06-inprogress-missing-actuals.json'
import c07 from '../__corpus__/demo_partner/07-inprogress-ok.json'
import c08 from '../__corpus__/demo_partner/08-delivered-missing-delivery-actual.json'

export const demoPartnerCorpus: GateCorpusCase[] = [
  c01,
  c02,
  c03,
  c04,
  c05,
  c06,
  c07,
  c08,
] as GateCorpusCase[]
