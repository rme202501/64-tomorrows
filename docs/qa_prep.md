# TF check: likely questions and short answers

Everyone should read all of this. The TF will ask individuals, not the team.

## Data

**What is an ensemble forecast?**
The model is run 64 times with slightly different starting conditions. Where the runs agree, the
forecast is reliable. Where they spread apart, it is uncertain.

**Why WeatherNext 3?**
It is Google's newest AI forecast model, among the most accurate available, and its data is
public on Google Cloud. It also ships ensemble statistics, which is exactly what our
uncertainty story needs.

**What exactly is in the data you use?**
For each variable and each hour we have:
- the ensemble **mean**,
- the **10th, 25th, 50th, 75th and 90th percentiles** across the 64 members.

The grid is 0.1° (about 11 km). Variables include 2 m temperature, dewpoint, hourly precipitation,
cloud cover, 10 m wind (speed and u/v), sea-level pressure, and solar radiation.

**Why not the raw 64 members?**
The raw bucket is "requester pays", so we would pay to download it, and it is about 64 times
bigger. The percentiles carry the uncertainty information we need.

**How do you get a probability like "40% chance of rain" from percentiles?**
We draw a piecewise-linear cumulative distribution through the five percentiles and read off
where the threshold falls. Example: if the 75th percentile is dry and the 90th is wet, the chance of
rain is between 10% and 25%. This is an approximation, and we say so on the page.

**How big is it and how did you process it?**
- The bucket stores every hour as a whole-globe map, so cropping New England for 7 days and about
  34 fields meant downloading about 63 GB.
- `pipeline/fetch_wn3_stats.py` downloads in parallel, crops each map immediately and caches it, so
  memory stays small and the run can resume after a failure.
- `pipeline/build_web_data.py` converts to 16-bit integers at 0.2° resolution, which comes to about
  25 MB for the whole site.

**What is derived rather than raw?**
- Feels-like temperature (NWS wind chill and heat index formulas).
- Spread: the 90th minus the 10th percentile.
- Chance of freezing, chance of rain, and chance of freezing precipitation. The last one multiplies
  the first two, which assumes they are independent; this is a simplification.
- Trust horizon.
- Storm tracks: local pressure minima linked from step to step.

**What can't the data do?**
- There are no pressure levels, so the vertical "sky elevator" idea was dropped.
- There are no individual members, so the roulette uses one percentile across the whole map.
- There is no ground truth, so we cannot score accuracy yet.

## Design decisions

**Why D3 and the web rather than Python?**
The interaction is the point (scrubbing time, spinning, drawing routes). It also runs on GitHub
Pages with no server.

**Colour choices?**
- Temperature uses a diverging blue-to-red scale with a neutral grey at about 55°F.
- Magnitudes such as the trust horizon use a single-hue blue ramp.
- Go/marginal/no-go use reserved status colours and always come with a text legend.
- Cloud cover runs from sky blue (clear) to white (overcast), which is close to how a sky looks.
- Palettes come from a colourblind-checked reference palette. Both light and dark modes are built.

**Why show uncertainty to the general public?**
A single number hides when the forecast is shaky. Bands, fog and "trust days" give a
one-glance answer to "should I trust this?" without any statistics vocabulary.

**Why the fog metaphor?**
People already associate fog with "can't see clearly". Thicker fog means the 64 forecasts
disagree more, so the forecast visibly "fogs over" as you scrub further ahead.

**How did the sketches change?**
- #9: from a static map to activity filters plus an hourly strip for a clicked town.
- #14: ice carry-over defined as lasting from the first hour with a 20%+ chance until the
  temperature stays above 36°F for 6 hours.
- #15: became a comparison across four contrasting places (coast, city, hills, mountaintop).

## Plan

- Next: gather TF feedback, cut or merge views, and add a guided scrollytelling intro.
- Refresh the data with a newer forecast run before the final submission.
- Possibly add an accuracy view using reanalysis (ERA5) as truth.

## Questions for the TF

1. We have 12 views. Should we cut to the strongest 6-8, or keep the "Explore" section as optional depth?
2. Is one audience (the general public) with an optional deeper section the right call, or should we pick one tier?
3. Without raw members, the roulette and freezing-precipitation probabilities are approximations.
   Is it OK to state this on the page, or should we restrict to what the percentiles give directly?
4. Is a single forecast run (a snapshot) acceptable, or should the site refresh automatically?
5. For accuracy questions ("is the AI model right?"), is comparing against ERA5 reanalysis worth the effort?
