#!/usr/bin/env python3
"""Analyse a glider IGC flight log: phases, climbs, circle geometry, wind,
and the energy balance of straight-flight legs.

Everything is derived from the B-record positions and times. Logger extension
fields (GSP/TRT/VAT) are deliberately ignored for the maths because their
declared column offsets are frequently wrong; they are only cross-checked.

Usage:
    python igc_analyse.py FLIGHT.igc [options]

Options:
    --units imperial|metric   default imperial (ft, kt, km, km/h)
    --polar NAME              force a polar by name/substring, or "none"
    --polar-points "v1,s1;v2,s2;v3,s3"   custom polar (IAS km/h, sink m/s)
    --json OUT.json           write full machine-readable results
    --min-circle-rate DEG     turn-rate threshold for circling (default 6)
"""

import argparse
import json
import math
import os
import statistics as st
import sys

R_EARTH = 6371000.0
G = 9.80665
KT = 1.943844          # m/s -> kt
FT = 3.280840          # m -> ft
HERE = os.path.dirname(os.path.abspath(__file__))


# ----------------------------------------------------------------- parsing

def parse_igc(path):
    """Return (header dict, list of fixes, list of task points, warnings)."""
    hdr, fixes, task, warn = {}, [], [], []
    ext_decl = None
    raw = open(path, "r", errors="replace").read().splitlines()

    def h(line, key):
        # H records come as HFxxx<LONGNAME>:value or HFxxxvalue
        body = line[5:]
        return body.split(":", 1)[1].strip() if ":" in body else body.strip()

    for line in raw:
        if not line:
            continue
        c = line[0].upper()
        if c == "H":
            up = line.upper()
            if up.startswith("HFDTE"):
                d = "".join(ch for ch in line[5:] if ch.isdigit())[:6]
                if len(d) == 6:
                    hdr["date"] = f"20{d[4:6]}-{d[2:4]}-{d[0:2]}"
            elif up.startswith("HFGTY"):
                hdr["glider_type"] = h(line, "gty")
            elif up.startswith("HFGID"):
                hdr["glider_id"] = h(line, "gid")
            elif up.startswith("HFCID"):
                hdr["competition_id"] = h(line, "cid")
            elif up.startswith("HFPLT"):
                hdr["pilot"] = h(line, "plt")
            elif up.startswith("HFCM2"):
                hdr["crew2"] = h(line, "cm2")
            elif up.startswith("HFFTY"):
                hdr["logger"] = h(line, "fty")
            elif up.startswith("HFGPS"):
                hdr["gps"] = h(line, "gps")
            elif up.startswith("HFTZN"):
                hdr["timezone"] = h(line, "tzn")
        elif c == "A" and "logger_id" not in hdr:
            hdr["logger_id"] = line[1:].strip()
        elif c == "I":
            ext_decl = line.strip()
        elif c == "C":
            if len(line) >= 18 and line[1:3].isdigit():
                try:
                    lat = dm(line[1:8], 2, line[8])
                    lon = dm(line[9:17], 3, line[17])
                    if abs(lat) > 0.001 or abs(lon) > 0.001:
                        task.append({"lat": lat, "lon": lon,
                                     "name": line[18:].strip()})
                except ValueError:
                    pass
        elif c == "B":
            f = parse_b(line)
            if f:
                fixes.append(f)

    if not fixes:
        raise SystemExit("no usable B records found - is this an IGC file?")

    fixes.sort(key=lambda f: f["t"])
    # midnight rollover
    for i in range(1, len(fixes)):
        if fixes[i]["t"] < fixes[i - 1]["t"] - 3600:
            for j in range(i, len(fixes)):
                fixes[j]["t"] += 86400
            break

    if ext_decl:
        try:
            n = int(ext_decl[1:3])
            declared_end = max(int(ext_decl[3 + 7 * k + 2:3 + 7 * k + 4])
                               for k in range(n))
            actual = max(len(l) for l in raw if l.startswith("B"))
            if declared_end != actual:
                warn.append(
                    f"I-record declares extensions out to column {declared_end} "
                    f"but B records are {actual} characters - logger extension "
                    f"fields (speed/vario) are unreliable in this file. All "
                    f"figures below are derived from positions and times.")
        except (ValueError, IndexError):
            pass
    return hdr, fixes, task, warn


def dm(s, ddigits, hemi):
    """IGC DDMMmmm -> decimal degrees."""
    deg = int(s[:ddigits])
    minutes = float(s[ddigits:ddigits + 2] + "." + s[ddigits + 2:ddigits + 5])
    v = deg + minutes / 60.0
    return -v if hemi in "SW" else v


def parse_b(line):
    if len(line) < 35:
        return None
    try:
        t = int(line[1:3]) * 3600 + int(line[3:5]) * 60 + int(line[5:7])
        lat = dm(line[7:14], 2, line[14])
        lon = dm(line[15:23], 3, line[23])
        palt = int(line[25:30])
        galt = int(line[30:35])
    except ValueError:
        return None
    if abs(lat) < 0.0001 and abs(lon) < 0.0001:
        return None
    return {"t": t, "lat": lat, "lon": lon, "palt": palt, "galt": galt,
            "valid": line[24].upper() == "A"}


def choose_altitude(fixes):
    """Pressure altitude is smoother; fall back to GNSS if it is dead."""
    p = [f["palt"] for f in fixes]
    g = [f["galt"] for f in fixes]
    p_ok = (max(p) - min(p) > 100) and -500 < min(p) < 15000
    src = "pressure" if p_ok else "GNSS"
    for f in fixes:
        f["alt"] = f["palt"] if p_ok else f["galt"]
    return src


# ------------------------------------------------------------- kinematics

def add_kinematics(F, max_gap=12):
    lat0 = st.mean(f["lat"] for f in F)
    lon0 = st.mean(f["lon"] for f in F)
    cosl = math.cos(math.radians(lat0))
    for f in F:
        f["x"] = math.radians(f["lon"] - lon0) * R_EARTH * cosl
        f["y"] = math.radians(f["lat"] - lat0) * R_EARTH
    for i, f in enumerate(F):
        f["dt"] = F[i + 1]["t"] - f["t"] if i < len(F) - 1 else 0
        if 0 < f["dt"]:
            f["dx"] = F[i + 1]["x"] - f["x"]
            f["dy"] = F[i + 1]["y"] - f["y"]
            f["step"] = math.hypot(f["dx"], f["dy"])
            f["vx"], f["vy"] = f["dx"] / f["dt"], f["dy"] / f["dt"]
            f["gs"] = f["step"] / f["dt"]
            f["vz"] = (F[i + 1]["alt"] - f["alt"]) / f["dt"]
        else:
            f["dx"] = f["dy"] = f["step"] = f["vx"] = f["vy"] = 0.0
            f["gs"] = f["vz"] = 0.0
        f["good"] = 0 < f["dt"] <= max_gap
    # track from neighbours either side (less noisy than single step)
    for i, f in enumerate(F):
        if 0 < i < len(F) - 1:
            f["trk"] = math.degrees(math.atan2(F[i + 1]["x"] - F[i - 1]["x"],
                                               F[i + 1]["y"] - F[i - 1]["y"])) % 360
        else:
            f["trk"] = None
    for i, f in enumerate(F):
        f["tr"] = None
        if f["trk"] is not None and i < len(F) - 1 and F[i + 1]["trk"] is not None \
                and 0 < f["dt"] <= max_gap:
            f["tr"] = wrap(F[i + 1]["trk"] - f["trk"]) / f["dt"]
    for i, f in enumerate(F):
        w = [F[j]["tr"] for j in range(max(0, i - 5), min(len(F), i + 6))
             if F[j]["tr"] is not None and abs(F[j]["t"] - f["t"]) <= 10]
        f["trs"] = st.mean(w) if w else 0.0


def wrap(a):
    return (a + 180) % 360 - 180


# ------------------------------------------------------------ segmentation

def segment(F, rate_thresh=6.0, min_run=25):
    for f in F:
        f["circ"] = abs(f["trs"]) > rate_thresh
    for _ in range(4):
        changed = False
        for a, b, c in runs(F):
            if F[b]["t"] - F[a]["t"] < min_run:
                for j in range(a, b + 1):
                    F[j]["circ"] = not c
                changed = True
        if not changed:
            break
    return runs(F)


def runs(F):
    out, s = [], 0
    for i in range(1, len(F) + 1):
        if i == len(F) or F[i]["circ"] != F[s]["circ"]:
            out.append((s, i - 1, F[s]["circ"]))
            s = i
        i += 0
    return out


def find_launch(F):
    """Return (takeoff idx, release idx, launch type, note, confident?).

    Release detection is genuinely hard: on a good day the tow speed and the
    post-release cruise speed overlap. When nothing clean is found the top of
    the initial continuous climb is used instead and confident=False, which the
    report flags so the reader can override it with --release.
    """
    to = 0
    for i, f in enumerate(F):
        if f["gs"] * 3.6 > 25 and f["good"]:
            to = i
            break
    # if the trace starts on the ground, back up to the first fix
    if to > 0 and F[0]["alt"] < F[to]["alt"] - 30:
        to = 0
    # initial continuous climb
    top = to
    best = F[to]["alt"]
    for i in range(to, len(F)):
        if F[i]["alt"] >= best:
            best, top = F[i]["alt"], i
        elif F[i]["alt"] < best - 60:
            break
    dur = F[top]["t"] - F[to]["t"]
    gain = F[top]["alt"] - F[to]["alt"]
    spd = [f["gs"] * 3.6 for f in F[to:top] if f["good"]]
    mspd = st.mean(spd) if spd else 0
    if gain < 50:
        typ = "no launch in this file - the trace appears to start airborne"
    elif dur <= 100 and gain > 100:
        typ = "winch or bungee launch"
    elif 90 <= mspd <= 155 and dur > 100:
        typ = "aerotow"
    else:
        typ = "unclear - possibly a self-launch or a partial trace"
    # release: first sustained drop below tow speed
    rel, confident = None, False
    if typ == "aerotow":
        for i in range(to + 5, min(top + 40, len(F) - 3)):
            if not F[i]["good"]:
                continue
            nxt = [f["gs"] * 3.6 for f in F[i:i + 8] if f["good"]]
            if nxt and len(nxt) >= 4 and st.mean(nxt) < mspd - 15:
                rel, confident = i, True
                break
    if rel is None:
        rel = top
    note = (f"initial climb {gain * FT:.0f} ft in {int(dur) // 60}m"
            f"{int(dur) % 60:02d}s at {mspd:.0f} km/h mean ground speed")
    return to, rel, typ, note, confident


# ----------------------------------------------------------------- climbs

def circle_stats(F, a, b, wind=None):
    """Geometry of a circling segment. wind=(wx,wy) m/s if known."""
    seg = F[a:b + 1]
    dur = seg[-1]["t"] - seg[0]["t"]
    turned = 0.0
    for i in range(len(seg) - 1):
        if seg[i]["trk"] is not None and seg[i + 1]["trk"] is not None \
                and seg[i]["good"]:
            turned += wrap(seg[i + 1]["trk"] - seg[i]["trk"])
    circles = abs(turned) / 360.0
    T = sum(f["dt"] for f in seg[:-1] if f["good"]) or 1
    if wind is None:
        wx = sum(f["vx"] * f["dt"] for f in seg[:-1] if f["good"]) / T
        wy = sum(f["vy"] * f["dt"] for f in seg[:-1] if f["good"]) / T
    else:
        wx, wy = wind
    air = [math.hypot(f["vx"] - wx, f["vy"] - wy) for f in seg[:-1] if f["good"]]
    va = st.median(air) if air else 0.0
    rate = abs(turned) / dur if dur else 0.0            # deg/s
    ct = 360.0 / rate if rate > 0.5 else None
    rad = va / math.radians(rate) if rate > 0.5 else None
    bank = math.degrees(math.atan(va * math.radians(rate) / G)) if rate > 0.5 else None
    return {
        "start": seg[0]["t"], "end": seg[-1]["t"], "duration_s": dur,
        "gain_m": seg[-1]["alt"] - seg[0]["alt"],
        "alt_bottom_m": seg[0]["alt"], "alt_top_m": seg[-1]["alt"],
        "avg_climb_ms": (seg[-1]["alt"] - seg[0]["alt"]) / dur if dur else 0.0,
        "circles": circles, "direction": "right" if turned > 0 else "left",
        "circle_time_s": ct, "radius_m": rad, "bank_deg": bank,
        "airspeed_kmh": va * 3.6, "turn_rate_deg_s": rate,
        "drift_vx": wx, "drift_vy": wy,
    }


def per_circle(F, a, b):
    """Split a circling segment into individual 360s: climb rate and centre."""
    seg = F[a:b + 1]
    out, acc, start = [], 0.0, 0
    for i in range(len(seg) - 1):
        if seg[i]["trk"] is None or seg[i + 1]["trk"] is None or not seg[i]["good"]:
            continue
        acc += wrap(seg[i + 1]["trk"] - seg[i]["trk"])
        if abs(acc) >= 360:
            s, e = seg[start], seg[i + 1]
            d = e["t"] - s["t"]
            pts = seg[start:i + 2]
            out.append({
                "start": s["t"], "duration_s": d,
                "gain_m": e["alt"] - s["alt"],
                "climb_ms": (e["alt"] - s["alt"]) / d if d else 0.0,
                "cx": st.mean(p["x"] for p in pts),
                "cy": st.mean(p["y"] for p in pts),
                "ct": st.mean(p["t"] for p in pts),
                "alt_m": s["alt"],
            })
            acc, start = 0.0, i + 1
    return out


def best_window(F, a, b, win=30):
    seg = F[a:b + 1]
    best = None
    for i in range(len(seg)):
        j = i
        while j < len(seg) - 1 and seg[j]["t"] - seg[i]["t"] < win:
            j += 1
        d = seg[j]["t"] - seg[i]["t"]
        if d >= win * 0.8:
            r = (seg[j]["alt"] - seg[i]["alt"]) / d
            best = r if best is None else max(best, r)
    return best


# ------------------------------------------------------------------- wind

def estimate_wind(F, climbs):
    """Mean drift over whole circles, weighted by number of circles."""
    ests = []
    for c in climbs:
        s = circle_stats(F, c["a"], c["b"])
        if s["circles"] >= 1.5:
            ests.append((s["drift_vx"], s["drift_vy"], s["circles"], s["start"]))
    if not ests:
        return None, []
    W = sum(e[2] for e in ests)
    wx = sum(e[0] * e[2] for e in ests) / W
    wy = sum(e[1] * e[2] for e in ests) / W
    per = [{"time": e[3], "speed_ms": math.hypot(e[0], e[1]),
            "from_deg": math.degrees(math.atan2(-e[0], -e[1])) % 360,
            "circles": e[2]} for e in ests]
    return (wx, wy), per


# ------------------------------------------------------------------ polar

class Polar:
    def __init__(self, name, points):
        self.name = name
        (v1, s1), (v2, s2), (v3, s3) = [(p[0] / 3.6, p[1]) for p in points]
        import itertools  # noqa: F401
        A = [[1, v1, v1 * v1], [1, v2, v2 * v2], [1, v3, v3 * v3]]
        self.a, self.b, self.c = solve3(A, [s1, s2, s3])

    def sink(self, eas):
        return self.a + self.b * eas + self.c * eas * eas

    def best_ld(self):
        best = (0, None)
        v = 15.0
        while v < 60:
            s = self.sink(v)
            if s > 0 and v / s > best[0]:
                best = (v / s, v)
            v += 0.1
        return best  # (L/D, speed m/s)


def solve3(A, y):
    import copy
    M = [row[:] + [y[i]] for i, row in enumerate(A)]
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(M[r][i]))
        M[i], M[p] = M[p], M[i]
        if abs(M[i][i]) < 1e-12:
            raise ValueError("degenerate polar points")
        for r in range(3):
            if r != i:
                f = M[r][i] / M[i][i]
                for cc in range(i, 4):
                    M[r][cc] -= f * M[i][cc]
    return [M[i][3] / M[i][i] for i in range(3)]


def load_polar(glider_type, force=None, custom=None):
    if custom:
        pts = [[float(x) for x in p.split(",")] for p in custom.split(";")]
        return Polar("custom", pts), "custom polar supplied on the command line"
    db = json.load(open(os.path.join(HERE, "polars.json")))
    if force and force.lower() == "none":
        return None, "polar disabled - no airmass analysis"
    cand = db["gliders"]
    if force:
        for g in cand:
            if force.lower() in g["name"].lower() or \
                    any(force.lower() in m for m in g["match"]):
                return Polar(g["name"], g["points"]), f"polar forced to {g['name']}"
    t = (glider_type or "").lower().replace("-", "").replace(" ", "")
    for g in cand:
        for m in g["match"]:
            if m.replace("-", "").replace(" ", "") in t:
                return Polar(g["name"], g["points"]), \
                    f"polar matched to {g['name']} from the glider-type header"
    d = db["default"]
    return Polar(d["name"], d["points"]), \
        f"no polar match for {glider_type!r}; using a {d['name']} - treat airmass figures as indicative only"


def sigma(h_m):
    return max(0.3, (1 - 2.25577e-5 * h_m) ** 4.256)


# ------------------------------------------------------------- cruise legs

def analyse_leg(F, a, b, polar, wind):
    seg = F[a:b + 1]
    dur = seg[-1]["t"] - seg[0]["t"]
    dist = sum(f["step"] for f in seg[:-1] if f["dt"] > 0)
    dh = seg[-1]["alt"] - seg[0]["alt"]
    wx, wy = wind if wind else (0.0, 0.0)
    ias, ws, T, up = [], [], 0.0, 0.0
    for f in seg[:-1]:
        if not f["good"]:
            continue
        tas = math.hypot(f["vx"] - wx, f["vy"] - wy)
        s = sigma(f["alt"])
        eas = tas * math.sqrt(s)
        ias.append(eas * 3.6)
        T += f["dt"]
        if polar:
            w = f["vz"] + polar.sink(eas) / math.sqrt(s)
            ws.append((w, f["dt"]))
            if w > 0:
                up += f["dt"]
    res = {
        "start": seg[0]["t"], "end": seg[-1]["t"], "duration_s": dur,
        "distance_m": dist, "dh_m": dh,
        "ld_over_ground": dist / -dh if dh < 0 else None,
        "mean_ias_kmh": st.mean(ias) if ias else None,
        "sd_ias_kmh": st.pstdev(ias) if len(ias) > 2 else None,
        "alt_start_m": seg[0]["alt"], "alt_end_m": seg[-1]["alt"],
    }
    if ws and T:
        res["mean_airmass_ms"] = sum(w * d for w, d in ws) / T
        res["frac_rising_air"] = up / T
        res["sampled_s"] = T
    return res


# ----------------------------------------------------------------- report

def hms(t):
    t = int(t) % 86400
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def mmss(s):
    s = int(s)
    return f"{s // 60}:{s % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--units", choices=["imperial", "metric"], default="imperial")
    ap.add_argument("--polar")
    ap.add_argument("--polar-points")
    ap.add_argument("--json")
    ap.add_argument("--min-circle-rate", type=float, default=6.0)
    ap.add_argument("--release", help="override release time, HH:MM:SS UTC")
    args = ap.parse_args()

    hdr, F, task, warn = parse_igc(args.file)
    alt_src = choose_altitude(F)
    add_kinematics(F)
    segment(F, args.min_circle_rate)

    imp = args.units == "imperial"
    H = (lambda m: f"{m * FT:,.0f} ft") if imp else (lambda m: f"{m:,.0f} m")
    C = (lambda ms: f"{ms * KT:+.1f} kt") if imp else (lambda ms: f"{ms:+.2f} m/s")
    S = (lambda ms: f"{ms * KT:.0f} kt") if imp else (lambda ms: f"{ms * 3.6:.0f} km/h")

    dts = [F[i + 1]["t"] - F[i]["t"] for i in range(len(F) - 1)]
    gaps = [(F[i]["t"], d) for i, d in enumerate(dts) if d > 20]
    dur = F[-1]["t"] - F[0]["t"]
    dist = sum(f["step"] for f in F[:-1] if f["dt"] > 0)

    out = []
    p = out.append
    p("=" * 64)
    p(f"IGC ANALYSIS  {os.path.basename(args.file)}")
    p("=" * 64)
    p(f"date {hdr.get('date','?')}   glider {hdr.get('glider_type','?')} "
      f"{hdr.get('glider_id','')} {hdr.get('competition_id','')}")
    p(f"pilot {hdr.get('pilot','?')}   logger {hdr.get('logger','?')} "
      f"{hdr.get('gps','')}")
    p(f"trace {hms(F[0]['t'])}-{hms(F[-1]['t'])}  {mmss(dur)}  "
      f"{len(F)} fixes  median {st.median(dts):.0f}s  max gap {max(dts)}s")
    p(f"altitude source: {alt_src}")

    p("")
    p("-- data quality " + "-" * 48)
    for w in warn:
        p(f"! {w}")
    if st.median(dts) > 4:
        p(f"! median fix interval {st.median(dts):.0f}s - too coarse to see "
          f"centring detail inside a circle; treat circle geometry as averages")
    if gaps:
        tot = sum(d for _, d in gaps)
        p(f"! {len(gaps)} gaps over 20s totalling {mmss(tot)} "
          f"({tot / dur * 100:.0f}% of the trace); largest {max(d for _,d in gaps)}s "
          f"at {hms(max(gaps, key=lambda g: g[1])[0])}")
    if not warn and st.median(dts) <= 4 and not gaps:
        p("clean trace, no significant gaps")

    to, rel, ltype, lnote, rel_ok = find_launch(F)
    if args.release:
        hh, mm, ss = (int(x) for x in args.release.split(":"))
        want = hh * 3600 + mm * 60 + ss
        rel = min(range(len(F)), key=lambda i: abs(F[i]["t"] - want))
        rel_ok = True
        lnote += "  [release time supplied by the operator]"
    p("")
    p("-- flight " + "-" * 54)
    p(f"launch      {hms(F[to]['t'])}  {ltype}")
    if "no launch" not in ltype:
        p(f"            {lnote}")
    if args.release:
        p(f"release     {hms(F[rel]['t'])} at {H(F[rel]['alt'])}  (supplied)")
    else:
        how = ("a sustained drop below tow speed" if rel_ok
               else "top of the initial climb; no clean speed change found")
        p(f"release     ESTIMATED {hms(F[rel]['t'])} at {H(F[rel]['alt'])}")
        p(f"            basis: {how}")
        p(f"            This is a heuristic. It is often wrong when the tow ran")
        p(f"            through lift, or the glider cruised fast after release.")
        p(f"            Check the trace near this time for the release turn and")
        p(f"            re-run with --release HH:MM:SS if it differs.")
    top_alt = max(f["alt"] for f in F)
    tail_gs = st.mean([f["gs"] * 3.6 for f in F[-6:-1] if f["good"]] or [999])
    landed = F[-1]["alt"] < top_alt - 300 and tail_gs < 60
    p(f"max altitude {H(top_alt)}   "
      + (f"landing {hms(F[-1]['t'])} at {H(F[-1]['alt'])}"
         if landed else
         f"trace ends {hms(F[-1]['t'])} at {H(F[-1]['alt'])} - still flying, "
         f"so this is a partial log"))
    p(f"track distance {dist/1000:.0f} km   soaring time after release "
      f"{mmss(F[-1]['t'] - F[rel]['t'])}")
    if task:
        p(f"declared task: {len(task)} points - "
          + " / ".join(t["name"] or f"{t['lat']:.3f},{t['lon']:.3f}" for t in task))

    # climbs
    rs = runs(F)
    climbs = []
    for a, b, circ in rs:
        if not circ or F[a]["t"] < F[rel]["t"]:
            continue
        if F[b]["alt"] - F[a]["alt"] > 0 and F[b]["t"] - F[a]["t"] >= 30:
            climbs.append({"a": a, "b": b})
    wind, wind_per = estimate_wind(F, climbs)

    circ_time = sum(F[b]["t"] - F[a]["t"] for a, b, c in rs
                    if c and F[a]["t"] >= F[rel]["t"])
    soar = max(1, F[-1]["t"] - F[rel]["t"])
    gain_circ = sum(F[c["b"]]["alt"] - F[c["a"]]["alt"] for c in climbs)

    p("")
    p("-- phase split (after release) " + "-" * 33)
    p(f"circling {mmss(circ_time)} ({circ_time/soar*100:.0f}% of soaring time) "
      f"in {len(climbs)} climbs")
    p(f"straight {mmss(soar - circ_time)} ({(soar-circ_time)/soar*100:.0f}%)")
    p(f"height gained while circling {H(gain_circ)}")
    if circ_time:
        p(f"average rate while circling {C(gain_circ / circ_time)} "
          f"(includes entry and centring losses)")
    if climbs:
        lo = min(F[c["a"]]["alt"] for c in climbs)
        hi = max(F[c["b"]]["alt"] for c in climbs)
        p(f"working band {H(lo)} to {H(hi)} "
          f"(lowest climb entry to highest climb top)")

    if wind:
        p("")
        p("-- wind from circle drift " + "-" * 38)
        p(f"mean {math.hypot(*wind)*KT:.0f} kt from "
          f"{math.degrees(math.atan2(-wind[0], -wind[1]))%360:.0f} deg")
        for w in wind_per:
            p(f"   {hms(w['time'])}  {w['speed_ms']*KT:4.0f} kt from "
              f"{w['from_deg']:3.0f} deg  ({w['circles']:.1f} circles)")
        if len(wind_per) > 1:
            spread = max(w["speed_ms"] for w in wind_per) - \
                min(w["speed_ms"] for w in wind_per)
            if spread * KT > 8:
                p("! estimates disagree by more than 8 kt - few complete circles "
                  "or genuinely variable wind; do not lean on this")

    p("")
    p("-- climbs " + "-" * 54)
    p(f"{'#':>2} {'time':>8} {'dur':>5} {'gain':>8} {'avg':>7} {'best30':>7} "
      f"{'circ':>5} {'dir':>5} {'t/360':>6} {'bank':>5} {'radius':>7} {'speed':>6}")
    climb_json = []
    for i, c in enumerate(climbs, 1):
        s = circle_stats(F, c["a"], c["b"], wind)
        bw = best_window(F, c["a"], c["b"])
        ct = "{:.0f}s".format(s["circle_time_s"]) if s["circle_time_s"] else "-"
        bk = "{:.0f}".format(s["bank_deg"]) if s["bank_deg"] else "-"
        rd = "{:.0f} m".format(s["radius_m"]) if s["radius_m"] else "-"
        p(f"{i:>2} {hms(s['start']):>8} {mmss(s['duration_s']):>5} "
          f"{H(s['gain_m']):>8} {C(s['avg_climb_ms']):>7} "
          f"{(C(bw) if bw is not None else '-'):>7} "
          f"{s['circles']:>5.1f} {s['direction']:>5} "
          f"{ct:>6} {bk:>5} {rd:>7} {S(s['airspeed_kmh']/3.6):>6}")
        s["best_30s_ms"] = bw
        s["per_circle"] = per_circle(F, c["a"], c["b"])
        climb_json.append(s)

    detail = [(i, s) for i, s in enumerate(climb_json, 1) if len(s["per_circle"]) >= 2]
    if detail:
        p("")
        p("-- circle by circle " + "-" * 44)
        for i, s in detail:
            p(f"climb {i} at {hms(s['start'])}:")
            prev = None
            for k, c in enumerate(s["per_circle"], 1):
                drift = ""
                if prev:
                    dx, dy = c["cx"] - prev["cx"], c["cy"] - prev["cy"]
                    dt = max(1.0, c["ct"] - prev["ct"])
                    drift = f"  centre moved {math.hypot(dx,dy):.0f} m " \
                            f"({math.hypot(dx,dy)/dt*KT:.0f} kt drift)"
                p(f"   circle {k}: {c['duration_s']:>3}s  {C(c['climb_ms'])}"
                  f"  from {H(c['alt_m'])}{drift}")
                prev = c

    # cruise legs
    polar, pnote = load_polar(hdr.get("glider_type"), args.polar, args.polar_points)
    p("")
    p("-- straight-flight legs " + "-" * 40)
    p(pnote)
    if polar:
        ld, v = polar.best_ld()
        p(f"assumed best glide {ld:.0f}:1 at {v*3.6:.0f} km/h "
          f"({v*KT:.0f} kt) - airmass figures are only as good as this")
    p(f"{'time':>17} {'dur':>6} {'km':>6} {'height':>9} {'L/D gnd':>8} "
      f"{'IAS':>7} {'sd':>5} {'airmass':>8} {'rising':>7}")
    legs, leg_json = [], []
    for a, b, circ in rs:
        if circ or F[a]["t"] < F[rel]["t"]:
            continue
        if F[b]["t"] - F[a]["t"] < 60:
            continue
        legs.append((a, b))
    up_t = tot_t = 0.0
    land_alt = F[-1]["alt"]
    circuit_seen = False
    for a, b in legs:
        L = analyse_leg(F, a, b, polar, wind)
        L["circuit"] = landed and F[b]["alt"] < land_alt + 250
        leg_json.append(L)
        if "frac_rising_air" in L and not L["circuit"]:
            up_t += L["frac_rising_air"] * L["sampled_s"]
            tot_t += L["sampled_s"]
        circuit_seen = circuit_seen or L["circuit"]
        ld = "{:.0f}:1".format(L["ld_over_ground"]) if L["ld_over_ground"] else "-"
        ia = "{:.0f}".format(L["mean_ias_kmh"]) if L["mean_ias_kmh"] else "-"
        sd = "{:.0f}".format(L["sd_ias_kmh"]) if L["sd_ias_kmh"] else "-"
        am = C(L["mean_airmass_ms"]) if "mean_airmass_ms" in L else "-"
        ri = "{:.0f}%".format(L["frac_rising_air"] * 100) \
            if "frac_rising_air" in L else "-"
        p(f"{hms(L['start'])}-{hms(L['end'])[3:]:>5} {mmss(L['duration_s']):>6} "
          f"{L['distance_m']/1000:>6.1f} {H(L['dh_m']):>9} {ld:>8} {ia:>7} "
          f"{sd:>5} {am:>8} {ri:>7}" + ("  <- circuit" if L["circuit"] else ""))
    if tot_t:
        p(f"straight flight was in rising air {up_t/tot_t*100:.0f}% of the time"
          + (" (circuit legs excluded)" if circuit_seen else ""))
        p("(IAS is km/h; 'airmass' is the vertical motion of the air the glider "
          "was flying through, after subtracting polar sink)")

    print("\n".join(out))

    if args.json:
        prof = [{"t": f["t"], "alt_m": f["alt"], "lat": round(f["lat"], 5),
                 "lon": round(f["lon"], 5), "circling": bool(f["circ"])}
                for f in F]
        json.dump({"header": hdr, "warnings": warn, "altitude_source": alt_src,
                   "launch": {"takeoff": F[to]["t"], "release": F[rel]["t"],
                              "type": ltype, "note": lnote},
                   "phase": {"circling_s": circ_time, "soaring_s": soar,
                             "gain_circling_m": gain_circ},
                   "wind": ({"speed_ms": math.hypot(*wind),
                             "from_deg": math.degrees(math.atan2(-wind[0], -wind[1])) % 360,
                             "per_climb": wind_per} if wind else None),
                   "climbs": climb_json, "legs": leg_json,
                   "track_distance_m": dist, "task": task,
                   "profile": prof},
                  open(args.json, "w"), indent=1, default=float)
        print(f"\n[json written to {args.json}]", file=sys.stderr)


if __name__ == "__main__":
    main()
