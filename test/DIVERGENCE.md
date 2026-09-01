# Deliberate divergence from the Python oracle

`reference/igc_analyse.py` is the specification for this port, and the golden
fixtures are its output. Everything must match it to within float drift.

Some things do not, on purpose. They are defects in the oracle that the port
fixes rather than reproduces, because reproducing them would put visibly wrong
output in front of a pilot.

They come in two kinds, and the difference matters:

- **Registered divergences.** The port's output differs and the golden fixture
  is allowed to differ with it. Each is registered in `test/divergence.ts` so
  the tests know exactly which fields may move, and only those.
- **Neutralised divergences.** The algorithm is the same but the *inputs* or
  the *segmentation* differ, so `golden.test.ts` hands the port the oracle's
  version - `analyse(text, { polarDb: ORACLE_POLARS, splitCircuit: false,
  windProfile: false })` - and the comparison stays exact to the last decimal. Writing off `legs` on
  every fixture as expected drift would have cost far more than it bought. The
  shipped behaviour is covered by `test/legs.test.ts` and `test/unit.test.ts`
  instead.

If you change any of this, change the registry, the tests and this file
together.

---

## C-record declaration header parsed as a task point

**Fixtures affected:** `thermal-day`, `declared-300k` (and any real trace with
a declared task)
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

### And the records either side of the task

The port also labels each record with the role its position in the block gives
it - `takeoff`, `start`, `turn`, `finish`, `landing` - using the turnpoint
count in the header, or the names where the header is too short to carry one.
This is an addition rather than a divergence: `task` still contains every
record the oracle keeps, in the same order, with a `role` key the oracle has no
equivalent of.

It matters for everything downstream. A declaration with real take-off and
landing coordinates has two records that are not the task, and counting them
turns a 300 km triangle into a five-leg course by way of the launch point, with
two phantom legs drawn across the plan view. The oracle prints the names and
stops, so it never had to decide; this app draws the task, sums it and publishes
the total, so it does.

`declared-300k` is the fixture for it: a spec-shaped block of header, take-off,
start, two turnpoints, finish and landing, declaring 300.3 km.

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

Reordering the database would have fixed the Duo and left the next such pair to
be found by whoever hit it, so the matching rule is what changed. The shipped
database has since been regenerated for a different reason - see *Neutralised:
the polar database is corrected*, below - but the ordering bug is in the
matching, not the file, and it is still there in the oracle's copy.

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

## Neutralised: the polar database is corrected

**Fixtures affected:** all of them, via `legs`
**Neutralised by:** `analyse(text, { polarDb: ORACLE_POLARS })` in the golden tests

`reference/polars.json` fits each glider's curve through three points that were
chosen by eye, and they do not reproduce the glider they name. Best glide comes
out around 15% optimistic across the whole file:

| | file | published |
| --- | --- | --- |
| PIK-20D | 47.3:1 | 41:1 |
| Standard Cirrus | 43.1:1 | 36.5:1 |
| LS4 | 46.5:1 | 40.5:1 |
| ASW 20 | 48.6:1 | 42.5:1 |
| Nimbus | 71.0:1 | 57:1 |

That number is printed on the page - "that assumes best glide near 47:1" - so
the error was visible, and every airmass figure below it is measured against
the same curve: too flat a polar subtracts too little sink and reads the air as
better than it was.

**What the port does instead:** `src/data/polars.json` is generated by
`test/tools/make-polars.ts` from published figures, so each curve reproduces the
glider on the label. `npm test` re-derives every entry and fails on one that has
drifted from its own `published` block.

Each curve is anchored at two published places: best glide, and a point out at
cruise speed. One anchor is not enough. Best glide gives two constraints - the
ratio, and the tangent from the origin touching there - and a quadratic has
three coefficients, so the third used to come from an assumption: that minimum
sink sits at 0.75 of best-glide speed for every glider. That assumption sets the
curvature, curvature is what high-speed sink is made of, and measured against
published polars for these types the result ran about 13% low above 150 km/h and
as much as 41% low. Always low, and low reads the air as better than it was, on
exactly the fast final glides where somebody would care. With the second anchor
the same comparison comes out around 4% with no bias.

`Polar` fits a cubic where four points are given, which is the right thing for a
custom polar taken off a measured curve. Deriving one here is not: a cubic needs
a fourth constraint, the only ones available are published minimum sink and its
slope, and pinning all four onto a cubic makes it bend hard between the anchors
and run away outside them - negative sink at low speed, or unbounded above
200 km/h, on eleven of the sixteen types that could be checked. The quadratic
was never the problem.

A quadratic still cannot hold both a 57:1 best glide and a 0.45 m/s minimum
sink: that would put minimum sink at 68 km/h, below the speed the glider flies
at. Real open-class polars are peakier than a parabola. For those two entries
minimum sink reads about 20% high, they are named in `POLAR_PEAKY` in
`test/polar-model.test.ts` so a new entry cannot join them quietly, and the
cruise range is right for all of them. `make-polars.ts` explains the arithmetic.

`reference/polars.json` is left exactly as vendored: it is the oracle's input,
not ours, and the golden tests feed it to the port so the comparison is the
algorithm rather than the data.

---

## Neutralised: the final glide is split from the circuit

**Fixtures affected:** every fixture that lands, via `legs`
**Neutralised by:** `analyse(text, { splitCircuit: false })` in the golden tests

A flight that lands ends in one unbroken stretch of straight flight, from the
top of the last glide all the way to the ground. The oracle labels a leg a
circuit if it *ends* near the landing height:

```python
L["circuit"] = landed and F[b]["alt"] < land_alt + 250
```

Which makes the whole of that stretch the circuit. On the `wave` fixture that
is a 35-minute "circuit" from 3,774 m; on a 300 km flight it is a landing
twenty-four minutes long, most of it final glide. It is also the wrong shape:
averaging the glide home together with the approach buries the one figure worth
having, the L/D and airmass of the glide.

**What the port does instead:** cuts the run at circuit entry - the first fix
of the final descent below 300 m above the landing field, staying below to the
end - and reports the two halves as `final glide` and `circuit`. A leg is only
a final glide if it was gliding home: down more than 300 m at half a metre a
second or better, so a ridge beat that finishes the day 400 m lower is not one.
Only the circuit is excluded from the rising-air figure; a final glide samples
the day like any other leg.

The cut is skipped where either half would come out under the minute a leg has
to run for, and a trace that never lands has no circuit at all.

---

## Neutralised: the wind is interpolated with height

**Fixtures affected:** every fixture with more than one climb, via `climbs`
and `legs`
**Neutralised by:** `analyse(text, { windProfile: false })` in the golden tests

The oracle estimates the wind from circle drift, weights the per-climb
estimates by whole circles, averages them into one vector, and then subtracts
that one vector from every fix in the flight:

```python
W = sum(e["circles"] for e in ests)
wx = sum(e["vx"] * e["circles"] for e in ests) / W
wy = sum(e["vy"] * e["circles"] for e in ests) / W
```

The per-climb estimates are right there and they disagree, which the oracle
notices - it prints them, and warns when they disagree by more than 8 knots -
and then averages them anyway. But most of that disagreement is not noise. Wind
veers and picks up through the working band, so a climb at 600 m and a climb at
1,800 m are measuring different air and are *supposed* to differ.

Averaging them costs twice. Every leg gets a wind that is too strong for the
bottom of the band and too weak for the top, and the error does not cancel: on
a crosswind leg it goes straight into the airspeed, which is why the leg table
has always carried "crosswind legs are worst affected" as a caveat.

**What the port does instead:** each estimate keeps the height it came from -
the middle of the climb that produced it - and the wind is interpolated between
them, linearly and as components rather than as a bearing. Everything that
subtracts wind asks for it at the height of the fix it is working on: the leg
airspeeds, the leg airmass balance, and the wind-corrected airspeed behind
circle radius and bank.

Three guards, because a gradient invented out of noise would be worse than the
average it replaced:

- Estimates with fewer than 2.5 whole circles are left out. The flight-mean
  vector dilutes a thin estimate by weighting on circles; a profile would run
  through it at full strength.
- Estimates within 150 m of each other in height are merged, weighted by
  circles. Two climbs in the same part of the band are two samples of one wind,
  and left apart a small disagreement between them becomes a near-vertical step
  in the profile.
- Outside the range of heights that were measured, the wind is held flat rather
  than extrapolated. That covers the tow, the final glide and the circuit -
  the parts of the flight there is no evidence about.

Where fewer than two heights survive those guards there is nothing to
interpolate, and the flight-mean vector is used exactly as before.
`result.wind_levels` says how many heights the profile rests on, so the page
can say whether it is doing anything at all, and `flight.json` carries it.

`wind` itself is unchanged: the reported flight-mean vector, its direction and
the `unreliable` flag are all still the oracle's, which is why only `climbs`
and `legs` move.

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
  circle minimum, and the reported flight-mean vector that comes out of it.
  Only where that vector gets *applied* does the port differ - see
  *Neutralised: the wind is interpolated with height*.
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
