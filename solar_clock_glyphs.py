"""
Clock glyphs of synthetic downward shortwave solar flux over Massachusetts.

One glyph per ~20 km grid cell.  Each glyph is a dial spanning 07:00-19:00
local time (07:00 at the top, clockwise, 13:00 at the bottom, 19:00 back at the
top), so the daylight hours fill the whole circle and spatial differences in
the fan shape are easy to compare.  The radius at each time step is the
downward shortwave flux at the surface (rim = 1000 W/m^2).  The fan is filled with a
single-hue amber ramp whose darkness encodes the daily integrated radiation
(kWh/m^2/day).

All flux values are SYNTHETIC: a clear-sky model (Haurwitz) driven by real
solar geometry for the chosen date, attenuated by a made-up cloud field with a
morning marine-stratus component on the coast and an afternoon convective
component over the Berkshires.

Run:  python3 solar_clock_glyphs.py
Outputs: figures/ma_solar_clock_glyphs.{png,pdf}, data/*.csv
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from matplotlib import pyplot as plt
from matplotlib import colors as mcolors
from matplotlib import patches
from matplotlib.collections import LineCollection
from matplotlib import patheffects
from matplotlib.path import Path as MplPath
from scipy.ndimage import gaussian_filter

HERE = Path(__file__).resolve().parent
SEED = 1710                     # CS1710 :)
DATE = "2025-07-15"             # a mid-July day
DAY_OF_YEAR = 196
UTC_OFFSET_H = -4.0             # EDT
STEP_MIN = 30                   # temporal resolution of the synthetic series
CELL_KM = 20.0                  # grid cell edge, km
RIM_WM2 = 1000.0                # flux mapped to the glyph rim
DIAL_START_H = 7.0              # dial window: 07:00 at the top ...
DIAL_END_H = 19.0               # ... one full clockwise turn to 19:00

# ---------------------------------------------------------------- palette ----
# Chart chrome from the reference palette; a single-hue amber ramp for the
# sequential (daily-total) encoding, light -> dark, plus a tone-on-tone ink.
SURFACE = "#fcfcfb"
PAGE = "#f9f9f7"
LAND = "#f0efec"
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
HAIRLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
AMBER_STOPS = ["#fbeedb", "#f6c98a", "#eb9a3a", "#c96a10", "#7a3d05"]
AMBER_INK = "#5a2c02"
AMBER_CMAP = mcolors.LinearSegmentedColormap.from_list("amber", AMBER_STOPS)

# ------------------------------------------------- Massachusetts outline -----
# Simplified state boundary (lon, lat), 35 vertices, from a public US-states
# GeoJSON, with a hand-added outer Cape (the source drops the arm north of Chatham).
MA_OUTLINE = np.array([
    (-70.918, 42.888), (-70.819, 42.872), (-70.781, 42.696), (-70.824, 42.554),
    (-70.983, 42.422), (-70.989, 42.269), (-70.770, 42.247), (-70.638, 42.088),
    (-70.660, 41.962), (-70.551, 41.930), (-70.540, 41.814), (-70.260, 41.716),
    (-70.030, 41.770), (-70.000, 41.900), (-70.070, 42.000), (-70.180, 42.040),
    (-70.240, 42.075), (-70.070, 42.060), (-69.970, 41.970), (-69.930, 41.860),
    (-69.937, 41.809), (-70.008, 41.672), (-70.485, 41.552), (-70.660, 41.546),
    (-70.764, 41.639), (-70.928, 41.612), (-70.934, 41.541), (-71.120, 41.497),
    (-71.197, 41.678), (-71.224, 41.710), (-71.328, 41.782), (-71.383, 42.017),
    (-71.531, 42.017), (-71.799, 42.006), (-71.799, 42.023), (-73.054, 42.039),
    (-73.486, 42.050), (-73.508, 42.088), (-73.267, 42.746), (-72.457, 42.729),
    (-71.295, 42.696), (-71.186, 42.789), (-70.918, 42.888),
])
CITIES = {
    "Boston": (-71.06, 42.36),
    "Worcester": (-71.80, 42.26),
    "Springfield": (-72.59, 42.10),
    "Pittsfield": (-73.25, 42.45),
    "Provincetown": (-70.18, 42.05),
    "Hyannis": (-70.28, 41.65),
}

# Equirectangular projection centred on the state; units are km so the glyph
# circles are true circles on the page.
LON0, LAT0 = -71.72, 42.19
KM_PER_DEG_LAT = 110.57
KM_PER_DEG_LON = 111.32 * np.cos(np.radians(LAT0))


def to_km(lon, lat):
    return (np.asarray(lon) - LON0) * KM_PER_DEG_LON, (np.asarray(lat) - LAT0) * KM_PER_DEG_LAT


def to_deg(x, y):
    return x / KM_PER_DEG_LON + LON0, y / KM_PER_DEG_LAT + LAT0


# ------------------------------------------------------------------- grid ----
@dataclass
class Cell:
    cid: int
    row: int
    col: int
    lon: float
    lat: float
    x_km: float
    y_km: float
    land_frac: float


def build_grid(cell_km: float = CELL_KM, min_land_frac: float = 0.15) -> list[Cell]:
    """Regular square grid (in km) clipped to the state outline."""
    ox, oy = to_km(MA_OUTLINE[:, 0], MA_OUTLINE[:, 1])
    outline = MplPath(np.column_stack([ox, oy]))
    xmin, xmax, ymin, ymax = ox.min(), ox.max(), oy.min(), oy.max()
    ncol = int(np.ceil((xmax - xmin) / cell_km))
    nrow = int(np.ceil((ymax - ymin) / cell_km))
    # centre the grid on the bounding box
    x0 = (xmin + xmax) / 2 - ncol * cell_km / 2
    y0 = (ymin + ymax) / 2 - nrow * cell_km / 2
    # 5x5 sample points per cell to estimate land fraction
    s = (np.arange(5) + 0.5) / 5 - 0.5
    sx, sy = np.meshgrid(s * cell_km, s * cell_km)
    cells: list[Cell] = []
    for r in range(nrow):
        for c in range(ncol):
            cx = x0 + (c + 0.5) * cell_km
            cy = y0 + (r + 0.5) * cell_km
            pts = np.column_stack([(cx + sx).ravel(), (cy + sy).ravel()])
            frac = outline.contains_points(pts).mean()
            centre_in = outline.contains_point((cx, cy))
            if frac >= min_land_frac or centre_in:
                lon, lat = to_deg(cx, cy)
                cells.append(Cell(len(cells), r, c, float(lon), float(lat), cx, cy, float(frac)))
    return cells


# ------------------------------------------------------- synthetic flux -------
def solar_zenith_cos(lat_deg, lon_deg, hours_local, doy=DAY_OF_YEAR, utc_offset=UTC_OFFSET_H):
    """cos(solar zenith angle) with declination + equation of time (Spencer)."""
    lat = np.radians(lat_deg)[:, None]
    lon = np.asarray(lon_deg)[:, None]
    t = np.asarray(hours_local)[None, :]
    g = 2 * np.pi * (doy - 1) / 365.0
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g)
            - 0.006758 * np.cos(2 * g) + 0.000907 * np.sin(2 * g)
            - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    eot_min = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g)
                        - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    # true solar time in hours: clock time + longitude correction + EoT
    tst = t + (lon - 15.0 * utc_offset) * 4.0 / 60.0 + eot_min / 60.0
    hour_angle = np.radians(15.0 * (tst - 12.0))
    cz = np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(hour_angle)
    return np.clip(cz, 0.0, 1.0)


def clear_sky_ghi(cos_z):
    """Haurwitz clear-sky global horizontal irradiance, W/m^2."""
    with np.errstate(divide="ignore", invalid="ignore"):
        ghi = 1098.0 * cos_z * np.exp(-0.059 / np.where(cos_z > 0, cos_z, np.nan))
    return np.nan_to_num(ghi, nan=0.0)


def synthetic_cloud_fraction(cells: list[Cell], hours, rng: np.random.Generator):
    """Made-up cloud fraction field cf(cell, time) in [0, 0.95].

    Components:
      * a smooth, static spatial patchiness field,
      * morning marine stratus on the coast / Cape (peaks ~07:00),
      * afternoon convective build-up increasing westward toward the
        Berkshires (peaks ~15:30),
      * a little smooth temporal noise per cell.
    """
    n = len(cells)
    x = np.array([c.x_km for c in cells])
    y = np.array([c.y_km for c in cells])
    t = np.asarray(hours)[None, :]

    # static patchiness: filtered white noise sampled on a coarse raster
    rows = np.array([c.row for c in cells]); cols = np.array([c.col for c in cells])
    raster = rng.normal(size=(rows.max() + 3, cols.max() + 3))
    raster = gaussian_filter(raster, sigma=1.6)
    raster = (raster - raster.mean()) / raster.std()
    patch = 0.18 + 0.12 * raster[rows + 1, cols + 1]

    # distance-ish to the ocean: east of ~-71.0 or on the Cape/South Coast
    lon = np.array([c.lon for c in cells]); lat = np.array([c.lat for c in cells])
    coastal = np.clip((lon + 71.3) / 0.9, 0, 1) * np.clip((42.75 - lat) / 0.5, 0, 1)
    coastal = np.maximum(coastal, np.clip((41.85 - lat) / 0.25, 0, 1))  # South Coast / Cape
    marine = 0.55 * coastal[:, None] * np.exp(-((t - 7.0) / 1.8) ** 2)

    # westward convective amplitude (Berkshires / hill towns)
    west = np.clip((-72.0 - lon) / 1.4, 0, 1) ** 1.3
    convective = (0.25 + 0.55 * west)[:, None] * np.exp(-((t - 15.5) / 2.6) ** 2)

    # temporal wiggle, smooth in time, independent per cell
    wiggle = gaussian_filter(rng.normal(size=(n, t.size)), sigma=(0, 3.0)) * 0.10

    cf = patch[:, None] + marine + convective + wiggle
    return np.clip(cf, 0.0, 0.95)


def generate_dataset(cells: list[Cell], step_min: int = STEP_MIN, seed: int = SEED):
    rng = np.random.default_rng(seed)
    hours = np.arange(0, 24, step_min / 60.0)
    lat = np.array([c.lat for c in cells]); lon = np.array([c.lon for c in cells])
    cos_z = solar_zenith_cos(lat, lon, hours)
    clear = clear_sky_ghi(cos_z)
    cf = synthetic_cloud_fraction(cells, hours, rng)
    # Kasten-Czeplak cloud attenuation of GHI
    ghi = clear * (1.0 - 0.75 * cf ** 3.4)
    ghi = np.clip(ghi + rng.normal(scale=6.0, size=ghi.shape) * (ghi > 0), 0, None)
    # daily integral, kWh/m^2/day (samples are uniformly spaced over the day)
    daily_kwh = ghi.sum(axis=1) * (step_min / 60.0) / 1000.0
    return hours, ghi, clear, cf, daily_kwh


def write_csvs(cells, hours, ghi, cf, daily_kwh, outdir: Path):
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "synthetic_flux_ma_timeseries.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cell_id", "lon", "lat", "date", "local_time", "ghi_wm2", "cloud_fraction"])
        for i, c in enumerate(cells):
            for j, h in enumerate(hours):
                hh, mm = int(h), int(round((h % 1) * 60))
                w.writerow([c.cid, f"{c.lon:.4f}", f"{c.lat:.4f}", DATE, f"{hh:02d}:{mm:02d}",
                            f"{ghi[i, j]:.1f}", f"{cf[i, j]:.3f}"])
    with open(outdir / "synthetic_flux_ma_daily.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cell_id", "row", "col", "lon", "lat", "land_fraction", "daily_kwh_m2"])
        for i, c in enumerate(cells):
            w.writerow([c.cid, c.row, c.col, f"{c.lon:.4f}", f"{c.lat:.4f}",
                        f"{c.land_frac:.2f}", f"{daily_kwh[i]:.3f}"])


# ---------------------------------------------------------------- drawing ----
def clock_xy(cx, cy, hours, radii):
    """Polar -> Cartesian: DIAL_START_H at the top, one clockwise turn to DIAL_END_H."""
    theta = 2 * np.pi * (np.asarray(hours) - DIAL_START_H) / (DIAL_END_H - DIAL_START_H)
    return cx + radii * np.sin(theta), cy + radii * np.cos(theta)


def draw_glyph(ax, cx, cy, R, hours, flux, fill_color, rim_color=BASELINE,
               rim_lw=0.6, fan_lw=0.6, spoke_lw=0.35, tick_len=0.10, zorder=5):
    """Clock face (rim + 4 ticks) and the filled radial flux fan."""
    ax.add_patch(patches.Circle((cx, cy), R, facecolor=SURFACE, edgecolor=rim_color,
                                linewidth=rim_lw, zorder=zorder))
    span = DIAL_END_H - DIAL_START_H
    for h in DIAL_START_H + span * np.arange(4) / 4:
        x0, y0 = clock_xy(cx, cy, h, R * (1 - tick_len))
        x1, y1 = clock_xy(cx, cy, h, R)
        ax.plot([x0, x1], [y0, y1], color=rim_color, lw=rim_lw, solid_capstyle="butt", zorder=zorder + 1)
    hours = np.asarray(hours); flux = np.asarray(flux)
    win = (hours >= DIAL_START_H) & (hours <= DIAL_END_H)
    hours, flux = hours[win], flux[win]
    r = R * np.clip(flux / RIM_WM2, 0, 1)
    # close the fan through the hub so the window edges are radial
    x, y = clock_xy(cx, cy, hours, r)
    x = np.concatenate([[cx], x, [cx]]); y = np.concatenate([[cy], y, [cy]])
    ax.fill(x, y, facecolor=fill_color, edgecolor=AMBER_INK, linewidth=fan_lw,
            joinstyle="round", zorder=zorder + 2)
    # one spoke per time step, a darker step of the fill's own hue
    spoke = tuple(np.asarray(mcolors.to_rgb(fill_color)) * 0.70)
    sx, sy = clock_xy(cx, cy, hours, r)
    keep = r > 0.02 * R
    segs = np.stack([np.repeat([[cx, cy]], keep.sum(), axis=0),
                     np.column_stack([sx[keep], sy[keep]])], axis=1)
    ax.add_collection(LineCollection(segs, colors=[spoke], linewidths=spoke_lw, zorder=zorder + 3))
    ax.plot(cx, cy, marker="o", ms=1.6, color=INK_SECONDARY, zorder=zorder + 4)


def draw_map(ax, cells):
    ox, oy = to_km(MA_OUTLINE[:, 0], MA_OUTLINE[:, 1])
    ax.set_facecolor(PAGE)
    ax.add_patch(patches.Polygon(np.column_stack([ox, oy]), closed=True, facecolor=LAND,
                                 edgecolor=INK_MUTED, linewidth=0.8, zorder=1))
    # faint grid cell outlines
    for c in cells:
        ax.add_patch(patches.Rectangle((c.x_km - CELL_KM / 2, c.y_km - CELL_KM / 2), CELL_KM, CELL_KM,
                                       facecolor="none", edgecolor=HAIRLINE, linewidth=0.5, zorder=2))
    # graticule every degree
    for lon in range(-73, -69):
        x, _ = to_km(lon, LAT0)
        ax.axvline(x, color=HAIRLINE, lw=0.6, zorder=0)
        ax.text(x, oy.min() - 18, f"{abs(lon)}°W", ha="center", va="top", fontsize=8, color=INK_MUTED)
    for lat in (42,):
        _, y = to_km(LON0, lat)
        ax.axhline(y, color=HAIRLINE, lw=0.6, zorder=0)
        ax.text(ox.min() - 6, y, f"{lat}°N", ha="right", va="center", fontsize=8, color=INK_MUTED)
    for name, (lon, lat) in CITIES.items():
        x, y = to_km(lon, lat)
        ax.plot(x, y, marker="o", ms=3, color=INK_SECONDARY, mfc=SURFACE, mew=0.9, zorder=20)
        ax.text(x + 3, y + 3, name, fontsize=8, color=INK_SECONDARY, zorder=20,
                ha="left", va="bottom",
                path_effects=[patheffects.withStroke(linewidth=2.5, foreground=SURFACE)])
    ax.set_aspect("equal")
    ax.set_xlim(ox.min() - 22, ox.max() + 14)
    ax.set_ylim(oy.min() - 26, oy.max() + 12)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)


def draw_legend_glyph(ax, hours, flux, fill_color, daily_kwh):
    """Enlarged annotated glyph explaining the encoding."""
    ax.set_facecolor(PAGE)
    ax.set_aspect("equal")
    R = 1.0
    draw_glyph(ax, 0, 0, R, hours, flux, fill_color, rim_lw=0.9, fan_lw=0.9, spoke_lw=0.6)
    leader = dict(arrowstyle="-", color=INK_MUTED, lw=0.6, shrinkA=0, shrinkB=2)
    # reference ring at 500 W/m^2 (the rim itself is 1000)
    ax.add_patch(patches.Circle((0, 0), R * 0.5, facecolor="none", edgecolor=INK_MUTED,
                                linewidth=0.6, linestyle=(0, (2, 2)), zorder=9))
    ax.text(0.04, R * 0.5 + 0.02, "500 W/m²", fontsize=7.5, color=INK_MUTED, ha="left", va="bottom", zorder=30)
    x, y = clock_xy(0, 0, 7.6, R)
    ax.annotate("rim = 1000 W/m²", (x, y), (0.70, 0.92), fontsize=7.5, color=INK_MUTED,
                ha="left", va="bottom", arrowprops=leader)
    # hour labels around the rim
    for h, lab, ha, va in ((7, "07:00 / 19:00", "center", "bottom"), (10, "10:00", "left", "center"),
                           (13, "13:00", "center", "top"), (16, "16:00", "right", "center")):
        x, y = clock_xy(0, 0, h, R * 1.13)
        ax.text(x, y, lab, fontsize=8.5, color=INK_PRIMARY, ha=ha, va=va)
    # morning / afternoon halves
    for h, lab, side in ((8.5, "morning", 1), (17.5, "afternoon", -1)):
        x, y = clock_xy(0, 0, h, R * 0.55)
        ax.annotate(lab, (x, y), (side * 1.18, 0.48), fontsize=8, color=INK_SECONDARY,
                    ha="left" if side > 0 else "right", va="center", arrowprops=leader)
    # one spoke as the worked example of the radial encoding
    k9 = int(np.argmin(np.abs(hours - 9.0)))
    x, y = clock_xy(0, 0, 9.0, R * flux[k9] / RIM_WM2)
    ax.annotate(f"spoke length = flux at that time\n(09:00 here: {flux[k9]:.0f} W/m²)", (x, y),
                (0.55, -1.40), fontsize=8, color=INK_SECONDARY, ha="left", va="center", arrowprops=leader)
    x, y = clock_xy(0, 0, 15.0, R * 0.45)
    ax.annotate(f"fill shade = full-day total\n({daily_kwh:.1f} kWh/m² here)", (x, y), (-1.95, -0.95),
                fontsize=8, color=INK_SECONDARY, ha="left", va="center", arrowprops=leader)
    ax.set_xlim(-2.0, 2.3); ax.set_ylim(-1.7, 1.35)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)


def main():
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
        "text.color": INK_PRIMARY, "axes.edgecolor": BASELINE,
        "figure.facecolor": PAGE, "savefig.facecolor": PAGE,
    })
    cells = build_grid()
    hours, ghi, clear, cf, daily_kwh = generate_dataset(cells)
    write_csvs(cells, hours, ghi, cf, daily_kwh, HERE / "data")

    # sequential colour scale for the daily total, rounded to tidy bounds
    vmin = np.floor(daily_kwh.min() * 2) / 2
    vmax = np.ceil(daily_kwh.max() * 2) / 2
    norm = mcolors.Normalize(vmin=vmin, vmax=vmax)

    fig = plt.figure(figsize=(15, 8.6))
    gs = fig.add_gridspec(nrows=2, ncols=2, width_ratios=[3.0, 1.0], height_ratios=[1.5, 1.0],
                          left=0.02, right=0.98, top=0.86, bottom=0.05, wspace=0.02, hspace=0.05)
    ax = fig.add_subplot(gs[:, 0])
    ax_key = fig.add_subplot(gs[0, 1])
    ax_cb = fig.add_subplot(gs[1, 1])

    draw_map(ax, cells)
    R = CELL_KM * 0.46
    for i, c in enumerate(cells):
        draw_glyph(ax, c.x_km, c.y_km, R, hours, ghi[i], AMBER_CMAP(norm(daily_kwh[i])))

    # legend glyph: use the cell nearest Worcester as the worked example
    wx, wy = to_km(*CITIES["Worcester"])
    k = int(np.argmin([(c.x_km - wx) ** 2 + (c.y_km - wy) ** 2 for c in cells]))
    draw_legend_glyph(ax_key, hours, ghi[k], AMBER_CMAP(norm(daily_kwh[k])), daily_kwh[k])
    ax_key.set_title("How to read one glyph", fontsize=10.5, color=INK_PRIMARY, loc="left", pad=6)

    # colour bar for the daily total
    ax_cb.set_facecolor(PAGE)
    ax_cb.set_axis_off()
    cax = ax_cb.inset_axes([0.12, 0.62, 0.76, 0.07])
    cb = fig.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=AMBER_CMAP), cax=cax, orientation="horizontal")
    cb.outline.set_edgecolor(BASELINE); cb.outline.set_linewidth(0.6)
    cb.ax.tick_params(labelsize=8, colors=INK_MUTED, length=2.5, width=0.6)
    cb.set_ticks(np.arange(vmin, vmax + 0.01, 0.5))
    cb.ax.set_title("Daily integrated downward shortwave flux (kWh/m²/day)", fontsize=9,
                    color=INK_SECONDARY, loc="left", pad=6)
    ax_cb.text(0.12, 0.42,
               f"Grid: {len(cells)} cells, {CELL_KM:.0f} km square, clipped to the state outline.\n"
               f"Time resolution: {STEP_MIN} min. Rim of every dial = {RIM_WM2:.0f} W/m².\n"
               f"Dial spans {DIAL_START_H:02.0f}:00 to {DIAL_END_H:02.0f}:00 local; flux outside that window\n"
               "is not drawn but is included in the daily total.\n"
               "Clear-sky curve from real solar geometry for the date; the cloud field,\n"
               "and therefore every flux value, is synthetic (seeded, reproducible).",
               fontsize=8, color=INK_MUTED, ha="left", va="top", transform=ax_cb.transAxes, linespacing=1.45)

    fig.text(0.02, 0.955, "Downward solar flux over Massachusetts as daylight clock glyphs (07:00-19:00)",
             fontsize=16, color=INK_PRIMARY, ha="left", va="top", fontweight="medium")
    fig.text(0.02, 0.905,
             f"Synthetic data for {DATE}. Each dial spans 07:00 to 19:00, clockwise from the top, so daylight fills the circle; each spoke's length is "
             "the surface flux at that time,\nand the fan's shade is the whole day's integrated radiation. Coastal "
             "cells show morning marine stratus; the Berkshires cloud over in the afternoon.",
             fontsize=9.5, color=INK_SECONDARY, ha="left", va="top", linespacing=1.4)

    out = HERE / "figures"
    out.mkdir(exist_ok=True)
    fig.savefig(out / "ma_solar_clock_glyphs.png", dpi=200)
    fig.savefig(out / "ma_solar_clock_glyphs.pdf")
    print(f"{len(cells)} cells; daily total range {daily_kwh.min():.2f}-{daily_kwh.max():.2f} kWh/m2; "
          f"peak flux {ghi.max():.0f} W/m2")
    print("wrote", out / "ma_solar_clock_glyphs.png")


if __name__ == "__main__":
    main()
