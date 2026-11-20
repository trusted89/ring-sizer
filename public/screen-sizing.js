import { sizeFor } from './sizing.js';

export const CARD_WIDTH_MM = 85.60;
export const circlePixels = (ringMm, linePx) => ringMm * linePx / CARD_WIDTH_MM;

function setupScreen() {
  const get = (id) => document.getElementById(id);
  const stage = get('cal-stage');
  const line = get('cal-line');
  const calibration = get('cal-width');
  const diameter = get('screen-diameter');
  const circle = get('screen-circle');
  const fit = get('screen-fit');
  const status = get('cal-status');
  const reading = get('screen-reading');
  const viewport = window.visualViewport;
  const geometry = () => [
    stage.clientWidth, window.innerWidth, window.devicePixelRatio,
    Number((viewport?.scale ?? 1).toFixed(4)),
    window.screen.orientation?.angle ?? window.orientation ?? 0,
  ].join(':');
  let calibrated = null;
  let lastGeometry = geometry();

  const draw = () => {
    line.style.width = calibration.value + 'px';
    if (calibrated) {
      const px = circlePixels(Number(diameter.value), calibrated.linePx);
      circle.style.width = circle.style.height = px + 'px';
    }
  };
  const invalidate = (why) => {
    calibrated = null;
    fit.hidden = true;
    reading.textContent = '';
    status.textContent = why;
  };
  const checkGeometry = () => {
    const current = geometry();
    calibration.max = Math.min(1000, Math.max(100, stage.clientWidth - 12));
    if (current !== lastGeometry) {
      lastGeometry = current;
      if (calibrated) invalidate('The screen or zoom changed. Match your card again before measuring.');
    }
    draw();
  };
  calibration.addEventListener('input', () => {
    if (calibrated) invalidate('Line changed. Confirm the card match again.');
    draw();
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
  get('cal-confirm').addEventListener('click', () => {
    checkGeometry();
    if (stage.clientWidth < 112) {
      invalidate('This screen is too narrow to calibrate. Try a larger screen.');
      return;
    }
    calibrated = { linePx: line.getBoundingClientRect().width, key: geometry() };
    diameter.value = '17.5';
    reading.textContent = '';
    status.textContent = 'Screen calibrated. Keep the same screen and zoom.';
    fit.hidden = false;
    draw();
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
  checkGeometry();
}

if (typeof document !== 'undefined' && document.getElementById('screen')) setupScreen();
