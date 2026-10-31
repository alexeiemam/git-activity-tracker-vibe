/**
 * Shared sequential colour encoding for numeric cells throughout git:signals.
 *
 * Zero is categorically different from any positive observation. Positive
 * observations use a perceptually ordered, log-spaced progression to keep
 * sparse activity legible alongside outliers. Missing observations stay
 * separate from observed zero and must never be passed as 0 by a caller.
 */
export const ZERO_COLOUR = '#edf1ec';
export const MISSING_BACKGROUND = 'repeating-linear-gradient(135deg,#f7f8f5 0px,#f7f8f5 5px,#e2e8e0 5px,#e2e8e0 10px)';
export const POSITIVE_COLOURS = ['#5f9f7d', '#4f9271', '#3d8062', '#2c6b50', '#19533c'];

const clamp = x => Math.min(1, Math.max(0, x));
const valid = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function makeIntensityScale(values) {
  let minPositive = Infinity;
  let max = 0;
  for (const value of values) {
    if (!valid(value)) continue;
    if (value > 0) minPositive = Math.min(value, minPositive);
    max = Math.max(value, max);
  }
  return { minPositive: minPositive === Infinity ? null : minPositive, max };
}

export function intensityPosition(value, scale) {
  if (!valid(value) || value === 0) return null;
  const min = scale?.minPositive;
  const max = scale?.max;
  if (!(min > 0) || !(max > min)) return 1;
  return clamp(Math.log(value / min) / Math.log(max / min));
}

export function positiveColour(position) {
  const scaled = clamp(position) * (POSITIVE_COLOURS.length - 1);
  const a = Math.min(POSITIVE_COLOURS.length - 1, Math.floor(scaled));
  const b = Math.min(POSITIVE_COLOURS.length - 1, a + 1);
  const mix = scaled - a;
  const rgb = channel => {
    const from = parseInt(POSITIVE_COLOURS[a].slice(1 + channel * 2, 3 + channel * 2), 16);
    const to = parseInt(POSITIVE_COLOURS[b].slice(1 + channel * 2, 3 + channel * 2), 16);
    return Math.round(from + (to - from) * mix).toString(16).padStart(2, '0');
  };
  return `#${rgb(0)}${rgb(1)}${rgb(2)}`;
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

export function intensitySwatches(scale, positiveSteps = 5) {
  if (!scale?.minPositive) return [0];
  if (scale.minPositive === scale.max) return [0, scale.max];
  return [0, ...Array.from({length: positiveSteps}, (_, index) =>
    scale.minPositive * (scale.max / scale.minPositive) ** (index / (positiveSteps - 1))
  )];
}

/** Consistent labelled legend; 0 and missing are never included in the positive gradient. */
export function intensityLegend(scale, format = x => String(x), {missing = false} = {}) {
  const swatches = intensitySwatches(scale);
  const spans = swatches.map((value, index) =>
    `<i class="numeric-key-swatch ${index === 0 ? 'is-zero' : ''}" style="background:${intensityColour(value, scale)}" title="${index === 0 ? '0 · observed but no activity' : `${format(value)} · positive activity`}" aria-hidden="true"></i>`
  ).join('');
  return `<div class="numeric-gradient-key" role="group" aria-label="Zero is neutral. Every positive value is green; darker green indicates more activity. Positive shades use a logarithmic scale.">
    <span>0 · none</span><span class="numeric-key-swatches">${spans}</span>
    <span>${scale?.minPositive == null ? 'No activity' : `${format(scale.max)} · highest`}</span>
    ${missing ? '<span class="numeric-key-missing" title="Not observed or undefined">— · unavailable</span>' : ''}<span class="numeric-key-method" title="Positive values are log-spaced to make sparse activity visible">log-scaled positives</span>
  </div>`;
}
