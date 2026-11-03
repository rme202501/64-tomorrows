export const BOUNDS = { west: -80, east: -66, south: 40, north: 48 };

export const NE_STATES = new Set([
  "Maine", "New Hampshire", "Vermont", "Massachusetts", "Rhode Island",
  "Connecticut", "New York", "New Jersey", "Pennsylvania",
]);

const spanLon = BOUNDS.east - BOUNDS.west;
const spanLat = BOUNDS.north - BOUNDS.south;

export const toUv = (lon, lat) => [(lon - BOUNDS.west) / spanLon, (lat - BOUNDS.south) / spanLat];

/** land mask in lon/lat space, north up, for a CanvasTexture */
export function landMask(geo, width = 1400) {
  const height = Math.round((width * spanLat) / spanLon);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const project = d3.geoTransform({
    point(lon, lat) {
      this.stream.point(((lon - BOUNDS.west) / spanLon) * width, ((BOUNDS.north - lat) / spanLat) * height);
    },
  });
  const path = d3.geoPath(project, g);
  g.fillStyle = "#000";
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#fff";
  g.beginPath();
  path(geo.land);
  g.fill();
  g.fillStyle = "#000";
  g.beginPath();
  path(LAKES);
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  path({ type: "FeatureCollection", features: geo.states.features });
  g.fill();
  return canvas;
}

/** box-blurred, downsampled copy of the land mask for the terrain shelf (smooth coastal slopes) */
export function shelfMask(mask, factor = 4, radius = 3, passes = 3) {
  const g = mask.getContext("2d");
  const src = g.getImageData(0, 0, mask.width, mask.height).data;
  const w = Math.floor(mask.width / factor);
  const h = Math.floor(mask.height / factor);
  let a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) s += src[((y * factor + dy) * mask.width + x * factor + dx) * 4];
      }
      a[y * w + x] = s / (factor * factor * 255);
    }
  }
  let b = new Float32Array(w * h);
  const n = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))];
        b[y * w + x] = s / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += b[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        a[y * w + x] = s / n;
      }
    }
  }
  return { data: a, width: w, height: h };
}

/** deduplicated outline segments of the Northeast states, clipped to the map, as [lon,lat,lon,lat] */
export function stateSegments(geo) {
  const pad = 0.05;
  const inside = ([lon, lat]) => lon >= BOUNDS.west - pad && lon <= BOUNDS.east + pad
    && lat >= BOUNDS.south - pad && lat <= BOUNDS.north + pad;
  const seen = new Set();
  const out = [];
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  for (const f of geo.states.features) {
    if (!NE_STATES.has(f.properties?.name)) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        let prev = ring[0];
        for (let k = 1; k < ring.length; k++) {
          const p = ring[k];
          if (!inside(prev) || !inside(p)) { prev = p; continue; }
          const a = key(prev);
          const b = key(p);
          const id = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (!seen.has(id) && a !== b) {
            seen.add(id);
            out.push([prev[0], prev[1], p[0], p[1]]);
          }
          prev = p;
        }
      }
    }
  }
  return out;
}

const ring = (pts) => [[...pts, pts[0]]];
const LAKES = {
  type: "MultiPolygon",
  coordinates: [
    ring([
      [-79.9, 43.28], [-79.78, 43.33], [-79.6, 43.48], [-79.38, 43.63], [-79.1, 43.75], [-78.85, 43.87],
      [-78.4, 43.92], [-78.17, 43.95], [-77.9, 43.98], [-77.73, 44.0], [-77.6, 43.93], [-77.4, 43.87],
      [-77.2, 43.85], [-77.05, 43.9], [-76.85, 43.95], [-76.82, 44.05], [-76.6, 44.15], [-76.45, 44.2],
      [-76.3, 44.2], [-76.1, 44.15], [-76.0, 43.9], [-76.2, 43.3], [-77.6, 43.1], [-79.0, 43.1], [-79.9, 43.1],
    ]),
    ring([
      [-80.6, 42.6], [-80.2, 42.62], [-80.05, 42.56], [-79.8, 42.7], [-79.5, 42.85], [-79.25, 42.87],
      [-79.0, 42.88], [-78.9, 42.9], [-78.85, 42.7], [-79.4, 42.2], [-80.6, 41.8],
    ]),
    ring([
      [-80.6, 44.5], [-80.05, 44.55], [-79.95, 44.75], [-80.05, 45.0], [-80.3, 45.3], [-80.45, 45.6], [-80.6, 45.8],
    ]),
  ],
};

export const CITIES = [
  { id: "harvard", name: "Harvard", lon: -71.1167, lat: 42.377, side: "left", mobileSide: "up", home: true },
  { id: "boston", name: "Boston", lon: -71.0589, lat: 42.3601, side: "right" },
  { id: "nyc", name: "New York", lon: -74.006, lat: 40.7128, side: "right" },
  { id: "portland", name: "Portland", lon: -70.2568, lat: 43.6591, side: "right" },
  { id: "burlington", name: "Burlington", lon: -73.2121, lat: 44.4759, side: "left" },
  { id: "albany", name: "Albany", lon: -73.7562, lat: 42.6526, side: "left" },
];
