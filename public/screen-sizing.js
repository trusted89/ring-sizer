import { sizeFor } from './sizing.js';

export const CARD_WIDTH_MM = 85.60;
export const CARD_SHORT_MM = 53.98;
const DEFAULT_SHORT_VIEW_WIDTH = 520;
const validReference = (mm) => mm === CARD_SHORT_MM || mm === CARD_WIDTH_MM;
// CSS 96 px/in is a useful starting estimate, never a physical calibration.
export const CALIBRATION_KEY = 'ringSizer.screenCalibration.v3';
export const startLineFor = (referenceMm) => Math.round(referenceMm * 96 / 25.4);
export const START_LINE_PX = startLineFor(CARD_WIDTH_MM);
export const circlePixels = (ringMm, linePx, referenceMm = CARD_WIDTH_MM) => ringMm * linePx / referenceMm;

function setupScreen() {
  const get = (id) => document.getElementById(id);
  const dialog = get('cal-dialog');
  const stage = get('cal-stage');
  const line = get('cal-line');
  const guide = get('cal-guide-note');
  const open = get('cal-open');
  const confirm = get('cal-confirm');
  const diameter = get('screen-diameter');
  const fitTitle = get('ring-fit-title');
  const circle = get('screen-circle');
  const fit = get('screen-fit');
  const status = get('cal-status');
  const reading = get('screen-reading');
  const viewport = window.visualViewport;
  const geometry = () => [
    window.devicePixelRatio,
    Number((viewport?.scale ?? 1).toFixed(4)), window.screen.width, window.screen.height,
    window.screen.orientation?.angle ?? window.orientation ?? 0,
  ].join(':');
  const MIN_LINE = 100;
  const DEFAULT_GUIDE = 'Only the right mark moves. Use the arrow keys for fine adjustment.';
  const referenceInputs = [...document.querySelectorAll('[name=cal-reference]')];
  let referenceMm = CARD_WIDTH_MM;
  let width = START_LINE_PX;
  const setReference = (mm) => {
    referenceMm = mm;
    for (const input of referenceInputs) input.checked = Number(input.value) === mm;
    width = startLineFor(mm);
  };
  let calibrated = null;
  let lastGeometry = geometry();
  let lastStageWidth = null;
  let confirmedOnClose = null;
  const savedCalibrations = new Map();
  const validSaved = (item) => item && typeof item.key === 'string' && validReference(item.referenceMm)
    && Number.isFinite(item.linePx) && item.linePx >= MIN_LINE && item.linePx <= 1000;
  try {
    const saved = JSON.parse(window.localStorage.getItem(CALIBRATION_KEY));
    // Accept a previously saved single match as well as the bounded history.
    for (const item of (Array.isArray(saved) ? saved.slice(-8) : [saved])) {
      if (validSaved(item)) savedCalibrations.set(item.key, item);
    }
  } catch { /* unavailable storage or invalid saved data */ }
  const restoreFor = (key) => savedCalibrations.get(key);
  const remember = (value) => {
    savedCalibrations.delete(value.key);
    savedCalibrations.set(value.key, value);
    if (savedCalibrations.size > 8) savedCalibrations.delete(savedCalibrations.keys().next().value);
    try { window.localStorage.setItem(CALIBRATION_KEY, JSON.stringify([...savedCalibrations.values()])); } catch { /* memory still works */ }
  };
  const updateOpenLabel = () => { open.textContent = calibrated ? 'Recalibrate with a card' : 'Calibrate with a card'; };
  const applyCalibration = (value, saved = false) => {
    calibrated = value;
    diameter.value = '17.5';
    reading.textContent = '';
    status.textContent = (saved ? 'Saved calibration restored.' : 'Screen calibrated.') +
      ' Keep the same screen and zoom; recalibrate after switching displays.';
    fit.hidden = false;
    updateOpenLabel();
    draw();
  };

  const maxWidth = () => Math.min(1000, stage.clientWidth - 14);
  const draw = () => {
    if (dialog.open) {
      const max = maxWidth();
      confirm.disabled = max < MIN_LINE;
      width = max < MIN_LINE ? 0 : Math.max(MIN_LINE, Math.min(width, max));
      line.style.width = width + 'px';
      if (max < MIN_LINE) guide.textContent = 'This view is too narrow. Try a larger screen.';
    }
    if (calibrated) {
      const px = circlePixels(Number(diameter.value), calibrated.linePx, calibrated.referenceMm);
      circle.style.width = circle.style.height = px + 'px';
    }
  };
  const invalidate = (why) => {
    calibrated = null;
    fit.hidden = true;
    reading.textContent = '';
    status.textContent = why;
    updateOpenLabel();
  };
  const checkGeometry = () => {
    const current = geometry();
    if (current !== lastGeometry) {
      lastGeometry = current;
      if (calibrated) invalidate('The screen or zoom changed. Match your card again before measuring.');
      if (!dialog.open) {
        const saved = restoreFor(current);
        if (saved) applyCalibration(saved, true);
      }
      if (dialog.open) {
        width = startLineFor(referenceMm);
        guide.textContent = 'Screen scale changed. Line both card edges up again.';
      }
    }
    if (dialog.open) {
      const stageWidth = stage.clientWidth;
      if (lastStageWidth !== null && lastStageWidth !== stageWidth) {
        guide.textContent = 'The guide moved. Line both card edges up again.';
      }
      lastStageWidth = stageWidth;
    }
    draw();
  };
  const adjust = (delta) => {
    checkGeometry();
    width += delta;
    draw();
  };
  open.addEventListener('click', () => {
    checkGeometry();
    setReference(calibrated?.referenceMm ?? (window.innerWidth < DEFAULT_SHORT_VIEW_WIDTH ? CARD_SHORT_MM : CARD_WIDTH_MM));
    if (calibrated) width = calibrated.linePx;
    guide.textContent = DEFAULT_GUIDE;
    document.documentElement.classList.add('calibration-open');
    dialog.showModal();
    lastGeometry = geometry();
    lastStageWidth = stage.clientWidth;
    draw();
  });
  for (const input of referenceInputs) input.addEventListener('change', () => {
    if (!input.checked || !validReference(Number(input.value))) return;
    setReference(Number(input.value));
    guide.textContent = DEFAULT_GUIDE;
    draw();
  });
  get('cal-cancel').addEventListener('click', () => dialog.close());
  stage.addEventListener('wheel', (event) => { if (!event.ctrlKey) event.preventDefault(); }, { passive: false });
  stage.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  dialog.addEventListener('close', () => {
    lastStageWidth = null;
    document.documentElement.classList.remove('calibration-open');
    const explicitMatch = confirmedOnClose;
    confirmedOnClose = null;
    checkGeometry();
    const saved = restoreFor(lastGeometry);
    if (explicitMatch?.key === lastGeometry) {
      applyCalibration(explicitMatch);
      // Native dialogs restore focus to the opener. Reveal and focus the next
      // step only after close/unlock, never during passive restoration.
      requestAnimationFrame(() => {
        if (dialog.open || fit.hidden || calibrated !== explicitMatch) return;
        fitTitle.focus({ preventScroll: true });
        fitTitle.scrollIntoView({ block: 'start' });
      });
    } else if (!calibrated && saved) {
      applyCalibration(saved, true);
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target?.name === 'cal-reference' || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    adjust((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1));
  });
  document.querySelectorAll('[data-adjust]').forEach(button => {
    button.addEventListener('click', () => adjust(Number(button.dataset.adjust)));
  });
  diameter.addEventListener('input', () => {
    reading.textContent = '';
    checkGeometry();
  });
  document.querySelectorAll('[data-nudge]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = get(button.dataset.nudge);
      Number(button.dataset.step) < 0 ? input.stepDown() : input.stepUp();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  confirm.addEventListener('click', () => {
    if (!dialog.open) return;
    const previous = lastGeometry;
    checkGeometry();
    if (previous !== lastGeometry || confirm.disabled) return;
    const linePx = line.getBoundingClientRect().width;
    if (linePx < MIN_LINE) return;
    const value = { linePx, referenceMm, key: lastGeometry };
    remember(value);
    confirmedOnClose = value;
    dialog.close();
  });
  get('ring-confirm').addEventListener('click', () => {
    checkGeometry();
    if (!calibrated || calibrated.key !== geometry()) return;
    const mm = Number(diameter.value);
    const sizes = sizeFor(mm);
    reading.textContent = `Estimated inner diameter: ${mm.toFixed(1)} mm` +
      (sizes.inRange ? ` · ISO ${sizes.iso.label} · US/Canada ≈ ${sizes.us.label}` : ' · Outside the sizing table');
  });
  window.addEventListener('resize', checkGeometry);
  viewport?.addEventListener('resize', checkGeometry);
  window.screen.orientation?.addEventListener?.('change', checkGeometry);
  if ('ResizeObserver' in window) new ResizeObserver(checkGeometry).observe(stage);
  const saved = restoreFor(lastGeometry);
  if (saved) applyCalibration(saved, true);
  checkGeometry();
}

if (typeof document !== 'undefined' && document.getElementById('screen')) setupScreen();
