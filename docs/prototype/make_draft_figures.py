"""Draft figures for the Prototype V1 process book.

Three visualization designs we have NOT built into the site yet. Each one is
drawn from the real WeatherNext 3 statistics in site/data/points.json so the
sketch shows real numbers, not invented ones.

Run from the repo root:
    python3 docs/prototype/make_draft_figures.py
"""
import datetime as dt
import json
import pathlib
import statistics as st

import matplotlib
import matplotlib.dates  # noqa: F401
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = ROOT / "site" / "data"
OUT = pathlib.Path(__file__).resolve().parent

pts = json.loads((SITE / "points.json").read_text())
man = json.loads((SITE / "manifest.json").read_text())
leads = man["leads_h"] if isinstance(man["leads_h"], list) else json.loads(man["leads_h"])
init = dt.datetime(2026, 10, 7, 12)
LOCAL = dt.timedelta(hours=-4)  # EDT
THRESH = man.get("horizon_spread_c", 4.0)

COAST = ["Boston", "Cape Cod", "Providence", "Portland ME", "Worcester"]
INLAND = ["Springfield", "Pittsfield", "Hartford", "Concord NH", "Mt Washington", "Burlington VT", "New York"]


def spread(town, var="t2m"):
    p = pts[town]
    return [hi - lo for hi, lo in zip(p[f"{var}_p90"], p[f"{var}_p10"])]


def valid(h):
    return init + dt.timedelta(hours=h) + LOCAL


def style(ax):
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", color="#e1e0d9", lw=0.6)
    ax.set_axisbelow(True)


def draft_a_daily_rhythm():
    """Draft A: spread by local hour of day, first 48 hours (hourly leads)."""
    buckets = {h: [] for h in range(24)}
    for t in pts:
        s = spread(t)
        for i, lead in enumerate(leads[:48]):
            buckets[valid(lead).hour].append(s[i])
    means = [st.mean(buckets[h]) for h in range(24)]
    fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
    colors = ["#2a78d6" if m >= st.mean(means) else "#9ec5f4" for m in means]
    ax.bar(range(24), means, color=colors)
    ax.set_xticks(range(0, 24, 3))
    ax.set_xticklabels([f"{h:02d}:00" for h in range(0, 24, 3)])
    ax.set_xlabel("Local hour of the valid time (EDT)")
    ax.set_ylabel("Mean 1-in-10 to 9-in-10 gap (°C)")
    ax.set_title("Draft A · Daily rhythm: when is the forecast most unsure?", loc="left", fontsize=10)
    style(ax)
    fig.tight_layout()
    fig.savefig(OUT / "draft_a_daily_rhythm.png")
    lo, hi = min(range(24), key=lambda h: means[h]), max(range(24), key=lambda h: means[h])
    return {"min_hour": lo, "min": means[lo], "max_hour": hi, "max": means[hi]}


def draft_b_jumps():
    """Draft B: uncertainty moves in jumps; annotate the largest steps."""
    s = spread("Boston")
    n = 48  # hourly leads only (1..48h): every step is one hour
    s = s[:n]
    times = [valid(h) for h in leads[:n]]
    d = [abs(s[i + 1] - s[i]) for i in range(n - 1)]
    cut = sorted(d, reverse=True)[len(d) // 10]
    share = sum(x for x in sorted(d, reverse=True)[: len(d) // 10]) / sum(d)
    fig, ax = plt.subplots(figsize=(7.2, 3.4), dpi=200)
    ax.plot(times, s, color="#2a78d6", lw=1.8)
    for i in range(n - 1):
        if d[i] >= cut:
            ax.axvspan(times[i], times[i + 1], color="#eb6834", alpha=0.25, lw=0)
    ax.set_ylabel("1-in-10 to 9-in-10 gap (°C)")
    ax.set_title("Draft B · Largest hourly steps in the first 48 h (orange = top 10%)", loc="left", fontsize=10)
    ax.text(0.99, 0.04, f"Top 10% of hourly steps = {share:.0%} of total change",
            transform=ax.transAxes, ha="right", fontsize=8, color="#52514e")
    style(ax)
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%a %H:%M"))
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(OUT / "draft_b_jumps.png")
    return {"share": share}


def draft_c_caveats():
    """Draft C: extreme-day caveat strip, one cell per valid day."""
    rows = []
    for day in range(7):
        start = dt.datetime(2026, 10, 8) + dt.timedelta(days=day)
        cells = []
        for t in pts:
            s = spread(t)
            for i, lead in enumerate(leads):
                if start <= valid(lead) < start + dt.timedelta(days=1):
                    cells.append(s[i])
        rows.append((start, st.mean(cells), max(cells), sum(c > THRESH for c in cells) / len(cells)))
    fig, ax = plt.subplots(figsize=(7.2, 2.6), dpi=200)
    for k, (start, mean_gap, max_gap, share_over) in enumerate(rows):
        flag = share_over > 0
        ax.add_patch(plt.Rectangle((k, 0), 0.92, 1, color="#eb6834" if flag else "#e1e0d9",
                                   alpha=0.85 if flag else 1))
        ax.text(k + 0.46, 0.66, start.strftime("%a %-d"), ha="center", fontsize=9)
        ax.text(k + 0.46, 0.42, f"{mean_gap:.1f}°C", ha="center", fontsize=8.5)
        ax.text(k + 0.46, 0.20, "caveat" if flag else "agrees", ha="center", fontsize=8,
                color="white" if flag else "#52514e")
    ax.set_xlim(-0.05, 7)
    ax.set_ylim(0, 1)
    ax.axis("off")
    ax.set_title(f"Draft C · Caveat strip: day cells flagged when any hour spreads over {THRESH:.0f}°C",
                 loc="left", fontsize=10)
    fig.tight_layout()
    fig.savefig(OUT / "draft_c_caveat_strip.png")
    return [(s.strftime("%a %-d"), round(m, 2), round(x, 2), round(f, 3)) for s, m, x, f in rows]


if __name__ == "__main__":
    a = draft_a_daily_rhythm()
    b = draft_b_jumps()
    c = draft_c_caveats()
    coast = st.mean(st.mean(spread(t)[:48]) for t in COAST)
    inland = st.mean(st.mean(spread(t)[:48]) for t in INLAND)
    print("A daily rhythm:", a)
    print("B jumps:", b)
    print("C caveat days (day, mean gap C, max gap C, share of hours over threshold):")
    for row in c:
        print("  ", row)
    print(f"coast vs inland mean gap, first 48h: {coast:.2f} vs {inland:.2f} C")
