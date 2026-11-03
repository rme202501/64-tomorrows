"""Build the data for the scrollytelling story page (site/story/).

Writes to site/story/data/:
  story.json          Harvard point series, 64 pseudo-members, daily member summaries, spread curve
  ne_<field>.bin      Northeast grids, Int16 little-endian, shape (lead, lat, lon), value = raw*scale + offset
  ne_meta.json        grid, lead times and scale/offset for the ne_*.bin files

Units: temperature in F, wind in mph, precipitation in mm/h, cloud in %.

Pseudo-members: the statistics bucket only stores the mean and p10-p90 of the 64-member ensemble.
Each lead's quantile curve is interpolated in normal-score space (linear in z between the stored
quantiles, extended past p10/p90 with the end slopes) and evaluated at the 64 percentiles (k+0.5)/64,
so at every lead the 64 values reproduce the stored quantiles exactly. Which member gets which
percentile is decided by ranking 64 smooth random paths (AR(1) in time), so each member follows a
continuous track and members can trade places as the forecast evolves.

Usage: python pipeline/build_story_data.py data/wn3/<run>.nc
"""

import json
import os
import sys
from statistics import NormalDist

import numpy as np
import pandas as pd
import xarray as xr

OUT = os.environ.get("STORY_OUT", "site/story/data")
HARVARD = (42.3744, -71.1169)
N_MEMBERS = 64
SEED = 64
TAU_H = 30.0
NE_COARSEN = 2
Q_LEVELS = [0.10, 0.25, 0.50, 0.75, 0.90]
Q_NAMES = ["p10", "p25", "p50", "p75", "p90"]
TZ = "America/New_York"

ND = NormalDist()
Q_Z = np.array([ND.inv_cdf(q) for q in Q_LEVELS])
MEMBER_Z = np.array([ND.inv_cdf((k + 0.5) / N_MEMBERS) for k in range(N_MEMBERS)])


def c_to_f(c):
    return c * 9 / 5 + 32


def convert(name, arr):
    if name.startswith(("temperature_2m", "dewpoint_temperature_2m")):
        return c_to_f(arr - 273.15)
    if name.startswith("total_precipitation_1hr"):
        return np.maximum(arr * 1000.0, 0)
    if name.startswith("wind_speed_10m") or name.startswith(("u_component", "v_component")):
        return arr * 2.23694
    if name.startswith("total_cloud_cover"):
        return np.clip(arr * 100.0, 0, 100)
    if name.startswith("surface_solar_radiation_downwards_1hr"):
        return np.maximum(arr / 3600.0, 0)
    return arr


def member_values(quantiles, lo=None, hi=None):
    """quantiles: (lead, 5) -> (lead, 64) values at MEMBER_Z, sorted ascending."""
    q = np.maximum.accumulate(quantiles, axis=-1)
    out = np.empty((q.shape[0], N_MEMBERS))
    for t in range(q.shape[0]):
        v = np.interp(MEMBER_Z, Q_Z, q[t])
        left = MEMBER_Z < Q_Z[0]
        right = MEMBER_Z > Q_Z[-1]
        sl = (q[t, 1] - q[t, 0]) / (Q_Z[1] - Q_Z[0])
        sr = (q[t, -1] - q[t, -2]) / (Q_Z[-1] - Q_Z[-2])
        v[left] = q[t, 0] + sl * (MEMBER_Z[left] - Q_Z[0])
        v[right] = q[t, -1] + sr * (MEMBER_Z[right] - Q_Z[-1])
        out[t] = v
    if lo is not None or hi is not None:
        out = np.clip(out, lo, hi)
    return out


def smooth_ranks(leads_h, rng):
    """(lead, 64) rank of each member, from 64 AR(1) paths with time scale TAU_H."""
    paths = np.empty((len(leads_h), N_MEMBERS))
    paths[0] = rng.standard_normal(N_MEMBERS)
    for t in range(1, len(leads_h)):
        rho = np.exp(-(leads_h[t] - leads_h[t - 1]) / TAU_H)
        paths[t] = rho * paths[t - 1] + np.sqrt(1 - rho ** 2) * rng.standard_normal(N_MEMBERS)
    return np.argsort(np.argsort(paths, axis=1), axis=1)


def assign(sorted_vals, ranks):
    return np.take_along_axis(sorted_vals, ranks, axis=1)


def encode(arr):
    finite = arr[np.isfinite(arr)]
    lo, hi = float(finite.min()), float(finite.max())
    scale = (hi - lo) / 65000 if hi > lo else 1.0
    q = np.round((arr - lo) / scale - 32500)
    q = np.where(np.isfinite(q), q, -32768).astype("<i2")
    return q, scale, lo + 32500 * scale


def rnd(a, d=1):
    return np.round(np.asarray(a, float), d).tolist()


def main(path):
    ds = xr.open_dataset(path).load()
    leads_h = (ds.lead_time.values / np.timedelta64(1, "h")).astype(int)
    init = pd.Timestamp(str(ds.attrs["init_time"])[:19], tz="UTC")
    valid = init + pd.to_timedelta(leads_h, unit="h")

    i = int(np.abs(ds.lat.values - HARVARD[0]).argmin())
    j = int(np.abs(ds.lon.values - HARVARD[1]).argmin())
    pt = {n: convert(n, ds[n].values[:, i, j].astype(float)) for n in ds.data_vars}

    def stats(var, short):
        out = {s: rnd(pt[f"{var}_{s}"], 2) for s in ["mean", *Q_NAMES] if f"{var}_{s}" in pt}
        return short, out

    series = dict(stats(v, s) for v, s in [
        ("temperature_2m", "t2m"), ("total_precipitation_1hr", "precip"),
        ("wind_speed_10m", "wind"), ("total_cloud_cover", "cloud"),
        ("surface_solar_radiation_downwards_1hr", "solar"), ("dewpoint_temperature_2m", "d2m"),
        ("u_component_of_wind_10m", "u10"), ("v_component_of_wind_10m", "v10"),
    ] if f"{v}_mean" in pt)

    rng = np.random.default_rng(SEED)
    rank_t = smooth_ranks(leads_h, rng)
    rank_p = smooth_ranks(leads_h, rng)

    def qmat(var):
        return np.stack([pt[f"{var}_{s}"] for s in Q_NAMES], axis=-1)

    members = {
        "t2m": assign(member_values(qmat("temperature_2m")), rank_t),
        "precip": assign(member_values(qmat("total_precipitation_1hr"), lo=0), rank_p),
        "wind": assign(member_values(qmat("wind_speed_10m"), lo=0), rank_p),
    }

    step_h = np.diff(np.concatenate([[0], leads_h]))
    local = valid.tz_convert(TZ)
    days = []
    for date in pd.unique(local.date):
        idx = np.nonzero(local.date == date)[0]
        hours = local.hour[idx]
        cover = float(step_h[idx].sum())
        days.append({
            "date": str(date),
            "dow": pd.Timestamp(date).strftime("%a"),
            "lead_days": int((pd.Timestamp(date) - pd.Timestamp(local[0].date())).days),
            "hours_covered": cover,
            "complete": bool(cover >= 20 and hours.min() <= 6 and hours.max() >= 18),
            "high": rnd(members["t2m"][idx].max(0)),
            "low": rnd(members["t2m"][idx].min(0)),
            "precip_total": rnd((members["precip"][idx] * step_h[idx, None]).sum(0), 2),
            "wind_max": rnd(members["wind"][idx].max(0)),
            "cloud_mean": round(float(pt["total_cloud_cover_mean"][idx].mean()), 1),
            "high_p50": round(float(pt["temperature_2m_p50"][idx].max()), 1),
            "low_p50": round(float(pt["temperature_2m_p50"][idx].min()), 1),
        })

    t_sorted = np.sort(members["t2m"], axis=1)
    story = {
        "meta": {
            "run": ds.attrs.get("run"), "init_time": init.isoformat(), "tz": TZ,
            "place": "Harvard Yard, Cambridge MA", "lat": HARVARD[0], "lon": HARVARD[1],
            "grid_lat": float(ds.lat.values[i]), "grid_lon": float(ds.lon.values[j]),
            "n_members": N_MEMBERS, "units": {"t2m": "F", "wind": "mph", "precip": "mm/h", "cloud": "%"},
            "max_lead_h": int(leads_h[-1]),
            "note": "Members are reconstructed from the stored ensemble quantiles (p10-p90), not raw members.",
        },
        "leads_h": leads_h.tolist(),
        "valid": [v.isoformat() for v in valid],
        "local_hour": local.hour.tolist(),
        "series": series,
        "members": {k: [rnd(v[:, m]) for m in range(N_MEMBERS)] for k, v in members.items()},
        "spread": {
            "t2m_p10_p90": rnd(pt["temperature_2m_p90"] - pt["temperature_2m_p10"], 2),
            "t2m_min_max": rnd(t_sorted[:, -1] - t_sorted[:, 0], 2),
            "wind_p10_p90": rnd(pt["wind_speed_10m_p90"] - pt["wind_speed_10m_p10"], 2),
            "precip_p10_p90": rnd(pt["total_precipitation_1hr_p90"] - pt["total_precipitation_1hr_p10"], 3),
        },
        "daily": days,
    }

    os.makedirs(OUT, exist_ok=True)
    with open(f"{OUT}/story.json", "w") as f:
        json.dump(story, f, separators=(",", ":"))

    lat = ds.lat.values[::NE_COARSEN]
    lon = ds.lon.values[::NE_COARSEN]
    ne = {
        "t2m_spread": convert("temperature_2m", ds["temperature_2m_p90"].values)
        - convert("temperature_2m", ds["temperature_2m_p10"].values),
        "t2m_p50": convert("temperature_2m", ds["temperature_2m_p50"].values),
        "precip_p90": convert("total_precipitation_1hr", ds["total_precipitation_1hr_p90"].values),
    }
    meta = {"leads_h": leads_h.tolist(), "valid": story["valid"],
            "lat": rnd(lat, 3), "lon": rnd(lon, 3), "fields": {}}
    for name, arr in ne.items():
        arr = arr[:, ::NE_COARSEN, ::NE_COARSEN].astype(np.float32)
        q, scale, offset = encode(arr)
        q.tofile(f"{OUT}/ne_{name}.bin")
        meta["fields"][name] = {"scale": scale, "offset": offset, "shape": list(arr.shape),
                                "min": float(np.nanmin(arr)), "max": float(np.nanmax(arr))}
    with open(f"{OUT}/ne_meta.json", "w") as f:
        json.dump(meta, f, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(OUT, fn)) for fn in os.listdir(OUT))
    print(f"wrote {OUT}: {len(leads_h)} leads to {leads_h[-1]} h, {len(days)} days, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1])
