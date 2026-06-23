// ---------------------------------------------------------------------------
// Weichert golden corpus — the `__corpus__/weichert/*.json` fixtures as a typed,
// importable `GateCorpusCase[]`. See longhaul.corpus.ts for the rationale: this
// is publish-time data, ordered by filename, asserted equal to the on-disk files
// by corpus.test.ts, and never bundled into the Lambda hot path.
// ---------------------------------------------------------------------------

import type { GateCorpusCase } from '../gate-pipeline'

import c01 from '../__corpus__/weichert/01-valid-accepted.json'
import c02 from '../__corpus__/weichert/02-forbidden-status-awarded.json'
import c03 from '../__corpus__/weichert/03-submit-missing-contact.json'
import c04 from '../__corpus__/weichert/04-submit-ok.json'
import c05 from '../__corpus__/weichert/05-invalid-email.json'
import c06 from '../__corpus__/weichert/06-inprogress-missing-actuals.json'
import c07 from '../__corpus__/weichert/07-inprogress-ok.json'
import c08 from '../__corpus__/weichert/08-delivered-missing-delivery-actual.json'

export const weichertCorpus: GateCorpusCase[] = [
  c01,
  c02,
  c03,
  c04,
  c05,
  c06,
  c07,
  c08,
] as GateCorpusCase[]
