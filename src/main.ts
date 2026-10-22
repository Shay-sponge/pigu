import './style.css';
import { createIcons, Fingerprint, Volume2, VolumeX, Camera, SlidersHorizontal, RotateCcw, Hand, Pointer, Orbit, Rotate3d } from 'lucide';
import { SoftScene } from './scene';
import { SlapAudio } from './audio';
import { skinTones, fabricTones } from './material';
import type { TouchMode } from './physics';

const icons = { Fingerprint, Volume2, VolumeX, Camera, SlidersHorizontal, RotateCcw, Hand, Pointer, Orbit, Rotate3d };
const iconify = () => createIcons({ icons, attrs: { 'stroke-width': 1.6 } });
iconify();

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const audio = new SlapAudio();
const count = $('#slap-count');
const response = $('#response-state');
const bars = [...document.querySelectorAll<HTMLElement>('#meter-bars b')];
const label = $('#touch-label');
const toast = $('#toast');
let toastTimeout: ReturnType<typeof setTimeout>;
let labelTimeout: ReturnType<typeof setTimeout>;
let studio: SoftScene;
let hits = 0;
let currentMode: TouchMode = 'slap';
let skinIndex = 0, fabricIndex = 0;

function notify(text: string) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2200);
}

const skinNames = ['Light', 'Medium', 'Tan', 'Deep'];
const fabricNames = ['Sage', 'Rose', 'Pearl', 'Ink'];
for (const [selector, colors, names, kind] of [
  ['#skin-swatches', skinTones, skinNames, 'skin'],
  ['#fabric-swatches', fabricTones, fabricNames, 'fabric'],
] as const) {
  colors.forEach((color, index) => {
    const button = document.createElement('button');
    button.className = 'swatch';
    button.style.setProperty('--swatch', color);
    button.setAttribute('aria-label', names[index]);
    button.setAttribute('aria-pressed', String(index === 0));
    button.dataset.tip = names[index];
    button.addEventListener('click', () => {
      if (!studio) return;
      $(selector).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      if (kind === 'skin') { studio.skin.uniforms.uSkin.value.set(color); skinIndex = index; }
      else { studio.skin.uniforms.uFabric.value.set(color); fabricIndex = index; }
    });
    $(selector).append(button);
  });
}

function setActive(selector: string, value: string, key: string) {
  document.querySelectorAll<HTMLButtonElement>(selector).forEach(button => {
    const active = button.dataset[key] === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function setMode(mode: TouchMode) {
  currentMode = mode;
  studio?.setMode(mode);
  setActive('[data-mode]', mode, 'mode');
}
function updateRanges() {
  for (const id of ['softness', 'bounce', 'force']) {
    const input = $<HTMLInputElement>(`#${id}`);
    $(`#${id}-value`).textContent = input.value;
    const percent = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
    input.style.setProperty('--value', `${percent}%`);
  }
  if (studio?.ready) {
    studio.physics.configure(Number($<HTMLInputElement>('#softness').value) / 100, Number($<HTMLInputElement>('#bounce').value) / 100);
    studio.force = Number($<HTMLInputElement>('#force').value) / 100;
  }
}
updateRanges();
document.querySelectorAll('input[type=range]').forEach(input => input.addEventListener('input', updateRanges));
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode as TouchMode)));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (!studio?.ready) return;
  studio.setView(button.dataset.view!);
  setActive('[data-view]', button.dataset.view!, 'view');
  $('#auto-rotate').setAttribute('aria-pressed', 'false');
}));
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(button => button.addEventListener('click', () => {
  if (!studio) return;
  studio.speed = Number(button.dataset.speed);
  setActive('[data-speed]', button.dataset.speed!, 'speed');
}));
$('#auto-rotate').addEventListener('click', () => {
  if (!studio?.ready) return;
  studio.setAutoRotate(!studio.controls.autoRotate);
  $('#auto-rotate').setAttribute('aria-pressed', String(studio.controls.autoRotate));
  if (studio.controls.autoRotate) setActive('[data-view]', '', 'view');
});
$('#sound').addEventListener('click', () => {
  audio.enabled = !audio.enabled;
  $('#sound').innerHTML = `<i data-lucide="${audio.enabled ? 'volume-2' : 'volume-x'}"></i>`;
  $('#sound').setAttribute('aria-pressed', String(audio.enabled));
  $('#sound').setAttribute('aria-label', audio.enabled ? 'Mute sound' : 'Enable sound');
  iconify();
  if (audio.enabled) void audio.unlock();
});
$('#settings-toggle').addEventListener('click', () => {
  const open = $('#settings').classList.toggle('open');
  $('#settings-toggle').setAttribute('aria-expanded', String(open));
  $('#settings-toggle').setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('#settings').classList.remove('open');
    $('#settings-toggle').setAttribute('aria-expanded', 'false');
  }
});
$('#capture').addEventListener('click', () => {
  if (!studio?.ready) return;
  try {
    const link = document.createElement('a');
    link.href = studio.capture();
    link.download = `pigu-${Date.now()}.png`;
    link.click();
    notify('A little keepsake.');
  } catch { notify('Image could not be saved.'); }
});
$('#reset').addEventListener('click', () => {
  if (!studio?.ready) return;
  studio.reset();
  hits = 0;
  count.textContent = '000';
  for (const [id, value] of [['softness', '68'], ['bounce', '72'], ['force', '65']]) $<HTMLInputElement>(`#${id}`).value = value;
  updateRanges();
  setMode('slap');
  setActive('[data-speed]', '1', 'speed');
  setActive('[data-view]', 'quarter', 'view');
  studio.speed = 1;
  $('#auto-rotate').setAttribute('aria-pressed', 'false');
  studio.skin.uniforms.uSkin.value.set(skinTones[0]);
  studio.skin.uniforms.uFabric.value.set(fabricTones[0]);
  skinIndex = fabricIndex = 0;
  for (const id of ['skin-swatches', 'fabric-swatches']) {
    $(`#${id}`).querySelectorAll('button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === 0)));
  }
  clearTimeout(labelTimeout);
  label.classList.remove('pop');
  notify('Fresh start.');
});
$('#retry').addEventListener('click', () => location.reload());

function showError(message: string) {
  const loading = document.querySelector<HTMLElement>('#loading');
  if (loading) loading.style.display = 'none';
  $('#load-error').hidden = false;
  $('#error-message').textContent = message;
  document.querySelectorAll<HTMLButtonElement>('.tool-dock button, #capture, #reset').forEach(b => b.disabled = true);
}

async function start() {
  try {
    studio = new SoftScene($('#scene'), {
      unlock: () => { void audio.unlock(); },
      hit: (_point, strength, x, y) => {
        hits++;
        count.textContent = String(hits).padStart(3, '0');
        audio.play(strength);
        $('#auto-rotate').setAttribute('aria-pressed', 'false');
        const words = ['nice.', 'boop.', 'soft spot.', 'oh, hi.', 'jiggle.'];
        label.textContent = words[(hits - 1) % words.length];
        label.style.left = `${Math.min(innerWidth - 70, Math.max(70, x))}px`;
        label.style.top = `${Math.max(125, y - 20)}px`;
        label.classList.remove('pop');
        void label.offsetWidth;
        label.classList.add('pop');
        clearTimeout(labelTimeout);
        labelTimeout = setTimeout(() => label.classList.remove('pop'), 950);
      },
      update: (energy, displacement) => {
        const level = Math.min(1, Math.sqrt(energy) * 1.2 + displacement);
        const now = performance.now() / 150;
        bars.forEach((bar, i) => bar.style.height = `${4 + level * 15 * (0.35 + 0.65 * Math.abs(Math.sin(now + i * 0.9)))}px`);
        const state = displacement > 0.005 ? currentMode === 'grab' ? 'SOFT TOUCH' : 'BOUNCING' : 'AT REST';
        if (response.textContent !== state) response.textContent = state;
        $('#auto-rotate').setAttribute('aria-pressed', String(studio.controls.autoRotate));
      },
      error: showError,
    });
    await studio.load();
    studio.setMode(currentMode);
    updateRanges();
    $('#loading').style.opacity = '0';
    setTimeout(() => $('#loading').remove(), 400);
    document.documentElement.dataset.ready = 'true';
    Object.defineProperty(window, '__pigu', {
      value: Object.freeze({ diagnostics: () => ({ ...studio.diagnostics(), audio: audio.state, soundEnabled: audio.enabled, skinIndex, fabricIndex, build: __PIGU_BUILD__ }) }),
      writable: false,
    });
  } catch (error) {
    console.error('Pigu startup failed', error);
    showError('The 3D studio could not start. A WebGL 2 capable browser is required.');
  }
}
void start();
