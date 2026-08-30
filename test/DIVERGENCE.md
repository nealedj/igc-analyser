# Deliberate divergence from the Python oracle

`reference/igc_analyse.py` is the specification for this port, and the golden
fixtures are its output. Everything must match it to within float drift.

Two things do not, on purpose. Both are defects in the oracle that the port
fixes rather than reproduces, because reproducing them would put visibly wrong
output in front of a pilot. Each is registered in `test/divergence.ts` so the
golden tests know exactly which fields are allowed to differ, and only those.

If you change either behaviour, change the registry and this file together.

---

## C-record declaration header parsed as a task point

**Fixtures affected:** `thermal-day` (and any real trace with a declared task)
**Fields:** `task`

The oracle accepts a C record as a turnpoint when its first two characters
after the `C` are digits:

```python
if len(line) >= 18 and line[1:3].isdigit():
```

Every C record passes that test, including the declaration header that opens
the block. Per the IGC specification that header is
`C` + `DDMMYY` + `HHMMSS` + `DDMMYY` + `NNNN` + `NN` — a date, a time, a task
number and a turnpoint count, with no coordinates in it at all. The oracle
reads its digits as a latitude and longitude anyway, and the result is a
phantom turnpoint thousands of kilometres from the flight.

On a real trace from the BGA Ladder the oracle reports:

```
declared task: 4 points - 0000001 / ASTON DOWN / RIVAR HILL / ASTON DOWN
```

`0000001` is the declaration header, decoded as 18.07°N 108.57°E — the South
China Sea, for a flight from Aston Down in Gloucestershire.

**What the port does instead:** requires the hemisphere characters that a real
turnpoint has and the header cannot have.

```ts
if (line.length >= 18 && 'NS'.includes(line[8]) && 'EW'.includes(line[17]))
```

This matters more here than it does in the oracle. The oracle prints the task
as a list of names, where a stray entry is merely odd. This project draws the
task on the trace, where a phantom turnpoint 8,000 km away collapses the
whole plan view to a dot.

The zero-coordinate `TAKEOFF` and `LANDING` records that some loggers emit are
still dropped by the oracle's own `abs(lat) > 0.001` test, which the port keeps.

---

## Polar matched by first key rather than longest

**Fixtures affected:** `wave`
**Fields:** `legs` (the airmass columns only)

The oracle takes the first database entry whose match key appears in the
glider-type header:

```python
for g in cand:
    for m in g["match"]:
        if m.replace("-", "").replace(" ", "") in t:
            return Polar(g["name"], g["points"]), ...
```

That makes the answer depend on the order of `polars.json`. `Discus`, with the
key `discus`, is listed before `Duo Discus`, so a Duo Discus header matches the
single-seat Discus and the `Duo Discus` entry is unreachable for anything that
could ever match it.

It is not a small difference. The Duo is a two-seater at roughly half again the
wing loading; using the single-seater's polar puts a systematic error into
every airmass and rising-air figure on the flight, and the Duo Discus is one of
the most common two-seaters in British club fleets.

**What the port does instead:** the longest matching key wins, which is
order-independent and fixes the whole class rather than this one instance.

Checked against every glider type in the database and its usual header
spellings, this changes exactly one result — `Duo Discus` and `Duo Discus XT`
now match `Duo Discus`. `Discus 2c`, `Discus b`, `Grob Twin Astir`,
`Astir CS 77`, `Nimbus 3DM`, `Ventus 2cxa`, `LAK-17a`, `JS1-C`, `K-21` and the
rest are unchanged.

`polars.json` itself is left byte-identical to the vendored copy. Reordering
the file would have fixed the Duo and left the next such pair to be found by
whoever hit it.

---

## Midnight rollover defeated by sorting before unwrapping

**Fixtures affected:** `midnight-rollover`
**Fields:** `launch`, `phase`, `wind`, `climbs`, `legs`, `profile`,
`track_distance_m` — every fix time moves, so effectively everything

B-record times are seconds since midnight UTC, so a flight crossing 00:00 wraps
from 86399 back to 0. The oracle detects this by looking for time running
backwards:

```python
fixes.sort(key=lambda f: f["t"])
# midnight rollover
for i in range(1, len(fixes)):
    if fixes[i]["t"] < fixes[i - 1]["t"] - 3600:
```

The sort on the previous line has already destroyed the evidence. After
sorting on the raw wrapped times the sequence is ascending by construction, so
the backwards step the loop is looking for can never be found. The fixes after
midnight are hoisted to the front of the flight instead.

The oracle on the `midnight-rollover` fixture, a 24-minute evening flight:

```
trace 00:00:00-23:59:59  1439:59  1425 fixes  median 1s  max gap 84976s
```

A 24-hour flight with a 23-hour gap in the middle of it. Every derived figure
downstream — the launch, the phase split, the climbs, the distance — is
computed on that reordering.

**What the port does instead:** unwraps in file order, which is the order the
detection was written for, and sorts afterwards.

```ts
let dayOffset = 0;
for (let i = 1; i < fixes.length; i++) {
  if (fixes[i].t + dayOffset < fixes[i - 1].t - 3600) dayOffset += 86400;
  fixes[i].t += dayOffset;
}
fixes.sort((p, q) => p.t - q.t);
```

The port also handles more than one rollover, where the oracle `break`s after
the first. That costs nothing and removes a second cliff; no sane trace crosses
midnight twice, but nothing depends on that being true.

On the same fixture the port gives a 1424-second flight from 23:44:01 to
00:07:45 with a maximum gap of 1 second, which is what the file contains.

---

## What is *not* divergent

Faithfully reproduced, including where it is arguably arguable:

- **Release detection is a heuristic** and often wrong when the tow ran through
  lift. The port keeps the oracle's algorithm exactly, and carries a
  `release_confident` flag so the UI can say when the release is the top of the
  initial climb rather than a detected speed change. The oracle says the same
  thing in prose.
- **Circling segmentation** — the 6°/s threshold, the 25-second minimum run and
  the four-pass absorption, including the fact that each pass iterates over a
  snapshot of the run list rather than a live one.
- **Wind from circle drift**, weighted by whole circles, including the 1.5
  circle minimum.
- **`statistics.median` on the wind-corrected airspeeds** rather than a mean.
- **Polar matching by substring** against the glider-type header, and the
  fallback to a generic 38:1 glass single-seater.
- **Density altitude out of range.** `sigma()` clamps its base at zero, so
  above about 44,330 m it returns the 0.3 floor. The oracle raises a
  `TypeError` there (Python gives a complex number for a fractional power of a
  negative), and a bare port would return `NaN` and quietly poison every
  airmass figure downstream. No fixture reaches it and no glider can; it is
  noted only so the clamp is not mistaken for a silent behaviour change.
- **Python's round-half-even** in `round(lat, 5)` for the profile coordinates,
  and in the `%.0f` formatting inside the launch note. See `src/core/pyutil.ts`.
