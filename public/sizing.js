// Sizing table: ISO 8653:2016 "Jewellery - Ring-sizes - Definition, measurement and designation".
// The ISO ring size is the inner circumference of the ring in millimetres, rounded to the
// nearest millimetre. Source: ISO 8653:2016, clause on designation (https://www.iso.org/standard/62783.html).
// US/Canada equivalents use the published linear relation
//   inner diameter (mm) = 11.63 + 0.8128 x size   (0.458 in at size 0, 0.032 in per full size)
// Source: "Ring size", Wikipedia (https://en.wikipedia.org/wiki/Ring_size), North America section.
// US values are a secondary conversion, rounded to the nearest half size.

export const TABLE = {
  name: 'ISO 8653:2016 ring sizes',
  isoMin: 41,
  isoMax: 76,
  rounding: 'ISO size = inner circumference (π × inner diameter) in mm, rounded to the nearest whole millimetre; exact halves round up.',
};

export const isoSizeExact = (dMm) => Math.PI * dMm;
export const usSizeExact = (dMm) => (dMm - 11.63) / 0.8128;

function fmtUs(s) {
  const h = Math.round(s * 2) / 2;
  return Number.isInteger(h) ? String(h) : `${Math.floor(h)}½`;
}

export function sizeFor(dMm, uMm = 0) {
  const iso = Math.round(isoSizeExact(dMm));
  const lo = Math.round(isoSizeExact(dMm - uMm)), hi = Math.round(isoSizeExact(dMm + uMm));
  const inRange = iso >= TABLE.isoMin && iso <= TABLE.isoMax;
  return {
    inRange,
    iso: { size: iso, label: String(iso), low: lo, high: hi, exact: isoSizeExact(dMm) },
    us: { label: fmtUs(usSizeExact(dMm)), low: fmtUs(usSizeExact(dMm - uMm)), high: fmtUs(usSizeExact(dMm + uMm)) },
  };
}

// Rows for the documented table shown in the page.
export function tableRows() {
  const rows = [];
  for (let iso = TABLE.isoMin; iso <= TABLE.isoMax; iso++) {
    const d = iso / Math.PI;
    rows.push({ iso, diameterMm: d, lowMm: (iso - 0.5) / Math.PI, highMm: (iso + 0.5) / Math.PI, us: fmtUs(usSizeExact(d)) });
  }
  return rows;
}
