// ---------------------------------------------------------------------------
// Longhaul golden corpus — the `__corpus__/longhaul/*.json` fixtures as a typed,
// importable `GateCorpusCase[]`. This is the same corpus the gate-pipeline test
// reads off disk, but exported so the publish path (scripts/publish-builtin-
// configs.ts) can assemble a publish body without `fs`. Ordered by filename so
// the array is deterministic; the index is asserted equal to the on-disk files
// by corpus.test.ts (a new fixture not listed here fails that test).
//
// NOTE: this is authoring/publish-time data only — it is NEVER imported by the
// hot validate path, so it is not bundled into the Lambda (the registry overlay
// uses mapping + rules alone).
// ---------------------------------------------------------------------------

import type { GateCorpusCase } from '../gate-pipeline'

import c01 from '../__corpus__/longhaul/01-valid-pending-create.json'
import c02 from '../__corpus__/longhaul/02-r1-no-shipments.json'
import c03 from '../__corpus__/longhaul/03-r4-advance-without-driver.json'
import c04 from '../__corpus__/longhaul/04-r4-ok-with-driver.json'
import c05 from '../__corpus__/longhaul/05-r5-finalize-missing-actual-date.json'
import c06 from '../__corpus__/longhaul/06-r5-finalize-ok.json'
import c07 from '../__corpus__/longhaul/07-r6-cancel-in-progress.json'
import c08 from '../__corpus__/longhaul/08-r6-cancel-pending-ok.json'
import c09 from '../__corpus__/longhaul/09-r2-driver-change-in-progress.json'
import c10 from '../__corpus__/longhaul/10-r2-ok-same-driver.json'
import c11 from '../__corpus__/longhaul/11-r3-remove-activity-with-actual-date.json'
import c12 from '../__corpus__/longhaul/12-structural-bad-status.json'

export const longhaulCorpus: GateCorpusCase[] = [
  c01,
  c02,
  c03,
  c04,
  c05,
  c06,
  c07,
  c08,
  c09,
  c10,
  c11,
  c12,
] as GateCorpusCase[]
