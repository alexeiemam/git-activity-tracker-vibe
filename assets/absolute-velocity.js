/**
 * Fixed, cohort-independent presentation of the observable daily contribution
 * index. One index unit corresponds to the weighted reference inputs defined
 * in contributionLevelUnits; it is not an hour, a line or a performance target.
 *
 * These colours never depend on the selected people, period or data maximum.
 * A value above the darkest reference still retains its exact numeric value.
 */
import {ZERO_COLOUR,MISSING_BACKGROUND} from './value-colour.js?v=personas-20261125-10';

/**
 * Stepped bands, not a continuous ramp: a reference day (4 commits, 200 changed
 * and 200 shipped lines, spread across the day) scores 1, and real days sit
 * between about 0.25 and 1.5, so distinct steps there keep neighbours apart.
 */
export const VELOCITY_MARKS=Object.freeze([0,0.25,0.5,0.75,1,1.5,2]);
export const VELOCITY_DARK_AT=2;
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const BANDS=VELOCITY_MARKS.length-1;
/** One step per band, evenly spaced in lightness from pale mint to deep green so neighbouring bands never blur. */
export const VELOCITY_COLOURS=Object.freeze(['#d6efe0','#aedfc2','#80c9a0','#50aa7d','#2b875f','#166044','#0a3a28']);

/** 0 for a zero day; otherwise the band's place from lightest (0) to darkest (1). */
export function velocityPosition(value) {
  if(!valid(value)||value===0)return null;
  const band=VELOCITY_MARKS.slice(1).filter(mark=>value>=mark).length;
  return band/BANDS;
}
export function velocityColour(value) {
  if(!valid(value))return null;
  return value===0?ZERO_COLOUR:VELOCITY_COLOURS[Math.round(velocityPosition(value)*BANDS)];
}

function textColour(fill) {
  const rgb=[1,3,5].map(i=>parseInt(fill.slice(i,i+2),16)/255)
    .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  const luminance=0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
  const white=1.05/(luminance+0.05),black=(luminance+0.05)/0.05;
  return white>=black?'#fff':'#17251d';
}
export function velocityStyle(value) {
  if(!valid(value))return `background:${MISSING_BACKGROUND};color:#64766a;border-color:#dae1d8`;
  const fill=velocityColour(value);
  return `background:${fill};color:${textColour(fill)};border-color:${value===0?'#d5ded4':fill}`;
}

export function velocityCellText(value) {
  if(!valid(value))return '—';
  if(value===0)return '0';
  if(value<0.1)return '<.1';
  if(value<10)return value.toFixed(1);
  return String(Math.round(value));
}

export function velocityLegend() {
  const label=value=>String(value).replace(/^0\./,'.');
  const swatches=[0.1,...VELOCITY_MARKS.slice(1)].map((value,index)=>
    `<span class="velocity-legend-stop"><i aria-hidden="true" style="background:${velocityColour(value)}"></i><span>${index===0?'<.25':index===BANDS?`${value}+`:label(value)}</span></span>`).join('');
  return `<div class="velocity-legend" role="group" aria-label="Absolute velocity index in fixed bands from under a quarter to two or more reference days. One is a reference day: 4 commits, 200 changed and 200 shipped lines, spread across the day. The same value has the same colour in every selection."><span class="velocity-legend-caption" title="1 = 4 commits, 200 changed and 200 shipped lines, spread across the day">FIXED INDEX · 1 ≈ A REFERENCE DAY</span><span class="velocity-legend-stop"><i aria-hidden="true" style="background:${ZERO_COLOUR}"></i><span>0</span></span>${swatches}<span class="numeric-key-missing" title="Outside imported evidence">— · unknown</span></div>`;
}
