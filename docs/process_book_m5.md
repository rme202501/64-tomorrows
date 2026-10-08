# Milestone 5: from sketches to a working prototype

*Paste into the process book Google Doc. Screenshots are in `docs/screenshots/`.*

## Data: from placeholder to real WeatherNext 3

- We now use **real Google WeatherNext 3 data**. All earlier sketches used placeholder data.
- **Source:** the public ensemble *statistics* bucket (`gs://weathernext3_statistics_spatial`). For
  each variable and hour it has the ensemble mean and the 10th, 25th, 50th, 75th and 90th
  percentiles of the 64 members, on a 0.1° (about 11 km) grid, hourly to 15 days.
- **Our subset:** the 7 Oct 2026 12Z run over New England (40-48°N, 80-66°W):
  - hourly for the first 48 h, then every 3 h to 7 days;
  - temperature, dewpoint, precipitation, cloud cover, 10 m wind, sea-level pressure and solar radiation.
- **Extras:**
  - the same future window from 10 older runs (forecast time machine);
  - a wide North Atlantic pressure field (storm tracking).
- **Surprises:**
  - The data is stored as whole-globe maps, so getting New England meant downloading about 63 GB.
    We wrote a resumable, parallel downloader that crops as it goes.
  - The statistics bucket has **no pressure levels** and **no individual members**. We dropped the
    vertical "sky elevator" idea and estimate probabilities from the percentiles.
- **Pipeline:**
  - `pipeline/fetch_wn3_stats.py` downloads and crops.
  - `pipeline/build_web_data.py` derives feels-like, spread and probabilities and compresses to about 25 MB.
  - `pipeline/build_extras.py` builds the time machine and storm tracks.

## Prototype: a D3 site in three parts

| Part | View | From sketch | Question |
|---|---|---|---|
| Your day | Temperature with spread | #1 (Henry) | What will the temperature be, and how sure is that? |
| | Feels-like and activity map | #9 (Ryan) | What will it feel like, and can I run / bike / go to the beach? |
| | Cloud cover animation | #10 (Ryan) | What does a day of cloud cover look like? |
| | Freezing precipitation timeline | #14 (Luke) | Will there be freezing precipitation, and how long will ice stay? |
| How sure? | Uncertainty growth | #15 (Luke) | How fast does the forecast range widen? |
| | Fog map | new | Where and when does the forecast get "foggy"? |
| | Trust horizon | new | How many days ahead can I trust the forecast here? |
| | Forecast roulette | new | What does "40% chance" mean? |
| Explore | Wind flow | Henry's wind sketch | Which way is the wind blowing? |
| | Forecast time machine | new | How did the forecast for one moment change run to run? |
| | Storm cone | new (Ryan's reflection on hurricane cones) | Where could the storm go? |
| | Route planner | new | When should I leave for my trip? |

## Design decisions

- **Uncertainty is the throughline.** Every view shows *how sure* along with *what*. It appears as
  bands (#1), fog, trust days, or the spread of roulette spins.
- **Colour:**
  - temperature is diverging blue to red with a neutral grey near 55°F;
  - magnitudes use one-hue ramps;
  - go/no-go uses reserved status colours with text labels;
  - all palettes come from a colourblind-checked reference palette, with light and dark themes.
- **Plain language:** "8 in 10 forecasts" instead of "P10-P90"; "trust horizon" instead of "spread threshold".
- **Interaction:**
  - every chart has hover tooltips;
  - maps have time sliders, and the animated views have play buttons;
  - views load lazily as you scroll, so the page stays fast.

## What changed from the sketches

- #9 gained activity filters and an hourly strip for a clicked town.
- #14's ice carry-over is now a concrete rule: from the first hour with a 20%+ chance until the
  temperature stays above 36°F for 6 hours.
- #15 compares four contrasting places (coast, city, hills, mountaintop) instead of one metric in the abstract.

## Open questions

See `docs/qa_prep.md` ("Questions for the TF").
