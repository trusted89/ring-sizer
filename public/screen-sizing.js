import { sizeFor } from './sizing.js';

export const CARD_WIDTH_MM = 85.60;
export const CARD_SHORT_MM = 53.98;
const DEFAULT_SHORT_VIEW_WIDTH = 520;
const validReference = (mm) => mm === CARD_SHORT_MM || mm === CARD_WIDTH_MM;
// CSS 96 px/in is a useful starting estimate, never a physical calibration.
export const FIT_SESSION_KEY = 'ringSizer.activeFitting.v1';
export const CALIBRATION_KEY = 'ringSizer.screenCalibration.v3';
export const startLineFor = (referenceMm) => Math.round(referenceMm * 96 / 25.4);
export const START_LINE_PX = startLineFor(CARD_WIDTH_MM);
export const circlePixels = (ringMm, linePx, referenceMm = CARD_WIDTH_MM) => ringMm * linePx / referenceMm;

function setupScreen() {
  const get = (id) => document.getElementById(id);
  const dialog = get('cal-dialog');
  const fitDialog = get('ring-dialog');
  const ringStage = get('ring-stage');
  const ringSpace = get('ring-space-note');
  const fitConfirm = get('ring-confirm');
  const ringOpen = get('ring-open');
  const previousReading = get('screen-last-reading');
  const exitFitting = get('ring-exit');
  const stage = get('cal-stage');
  const line = get('cal-line');
  const card = get('cal-card-shape');
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
  let introShown = false;
  let fitConfirmed = false;
  const fitRoute = () => {
    const { pathname, search, hash } = window.location;
    return !hash || hash === '#screen' ? pathname + search : null;
  };
  const clearFitCheckpoint = () => {
    try { window.sessionStorage.removeItem(FIT_SESSION_KEY); } catch { /* storage unavailable */ }
  };
  const saveFitCheckpoint = () => {
    const route = fitRoute();
    if (!route || !fitDialog.open || !calibrated || calibrated.key !== geometry()) return;
    try {
      window.sessionStorage.setItem(FIT_SESSION_KEY, JSON.stringify({
        route, key: calibrated.key, linePx: calibrated.linePx, referenceMm: calibrated.referenceMm,
        mm: Number(diameter.value), confirmed: fitConfirmed,
      }));
    } catch { /* current session still works */ }
  };
  const savedFitting = () => {
    try {
      const item = JSON.parse(window.sessionStorage.getItem(FIT_SESSION_KEY));
      const route = fitRoute();
      if (route && item?.route === route && calibrated && item.key === calibrated.key &&
          item.key === geometry() && item.linePx === calibrated.linePx && item.referenceMm === calibrated.referenceMm &&
          Number.isFinite(item.mm) && item.mm >= Number(diameter.min) && item.mm <= Number(diameter.max) &&
          Math.abs(item.mm * 10 - Math.round(item.mm * 10)) < 1e-7 && typeof item.confirmed === 'boolean') return item;
    } catch { /* absent, malformed or unavailable */ }
    return null;
  };
  const showFitResult = () => {
    const mm = Number(diameter.value);
    const sizes = sizeFor(mm);
    reading.textContent = previousReading.textContent = `Estimated inner diameter: ${mm.toFixed(1)} mm` +
      (sizes.inRange ? ` · ISO ${sizes.iso.label} · US/Canada ≈ ${sizes.us.label}` : ' · Outside the sizing table');
    exitFitting.textContent = 'Done';
    fitConfirmed = true;
  };
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
    fitConfirmed = false;
    diameter.value = '17.5';
    reading.textContent = previousReading.textContent = '';
    exitFitting.textContent = 'Exit fitting';
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
      line.style.width = card.style.width = width + 'px';
      const otherEdgeMm = referenceMm === CARD_SHORT_MM ? CARD_WIDTH_MM : CARD_SHORT_MM;
      card.style.height = width * otherEdgeMm / referenceMm + 'px';
      card.hidden = width === 0;
      if (max < MIN_LINE) guide.textContent = 'This view is too narrow. Try a larger screen.';
    }
    if (calibrated) {
      const px = circlePixels(Number(diameter.value), calibrated.linePx, calibrated.referenceMm);
      circle.style.width = circle.style.height = px + 'px';
      // Reserve room for the largest circle, so its center never shifts as it grows.
      ringStage.style.setProperty('--ring-maximum-px', Math.ceil(circlePixels(Number(diameter.max), calibrated.linePx, calibrated.referenceMm) + 24) + 'px');
      if (fitDialog.open) {
        const room = px + 8 <= ringStage.clientWidth;
        circle.hidden = !room;
        ringSpace.hidden = room;
        fitConfirm.disabled = !room;
      }
    }
  };
  const invalidate = (why) => {
    calibrated = null;
    fitConfirmed = false;
    fit.hidden = true;
    reading.textContent = previousReading.textContent = '';
    if (fitDialog.open) {
      fitDialog.close();
      // On automatic exit the Measure ring opener is now hidden.
      open.focus({ preventScroll: true });
    }
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
  const syncPageLock = () => {
    if (dialog.open || fitDialog.open) document.documentElement.classList.add('calibration-open');
    else document.documentElement.classList.remove('calibration-open');
  };
  const openFitting = (restored = null) => {
    checkGeometry();
    if (!calibrated || calibrated.key !== geometry() || dialog.open || fitDialog.open) return;
    if (restored) diameter.value = String(restored.mm);
    fitDialog.showModal();
    syncPageLock();
    fitTitle.focus({ preventScroll: true });
    draw();
    if (restored?.confirmed && !fitConfirm.disabled) showFitResult();
    saveFitCheckpoint();
  };
  const resumeFitting = () => {
    checkGeometry();
    const item = savedFitting();
    const photoLive = get('live');
    if (item && get('result').hidden && (!photoLive || photoLive.hidden)) openFitting(item);
  };
  ringOpen.addEventListener('click', () => openFitting());
  exitFitting.addEventListener('click', () => { clearFitCheckpoint(); fitDialog.close(); });
  fitDialog.addEventListener('cancel', clearFitCheckpoint);
  fitDialog.addEventListener('close', syncPageLock);
  window.addEventListener('hashchange', () => {
    if (!fitRoute()) {
      if (fitDialog.open) fitDialog.close();
    } else resumeFitting();
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) resumeFitting(); });
  const consume = (event) => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  for (const surface of [stage, ringStage]) {
    surface.addEventListener('wheel', (event) => { if (!event.ctrlKey && !event.metaKey) consume(event); }, { passive: false });
  }
  stage.addEventListener('touchmove', (event) => { if ((event.touches?.length ?? 1) === 1) consume(event); }, { passive: false });
  // A metal ring can generate several contacts and a follow-up synthetic
  // click. Suppress them on this inert surface only, never page-wide.
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'click', 'dblclick', 'contextmenu', 'dragstart', 'selectstart']) {
    ringStage.addEventListener(type, consume, { passive: false });
  }
  fitDialog.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target === diameter) return;
    if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    ['ArrowLeft', 'ArrowDown'].includes(event.key) ? diameter.stepDown() : diameter.stepUp();
    diameter.dispatchEvent(new Event('input', { bubbles: true }));
  });
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
    dialog.showModal();
    syncPageLock();
    if (!introShown) {
      introShown = true;
      card.classList.add('cal-cue-intro');
    }
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
  dialog.addEventListener('close', () => {
    card.classList.remove('cal-cue-intro');
    lastStageWidth = null;
    syncPageLock();
    const explicitMatch = confirmedOnClose;
    confirmedOnClose = null;
    checkGeometry();
    const saved = restoreFor(lastGeometry);
    if (explicitMatch?.key === lastGeometry) {
      applyCalibration(explicitMatch);
      // Wait for the native dialog close/focus return before opening its
      // successor. Passive restores keep the inline Measure ring entry.
      requestAnimationFrame(() => {
        if (fit.hidden || calibrated !== explicitMatch) return;
        openFitting();
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
    fitConfirmed = false;
    reading.textContent = previousReading.textContent = '';
    exitFitting.textContent = 'Exit fitting';
    checkGeometry();
    saveFitCheckpoint();
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
  fitConfirm.addEventListener('click', () => {
    checkGeometry();
    if (!fitDialog.open || fitConfirm.disabled || !calibrated || calibrated.key !== geometry()) return;
    showFitResult();
    saveFitCheckpoint();
  });
  window.addEventListener('resize', checkGeometry);
  viewport?.addEventListener('resize', checkGeometry);
  window.screen.orientation?.addEventListener?.('change', checkGeometry);
  if ('ResizeObserver' in window) new ResizeObserver(checkGeometry).observe(stage);
  const saved = restoreFor(lastGeometry);
  if (saved) applyCalibration(saved, true);
  checkGeometry();
  const navigation = window.performance?.getEntriesByType?.('navigation')[0]?.type;
  if (saved && (!navigation || navigation === 'reload' || navigation === 'back_forward')) requestAnimationFrame(resumeFitting);
}

if (typeof document !== 'undefined' && document.getElementById('screen')) setupScreen();
