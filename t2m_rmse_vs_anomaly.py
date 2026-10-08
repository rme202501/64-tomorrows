"""
How well does a forecast do as a function of *what the truth turned out to be*?

x axis:  the verifying 2 m temperature, expressed as standard deviations from
         the climatological mean for that place/date/hour (a "z-score").
bars:    mean RMSE of the forecast for all cases whose truth fell in that bin,
         one bar per lead time (6 h, 24 h, 72 h), grouped within each 0.5 sigma bin.
curve:   the standard normal density, on a second (muted) axis, showing how
         often each kind of truth value actually occurs.  Tall bars in the tails
         are real but rare; the curve says how rare.

All numbers are SYNTHETIC.  The error model is deliberately simple and is the
reason the bars form a U:

    forecast_z = r(lead) * truth_z + eps,   eps ~ N(0, s(lead)^2)

i.e. the model is partly "regressed toward climatology" (r < 1), so the
further the truth sits from the mean, the larger the systematic under-forecast
of the anomaly, on top of a random error that grows with lead time.  Conditional
on the truth, RMSE = clim_sd * sqrt(((1 - r) z)^2 + s^2).

Run:  python3 t2m_rmse_vs_anomaly.py
Outputs: figures/t2m_rmse_vs_anomaly.{png,pdf}
         data/synthetic_t2m_rmse_by_anomaly.csv
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from matplotlib import patches
from matplotlib import pyplot as plt
from matplotlib import transforms

HERE = Path(__file__).resolve().parent
SEED = 1710
N_CASES = 20_000            # verification cases sampled from the climatology
CLIM_SD_C = 6.5             # climatological SD of 2 m temperature, degrees C (synthetic)
Z_MAX = 3.0                 # x-axis extent in sigma
BIN_W = 0.5                 # bin width in sigma

# ---------------------------------------------------------------- palette ----
# Chrome shared with the other two figures.  Lead time is ORDINAL, so the three
# series take one hue at three lightness steps (short lead = light, long = dark);
# steps chosen from the shared blue ramp and validated as an ordinal ramp.
SURFACE = "#fcfcfb"
PAGE = "#f9f9f7"
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
HAIRLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
DENSITY_FILL = "#ebe9e1"    # neutral, recessive: the curve is context, not a series
DENSITY_LINE = "#a9a69c"


@dataclass(frozen=True)
class Lead:
    hours: int
    label: str
    r: float        # regression-toward-climatology factor (1 = perfect anomaly amplitude)
    s: float        # random error SD, in climatological SDs
    colour: str


LEADS: list[Lead] = [
    Lead(6,  "+6 h",  0.97, 0.12, "#6da7ec"),
    Lead(24, "+24 h", 0.90, 0.25, "#256abf"),
    Lead(72, "+72 h", 0.72, 0.45, "#0d366b"),
]

EDGES = np.round(np.arange(-Z_MAX, Z_MAX + BIN_W / 2, BIN_W), 6)
CENTRES = (EDGES[:-1] + EDGES[1:]) / 2


# ------------------------------------------------------------------ data -----
def synthesize(rng: np.random.Generator):
    """Return truth z-scores and a dict lead -> forecast error in degrees C."""
    z = rng.standard_normal(N_CASES)
    errors = {}
    for lead in LEADS:
        eps = rng.normal(0.0, lead.s, N_CASES)
        fz = lead.r * z + eps
        errors[lead.hours] = (fz - z) * CLIM_SD_C
    return z, errors


def bin_rmse(z: np.ndarray, err: np.ndarray):
    idx = np.digitize(z, EDGES) - 1
    rmse = np.full(len(CENTRES), np.nan)
    n = np.zeros(len(CENTRES), dtype=int)
    for b in range(len(CENTRES)):
        m = idx == b
        n[b] = m.sum()
        if n[b]:
            rmse[b] = np.sqrt(np.mean(err[m] ** 2))
    return rmse, n


def std_normal_pdf(x):
    return np.exp(-0.5 * x**2) / np.sqrt(2 * np.pi)


def std_normal_cdf(x):
    from math import erf, sqrt
    return 0.5 * (1 + np.vectorize(erf)(x / sqrt(2)))


def write_csv(n, rmse_by_lead, path: Path) -> None:
    mass = std_normal_cdf(EDGES[1:]) - std_normal_cdf(EDGES[:-1])
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["bin_lo_sigma", "bin_hi_sigma", "bin_centre_sigma", "bin_lo_degC",
                    "bin_hi_degC", "n_cases", "std_normal_prob_mass"]
                   + [f"rmse_degC_{ld.hours}h" for ld in LEADS])
        for b in range(len(CENTRES)):
            w.writerow([f"{EDGES[b]:.2f}", f"{EDGES[b+1]:.2f}", f"{CENTRES[b]:.2f}",
                        f"{EDGES[b]*CLIM_SD_C:.2f}", f"{EDGES[b+1]*CLIM_SD_C:.2f}",
                        int(n[b]), f"{mass[b]:.5f}"]
                       + [f"{rmse_by_lead[ld.hours][b]:.3f}" for ld in LEADS])


# ---------------------------------------------------------------- drawing ----
def rounded_bar(ax, x, w, h, colour, radius, zorder=3):
    """Column with a rounded cap and a square foot on the baseline."""
    if h <= 0:
        return
    r = min(radius, h / 2, w / 2)
    box = patches.FancyBboxPatch(
        (x + r, -r + r), w - 2 * r, h - r,          # pad=r grows it back to (x, 0, w, h)
        boxstyle=f"round,pad={r},rounding_size={r}",
        facecolor=colour, edgecolor="none", linewidth=0, zorder=zorder,
        mutation_aspect=1.0,
    )
    ax.add_patch(box)
    # square off the bottom by covering the lower rounding with a plain rectangle
    ax.add_patch(patches.Rectangle((x, 0), w, min(r, h), facecolor=colour,
                                   edgecolor="none", linewidth=0, zorder=zorder))


def draw(z, rmse_by_lead, n):
    plt.rcParams.update({
        "font.family": "sans-serif",
        "font.sans-serif": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"],
        "figure.facecolor": PAGE, "savefig.facecolor": PAGE,
        "axes.facecolor": SURFACE,
    })
    fig = plt.figure(figsize=(13, 7.6))
    ax = fig.add_axes([0.075, 0.20, 0.85, 0.58])
    ax_d = ax.twinx()                 # density axis, drawn first so bars sit on top

    # ---- density overlay (context layer) ----
    xs = np.linspace(-Z_MAX, Z_MAX, 601)
    pdf = std_normal_pdf(xs)
    ax_d.fill_between(xs, 0, pdf, color=DENSITY_FILL, linewidth=0, zorder=1)
    ax_d.plot(xs, pdf, color=DENSITY_LINE, linewidth=1.4, zorder=1.5)
    ax_d.set_ylim(0, 0.62)
    ax_d.set_yticks([0, 0.1, 0.2, 0.3, 0.4])
    ax_d.tick_params(axis="y", colors=INK_MUTED, labelsize=8.5, length=0, pad=6)
    for lbl in ax_d.get_yticklabels():
        lbl.set_color(INK_MUTED)
    ax_d.set_ylabel("Relative frequency of the truth value\n(standard normal density)",
                    color=INK_MUTED, fontsize=9, labelpad=12, rotation=270, va="bottom")
    for sp in ax_d.spines.values():
        sp.set_visible(False)
    ax_d.set_zorder(ax.get_zorder() - 1)
    ax.patch.set_visible(True)
    ax_d.patch.set_visible(False)
    # put the density axis UNDER the bar axis but keep the bar axis background clear
    ax.set_zorder(ax_d.get_zorder() + 1)
    ax.patch.set_alpha(0)

    # coverage brackets: 68 % within +-1 sigma, 95 % within +-2 sigma
    for lim, txt, y in ((1.0, "68 % of truth values fall within ±1σ", 0.545),
                        (2.0, "95 % within ±2σ", 0.585)):
        ax_d.plot([-lim, lim], [y, y], color=BASELINE, linewidth=1, zorder=1)
        for xx in (-lim, lim):
            ax_d.plot([xx, xx], [y - 0.008, y + 0.008], color=BASELINE, linewidth=1, zorder=1)
        ax_d.text(0, y + 0.006, txt, ha="center", va="bottom", fontsize=8.5,
                  color=INK_MUTED, zorder=1)

    # ---- bars (data layer) ----
    group_w = 0.40                         # of the 0.5 sigma bin
    bar_w = group_w / len(LEADS)
    gap = 0.012                            # surface gap between touching bars
    y_max = max(np.nanmax(v) for v in rmse_by_lead.values())
    for i, lead in enumerate(LEADS):
        vals = rmse_by_lead[lead.hours]
        for b, c in enumerate(CENTRES):
            x0 = c - group_w / 2 + i * bar_w + gap / 2
            rounded_bar(ax, x0, bar_w - gap, vals[b], lead.colour, radius=0.03)

    ax.set_xlim(-Z_MAX - 0.15, Z_MAX + 0.15)
    ax.set_ylim(0, np.ceil(y_max * 1.18 * 2) / 2)

    # gridlines: hairline, recessive, behind everything
    ax.yaxis.grid(True, color=HAIRLINE, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.spines["bottom"].set_color(BASELINE)
    ax.spines["bottom"].set_linewidth(1)
    ax.tick_params(axis="y", colors=INK_SECONDARY, labelsize=9, length=0, pad=6)
    ax.set_ylabel("Mean forecast RMSE for cases in this bin  (°C)", color=INK_SECONDARY,
                  fontsize=9.5, labelpad=10)

    # x ticks: sigma on the first row, degrees C anomaly on a second, muted row
    ticks = np.arange(-Z_MAX, Z_MAX + 0.01, 1.0)
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{t:+.0f}σ" if t else "mean" for t in ticks],
                       fontsize=9.5, color=INK_PRIMARY)
    ax.tick_params(axis="x", length=4, color=BASELINE, pad=5)
    for t in ticks:
        ax.text(t, -0.075, f"{t*CLIM_SD_C:+.1f} °C" if t else "0 °C", transform=
                transforms.blended_transform_factory(ax.transData, ax.transAxes),
                ha="center", va="top", fontsize=8, color=INK_MUTED)
    ax.text(0.5, -0.145, "Truth 2 m temperature, in standard deviations from the "
            f"climatological mean  (1σ = {CLIM_SD_C:.1f} °C, synthetic)",
            transform=ax.transAxes, ha="center", va="top", fontsize=9.5, color=INK_SECONDARY)
    # bin edges as faint ticks so the 0.5 sigma bins are legible
    ax.set_xticks(EDGES, minor=True)
    ax.tick_params(axis="x", which="minor", length=2.5, color=HAIRLINE)

    # ---- direct labels: the +3 sigma group doubles as the legend ----
    last = len(CENTRES) - 1
    for i, lead in enumerate(LEADS):
        v = rmse_by_lead[lead.hours][last]
        x = CENTRES[last] - group_w / 2 + i * bar_w + bar_w / 2
        ax.text(x, v + 0.12, f"{v:.1f}", ha="center", va="bottom", fontsize=8.5,
                color=INK_SECONDARY, zorder=5)
    # and the centre bin, where the story is "small"
    mid = len(CENTRES) // 2 - 1
    for i, lead in enumerate(LEADS):
        v = rmse_by_lead[lead.hours][mid]
        x = CENTRES[mid] - group_w / 2 + i * bar_w + bar_w / 2
        ax.text(x, v + 0.12, f"{v:.1f}", ha="center", va="bottom", fontsize=8.5,
                color=INK_SECONDARY, zorder=5)

    # ---- legend: one horizontal row between the subtitle and the plot ----
    ly = 0.835
    x = 0.075
    sw_w, sw_h = 0.009, 0.026
    for lead in LEADS:
        fig.patches.append(patches.FancyBboxPatch((x, ly - sw_h / 2), sw_w, sw_h,
                           boxstyle="round,pad=0,rounding_size=0.003", transform=fig.transFigure,
                           facecolor=lead.colour, edgecolor="none", figure=fig))
        t = fig.text(x + sw_w + 0.007, ly, f"{lead.label} forecast", ha="left", va="center",
                     fontsize=9.5, color=INK_PRIMARY)
        x += sw_w + 0.007 + 0.0075 * len(f"{lead.label} forecast") + 0.018
    x += 0.012
    fig.patches.append(patches.Rectangle((x, ly - sw_h / 2), sw_w, sw_h, transform=fig.transFigure,
                       facecolor=DENSITY_FILL, edgecolor=DENSITY_LINE, linewidth=1, figure=fig))
    fig.text(x + sw_w + 0.007, ly, "how often the truth lands here (standard normal density, right axis)",
             ha="left", va="center", fontsize=9.5, color=INK_PRIMARY)

    # ---- title, subtitle, footnote ----
    fig.text(0.075, 0.955, "The further from normal the weather, the worse the forecast",
             fontsize=17, color=INK_PRIMARY, ha="left", va="top", fontweight="medium")
    fig.text(0.075, 0.905,
             "Forecast RMSE for 2 m temperature, grouped by how unusual the observed value was.  "
             "Errors are smallest near the climatological mean and grow toward both tails,\n"
             "and the growth steepens with lead time.  The grey curve is the standard normal "
             "density: the tall tail bars describe events that are also the rarest.",
             fontsize=9.8, color=INK_SECONDARY, ha="left", va="top", linespacing=1.5)
    dropped = int((np.abs(z) > Z_MAX).sum())
    fig.text(0.075, 0.032,
             f"Synthetic data, seed {SEED}.  {N_CASES:,} verification cases with truth z-scores "
             f"drawn from N(0, 1); {dropped} cases beyond ±{Z_MAX:.0f}σ are not shown.  "
             f"Bin counts range from {n.min():,} (outer bins) to {n.max():,} (central bins).\n"
             "Error model: forecast_z = r·truth_z + ε, ε ~ N(0, s²), with (r, s) = "
             + ",  ".join(f"({ld.r:.2f}, {ld.s:.2f}) at {ld.label}" for ld in LEADS)
             + ".  The U shape is the r < 1 term: the model under-forecasts anomalies.",
             fontsize=8, color=INK_MUTED, ha="left", va="bottom", linespacing=1.5)
    return fig


def main() -> None:
    rng = np.random.default_rng(SEED)
    z, errors = synthesize(rng)
    rmse_by_lead, n = {}, None
    for lead in LEADS:
        rmse_by_lead[lead.hours], n = bin_rmse(z, errors[lead.hours])
    (HERE / "figures").mkdir(exist_ok=True)
    (HERE / "data").mkdir(exist_ok=True)
    write_csv(n, rmse_by_lead, HERE / "data" / "synthetic_t2m_rmse_by_anomaly.csv")
    fig = draw(z, rmse_by_lead, n)
    fig.savefig(HERE / "figures" / "t2m_rmse_vs_anomaly.png", dpi=200)
    fig.savefig(HERE / "figures" / "t2m_rmse_vs_anomaly.pdf")
    print("bin centres:", CENTRES)
    print("n per bin:  ", n)
    for lead in LEADS:
        print(f"RMSE {lead.label}:", np.round(rmse_by_lead[lead.hours], 2))


if __name__ == "__main__":
    main()
