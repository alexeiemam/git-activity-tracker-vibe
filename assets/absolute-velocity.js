/**
 * Fixed, cohort-independent presentation of the observable daily contribution
 * index. One index unit corresponds to the weighted reference inputs defined
 * in contributionLevelUnits; it is not an hour, a line or a performance target.
 *
 * These colours never depend on the selected people, period or data maximum.
 * A value above the darkest reference still retains its exact numeric value.
 */
import {positiveColour,ZERO_COLOUR,MISSING_BACKGROUND} from './value-colour.js?v=git-quadrant-inspection-20261108-1';

export const VELOCITY_MARKS=Object.freeze([0,0.25,0.5,1,1.5,2,3]);
export const VELOCITY_DARK_AT=3;
const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;

export function velocityPosition(value) {
  if(!valid(value)||value===0)return null;
  return Math.min(1,Math.log1p(2*value)/Math.log1p(2*VELOCITY_DARK_AT));
}
export function velocityColour(value) {
  if(!valid(value))return null;
  return value===0?ZERO_COLOUR:positiveColour(velocityPosition(value));
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
  const swatches=VELOCITY_MARKS.map((value,index)=>
    `<span class="velocity-legend-stop"><i aria-hidden="true" style="background:${velocityColour(value)}"></i><span>${index===VELOCITY_MARKS.length-1?'3+':value}</span></span>`).join('');
  return `<div class="velocity-legend" role="group" aria-label="Absolute velocity index colour scale: fixed thresholds from zero through three or more. Same value has the same colour in every selection."><span class="velocity-legend-caption">FIXED INDEX</span>${swatches}<span class="numeric-key-missing" title="Outside imported evidence">— · unknown</span></div>`;
}
