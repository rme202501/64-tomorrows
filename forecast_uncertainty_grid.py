"""
Forecast-uncertainty grid: how much do we NOT know, for each variable, at each
lead time?

One shaded cell per (variable, lead time).  The shade encodes the *effective
standard deviation* of the forecast for that variable, expressed as a multiple
of the variable's own climatological standard deviation:

    effective SD = sqrt(ensemble spread^2 + systematic bias^2) / climatological SD

so 0 means "we know it exactly", 1 means "the forecast is no more certain than
climatology", and values above 1 mean the forecast is (effectively) worse than
climatology.  Because the units cancel, one colour scale serves every row.

The lead-time axis is mixed: hourly steps for the first day, then daily steps
out to a week, which is how most forecast products are actually consumed.

All numbers are SYNTHETIC.  Each variable gets a simple error-growth model
(a floor, a saturating growth curve with its own time constant, an optional
diurnal modulation for the sun-driven variables, and a small deterministic
bias) plus seeded noise.  The shapes are plausible; the values are made up.

Run:  python3 forecast_uncertainty_grid.py
Outputs: figures/forecast_uncertainty_grid.{png,pdf}
         data/synthetic_forecast_uncertainty.csv
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from matplotlib import colors as mcolors
from matplotlib import patches
from matplotlib import pyplot as plt

HERE = Path(__file__).resolve().parent
SEED = 1710                        # CS1710 :)
INIT_LOCAL_HOUR = 6                # forecast issued at 06:00 local
VMAX = 1.5                         # top of the colour scale, in climatological SDs

# ---------------------------------------------------------------- palette ----
# Chart chrome shared with solar_clock_glyphs.py.  The value encoding is a
# single-hue blue ramp (light -> dark = certain -> uncertain); amber is already
# taken by the flux figure, so uncertainty gets the next sequential hue.
SURFACE = "#fcfcfb"
PAGE = "#f9f9f7"
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
HAIRLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
BLUE_STOPS = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
BLUE_CMAP = mcolors.LinearSegmentedColormap.from_list("blue_seq", BLUE_STOPS)


# ------------------------------------------------------------ lead times -----
@dataclass(frozen=True)
class Lead:
    hours: float
    label: str
    group: str          # "hourly" or "daily"


LEADS: list[Lead] = (
    [Lead(h, f"+{h}h", "hourly") for h in (1, 2, 3, 6, 9, 12, 18, 24)]
    + [Lead(24 * d, f"day {d}", "daily") for d in range(2, 8)]
)


# ------------------------------------------------------------- variables -----
@dataclass(frozen=True)
class Variable:
    key: str
    name: str
    unit: str
    clim_sd: float      # climatological SD in native units (synthetic)
    floor: float        # irreducible uncertainty at t -> 0, as fraction of clim SD
    growth: float       # asymptotic growth above the floor, fraction of clim SD
    tau_h: float        # e-folding time of error growth, hours
    diurnal: float      # amplitude of sunrise/sunset modulation (0 = none)
    bias: float         # systematic bias at long lead, fraction of clim SD


VARIABLES: list[Variable] = [
    Variable("ghi", "Global horizontal irradiance", "W/m²", 280.0, 0.12, 0.92, 30.0, 0.35, 0.10),
    Variable("cloud", "Cloud fraction", "(fraction)", 0.32, 0.18, 0.98, 22.0, 0.25, 0.08),
    Variable("t2m", "2 m air temperature", "°C", 6.5, 0.08, 0.85, 60.0, 0.10, 0.12),
    Variable("wind", "10 m wind speed", "m/s", 2.4, 0.15, 1.00, 36.0, 0.00, 0.15),
    Variable("precip", "Precipitation (3 h total)", "mm", 3.1, 0.35, 0.95, 14.0, 0.00, 0.10),
    Variable("rh", "Relative humidity", "%", 14.0, 0.14, 0.95, 40.0, 0.15, 0.06),
]


def synthesize(rng: np.random.Generator) -> np.ndarray:
    """Effective SD (in climatological SDs), shape (n_variables, n_leads)."""
    out = np.zeros((len(VARIABLES), len(LEADS)))
    for i, v in enumerate(VARIABLES):
        for j, lead in enumerate(LEADS):
            t = lead.hours
            spread = v.floor + v.growth * (1.0 - np.exp(-t / v.tau_h))
            if v.diurnal > 0 and lead.group == "hourly":
                # Sun-driven variables are hardest near sunrise/sunset and,
                # for the first day, easy overnight when the value is ~0.
                local_hour = (INIT_LOCAL_HOUR + t) % 24
                twilight = np.exp(-((local_hour - 6.5) ** 2) / 4.0) + np.exp(-((local_hour - 19.0) ** 2) / 4.0)
                night = 1.0 if (local_hour < 5.0 or local_hour > 20.5) else 0.0
                spread *= 1.0 + v.diurnal * twilight - 0.45 * v.diurnal * night
            bias = v.bias * (1.0 - np.exp(-t / (2 * v.tau_h)))
            eff = np.sqrt(spread**2 + bias**2)
            eff *= 1.0 + rng.normal(0.0, 0.04)          # a little realism
            out[i, j] = float(np.clip(eff, 0.02, VMAX))
    return out


def write_csv(values: np.ndarray, path: Path) -> None:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["variable", "variable_name", "unit", "clim_sd_native",
                    "lead_hours", "lead_label", "lead_group",
                    "effective_sd_ratio", "effective_sd_native"])
        for i, v in enumerate(VARIABLES):
            for j, lead in enumerate(LEADS):
                r = values[i, j]
                w.writerow([v.key, v.name, v.unit, v.clim_sd, lead.hours, lead.label,
                            lead.group, f"{r:.3f}", f"{r * v.clim_sd:.3f}"])


# ------------------------------------------------------------------ figure ----
def draw(values: np.ndarray) -> plt.Figure:
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
        "figure.facecolor": PAGE, "savefig.facecolor": PAGE,
        "axes.facecolor": SURFACE,
    })

    n_rows, n_cols = values.shape
    cell = 1.0                      # cell pitch, data units
    gap = 0.06                      # surface gap between cells (~2px at output size)
    group_gap = 0.55                # extra breathing room between hourly and daily
    n_hourly = sum(1 for l in LEADS if l.group == "hourly")

    # x position of each column, with a split between the two lead-time groups
    xs = np.array([j * cell + (group_gap if LEADS[j].group == "daily" else 0.0) for j in range(n_cols)])
    width_total = xs[-1] + cell

    fig = plt.figure(figsize=(13.5, 7.1))
    # grid axes: left margin for row labels, top for column labels + title
    ax = fig.add_axes([0.235, 0.215, 0.655, 0.50])
    ax.set_xlim(-0.02, width_total + 0.02)
    ax.set_ylim(n_rows * cell + 0.02, -0.02)     # row 0 at the top
    ax.set_aspect("equal")
    ax.axis("off")

    norm = mcolors.Normalize(vmin=0.0, vmax=VMAX)

    # cells
    for i in range(n_rows):
        for j in range(n_cols):
            colour = BLUE_CMAP(norm(values[i, j]))
            ax.add_patch(patches.FancyBboxPatch(
                (xs[j] + gap / 2, i * cell + gap / 2), cell - gap, cell - gap,
                boxstyle=patches.BoxStyle("Round", pad=0.0, rounding_size=0.10),
                facecolor=colour, edgecolor="none", linewidth=0, zorder=2))

    # row labels: variable name in primary ink, unit + climatological SD in muted
    for i, v in enumerate(VARIABLES):
        y = i * cell + cell / 2
        ax.text(-0.22, y - 0.12, v.name, ha="right", va="center", fontsize=10.5, color=INK_PRIMARY)
        ax.text(-0.22, y + 0.20, f"1 SD = {v.clim_sd:g} {v.unit}", ha="right", va="center",
                fontsize=8, color=INK_MUTED)

    # column labels
    for j, lead in enumerate(LEADS):
        ax.text(xs[j] + cell / 2, -0.16, lead.label, ha="center", va="bottom",
                fontsize=9.5, color=INK_SECONDARY)

    # group headers with a hairline rule under each
    def group_header(j0: int, j1: int, text: str) -> None:
        x0, x1 = xs[j0] + gap / 2, xs[j1] + cell - gap / 2
        ax.plot([x0, x1], [-0.62, -0.62], color=BASELINE, lw=0.8, solid_capstyle="butt", zorder=1)
        ax.text((x0 + x1) / 2, -0.70, text, ha="center", va="bottom", fontsize=9.5,
                color=INK_MUTED, style="normal")

    group_header(0, n_hourly - 1, "HOURS AHEAD")
    group_header(n_hourly, n_cols - 1, "DAYS AHEAD")

    # forecast-issue marker on the left edge of the grid
    ax.plot([-0.02, -0.02], [-0.02, n_rows * cell + 0.02], color=BASELINE, lw=0.8, zorder=1)
    ax.text(-0.02, n_rows * cell + 0.22, f"issued {INIT_LOCAL_HOUR:02d}:00 local",
            ha="left", va="top", fontsize=8, color=INK_MUTED)

    # --- colour key -------------------------------------------------------
    ax_cb = fig.add_axes([0.235, 0.095, 0.36, 0.032])
    grad = np.linspace(0, VMAX, 512)[None, :]
    ax_cb.imshow(grad, aspect="auto", cmap=BLUE_CMAP, norm=norm, extent=(0, VMAX, 0, 1))
    ax_cb.set_yticks([])
    ax_cb.set_xticks([0, 0.5, 1.0, 1.5])
    ax_cb.set_xticklabels(["0", "0.5×", "1×", "1.5×"], fontsize=8.5, color=INK_SECONDARY)
    ax_cb.tick_params(axis="x", length=3, color=BASELINE, pad=3)
    for s in ax_cb.spines.values():
        s.set_visible(False)
    ax_cb.axvline(1.0, color=SURFACE, lw=1.4, zorder=3)
    ax_cb.axvline(1.0, color=INK_PRIMARY, lw=0.8, zorder=4)
    ax_cb.set_title("Effective forecast SD, as a multiple of the variable's climatological SD",
                    fontsize=9, color=INK_SECONDARY, loc="left", pad=6)
    fig.text(0.235 + 0.36 * (1.0 / VMAX), 0.052, "1× = no better than climatology",
             ha="center", va="top", fontsize=8, color=INK_MUTED)
    fig.text(0.235, 0.052, "certain", ha="left", va="top", fontsize=8, color=INK_MUTED)
    fig.text(0.235 + 0.36, 0.052, "uncertain", ha="right", va="top", fontsize=8, color=INK_MUTED)

    # --- title block -------------------------------------------------------
    fig.text(0.05, 0.95, "How uncertain is the forecast, and when?",
             fontsize=16, color=INK_PRIMARY, ha="left", va="top", fontweight="medium")
    fig.text(0.05, 0.895,
             "Each cell is one forecast variable at one lead time, shaded by its effective standard deviation\n"
             "(ensemble spread and systematic bias combined) in units of that variable's own climatological SD.\n"
             "Darker = less certain.  Hourly steps through the first day, then daily steps out to a week.",
             fontsize=9.5, color=INK_SECONDARY, ha="left", va="top", linespacing=1.45)

    fig.text(0.89, 0.135,
             "Synthetic data: a per-variable error-growth model with diurnal modulation for\n"
             "the sun-driven variables; no real forecasts were harmed.  CS1710 final project.",
             ha="right", va="top", fontsize=8, color=INK_MUTED, linespacing=1.45)
    return fig


def main() -> None:
    rng = np.random.default_rng(SEED)
    values = synthesize(rng)

    (HERE / "data").mkdir(exist_ok=True)
    (HERE / "figures").mkdir(exist_ok=True)
    write_csv(values, HERE / "data" / "synthetic_forecast_uncertainty.csv")

    fig = draw(values)
    fig.savefig(HERE / "figures" / "forecast_uncertainty_grid.png", dpi=200)
    fig.savefig(HERE / "figures" / "forecast_uncertainty_grid.pdf")
    print("wrote figures/forecast_uncertainty_grid.{png,pdf} and data/synthetic_forecast_uncertainty.csv")


if __name__ == "__main__":
    main()
