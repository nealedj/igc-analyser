# Reference implementation (test oracle)

This directory contains a verbatim copy of the Python implementation that this
project is a port of.

| File | Origin |
| --- | --- |
| `igc_analyse.py` | `scripts/igc_analyse.py` from the `igc-analysis` Claude skill |
| `polars.json` | `scripts/polars.json` from the same skill |
| `interpretation.md` | `references/interpretation.md` from the same skill |

## What this is for

**It is the test oracle, not a runtime dependency.** Nothing in `src/` imports
it, nothing in the build touches it, and none of it is shipped to the browser.
Its only job is to produce the expected JSON that the TypeScript port is
asserted against:

```bash
python3 reference/igc_analyse.py FLIGHT.igc --json expected.json
```

`npm run verify-fixtures` regenerates every golden fixture from this script, so
any drift between the oracle and the port shows up as a failing diff rather
than as a silent behaviour change.

It needs Python 3 and the standard library only. Contributors without Python
can still run `npm test` — the fixtures are committed.

`interpretation.md` is vendored because the UI copy must not contradict it. It
explains what the numbers mean: what circle geometry is and is not evidence
for, how to read a per-circle climb sequence, and which caveats have to travel
with the airmass figures.

## Divergence

Where the port deliberately differs from this script, it is recorded in
[`../test/DIVERGENCE.md`](../test/DIVERGENCE.md) with the reason. Silent
divergence is a defect.

## Updating

If the upstream skill changes, re-copy the files here, run
`npm run verify-fixtures`, and review the resulting fixture diff before
committing. A fixture diff is the point: it is what makes an upstream change
visible.
