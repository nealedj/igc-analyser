# Reading the numbers

Reference for turning `igc_analyse.py` output into a useful debrief. Read this
before writing the analysis, not before running the script.

## Contents
1. What the flight actually was
2. Circle geometry
3. Climb quality and centring
4. Leaving decisions
5. Straight flight and the airmass figures
6. Wind
7. Height band
8. Two-seaters and instructional flights
9. Things the numbers cannot tell you

---

## 1. What the flight actually was

Look at the phase split before anything else, because it determines what kind
of debrief is useful.

- **Circling above ~35% of soaring time**: a thermal day. Climb rates, centring
  and circle geometry are the story.
- **Circling 10-25%**: streets, convergence, or energy lines. The story is
  route choice and when *not* to circle. Analysing the few climbs in isolation
  will miss the point of the flight.
- **Circling under 10% with sustained straight climbs**: ridge or wave. Check
  the wind estimate. Strong wind plus straight climbs at height means wave;
  light wind plus straight climbs means convergence or a street. Ridge shows as
  repeated straight beats at similar altitude close to terrain.

Say which of these it is early in the debrief. A pilot asking "how was their
thermalling" on a wave flight needs to be told that the question doesn't quite
fit the flight, kindly and with the evidence.

## 2. Circle geometry

`t/360`, `bank` and `radius` come from the accumulated heading change and the
wind-corrected airspeed, so they are averages across the whole climb, not a
snapshot.

Typical thermalling for a glass glider at normal weights:

| | circle time | bank | radius |
|---|---|---|---|
| tight core work, low down | 18-22 s | 40-45° | 70-100 m |
| normal | 20-26 s | 35-40° | 90-130 m |
| broad smooth lift, high up | 30-45 s | 20-28° | 150-220 m |
| too flat to core anything narrow | 50 s+ | under 15° | 250 m+ |

A wide flat circle is not automatically bad. In smooth broad lift it is
correct, and the climb rate column will confirm it was working. A wide flat
circle with a poor climb rate is the diagnostic combination worth mentioning.

Fewer than about 1.5 circles means the geometry figures are unreliable — the
glider was S-turning or making a single correction, not circling. The script
still prints a row; say so rather than treating it as a climb.

## 3. Climb quality and centring

Compare three numbers per climb: `avg`, `best30`, and the per-circle sequence.

- `avg` well below `best30` means time was lost entering or centring, or the
  climb was left late as it decayed. Both are normal; the per-circle rows say
  which.
- A per-circle sequence that **improves** (e.g. +3.3, +4.0, +4.1 kt) is good
  centring: the pilot found the core and stayed with it.
- A sequence that **decays** near the top of the band usually means the thermal
  is dying out or hitting an inversion, not that the pilot lost it.
- A sequence that **oscillates** suggests the core was never found; the pilot
  was circling next to it.

The `centre moved` figure between circles is drift. If it matches the wind
estimate, the pilot was drifting with the thermal, which is correct. Drift much
larger than the wind means they were deliberately moving the circle — either
searching, or chasing a core that was leaning.

## 4. Leaving decisions

This is often the most instructive part of a good flight and is easy to miss.

For each climb, compare the rate in the last circle against what the straight
legs either side were delivering (`airmass` column). Leaving a 2 kt climb is
correct when the line ahead is giving +1 kt of airmass while also making
100 km/h of progress, because circling makes no progress at all. Point out the
arithmetic rather than just praising the decision.

Also look for climbs that were entered and abandoned within a circle. Two or
three of those in a row is a pilot who was unwilling to commit, which usually
costs more than it saves.

## 5. Straight flight and the airmass figures

The `airmass` column is the vertical motion of the air the glider flew
through — measured height change minus the polar sink for the speed and
density. It is the single most useful column for line-running flights.

Caveats to state whenever you quote it:
- It depends entirely on the assumed polar. A club glider flying heavy, with
  bugs, or with water, will read low. The script prints which polar it used.
- It uses the flight-mean wind to convert ground speed to airspeed. If the wind
  estimate is poor, or the wind changed during the flight, the speeds and hence
  the sink correction are off. Crosswind legs are worst affected.
- `L/D gnd` is the raw ratio of distance to height lost. It is not corrected for
  wind. A figure well above the glider's best L/D is real evidence of energy
  gained from the air (a tailwind alone rarely explains a large excess), and a
  ratio above roughly 100:1 usually means the leg was essentially level flight
  in lift.

`sd` is the standard deviation of indicated airspeed on the leg. A small value
(under about 10 km/h) means a steady cruise speed; a large value means the pilot
was varying speed, which on a good day is dolphin flying and on a bad day is
inattention. Combine it with `rising` — varying speed while spending most of
the leg in rising air is deliberate.

## 6. Wind

Wind comes from the mean drift over whole circles. It needs at least a couple
of complete circles to mean anything, and the script says how many each estimate
used. If per-climb estimates disagree by more than about 8 kt, the estimate is
noise: say so and do not build an argument on it.

Light and variable wind rules out wave. Strong wind with straight climbs at
height supports it.

## 7. Height band

`working band` is the lowest climb entry to the highest climb top. A narrow band
worked consistently is disciplined flying. One deep excursion below the band
followed immediately by a climb is a save, and worth calling out. Repeated
excursions low mean the pilot was behind the day.

## 8. Two-seaters and instructional flights

If the glider type is a two-seat trainer, the flight may be an instructional
one, possibly with the student handling. Don't attribute technique to a single
pilot with confidence, and avoid framing a debrief as criticism of a named
person. The header pilot field is often a club name or blank anyway.

## 9. Things the numbers cannot tell you

Be explicit about these rather than papering over them:

- **Sub-circle detail.** Anything coarser than about 2 s between fixes cannot
  show where in the circle the lift was, so real centring analysis is out of
  reach. Say this once, plainly.
- **Total energy.** Most traces have no vario; vertical speed is differentiated
  altitude, so it lags and includes stick thermals.
- **Why.** The trace shows what the glider did, never what the pilot could see —
  cloud, other gliders, birds, airspace, the state of the day ahead.
- **Release time**, when the tow ran through lift. The script flags its estimate
  as a heuristic; treat it as one.
- **Airspace and rules.** Do not infer infringements from GPS altitude, which is
  not what airspace is measured against.
