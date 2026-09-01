# Flight page export format

**Schema version 1.**

This document is the contract between the IGC Analyser and anything that
publishes a flight page from it. The two live in separate repositories and
deploy on their own schedules, so this file format is the only interface
between them.

**Changes to it are breaking.** See [Versioning](#versioning).

---

## The bundle

The **Download flight page bundle** button produces a zip:

```
<date>-<registration>-igc-analysis.zip
├── flight.json     every figure on the page, versioned
├── trace.svg       plan view of the track, static and themeable
└── barogram.svg    altitude against time, static and themeable
```

Entries are deflated where the browser supports `CompressionStream`, stored
otherwise. Both are ordinary ZIP; any reader handles either.

The bundle is built in the browser from a file the reader chose. Nothing is
uploaded at any point, and there is no server involved in producing it.

## Conventions

Fixed across the whole of `flight.json`, and safe to rely on:

| | |
| --- | --- |
| **Units** | SI only. Metres, seconds, metres per second, degrees. Never feet, knots or kilometres, whatever the app was displaying when the bundle was made. Field names carry the unit: `distanceM`, `durationS`, `avgClimbMs`, `fromDeg`. |
| **Times of day** | `"HH:MM:SSZ"`. Always UTC, which is what the trace contains. A flight crossing midnight keeps counting, so `endTime` can read `"01:12:04Z"` against a `startTime` of `"23:44:01Z"`. |
| **Instants** | `startInstant` / `endInstant` are full ISO-8601 in UTC, or `null` when the file had no usable `HFDTE` header. Prefer these when you need a date; fall back to `date` plus the times. |
| **Durations** | Whole seconds, as integers. |
| **Angles** | Degrees true. Wind `fromDeg` is the direction the wind is coming *from*, the way a pilot says it. |
| **Absent values** | `null`, never omitted, never `""`, never `0`. Every key documented below is always present. |
| **Numbers** | Rounded to a sensible number of decimal places for display. Nothing is `NaN` or `Infinity`. |

## `flight.json`

### `schemaVersion`

Integer. `1`. Check it before reading anything else.

### `generator`

```json
{ "name": "igc-analyser", "url": "https://igc.neale.dev/", "generatedAt": "2026-08-30T19:41:02Z" }
```

### `source`

| Field | Type | Notes |
| --- | --- | --- |
| `filename` | string \| null | The file the reader chose. |
| `loggerId` | string \| null | The `A` record: manufacturer and serial. |
| `logger` | string \| null | `HFFTY`, e.g. `"LXNAV,LX9000"`. |
| `gps` | string \| null | `HFGPS`. |
| `altitudeSource` | `"pressure"` \| `"GNSS"` | Which channel every height in this file came from. |

`altitudeSource` is worth surfacing. Many FLARM and OGN traces write zero in
the pressure column throughout, and the GNSS fallback is noisier, which
inflates short-window climb rates. Neither channel is a datum for airspace.

### `flight`

| Field | Type | Notes |
| --- | --- | --- |
| `date` | string \| null | `YYYY-MM-DD`. |
| `glider.type` | string \| null | `HFGTY`, verbatim. Often misspelled or missing; this is what the file said. |
| `glider.registration` | string \| null | `HFGID`. |
| `glider.competitionId` | string \| null | `HFCID`. |
| `pilot` | string \| null | Frequently a club name, or blank. |
| `crew2` | string \| null | Second seat. Present usually means a two-seater. |
| `startTime`, `endTime` | string | First and last fix, `HH:MM:SSZ`. |
| `startInstant`, `endInstant` | string \| null | Full ISO-8601. |
| `durationS` | integer | First fix to last. Not airborne time. |
| `trackDistanceM` | number | Distance along the track, all of it, including the tow. Not a task distance and not an OLC score. |
| `maxAltitudeM` | number | |
| `landed` | boolean | `false` means the trace stops with the glider still flying, so it is a partial log. Say so if you publish the duration. |

### `launch`

| Field | Type | Notes |
| --- | --- | --- |
| `takeoffTime` | string | |
| `releaseTime` | string | |
| `type` | string | `"aerotow"`, `"winch or bungee launch"`, `"unclear - possibly a self-launch or a partial trace"`, or `"no launch in this file - the trace appears to start airborne"`. Match on the prefix, not the whole string. |
| `note` | string | Human-readable: initial climb, duration, mean ground speed. |
| `releaseConfident` | boolean | **See below.** |
| `releaseOverridden` | boolean | **See below.** |

`releaseConfident: false` means no clean drop below tow speed was found and the
top of the initial climb was used instead. It is often wrong when the tow ran
through lift. Every figure in `phase` is measured from the release, so **a page
that quotes soaring time or the phase split when this is `false` should say the
release is an estimate.**

`releaseOverridden: true` means the release time was supplied by whoever made
the bundle rather than found in the trace. `releaseConfident` is `true` in that
case as well and cannot tell the two apart, which is why this is separate: a
time a pilot asserted and a time the trace yielded are different claims about
where the flight starts, even though both are better than a guess.

### `task`

The declared task from the file's `C` records, or `declared: false`.

| Field | Type | Notes |
| --- | --- | --- |
| `declared` | boolean | |
| `shape` | string \| null | `"triangle"`, `"out and return"`, `"quadrilateral"`, `"straight distance"`, `"N-leg closed course"`, `"N-leg task"`. |
| `closed` | boolean \| null | Finishes within 1 km of where it started. |
| `distanceM` | number \| null | Sum of the great-circle legs, **start to finish only**. This is the declared distance, not a scored one: no start line, no finish ring, no observation zones. |
| `turnpoints` | integer \| null | Turnpoints between the start and the finish. |
| `points[]` | array | `{ name, lat, lon, role }`, in declared order: the start, the turnpoints and the finish. `name` and `role` may be `null`. |
| `legs[]` | array | `{ from, to, distanceM, bearingDeg }`. `bearingDeg` is the initial great-circle track, degrees true. |
| `takeoff` | object \| null | `{ name, lat, lon }`, where the declaration carried one. |
| `landing` | object \| null | `{ name, lat, lon }`, where the declaration carried one. |
| `declaration` | object \| null | `{ description, declaredDate, declaredTime, turnpoints }` from the header that opens the `C` block. Any field may be `null`. |
| `flown` | object \| null | The trace checked against the declaration. **See below.** |

`role` is `"start"`, `"turn"` or `"finish"` - `points[]` never contains the
take-off or landing records, which are in `takeoff` and `landing` instead.
Their coordinates are the launch and expected landing site, and counting them
as turnpoints inflates the distance and adds two phantom legs. `role` is
`null` where the `C` block was too irregular to lay out by position, in which
case every point in it is treated as a scoring point.

Zero-coordinate `TAKEOFF` and `LANDING` records are dropped, as is the
declaration header that opens a `C` block.

#### `task.flown`

What the trace did about the declaration. `null` where there was no task to
check against.

| Field | Type | Notes |
| --- | --- | --- |
| `zone` | string | `"cylinder"` or `"fai-sector"`. The rule turnpoints were tested with. |
| `radiusM` | number | Cylinder radius, and the start and finish zone under both rules. |
| `complete` | boolean | **Every point reached, in order.** Check this before quoting `speedMs`. |
| `note` | string | What happened, in words. Where the sequence broke, and how close it got. |
| `startAssumed` | boolean | **`true` means no start crossing was found after release**, so the clock runs from release: `durationS` is an upper bound and `speedMs` a lower one. |
| `startTime` | string \| null | `HH:MM:SSZ`. The last exit from the start zone before the first turnpoint, never earlier than release. |
| `finishTime` | string \| null | First entry into the finish zone after the last turnpoint. `null` unless `complete`. |
| `durationS` | integer \| null | Finish minus start. |
| `speedMs` | number \| null | `task.distanceM / durationS`. |
| `turnpointsRounded`, `turnpointsDeclared` | integer | |
| `points[]` | array | `{ name, role, zone, time, closestM, closestAt }`, in course order. |

`points[].time` is when that point counted: for a turnpoint or the finish, when
its zone was first achieved; for the start, the time the clock runs from.
`null` means it was never reached, and `closestM` is then the useful figure —
the difference between a turnpoint missed by 400 m and a task abandoned on the
second leg.

**`speedMs` is not a scored speed, and `complete: true` is not a claim.** The
observation zone is an assumption made by whoever produced the bundle, not
something the IGC file carries: real start lines, start rings and finish rings
are none of the shapes offered here. There are no start height or time limits,
no airspace and no penalties. A page publishing the speed should publish `zone`
and `radiusM` with it, and should not call it a badge or ladder result.

### `phase`

Everything here is measured **after release**.

| Field | Type | Notes |
| --- | --- | --- |
| `circlingS`, `straightS`, `soaringS` | integer | |
| `circlingFraction` | number | 0 to 1. **The most useful single number in the file.** |
| `gainCirclingM` | number | Height gained in climbs. |
| `meanCirclingRateMs` | number \| null | Includes entry and centring losses, so it reads below the climb table's averages. |
| `workingBand` | `{ bottomM, topM }` \| null | Lowest climb entry to highest climb top. |
| `risingAirFraction` | number \| null | Fraction of straight flight in rising air, circuit legs excluded. Depends on `polar`. |

`circlingFraction` decides what kind of flight this was, and therefore what a
page should say about it. Above about 0.35 is a thermal day. Between 0.10 and
0.35 is streets, convergence or energy lines, where route choice matters more
than the individual climbs. Below 0.10 with sustained straight climbs is ridge
or wave — check `wind` before calling it either.

### `wind`

`null` when no climb turned enough complete circles to estimate from.

| Field | Type | Notes |
| --- | --- | --- |
| `speedMs` | number | |
| `fromDeg` | number | Degrees true, the direction it blows from. |
| `spreadMs` | number | Fastest per-climb estimate minus slowest. |
| `unreliable` | boolean | **Set when the estimates disagree by more than 8 kt.** |
| `levels` | integer | Distinct heights the wind profile rests on. **See below.** |
| `perClimb[]` | array | `{ time, altM, speedMs, fromDeg, circles }`. |

Wind comes from the drift of whole circles. `circles` on each estimate is how
many it had to work with; below about 1.5 the glider was S-turning, not
circling. **If `unreliable` is `true`, do not publish the wind without saying
it is uncertain**, and do not build an argument on it.

`altM` is the middle of the climb the estimate came from. Two estimates that
disagree at different heights are a gradient rather than noise, which is part
of why `unreliable` is a blunt flag: the wind is not the same at the bottom of
the working band as at the top.

`levels` is how many heights survived the filters used to build the profile -
estimates within 150 m of each other count once, and estimates under 2.5 whole
circles are left out. `levels >= 2` means every airspeed and airmass figure in
this file used the wind at the height its fix was flown at, interpolated
between those heights and held flat above the highest climb and below the
lowest. `0` or `1` means there was nothing to interpolate and `speedMs` /
`fromDeg` were used everywhere, so a leg well above or below the climbs was
corrected with a wind that was not measured there.

### `climbs[]`

One entry per circling climb after release, in order.

| Field | Type | Notes |
| --- | --- | --- |
| `index` | integer | 1-based. |
| `startTime`, `endTime` | string | |
| `durationS` | integer | |
| `gainM` | number | |
| `altBottomM`, `altTopM` | number | |
| `avgClimbMs` | number | Over the whole climb. |
| `best30sMs` | number \| null | Best sustained 30 seconds. |
| `circles` | number | Fractional. |
| `direction` | `"left"` \| `"right"` | |
| `circleTimeS`, `radiusM`, `bankDeg` | number \| null | **Null below 1.5 circles.** |
| `airspeedKmh` | number | Wind-corrected. |
| `perCircle[]` | array | `{ index, startTime, durationS, gainM, climbMs, altM }`. |

The geometry is derived from accumulated heading change and wind-corrected
airspeed, so it is an average across the whole climb rather than a snapshot.
Below 1.5 circles it would describe something that did not happen, so the three
geometry fields are `null` — render them as blank, not as zero.

`avgClimbMs` well below `best30sMs` means time was lost entering, centring, or
leaving late. The `perCircle` sequence says which: improving is good centring,
decaying near the top of the band is usually the thermal dying rather than the
pilot losing it, and oscillating suggests the core was never found.

### `legs[]`

One entry per straight leg over a minute, after release.

| Field | Type | Notes |
| --- | --- | --- |
| `startTime`, `endTime` | string | |
| `durationS` | integer | |
| `distanceM` | number | |
| `heightChangeM` | number | Negative for a descent. |
| `altStartM`, `altEndM` | number | |
| `ldOverGround` | number \| null | Distance over height lost. **Not wind-corrected.** Null if the leg climbed. |
| `meanIasKmh`, `sdIasKmh` | number \| null | |
| `meanAirmassMs` | number \| null | **See below.** |
| `fracRisingAir` | number \| null | 0 to 1. |
| `kind` | string | `"cruise"`, `"final glide"` or `"circuit"`. An open set: match on the values you know and treat the rest as a cruise. |
| `circuit` | boolean | `kind === "circuit"`. Part of the landing circuit; excluded from `risingAirFraction`. |

The last straight run of a flight that landed reaches from the top of the last
glide to the ground, so reported whole it is a final glide and a circuit in one
row - on a 300 km flight, a "landing" twenty minutes long. It is cut and the
two halves are reported separately. Where the declared task was finished the
cut is at the finish, which is where the glide was actually aimed; otherwise it
is where the glider settled below 300 m above the landing field. A finish
crossed low happens after the glider is already below circuit height, and in
that case the finish still wins: nothing before it is the circuit. Only the
circuit half is excluded from `risingAirFraction`: a final glide samples the
air like any other leg.

`meanAirmassMs` is the vertical motion of the air the glider flew through:
measured height change minus polar sink for the speed and density it was flown
at. It is the most useful column here for a line-running flight, and it is
**only as good as `polar`**.

`sdIasKmh` under about 10 km/h is a steady cruise. A large value is either
dolphin flying or inattention, and `fracRisingAir` says which.

### `polar`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string \| null | `null` when the polar was disabled. |
| `note` | string | How it was arrived at, in words. |
| `matched` | boolean | **`false` means no glider was recognised and a generic was assumed.** |
| `bestLd` | number \| null | |
| `bestLdSpeedMs` | number \| null | |
| `minSinkMs` | number \| null | Where the fitted curve puts minimum sink. |
| `referenceLoadingKgM2` | number \| null | The wing loading the published curve is for. `null` for a custom or disabled polar. |
| `loadingKgM2` | number \| null | The loading the curve was scaled to. `null` means it was used as published. |

> **`meanAirmassMs`, `fracRisingAir`, `risingAirFraction` and `ldOverGround`
> must never be published without `polar.note` alongside them.**

The polars are indicative values at the stated wing loading, dry, not
manufacturer-certified figures. `matched: false` means the number rests on a
guess at what was flying.

Wing loading is the largest assumption left in any airmass figure, which is why
it is two fields rather than a sentence in `note`. Water or a heavy pilot moves
the curve further than the choice between two plausible polars does: a glider at
45 kg/m² against a published 34 flies every point of its polar 15% faster for
15% more sink. `loadingKgM2: null` means nobody said, so the published loading
was used — a page quoting airmass from a flight that might have been ballasted
should say as much.

### `quality`

| Field | Type | Notes |
| --- | --- | --- |
| `fixes` | integer | |
| `medianIntervalS` | number | |
| `maxGapS` | number | |
| `gapsOver20s` | integer | |
| `gapTotalS` | number | |
| `coarse` | boolean | **Median interval over 4 s.** |
| `warnings[]` | string[] | Free text from the parser, e.g. an I record that disagrees with its own B records. |

`coarse: true` means the fix rate cannot support circle geometry as a
measurement, and centring inside a circle cannot be seen at all. **A page
showing `circleTimeS`, `radiusM` or `bankDeg` when this is set should say so
once, above them.**

### `figures`

```json
{
  "trace": "trace.svg",
  "barogram": "barogram.svg",
  "renderedUnits": "imperial",
  "barogramHeightUnit": "ft"
}
```

The SVGs are rendered in whatever the app was displaying. `flight.json` is SI
regardless, so if you need the figures to match your page's units, set them in
the app before exporting.

### `profile` (optional)

Present only when explicitly requested; the button does not include it. An
array of `[t, altM, lat, lon, circling]` rows, with `profileColumns` naming
them. `t` is seconds since midnight UTC, `circling` is `0` or `1`.

---

## The SVG figures

Both files are:

- **Static.** No `<script>`, no animation, no interaction. Everything the app
  adds for brushing and hovering is stripped.
- **Self-contained.** No external references of any kind: no fonts, no images,
  no stylesheets. They render correctly opened on their own.
- **Sized.** `width`, `height` and `viewBox` are all set. The `viewBox` is cut
  to the content, so `trace.svg` for a long out-and-back is tall and narrow
  rather than a thin line in a wide empty box.
- **Described.** `<title>` and `<desc>`, and `role="img"` with an `aria-label`.

### Theming

Every colour is a CSS custom property with a fallback:

```css
.baro-circling { stroke: var(--igc-circling, #c2571a); }
```

Nothing inside the SVG defines those properties, so a host page can set them on
any ancestor and they inherit in.

| Property | Used for |
| --- | --- |
| `--igc-circling` | Circling, in both figures |
| `--igc-straight` | Straight flight, in both figures |
| `--igc-rule` | Grid lines |
| `--igc-faint` | Axis labels, task, north arrow, markers |
| `--igc-dim` | Scale bar |
| `--igc-fg`, `--igc-bg` | The release marker's stroke and fill |
| `--igc-ok` | Start marker |
| `--igc-sink` | Landing marker |
| `--igc-vz-0` … `--igc-vz-6` | Climb-rate bands, lowest to highest, when the track is coloured by climb rate |

> **Theming only works when the SVG is inlined into the host document.**
> CSS custom properties do not cross into an `<img src>` or an
> `<object data>`: those load as separate documents and will always render with
> the fallback colours. Inline the file's markup — which is what a Hugo
> shortcode reading this bundle should do anyway, since it also wants the
> figure to scale and to be styled with the rest of the page.

---

## Consuming it

```js
const flight = JSON.parse(await fs.readFile('flight.json', 'utf8'));
if (flight.schemaVersion !== 1) throw new Error(`unsupported schema ${flight.schemaVersion}`);

const km = (m) => (m / 1000).toFixed(0);
const ft = (m) => Math.round(m * 3.280840).toLocaleString('en-GB');

console.log(`${flight.flight.glider.type} · ${flight.flight.glider.registration}`);
console.log(`${flight.task.distanceM ? `${km(flight.task.distanceM)} km ${flight.task.shape}` : 'no declared task'}`);
console.log(`${km(flight.flight.trackDistanceM)} km flown, max ${ft(flight.flight.maxAltitudeM)} ft`);
```

### Worked example: a badge flight page

The existing hand-built 303 km page on neale.dev is the target this format has
to be able to reproduce. Every part of it comes from somewhere:

| On the page | From |
| --- | --- |
| Usk · Worcester · Lake Vyrnwy · Usk | `task.points[].name` |
| 303 km triangle | `task.distanceM`, `task.shape` |
| 19 JUL 2026 | `flight.date` |
| PIK-20D · G-DDLY | `flight.glider.type`, `flight.glider.registration` |
| Distance flown 518 km | `flight.trackDistanceM` |
| Max altitude 2,102 m | `flight.maxAltitudeM` |
| 4h 58m · 11:05Z – 16:03Z | `flight.durationS`, `flight.startTime`, `flight.endTime` |
| The trace, with the declared task dashed over it | `trace.svg`, inlined |
| The barogram | `barogram.svg`, inlined |

Everything the page shows is covered. The bundle also carries the climbs, the
legs, the wind and the phase split, which that page does not use — a later one
can, without a new format.

---

## Versioning

`schemaVersion` is a single integer. It goes up when a change would break a
consumer that was written against the previous version:

- removing a field, or renaming one
- changing a field's type, unit, or meaning
- narrowing what a field can contain

It does **not** go up for a new optional field, or a new value in a
documented open set such as `launch.type` or `task.shape` — match those on a
prefix or handle the default, rather than exhaustively.

Consumers should check `schemaVersion` and refuse anything they do not know,
rather than reading a future bundle on the assumption it is compatible.
