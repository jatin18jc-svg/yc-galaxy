# YC Galaxy

An interactive map of ~2,760 Y Combinator companies (Winter 2022 → latest cohorts), rendered as a galaxy: sectors form constellations, sub-sectors form star clusters, and every company is a star. Toggle between 2D (canvas + D3) and 3D (three.js) views.

- Star color = AI category, styled like stellar temperature classes (blue-white AI-native, gold AI-enabled, ember Non-AI)
- Aurora-teal ring = acquired, dimmed = inactive
- Re-cluster the whole galaxy by sector, geography, or business model — dots morph between layouts
- Timeline scrubber replays YC batch by batch
- Filters, search, and click-through company profiles with website / YC links

## Run locally

```sh
python3 -m http.server 8642 --directory galaxy
# open http://localhost:8642
```

Any static file server works — there is no build step.

## Update the data

The dataset is exported from the `Companies` sheet of `yc_market_map.xlsx` (kept out of the repo). After editing the spreadsheet:

```sh
python3 galaxy/build_data.py
```

This rewrites `galaxy/data.json`, which the app loads at startup.

## Deploy

The site is fully static (`galaxy/` is the web root):

- **Vercel / Netlify / Cloudflare Pages**: import the repo, set the root (output) directory to `galaxy`, no build command.
- **GitHub Pages**: the included workflow (`.github/workflows/pages.yml`) publishes `galaxy/` on every push to `main`. Enable it in repo Settings → Pages → Source: GitHub Actions. Requires a public repo on the free plan.
