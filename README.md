# 64 Tomorrows: WeatherNext 3 forecast uncertainty

Google WeatherNext 3 makes 64 forecasts for the same hours. This repo turns the spread between them into a
scrollytelling website for New England, plus the pipeline that produces its data.

Live site: https://rme202501.github.io/64-tomorrows/ · Source: `site/` · Data pipeline: `pipeline/`

## Assignment map (Prototype V1)

| Requirement | Where to find it |
| --- | --- |
| Team members | Henry Mattoni, Ryan Eto, Luke Tan. Listed in `docs/prototype/prototype_v1.html` (section 1) and in the process book. |
| Complete data pipeline (scraping and cleaning on real data) | `pipeline/` (`fetch_wn3_stats.py`, `fetch_time_machine.py`, `fetch_storm.py`, `build_web_data.py`, `build_extras.py`). Outputs: `site/data/` (`manifest.json`, `points.json`, `fields/*.bin`, `storm.json`, `time_machine.json`). See "Data pipeline and site" below. |
| Two functional D3 visualizations (data loading + rendering) | (1) Hook: `site/js/views/scrollyHook.js`. (2) Growth: `site/js/views/scrollyGrowth.js`. Both load data through `site/js/data.js` and draw with `site/js/chart.js`. |
| Additional visualization drafts (2–3, not yet built) | `docs/prototype/make_draft_figures.py` generates `draft_a_daily_rhythm.png` and `draft_b_jumps.png`. Draft C (`draft_c_caveat_strip.png`) is built as `site/js/views/scrollyCaveat.js`. |
| Website structure | `site/index.html` (page order and copy), `site/js/main.js` (lazy-loads each view), `site/css/style.css` (layout). |
| Clear storytelling | Step text in `site/index.html`; narrative in `docs/prototype/prototype_v1.html` section 2. |
| Novel view design | `site/js/views/scrollyHook.js` (one app-style number on the fan of 64 forecasts). Design and interaction notes in `docs/prototype/prototype_v1.html` sections 4a and 8. |
| Updated process book (incl. prototype documentation) | `docs/prototype/prototype_v1.html` and `.pdf` (new prototype pages). The full combined process book is in the submission zip. |
| Dashboards (Milestone 6) | `site/dashboards/` (`uncertainty/`, `planner/`). |

Shared helpers for scroll steps: `site/js/scrolly.js`. Classic views kept under "More views": `site/js/views/`.

## Run the site

```bash
python3 -m http.server 8731 --directory site
# open http://localhost:8731/
```

Pages deploys `site/` on every push to `main` (`.github/workflows/pages.yml`).

Draft figures (uses the real data in `site/data/`):

```bash
python3 docs/prototype/make_draft_figures.py
```

## Data pipeline and site (real WeatherNext 3 data)

Real Google WeatherNext 3 ensemble statistics (mean, p10-p90 of 64 members) for New England,
visualized as a D3 site in `site/`.

## Data pipeline

Requires `gcloud auth application-default login`. Only the free statistics bucket is used.

```bash
pip install -r requirements.txt
python3 pipeline/fetch_wn3_stats.py                      # latest 6-hourly run, ~63 GB streamed, ~80 MB kept
python3 pipeline/fetch_time_machine.py <run> --n 10      # same window from 10 older runs
python3 pipeline/fetch_storm.py <run>                    # wide-domain sea-level pressure
python3 pipeline/build_web_data.py data/wn3/<run>.nc     # -> site/data/ (~20 MB)
python3 pipeline/build_extras.py <run>                   # -> time machine + storm data
```

Downloads are resumable: cropped chunks are cached under `data/wn3/.cache/` until a run completes.

### Run the site (WN3 data)

```bash
python3 -m http.server --directory site 8731
```

Check-prep docs: `docs/walkthrough.md`, `docs/qa_prep.md`, `docs/process_book_m5.md`.


## Storyline

The site is a scrollytelling page that follows the Milestone 7 storyboard in four acts. Each act is a sticky chart
with step cards; scrolling changes what the chart shows:

* **Hook**: `scrollyHook`, one app-style number, then the fan of 64 forecasts it came from.
* **Rising insights**: `scrollyGrowth`, how the gap grows with lead time, place, the Tue 13 jump, and wind.
* **Main message**: `scrollyCaveat`, day-by-day spread against the 7 °F trust limit.
* **Solution**: `scrollyHorizon`, each town's trust horizon.

The shared step logic is in `site/js/scrolly.js`. Edit the copy in `site/index.html`. Classic views sit under Explore.

Draft designs are generated from the real data by `python3 docs/prototype/make_draft_figures.py`. The write-up is
`docs/prototype/prototype_v1.html`.

## Synthetic illustration: solar clock glyphs (not part of the site)

`solar_clock_glyphs.py` generates a synthetic day of downward shortwave solar
flux on a 20 km grid over Massachusetts and draws one 24-hour clock glyph per
grid cell.

* **Dial**: spans 07:00 to 19:00 local, 07:00 at the top, clockwise, 13:00 at the bottom. Rim = 1000 W/m². Flux outside the window is not drawn but counts toward the daily total.
* **Spokes / fan radius**: surface flux at each 30-minute step, so the daylight
  hours fill the whole circle and cells are easy to compare.
* **Fan shade**: the day's integrated radiation (kWh/m²/day), single-hue amber,
  darker = more.

The clear-sky curve comes from real solar geometry for 2025-07-15 (declination,
equation of time, longitude offset), attenuated by a made-up cloud field with
morning marine stratus on the coast and afternoon convection over the
Berkshires. All flux values are synthetic and seeded (`SEED = 1710`).

### Run (solar illustration)

```bash
pip install -r requirements.txt
python3 solar_clock_glyphs.py
```

Outputs:

* `figures/ma_solar_clock_glyphs.png` and `.pdf`
* `data/synthetic_flux_ma_timeseries.csv` (cell, lon, lat, local time, W/m², cloud fraction)
* `data/synthetic_flux_ma_daily.csv` (cell, lon, lat, kWh/m²/day)

Knobs at the top of the script: `DATE`/`DAY_OF_YEAR`, `STEP_MIN`, `CELL_KM`,
`RIM_WM2`, `DIAL_START_H`/`DIAL_END_H`, `SEED`.

### Synthetic illustration: forecast RMSE vs. how unusual the truth was

`t2m_rmse_vs_anomaly.py` asks: does the forecast get worse when the weather is
far from normal? It bins synthetic 2 m temperature *truth* values by their
distance from the climatological mean (0.5σ bins, ±3σ, 1σ = 6.5 °C) and draws
the mean forecast RMSE in each bin as grouped bars for +6 h, +24 h and +72 h
lead times. A standard normal density (right axis, grey) shows how often each
kind of truth value actually occurs, so tall tail bars can be read as "large
but rare".

The U shape is built into the synthetic error model,
`forecast_z = r·truth_z + ε`: with `r < 1` the model is regressed toward
climatology and under-forecasts anomalies, and `r` falls / `ε` grows with lead
time. 20,000 cases, `SEED = 1710`.

```bash
python3 t2m_rmse_vs_anomaly.py
```

Outputs:

* `figures/t2m_rmse_vs_anomaly.png` and `.pdf`
* `data/synthetic_t2m_rmse_by_anomaly.csv` (bin edges in σ and °C, case count,
  standard normal probability mass, RMSE per lead time)

Knobs: `N_CASES`, `CLIM_SD_C`, `Z_MAX`, `BIN_W`, and the `(r, s)` pair per lead
in `LEADS`.

