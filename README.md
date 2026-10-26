# Solar clock glyphs over Massachusetts

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

## Run

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

## Forecast RMSE vs. how unusual the truth was

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

# 64 Tomorrows: WeatherNext 3 site (Milestone 5)

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

## Site

```bash
python3 -m http.server --directory site 8731
```

Check-prep docs: `docs/walkthrough.md`, `docs/qa_prep.md`, `docs/process_book_m5.md`.

## Prototype V1 (storyline)

The site follows the Milestone 7 storyboard in four acts: **Hook** (`fanHook`, one number vs. the fan of
possible temperatures), **Rising insights** (`tempSpread`, `rangeGrowth`, `fogMap`, `timeMachine`), **Main
message** (`roulette`, `freezeTimeline`, `feelsMap`), and **Solution** (`horizonMap`, `routePlanner`), plus an
Explore section. Edit the copy in `site/index.html`.

Draft designs that are not built yet are generated from the real data by
`python3 docs/prototype/make_draft_figures.py`. The write-up is `docs/prototype/prototype_v1.html`.
