"""Build site data for the forecast time machine and the storm cone.

Inputs (from fetch_time_machine.py and fetch_storm.py):
  data/wn3/time_machine/<run>.nc   older runs cropped to a shared valid-time window
  data/wn3/storm/<run>.nc          wide-domain MSLP mean / p10 / p90

Outputs in site/data/:
  time_machine.json, fields/tm_t2m_mean.bin  (run, valid, lat, lon)
  storm.json, fields/storm_mslp_{mean,p10,p90}.bin  (lead, lat, lon)

Usage: python pipeline/build_extras.py 20261007_12hr_01_preds
"""

import glob
import json
import os
import sys

import numpy as np
import xarray as xr
from scipy.ndimage import minimum_filter

from build_web_data import OUT, TOWNS, encode

TM_COARSEN = 2
STORM_COARSEN = 5
LOW_MAX_HPA = 1012
LOW_WINDOW = 9
LINK_KM = 700


def write_bin(name, arr):
    q, scale, offset = encode(arr.astype(np.float32))
    q.tofile(f"{OUT}/fields/{name}.bin")
    return {"scale": scale, "offset": offset, "shape": list(arr.shape)}


def build_time_machine():
    paths = sorted(glob.glob("data/wn3/time_machine/*.nc"))
    runs = [xr.open_dataset(p) for p in paths]
    valid = [r.attrs["init_time"] for r in runs]
    inits = [np.datetime64(v[:19]) for v in valid]
    order = np.argsort(inits)
    runs = [runs[k] for k in order]
    inits = [inits[k] for k in order]
    valid_times = inits[-1] + runs[-1].lead_time.values
    n_valid = len(valid_times)

    lat, lon = runs[0].lat.values, runs[0].lon.values
    maps = np.stack([r.temperature_2m_mean.values[:n_valid, ::TM_COARSEN, ::TM_COARSEN] - 273.15 for r in runs])

    series = {}
    for town, (la, lo) in TOWNS.items():
        i, j = int(np.abs(lat - la).argmin()), int(np.abs(lon - lo).argmin())
        series[town] = {
            key: [np.round(src.values[:n_valid, i, j] * conv + off, 2).tolist() for src in
                  (r[var] for r in runs)]
            for key, var, conv, off in [
                ("t2m_mean", "temperature_2m_mean", 1, -273.15),
                ("t2m_p10", "temperature_2m_p10", 1, -273.15),
                ("t2m_p90", "temperature_2m_p90", 1, -273.15),
                ("precip_mean", "total_precipitation_1hr_mean", 1000, 0),
                ("precip_p90", "total_precipitation_1hr_p90", 1000, 0),
            ]
        }
    meta = write_bin("tm_t2m_mean", maps)
    out = {
        "runs": [str(t) + "Z" for t in inits],
        "valid_times": [str(t) + "Z" for t in valid_times.astype("datetime64[s]")],
        "lat": lat[::TM_COARSEN].round(3).tolist(), "lon": lon[::TM_COARSEN].round(3).tolist(),
        "field": meta, "towns": series,
    }
    with open(f"{OUT}/time_machine.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"time machine: {len(runs)} runs x {n_valid} valid times")


def haversine_km(a, b):
    la1, lo1, la2, lo2 = map(np.radians, (a[0], a[1], b[0], b[1]))
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * np.arcsin(np.sqrt(h))


def find_lows(field, lat, lon):
    local = minimum_filter(field, size=LOW_WINDOW, mode="nearest") == field
    edge = LOW_WINDOW // 2
    local[:edge] = local[-edge:] = False
    local[:, :edge] = local[:, -edge:] = False
    ii, jj = np.nonzero(local & (field < LOW_MAX_HPA))
    return [(float(lat[i]), float(lon[j]), float(field[i, j])) for i, j in zip(ii, jj)]


def build_storm(run):
    ds = xr.open_dataset(f"data/wn3/storm/{run}.nc")
    lat = ds.lat.values[::STORM_COARSEN]
    lon = ds.lon.values[::STORM_COARSEN]
    leads = (ds.lead_time.values / np.timedelta64(1, "h")).astype(int)
    grids = {s: ds[f"mean_sea_level_pressure_{s}"].values[:, ::STORM_COARSEN, ::STORM_COARSEN] / 100
             for s in ("mean", "p10", "p90")}

    tracks = []
    for t in range(len(leads)):
        for low in find_lows(grids["mean"][t], lat, lon):
            best = None
            for tr in tracks:
                if tr["t"][-1] != t - 1:
                    continue
                d = haversine_km(tr["pts"][-1], low)
                if d < LINK_KM and (best is None or d < best[0]):
                    best = (d, tr)
            if best:
                best[1]["pts"].append(low)
                best[1]["t"].append(t)
            else:
                tracks.append({"pts": [low], "t": [t]})
    tracks = [tr for tr in tracks if len(tr["t"]) >= 4]
    tracks.sort(key=lambda tr: min(p[2] for p in tr["pts"]))

    meta = {s: write_bin(f"storm_mslp_{s}", g) for s, g in grids.items()}
    out = {
        "leads_h": leads.tolist(), "lat": lat.round(3).tolist(), "lon": lon.round(3).tolist(),
        "fields": meta,
        "tracks": [{"t": tr["t"], "lat": [p[0] for p in tr["pts"]], "lon": [p[1] for p in tr["pts"]],
                    "hpa": [round(p[2], 1) for p in tr["pts"]]} for tr in tracks],
    }
    with open(f"{OUT}/storm.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"storm: {len(tracks)} tracked lows, deepest {tracks[0]['pts'] and min(p[2] for p in tracks[0]['pts']):.0f} hPa")


if __name__ == "__main__":
    os.makedirs(f"{OUT}/fields", exist_ok=True)
    build_storm(sys.argv[1])
    build_time_machine()
