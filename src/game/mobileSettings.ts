import {DEFAULT_SETTINGS,type Settings} from './types';

/** Persist preferences only; sensor permission/readiness is never saved. */
export function mobileSettings(value:unknown):Pick<Settings,'gyroMode'|'gyroSensitivity'|'fireDrag'> {
 const s=value&&typeof value==='object'?value as Partial<Settings>:{};
 return {
  gyroMode:s.gyroMode==='aim'||s.gyroMode==='always'?s.gyroMode:'off',
  gyroSensitivity:typeof s.gyroSensitivity==='number'&&Number.isFinite(s.gyroSensitivity)?Math.max(.3,Math.min(3,s.gyroSensitivity)):DEFAULT_SETTINGS.gyroSensitivity,
  fireDrag:typeof s.fireDrag==='boolean'?s.fireDrag:DEFAULT_SETTINGS.fireDrag,
 };
}
