const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;
const DT = 0.004;

const k1 = new Float64Array(3);
const k2 = new Float64Array(3);
const k3 = new Float64Array(3);
const k4 = new Float64Array(3);

function deriv(x, y, z, out) {
  out[0] = SIGMA * (y - x);
  out[1] = x * (RHO - z) - y;
  out[2] = x * y - BETA * z;
}

function rk4(s, h) {
  const [x, y, z] = s;
  deriv(x, y, z, k1);
  deriv(x + (h / 2) * k1[0], y + (h / 2) * k1[1], z + (h / 2) * k1[2], k2);
  deriv(x + (h / 2) * k2[0], y + (h / 2) * k2[1], z + (h / 2) * k2[2], k3);
  deriv(x + h * k3[0], y + h * k3[1], z + h * k3[2], k4);
  for (let j = 0; j < 3; j++) s[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
}

/**
 * Lorenz (1963) runs from one base state, each nudged by its own offset along x (and half that along y).
 * Returns one Float32Array of x per run, sampled `perDay` times a day for `days` days.
 */
export function lorenzRuns(base, offsets, { days, perDay, daysPerUnit }) {
  const n = days * perDay + 1;
  const sub = Math.max(1, Math.round(1 / (perDay * daysPerUnit * DT)));
  const h = 1 / (perDay * daysPerUnit * sub);
  return offsets.map((d) => {
    const s = new Float64Array([base[0] + d, base[1] + d / 2, base[2]]);
    const xs = new Float32Array(n);
    xs[0] = s[0];
    for (let i = 1; i < n; i++) {
      for (let k = 0; k < sub; k++) rk4(s, h);
      xs[i] = s[0];
    }
    return xs;
  });
}
