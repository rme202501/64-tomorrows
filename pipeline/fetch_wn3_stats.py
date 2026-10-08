"""Download WeatherNext 3 ensemble statistics over New England.

Source: the precomputed statistics bucket
gs://weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/
(mean, p10, p25, p50, p75, p90 of the 64-member ensemble). No requester-pays
billing is used. Requires `gcloud auth application-default login`.

Every stored chunk is one global field for one lead time (~20 MB), so the
cost scales with (variables x statistics x lead times). Each chunk is fetched,
cropped to the box in memory and discarded, so RAM stays small. Cropped
chunks are cached under data/wn3/.cache/, so a rerun resumes where it stopped.

Usage:
    python pipeline/fetch_wn3_stats.py                 # latest 6-hourly run
    python pipeline/fetch_wn3_stats.py --run 20261007_12hr_01_preds
    python pipeline/fetch_wn3_stats.py --runs 10 --vars temperature_2m:mean,p10,p50,p90
"""

import argparse
import datetime as dt
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import obstore
import xarray as xr
import zarr

BUCKET = "weathernext3_statistics_spatial"
PREFIX_ROOT = "weathernext_3_0_0_statistics/zarr/2026_to_present"

LAT_MIN, LAT_MAX = 40.0, 48.0
LON_MIN, LON_MAX = -80.0, -66.0

ALL_STATS = ["mean", "p10", "p25", "p50", "p75", "p90"]
DEFAULT_VARS = {
    "temperature_2m": ALL_STATS,
    "dewpoint_temperature_2m": ["mean", "p50"],
    "total_precipitation_1hr": ALL_STATS,
    "total_cloud_cover": ALL_STATS,
    "wind_speed_10m": ALL_STATS,
    "mean_sea_level_pressure": ["mean", "p10", "p50", "p90"],
    "u_component_of_wind_10m": ["mean"],
    "v_component_of_wind_10m": ["mean"],
    "surface_solar_radiation_downwards_1hr": ["mean", "p50"],
}

HOURLY_UNTIL_H = 48
MAX_LEAD_H = 168
COARSE_STEP_H = 3

OUT_DIR = "data/wn3"
RETRIES = 6


def lead_hours():
    fine = list(range(1, HOURLY_UNTIL_H + 1))
    coarse = list(range(HOURLY_UNTIL_H + COARSE_STEP_H, MAX_LEAD_H + 1, COARSE_STEP_H))
    return fine + coarse


def store_for(run_name):
    return obstore.store.GCSStore(
        bucket=BUCKET, prefix=f"{PREFIX_ROOT}/{run_name}/predictions.zarr"
    )


def run_exists(run_name):
    try:
        obstore.head(store_for(run_name), "zarr.json")
        return True
    except Exception:
        return False


def recent_6hourly_runs(n):
    now = dt.datetime.now(dt.timezone.utc)
    cand = now.replace(hour=(now.hour // 6) * 6, minute=0, second=0, microsecond=0)
    runs = []
    for _ in range(80):
        name = f"{cand:%Y%m%d}_{cand:%H}hr_01_preds"
        if run_exists(name):
            runs.append(name)
            if len(runs) == n:
                return runs
        cand -= dt.timedelta(hours=6)
    raise RuntimeError("Not enough 6-hourly runs found in the last 20 days")


def parse_vars(spec):
    if not spec:
        return DEFAULT_VARS
    out = {}
    for item in spec.split(";"):
        name, stats = item.split(":")
        out[name] = stats.split(",")
    return out


def fetch_run(run_name, variables, workers, leads=None, out_dir=OUT_DIR):
    ds = xr.open_zarr(zarr.storage.ObjectStore(store_for(run_name)), chunks={})
    lat_sel = slice(LAT_MIN, LAT_MAX) if ds.lat_0p1[0] < ds.lat_0p1[-1] else slice(LAT_MAX, LAT_MIN)
    box = {"lat_0p1": lat_sel, "lon_0p1": slice(LON_MIN % 360, LON_MAX % 360)}
    wanted = np.array([np.timedelta64(h, "h") for h in (leads or lead_hours())])
    lead_idx = np.nonzero(np.isin(ds.lead_time.values, wanted))[0]

    template = ds["temperature_2m_mean"].isel(lead_time=lead_idx).sel(box)
    shape = template.shape
    arrays = {f"{v}_{s}": np.full(shape, np.nan, np.float32)
              for v, stats in variables.items() for s in stats}

    cache = os.path.join(out_dir, ".cache", run_name)
    os.makedirs(cache, exist_ok=True)

    def job(name, k, li):
        part = os.path.join(cache, f"{name}_{int(li)}.npy")
        if os.path.exists(part):
            arrays[name][k] = np.load(part)
            return
        for attempt in range(RETRIES):
            try:
                values = ds[name].isel(lead_time=li).sel(box).values
                break
            except Exception as e:
                if attempt == RETRIES - 1:
                    raise
                print(f"retry {name} lead {int(li)}: {type(e).__name__}", flush=True)
                time.sleep(2 ** attempt)
        np.save(part + ".tmp.npy", values)
        os.replace(part + ".tmp.npy", part)
        arrays[name][k] = values

    tasks = [(name, k, li) for name in arrays for k, li in enumerate(lead_idx)]
    total, done, t0 = len(tasks), 0, time.time()
    with ThreadPoolExecutor(workers) as pool:
        futures = [pool.submit(job, *t) for t in tasks]
        for f in as_completed(futures):
            f.result()
            done += 1
            if done % 10 == 0 or done == total:
                rate = done / (time.time() - t0)
                eta = (total - done) / rate / 60
                print(f"{run_name} {done}/{total} chunks "
                      f"({100 * done / total:.0f}%) eta {eta:.0f} min", flush=True)

    coords = {
        "lead_time": template.lead_time.values,
        "lat": template.lat_0p1.values,
        "lon": ((template.lon_0p1.values + 180) % 360) - 180,
    }
    out = xr.Dataset(
        {n: (("lead_time", "lat", "lon"), a) for n, a in arrays.items()},
        coords=coords,
        attrs={"run": run_name, "init_time": str(ds.init_time.values),
               "source": f"gs://{BUCKET}/{PREFIX_ROOT}/{run_name}"},
    )
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{run_name}.nc")
    out.to_netcdf(path + ".tmp", encoding={n: {"zlib": True, "complevel": 4} for n in arrays})
    os.replace(path + ".tmp", path)
    shutil.rmtree(cache)
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.1f} MB)", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", help="explicit run name, e.g. 20261007_12hr_01_preds")
    ap.add_argument("--runs", type=int, default=1, help="number of recent 6-hourly runs")
    ap.add_argument("--vars", help='e.g. "temperature_2m:mean,p10;mean_sea_level_pressure:mean"')
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()

    runs = [args.run] if args.run else recent_6hourly_runs(args.runs)
    variables = parse_vars(args.vars)
    for run in runs:
        if os.path.exists(os.path.join(OUT_DIR, f"{run}.nc")):
            print(f"skip {run} (exists)", flush=True)
            continue
        fetch_run(run, variables, args.workers)


if __name__ == "__main__":
    sys.exit(main())
