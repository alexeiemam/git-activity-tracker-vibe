/**
 * Shared numerical colour scale. Zero means no observed activity, never missing.
 * Positive values are green, and missing observations use a separate pattern.
 *
 * The hue and wide lightness range make the smallest positive conspicuous against
 * zero. Within the positive range, colours are interpolated in OKLab (roughly
 * equal perceptual steps) and mapped by the actual VALUE ratio on a log axis.
 * A narrow positive range uses only part of the palette; 10 vs 11 should not
 * look as different as 1 vs 100 merely because both are min and max.
 */
export const ZERO_COLOUR = '#edf1ec';
export const MISSING_BACKGROUND = 'repeating-linear-gradient(135deg,#f7f8f5 0px,#f7f8f5 5px,#e2e8e0 5px,#e2e8e0 10px)';

// Fourfold positive variation is enough to justify the full colour span.
// Below that, use a proportional fraction of the span. This avoids overstating
// a tiny range while preserving a continuous, rank-independent encoding.
const FULL_SPAN_RATIO = 4;
const LOW_POSITIVE = '#57c58d';
const HIGH_POSITIVE = '#092f24';
const clamp = x => Math.min(1, Math.max(0, x));
const valid = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

// Standard sRGB <-> OKLab conversions. No runtime CSS colour-function support
// or dependency is required: the browser receives ordinary #rrggbb colours.
function toLab(hex) {
  const linear = [1, 3, 5].map(n => {
    const c = parseInt(hex.slice(n, n + 2), 16) / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  const [r, g, b] = linear;
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [
    .2104542553*l + .793617785*m - .0040720468*s,
    1.9779984951*l - 2.428592205*m + .4505937099*s,
    .0259040371*l + .7827717662*m - .808675766*s,
  ];
}
function fromLab([L, a, b]) {
  const l = (L + .3963377774*a + .2158037573*b) ** 3;
  const m = (L - .1055613458*a - .0638541728*b) ** 3;
  const s = (L - .0894841775*a - 1.291485548*b) ** 3;
  const linear = [
    4.0767416621*l - 3.3077115913*m + .2309699292*s,
    -1.2684380046*l + 2.6097574011*m - .3413193965*s,
    -.0041960863*l - .7034186147*m + 1.707614701*s,
  ];
  return `#${linear.map(channel => {
    const srgb = channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - .055;
    return Math.round(clamp(srgb) * 255).toString(16).padStart(2, '0');
  }).join('')}`;
}

const lowLab = toLab(LOW_POSITIVE);
const highLab = toLab(HIGH_POSITIVE);
export function positiveColour(position) {
  const t = clamp(Number.isFinite(position) ? position : 0);
  return fromLab(lowLab.map((v, i) => v + (highLab[i] - v) * t));
}
// Seven reference shades, useful for inspecting the actual perceptual ramp.
export const POSITIVE_COLOURS = Array.from({length: 7}, (_, i) => positiveColour(i / 6));

export function makeIntensityScale(values) {
  let minPositive = Infinity;
  let max = 0;
  for (const value of values) {
    if (!valid(value)) continue;
    if (value > 0) minPositive = Math.min(value, minPositive);
    max = Math.max(value, max);
  }
  return {minPositive: minPositive === Infinity ? null : minPositive, max};
}

/** Zero/undefined return null; a positive returns a position in [0,1]. */
export function intensityPosition(value, scale) {
  if (!valid(value) || value === 0) return null;
  const min = scale?.minPositive;
  const max = scale?.max;
  if (!(min > 0) || !(max > min)) return 0;
  // Subtract logs rather than dividing the numbers: even finite max/min may
  // overflow if values range from very small fractions to very large counts.
  const distance = Math.log(max) - Math.log(min);
  if (!(distance > 0)) return 0;
  const fullRange = clamp((Math.log(value) - Math.log(min)) / distance);
  const span = clamp(distance / Math.log(FULL_SPAN_RATIO));
  return fullRange * span;
}

/** Returns null for unobserved/undefined cells, not the zero colour. */
export function intensityColour(value, scale) {
  if (!valid(value)) return null;
  if (value === 0) return ZERO_COLOUR;
  return positiveColour(intensityPosition(value, scale));
}

function contrast(hex, ink) {
  const luminance = colour => {
    const linear = [1, 3, 5].map(n => {
      const c = parseInt(colour.slice(n, n + 2), 16) / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  };
  const x = luminance(hex), y = luminance(ink);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

export function intensityTextColour(value, scale) {
  const fill = intensityColour(value, scale);
  if (!fill) return '#64766a';
  return contrast(fill, '#ffffff') >= contrast(fill, '#000000') ? '#ffffff' : '#000000';
}

/** Inline styles work for table cells and small chart squares alike. */
export function intensityStyle(value, scale) {
  if (!valid(value)) return `background:${MISSING_BACKGROUND};color:#64766a;border-color:#dae1d8`;
  const fill = intensityColour(value, scale);
  return `background:${fill};color:${intensityTextColour(value, scale)};border-color:${value === 0 ? '#d5ded4' : fill}`;
}

export function intensitySwatches(scale, positiveSteps = 7) {
  if (!scale?.minPositive) return [0];
  if (scale.minPositive === scale.max) return [0, scale.max];
  const lo = Math.log(scale.minPositive), hi = Math.log(scale.max);
  const steps = Math.max(2, positiveSteps);
  return [0, ...Array.from({length: steps}, (_, index) =>
    index === 0 ? scale.minPositive : index === steps - 1 ? scale.max
      : Math.exp(lo + (hi - lo) * (index / (steps - 1)))
  )];
}

// A fractional positive must never be described as zero just because a chart's
// usual number formatter rounds to a whole number. Preserve any unit suffix.
function legendValue(value, format) {
  const shown = String(format(value));
  if (value > 0 && shown === String(format(0))) {
    const firstZero = shown.indexOf('0');
    if (firstZero >= 0) return shown.slice(0, firstZero) + Number(value.toPrecision(3)) + shown.slice(firstZero + 1);
  }
  return shown;
}

/** Label the observed endpoints: colours indicate ratios, not percentile rank. */
export function intensityLegend(scale, format = x => String(x), {missing = false} = {}) {
  const swatches = intensitySwatches(scale);
  const spans = swatches.map((value, index) =>
    `<i class="numeric-key-swatch ${index === 0 ? 'is-zero' : ''}" style="background:${intensityColour(value, scale)}" title="${index === 0 ? '0 · observed but no activity' : `${legendValue(value, format)} · positive activity`}" aria-hidden="true"></i>`
  ).join('');
  const min = scale?.minPositive;
  const endpoint = min == null ? 'No positive values'
    : min === scale.max ? `${legendValue(min, format)} · only positive value`
      : `${legendValue(min, format)} → ${legendValue(scale.max, format)} · positive range`;
  const method = min == null ? '' : min === scale.max ? 'one positive level' : 'log by value, not percentile';
  return `<div class="numeric-gradient-key" role="group" aria-label="Zero is neutral, missing is hatched. Positive values use a perceptually spaced green gradient mapped to actual value ratios, not ranks. Narrow ranges use less contrast.">
    <span>0 · none</span><span class="numeric-key-swatches">${spans}</span>
    <span class="numeric-key-endpoints">${endpoint}</span>
    ${missing ? '<span class="numeric-key-missing" title="Not observed or undefined">— · unavailable</span>' : ''}${method ? `<span class="numeric-key-method" title="The logarithmic scale is applied to actual ratios. When values vary by less than fourfold, less than the full palette is used.">${method}</span>` : ''}
  </div>`;
}
