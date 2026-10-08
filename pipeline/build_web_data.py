"""Turn fetched WeatherNext 3 statistics NetCDF into compact files for the site.

Writes to site/data/:
  manifest.json            grid, lead times, init time, field list + scale/offset
  fields/<name>.bin        Int16 little-endian, shape (lead, lat, lon), value = raw*scale + offset
  points.json              full-resolution series at named towns (all stats)

Derived fields:
  feels_like_c       NWS wind chill / heat index from mean T, Td, wind
  t2m_spread_c       p90 - p10 of 2 m temperature
  p_freeze           P(T < 0 C) from the piecewise-linear CDF through the quantiles
  p_rain             P(precip > 0.1 mm/h), same method
  p_freezing_precip  p_rain * p_freeze (independence approximation)
  horizon_h          first lead where t2m spread exceeds HORIZON_SPREAD_C (2D)

Usage: python pipeline/build_web_data.py data/wn3/<run>.nc
"""

import json
import os
import sys

import numpy as np
import xarray as xr

OUT = os.environ.get("WEB_OUT", "site/data")
COARSEN = 2
HORIZON_SPREAD_C = 4.0
RAIN_MM = 0.1
Q_LEVELS = np.array([0.10, 0.25, 0.50, 0.75, 0.90])
Q_NAMES = ["p10", "p25", "p50", "p75", "p90"]

TOWNS = {
    "Boston": (42.36, -71.06), "Worcester": (42.26, -71.80),
    "Springfield": (42.10, -72.59), "Pittsfield": (42.45, -73.25),
    "Cape Cod": (41.67, -70.30), "Providence": (41.82, -71.41),
    "Hartford": (41.76, -72.67), "Portland ME": (43.66, -70.26),
    "Burlington VT": (44.48, -73.21), "Concord NH": (43.21, -71.54),
    "Mt Washington": (44.27, -71.30), "New York": (40.71, -74.01),
}


def prob_below(ds, var, threshold):
    """P(X < threshold) from quantiles, linear between them, tails fading to 0 / 1."""
    q = np.stack([ds[f"{var}_{n}"].values for n in Q_NAMES], axis=-1)
    q = np.maximum.accumulate(q, axis=-1)
    x = threshold
    p = np.full(q.shape[:-1], 0.5, np.float32)
    for i in range(len(Q_LEVELS) - 1):
        lo, hi = q[..., i], q[..., i + 1]
        inside = (x > lo) & (x < hi)
        frac = np.where(hi > lo, (x - lo) / np.where(hi > lo, hi - lo, 1), 0.5)
        p = np.where(inside, Q_LEVELS[i] + frac * (Q_LEVELS[i + 1] - Q_LEVELS[i]), p)
    width = np.maximum(q[..., -1] - q[..., 0], 1e-3)
    p = np.where(x <= q[..., 0], 0.10 * np.clip(1 - (q[..., 0] - x) / width, 0, 1), p)
    p = np.where(x >= q[..., -1], 1 - 0.10 * np.clip(1 - (x - q[..., -1]) / width, 0, 1), p)
    return p.astype(np.float32)


def feels_like(t_c, td_c, wind_ms):
    t_f = t_c * 9 / 5 + 32
    v_mph = wind_ms * 2.23694
    e = 6.112 * np.exp(17.67 * td_c / (td_c + 243.5))
    es = 6.112 * np.exp(17.67 * t_c / (t_c + 243.5))
    rh = np.clip(100 * e / es, 0, 100)
    wc = 35.74 + 0.6215 * t_f - 35.75 * v_mph ** 0.16 + 0.4275 * t_f * v_mph ** 0.16
    hi = (-42.379 + 2.04901523 * t_f + 10.14333127 * rh - 0.22475541 * t_f * rh
          - 6.83783e-3 * t_f ** 2 - 5.481717e-2 * rh ** 2 + 1.22874e-3 * t_f ** 2 * rh
          + 8.5282e-4 * t_f * rh ** 2 - 1.99e-6 * t_f ** 2 * rh ** 2)
    out = np.where((t_f <= 50) & (v_mph > 3), wc, t_f)
    out = np.where(t_f >= 80, hi, out)
    return ((out - 32) * 5 / 9).astype(np.float32)


def to_units(ds):
    for n in list(ds.data_vars):
        if n.startswith(("temperature_2m", "dewpoint_temperature_2m")):
            ds[n] = ds[n] - 273.15
        elif n.startswith("total_precipitation_1hr"):
            ds[n] = ds[n] * 1000.0
        elif n.startswith("mean_sea_level_pressure"):
            ds[n] = ds[n] / 100.0
        elif n.startswith("surface_solar_radiation_downwards_1hr"):
            ds[n] = ds[n] / 3600.0
    return ds


def short_name(n):
    return (n.replace("temperature_2m", "t2m").replace("dewpoint_t2m", "d2m")
             .replace("dewpoint_temperature_2m", "d2m")
             .replace("total_precipitation_1hr", "precip")
             .replace("total_cloud_cover", "cloud").replace("wind_speed_10m", "wind")
             .replace("mean_sea_level_pressure", "mslp")
             .replace("u_component_of_wind_10m", "u10").replace("v_component_of_wind_10m", "v10")
             .replace("surface_solar_radiation_downwards_1hr", "solar"))


def encode(arr):
    finite = arr[np.isfinite(arr)]
    lo, hi = float(finite.min()), float(finite.max())
    scale = (hi - lo) / 65000 if hi > lo else 1.0
    q = np.round((arr - lo) / scale - 32500)
    q = np.where(np.isfinite(q), q, -32768).astype("<i2")
    return q, scale, lo + 32500 * scale


def main(path):
    ds = to_units(xr.open_dataset(path).load())
    fields = {short_name(n): ds[n].values for n in ds.data_vars}

    td = ds.get("dewpoint_temperature_2m_mean", ds["temperature_2m_mean"] - 5).values
    fields["feels_like"] = feels_like(ds["temperature_2m_mean"].values, td,
                                      ds["wind_speed_10m_mean"].values)
    fields["t2m_spread"] = (ds["temperature_2m_p90"] - ds["temperature_2m_p10"]).values
    fields["p_freeze"] = prob_below(ds, "temperature_2m", 0.0)
    fields["p_rain"] = 1 - prob_below(ds, "total_precipitation_1hr", RAIN_MM)
    fields["p_freezing_precip"] = fields["p_rain"] * fields["p_freeze"]

    leads_h = (ds.lead_time.values / np.timedelta64(1, "h")).astype(int)
    spread = fields["t2m_spread"]
    exceeded = spread > HORIZON_SPREAD_C
    first = np.where(exceeded.any(0), leads_h[np.argmax(exceeded, 0)], leads_h[-1] + 1)

    lat, lon = ds.lat.values, ds.lon.values
    lat_c, lon_c = lat[::COARSEN], lon[::COARSEN]

    os.makedirs(f"{OUT}/fields", exist_ok=True)
    manifest = {
        "run": ds.attrs.get("run"), "init_time": ds.attrs.get("init_time"),
        "leads_h": leads_h.tolist(),
        "lat": [float(x) for x in lat_c], "lon": [float(x) for x in lon_c],
        "horizon_spread_c": HORIZON_SPREAD_C,
        "fields": {},
    }
    for name, arr in fields.items():
        arr = arr[:, ::COARSEN, ::COARSEN].astype(np.float32)
        q, scale, offset = encode(arr)
        q.tofile(f"{OUT}/fields/{name}.bin")
        manifest["fields"][name] = {"scale": scale, "offset": offset, "shape": list(arr.shape)}
    h = first[::COARSEN, ::COARSEN].astype(np.float32)
    q, scale, offset = encode(h[None])
    q.tofile(f"{OUT}/fields/horizon_h.bin")
    manifest["fields"]["horizon_h"] = {"scale": scale, "offset": offset, "shape": [1, *h.shape]}

    points = {}
    for town, (la, lo) in TOWNS.items():
        i, j = int(np.abs(lat - la).argmin()), int(np.abs(lon - lo).argmin())
        points[town] = {"lat": la, "lon": lo,
                        **{k: np.round(v[:, i, j].astype(float), 3).tolist() for k, v in fields.items()}}
    with open(f"{OUT}/points.json", "w") as f:
        json.dump(points, f, separators=(",", ":"))
    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump(manifest, f, indent=1)

    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fs in os.walk(OUT) for fn in fs)
    print(f"wrote {OUT}: {len(manifest['fields'])} fields, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1])
