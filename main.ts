// Drift: an eight-pad pentatonic drone instrument, pitched and voiced like a
// didgeridoo. Every note lives in the same scale, so any combination of pads
// — one finger or five — sounds consonant. Vertical position sweeps a shared
// filter and delay, so the same notes feel brighter or darker depending on
// where you touch.

const MIN_CUTOFF = 150;
const MAX_CUTOFF = 2500;
const ATTACK = 0.05;
const RELEASE = 0.6;
const VOICE_GAIN = 0.35;
const MASTER_GAIN = 1.5;
// The vocal-tract "wow" a didgeridoo player shapes with tongue and mouth:
// a bandpass formant whose centre frequency an LFO rocks back and forth.
const FORMANT_CENTER = 500;
const FORMANT_DEPTH = 300;
const FORMANT_RATE = 4.5;

const instrument = document.querySelector<HTMLElement>("#instrument");
const hint = document.querySelector<HTMLElement>("#hint");
const pads = Array.from(document.querySelectorAll<HTMLButtonElement>(".pad"));
const waveformCanvas = document.querySelector<HTMLCanvasElement>("#waveform");
const waveformCtx = waveformCanvas?.getContext("2d") ?? null;
const pitchSlider = document.querySelector<HTMLInputElement>("#pitch");
const pitchReadout = document.querySelector<HTMLElement>("#pitch-readout");
const reverbSlider = document.querySelector<HTMLInputElement>("#reverb");
const reverbReadout = document.querySelector<HTMLElement>("#reverb-readout");
const stickyToggle = document.querySelector<HTMLInputElement>("#sticky");
const invertToggle = document.querySelector<HTMLInputElement>("#invert");
const fartBtn = document.querySelector<HTMLElement>("#fart");
// Classic dual-phosphor terminal: amber for the instrument, green for the
// diagnostic scope, so the trace reads as a distinct system readout.
const WAVEFORM_HUE = 120;

let audioContext: AudioContext | null = null;
let masterFilter: BiquadFilterNode | null = null;
let analyser: AnalyserNode | null = null;
let waveformData: Uint8Array<ArrayBuffer> | null = null;
let brightness = 0.5; // 0 = dark, 1 = bright — also drives the CSS backdrop.

type Voice = { oscillator: OscillatorNode; gain: GainNode; baseFrequency: number };
const voices = new Map<string, Voice>();
let pitchMultiplier = 1;
let wetGain: GainNode | null = null;
let invertGain: GainNode | null = null;

function markPlayed() {
  hint?.classList.add("played");
}

function setBrightness(value: number) {
  brightness = Math.min(1, Math.max(0, value));
  document.documentElement.style.setProperty("--brightness", brightness.toFixed(3));
  if (masterFilter && audioContext) {
    const cutoff = MIN_CUTOFF * (MAX_CUTOFF / MIN_CUTOFF) ** brightness;
    masterFilter.frequency.setTargetAtTime(cutoff, audioContext.currentTime, 0.05);
  }
}

function ensureAudio(): AudioContext {
  if (audioContext) return audioContext;

  const context = new AudioContext();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.value = MIN_CUTOFF * (MAX_CUTOFF / MIN_CUTOFF) ** brightness;

  const compressor = context.createDynamicsCompressor();

  const delay = context.createDelay(1);
  delay.delayTime.value = 0.28;
  const feedback = context.createGain();
  feedback.gain.value = 0.32;
  const wet = context.createGain();
  wet.gain.value = 0.22;

  const formant = context.createBiquadFilter();
  formant.type = "bandpass";
  formant.Q.value = 6;
  formant.frequency.value = FORMANT_CENTER;

  const formantLfo = context.createOscillator();
  formantLfo.type = "sine";
  formantLfo.frequency.value = FORMANT_RATE;
  const formantLfoGain = context.createGain();
  formantLfoGain.gain.value = FORMANT_DEPTH;
  formantLfo.connect(formantLfoGain);
  formantLfoGain.connect(formant.frequency);
  formantLfo.start();

  filter.connect(formant);
  formant.connect(compressor);
  formant.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(compressor);

  // Boost after compression, not before — the compressor's already tamed
  // the peaks, so this makeup gain adds loudness without adding clipping.
  const makeup = context.createGain();
  makeup.gain.value = MASTER_GAIN;
  compressor.connect(makeup);
  const invert = context.createGain();
  invert.gain.value = invertToggle?.checked ? -1 : 1;
  makeup.connect(invert);
  invert.connect(context.destination);
  wetGain = wet;
  invertGain = invert;
  if (reverbSlider) wet.gain.value = Number(reverbSlider.value);

  const analyserNode = context.createAnalyser();
  analyserNode.fftSize = 2048;
  invert.connect(analyserNode);

  audioContext = context;
  masterFilter = filter;
  analyser = analyserNode;
  waveformData = new Uint8Array(analyserNode.fftSize);
  return context;
}

function noteOn(voiceId: string, baseFrequency: number, pad: HTMLElement | null) {
  const context = ensureAudio();
  if (context.state === "suspended") void context.resume();
  if (!masterFilter) return;
  if (voices.has(voiceId)) return;

  const oscillator = context.createOscillator();
  oscillator.type = "sawtooth";
  oscillator.frequency.value = baseFrequency * pitchMultiplier;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(VOICE_GAIN, context.currentTime + ATTACK);

  oscillator.connect(gain);
  gain.connect(masterFilter);
  oscillator.start();

  voices.set(voiceId, { oscillator, gain, baseFrequency });
  pad?.classList.add("active");
  markPlayed();
}

// The frequency control spans the whole width of the page and re-pitches
// every pad together, live — held notes glide to the new pitch instead of
// waiting for the next press.
function setPitchMultiplier(value: number) {
  pitchMultiplier = value;
  if (!audioContext) return;
  const now = audioContext.currentTime;
  for (const voice of voices.values()) {
    voice.oscillator.frequency.setTargetAtTime(voice.baseFrequency * pitchMultiplier, now, 0.05);
  }
}

reverbSlider?.addEventListener("input", () => {
  const v = Number(reverbSlider.value);
  if (wetGain && audioContext) wetGain.gain.setTargetAtTime(v, audioContext.currentTime, 0.05);
  if (reverbReadout) reverbReadout.textContent = `${Math.round(v * 100)}%`;
});

invertToggle?.addEventListener("change", () => {
  if (invertGain && audioContext) invertGain.gain.value = invertToggle.checked ? -1 : 1;
});

fartBtn?.addEventListener("click", () => {
  const ctx = ensureAudio();
  if (ctx.state === "suspended") void ctx.resume();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.35);
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = 28;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 40;
  lfo.connect(lfoAmt);
  lfoAmt.connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  osc.connect(lp);
  lp.connect(g);
  g.connect(invertGain ?? ctx.destination);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + 0.45);
  lfo.stop(t + 0.45);
  markPlayed();
});

pitchSlider?.addEventListener("input", () => {
  setPitchMultiplier(Number(pitchSlider.value));
  if (pitchReadout) {
    const percent = Math.round(pitchMultiplier * 100);
    pitchReadout.textContent = "";
    pitchReadout.append(`${percent}%`);
    const cursor = document.createElement("span");
    cursor.className = "bbs-cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.textContent = "_";
    pitchReadout.append(cursor);
  }
});

function noteOff(voiceId: string, pad: HTMLElement | null) {
  const voice = voices.get(voiceId);
  pad?.classList.remove("active");
  if (!voice || !audioContext) return;

  const { oscillator, gain } = voice;
  const now = audioContext.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + RELEASE);
  oscillator.stop(now + RELEASE + 0.05);
  voices.delete(voiceId);
}

function frequencyOf(pad: HTMLElement): number {
  return Number(pad.dataset.freq);
}

function updateBrightnessFromClientY(clientY: number) {
  const ratio = 1 - clientY / window.innerHeight;
  setBrightness(ratio);
}

// Pointer events unify mouse and touch, and each pointerId is its own
// voice, so a mouse drag glides between pads (glissando) while several
// simultaneous touches play a chord.
const pointerPads = new Map<number, HTMLElement>();

function padUnderPoint(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  return el?.closest<HTMLElement>(".pad") ?? null;
}

// Sticky keys: a press latches the note on, the next press on that pad
// releases it. Uses a pad-keyed voice id so any input path toggles the
// same voice.
function stickyToggleNote(pad: HTMLElement): void {
  const id = `sticky-${pad.dataset.key}`;
  if (voices.has(id)) noteOff(id, pad);
  else noteOn(id, frequencyOf(pad), pad);
}

instrument?.addEventListener("pointerdown", (event) => {
  const pad = (event.target as HTMLElement).closest<HTMLElement>(".pad");
  if (!pad) return;
  event.preventDefault();
  if (stickyToggle?.checked) {
    stickyToggleNote(pad);
    updateBrightnessFromClientY(event.clientY);
    return;
  }
  pointerPads.set(event.pointerId, pad);
  noteOn(`pointer-${event.pointerId}`, frequencyOf(pad), pad);
  updateBrightnessFromClientY(event.clientY);
});

document.addEventListener("pointermove", (event) => {
  updateBrightnessFromClientY(event.clientY);

  const currentPad = pointerPads.get(event.pointerId);
  if (!currentPad) return;

  const pad = padUnderPoint(event.clientX, event.clientY);
  if (pad && pad !== currentPad) {
    noteOff(`pointer-${event.pointerId}`, currentPad);
    pointerPads.set(event.pointerId, pad);
    noteOn(`pointer-${event.pointerId}`, frequencyOf(pad), pad);
  }
});

function releasePointer(event: PointerEvent) {
  const pad = pointerPads.get(event.pointerId);
  if (!pad) return;
  noteOff(`pointer-${event.pointerId}`, pad);
  pointerPads.delete(event.pointerId);
}

document.addEventListener("pointerup", releasePointer);
document.addEventListener("pointercancel", releasePointer);

// A pad reached by Tab (not the letter keys) needs the same press-and-hold
// expressiveness as every other input path, not a fixed blip: holding
// Enter/Space sustains the note for as long as it's held, exactly like a
// held pointer or a held home-row key. preventDefault on keydown stops the
// button's own default activation from also firing a click for the same
// press, which would otherwise double-trigger noteOn.
instrument?.addEventListener("keydown", (event) => {
  const pad = (event.target as HTMLElement).closest<HTMLElement>(".pad");
  if (!pad || (event.key !== " " && event.key !== "Enter")) return;
  event.preventDefault();
  if (event.repeat) return;
  noteOn(`focus-${pad.dataset.key}`, frequencyOf(pad), pad);
});

instrument?.addEventListener("keyup", (event) => {
  const pad = (event.target as HTMLElement).closest<HTMLElement>(".pad");
  if (!pad || (event.key !== " " && event.key !== "Enter")) return;
  noteOff(`focus-${pad.dataset.key}`, pad);
});

// Tabbing away mid-hold moves focus before the physical key comes back up, so
// the eventual keyup lands on whatever now has focus, not the pad that
// started the note — without this, that pad drones forever. focusout fires
// the instant focus actually leaves the pad (Tab, Shift+Tab, a click
// elsewhere), which is exactly when the hold should end.
instrument?.addEventListener("focusout", (event) => {
  const pad = (event.target as HTMLElement).closest<HTMLElement>(".pad");
  if (!pad) return;
  noteOff(`focus-${pad.dataset.key}`, pad);
});

// Assistive tech that activates a control by calling .click() directly, with
// no keydown/keyup pair at all, never reaches the listeners above — this
// fallback (detail === 0 marks a non-pointer click) gives that path a short
// blip rather than silence.
instrument?.addEventListener("click", (event) => {
  if (event.detail !== 0) return; // real pointer clicks already handled above
  const pad = (event.target as HTMLElement).closest<HTMLElement>(".pad");
  if (!pad) return;
  const voiceId = `click-${pad.dataset.key}`;
  noteOn(voiceId, frequencyOf(pad), pad);
  window.setTimeout(() => noteOff(voiceId, pad), 180);
});

// Home-row keys give a stranger a second, un-pointed-at way to play: press
// and hold any of A S D F G H J K, chords included.
const keyPads = new Map<string, HTMLElement>();
for (const pad of pads) {
  const key = pad.dataset.key;
  if (key) keyPads.set(key, pad);
}

const BRIGHTNESS_STEP = 0.08;

document.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();

  const pad = keyPads.get(key);
  if (pad) {
    if (stickyToggle?.checked) stickyToggleNote(pad);
    else noteOn(`key-${key}`, frequencyOf(pad), pad);
    return;
  }

  if (key === "arrowup") {
    event.preventDefault();
    ensureAudio();
    setBrightness(brightness + BRIGHTNESS_STEP);
  } else if (key === "arrowdown") {
    event.preventDefault();
    ensureAudio();
    setBrightness(brightness - BRIGHTNESS_STEP);
  }
});

document.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  const pad = keyPads.get(key);
  if (pad) noteOff(`key-${key}`, pad);
});

// A held key or pointer whose release never reaches the page — the tab loses
// focus mid-note, most commonly an alt-tab away — would otherwise drone
// forever, since keyup/pointerup only fire on the page that's still focused.
// Releasing every voice on blur turns that into an ordinary note-off.
function releaseAllVoices() {
  for (const voiceId of Array.from(voices.keys())) {
    noteOff(voiceId, null);
  }
  pointerPads.clear();
  for (const pad of pads) pad.classList.remove("active");
}

window.addEventListener("blur", releaseAllVoices);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseAllVoices();
});

setBrightness(brightness);

// The canvas backing store is sized in device pixels so the trace stays
// crisp on high-DPI screens; setTransform (not scale) keeps repeated
// resizes from compounding the DPR factor.
function resizeWaveform() {
  if (!waveformCanvas || !waveformCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = waveformCanvas.getBoundingClientRect();
  waveformCanvas.width = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  waveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function traceWaveformPath(width: number, height: number, mirror: boolean) {
  if (!waveformCtx) return;
  waveformCtx.beginPath();
  if (!analyser || !waveformData) {
    waveformCtx.moveTo(0, height / 2);
    waveformCtx.lineTo(width, height / 2);
    return;
  }
  const step = width / waveformData.length;
  for (let i = 0; i < waveformData.length; i++) {
    const offset = (waveformData[i] / 128 - 1) * (height / 2) * 0.9 * (mirror ? -1 : 1);
    const y = height / 2 + offset;
    const x = i * step;
    if (i === 0) waveformCtx.moveTo(x, y);
    else waveformCtx.lineTo(x, y);
  }
}

function drawWaveform() {
  requestAnimationFrame(drawWaveform);
  if (!waveformCanvas || !waveformCtx) return;
  if (analyser && waveformData) analyser.getByteTimeDomainData(waveformData);

  const width = waveformCanvas.clientWidth;
  const height = waveformCanvas.clientHeight;
  const isIdle = !analyser || !waveformData;
  waveformCtx.clearRect(0, 0, width, height);

  // A faint mirrored reflection under the real trace gives the panel depth,
  // like a scope with phosphor persistence, without a second data source.
  waveformCtx.lineWidth = 2;
  waveformCtx.shadowBlur = 0;
  waveformCtx.strokeStyle = `hsl(${WAVEFORM_HUE} 90% 55% / ${isIdle ? 0.15 : 0.25})`;
  traceWaveformPath(width, height, true);
  waveformCtx.stroke();

  waveformCtx.strokeStyle = `hsl(${WAVEFORM_HUE} 95% ${isIdle ? 55 : 70}% / ${isIdle ? 0.4 : 1})`;
  waveformCtx.shadowColor = `hsl(${WAVEFORM_HUE} 95% 65%)`;
  waveformCtx.shadowBlur = isIdle ? 0 : 12;
  traceWaveformPath(width, height, false);
  waveformCtx.stroke();
}

window.addEventListener("resize", resizeWaveform);
resizeWaveform();
requestAnimationFrame(drawWaveform);

// ---------------------------------------------------------------------------
// FX layer: a full-viewport canvas of deliberate junk — particle bursts,
// drifting emoji stickers, and several overlaid waveform traces that ignore
// the scope box entirely.
// ---------------------------------------------------------------------------

const fxCanvas = document.querySelector<HTMLCanvasElement>("#fx");
const fxCtx = fxCanvas?.getContext("2d") ?? null;

const STICKER_GLYPHS = ["★", "◆", "▲", "☺", "♪", "♫", "✦", "◉", "☠", "✷", "❖", "⚡"];
const FX_HUES = [120, 40, 200, 320, 60, 280];

type Particle = { x: number; y: number; vx: number; vy: number; life: number; hue: number; size: number };
type Sticker = { x: number; y: number; vx: number; vy: number; life: number; glyph: string; hue: number; size: number; spin: number; angle: number };

const particles: Particle[] = [];
const stickers: Sticker[] = [];

function resizeFx() {
  if (!fxCanvas || !fxCtx) return;
  const dpr = window.devicePixelRatio || 1;
  fxCanvas.width = window.innerWidth * dpr;
  fxCanvas.height = window.innerHeight * dpr;
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function burstAt(x: number, y: number) {
  const hue = FX_HUES[Math.floor(Math.random() * FX_HUES.length)];
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 1,
      life: 1,
      hue: hue + Math.random() * 40,
      size: 1 + Math.random() * 4,
    });
  }
  for (let i = 0; i < 3; i++) {
    stickers.push({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: -1 - Math.random() * 3,
      life: 1,
      glyph: STICKER_GLYPHS[Math.floor(Math.random() * STICKER_GLYPHS.length)],
      hue: Math.random() * 360,
      size: 14 + Math.random() * 34,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI * 2,
    });
  }
}

// Every pad press throws a burst from wherever that pad is on screen.
for (const pad of pads) {
  pad.addEventListener("pointerdown", () => {
    const r = pad.getBoundingClientRect();
    burstAt(r.left + r.width / 2, r.top + r.height / 2);
  });
}
document.addEventListener("keydown", (event) => {
  const pad = keyPads.get(event.key.toLowerCase());
  if (!pad || event.repeat) return;
  const r = pad.getBoundingClientRect();
  burstAt(r.left + r.width / 2, r.top + r.height / 2);
});
fartBtn?.addEventListener("click", () => {
  for (let i = 0; i < 6; i++) {
    burstAt(Math.random() * window.innerWidth, Math.random() * window.innerHeight);
  }
});

// Overlaid waveform traces, each with its own scale, vertical anchor, phase
// offset and colour — nothing here respects the scope box.
const OVERLAYS = [
  { hue: 120, amp: 0.5, yFrac: 0.28, skip: 3, width: 1.5, alpha: 0.55, phase: 0 },
  { hue: 320, amp: 0.9, yFrac: 0.5, skip: 7, width: 2.5, alpha: 0.4, phase: 200 },
  { hue: 40, amp: 1.4, yFrac: 0.62, skip: 11, width: 1, alpha: 0.35, phase: 500 },
  { hue: 200, amp: 0.35, yFrac: 0.8, skip: 5, width: 3, alpha: 0.3, phase: 900 },
];

let fxTick = 0;

function drawFx() {
  requestAnimationFrame(drawFx);
  if (!fxCanvas || !fxCtx) return;
  fxTick++;

  const w = window.innerWidth;
  const h = window.innerHeight;
  fxCtx.clearRect(0, 0, w, h);

  if (analyser && waveformData) {
    analyser.getByteTimeDomainData(waveformData);
    for (const o of OVERLAYS) {
      fxCtx.save();
      fxCtx.globalAlpha = o.alpha;
      fxCtx.strokeStyle = `hsl(${o.hue + Math.sin(fxTick / 60) * 30} 95% 60%)`;
      fxCtx.lineWidth = o.width;
      fxCtx.shadowColor = `hsl(${o.hue} 95% 60%)`;
      fxCtx.shadowBlur = 10;
      fxCtx.beginPath();
      const n = waveformData.length;
      let first = true;
      for (let i = 0; i < n; i += o.skip) {
        const v = waveformData[(i + o.phase) % n] / 128 - 1;
        const x = (i / n) * w;
        const y = h * o.yFrac + v * h * 0.25 * o.amp;
        if (first) { fxCtx.moveTo(x, y); first = false; }
        else fxCtx.lineTo(x, y);
      }
      fxCtx.stroke();
      fxCtx.restore();
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.99; p.life -= 0.018;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    fxCtx.globalAlpha = Math.max(0, p.life);
    fxCtx.fillStyle = `hsl(${p.hue} 95% 60%)`;
    fxCtx.fillRect(p.x, p.y, p.size, p.size);
  }

  for (let i = stickers.length - 1; i >= 0; i--) {
    const s = stickers[i];
    s.x += s.vx; s.y += s.vy; s.vy += 0.06; s.life -= 0.008; s.angle += s.spin;
    if (s.life <= 0) { stickers.splice(i, 1); continue; }
    fxCtx.save();
    fxCtx.globalAlpha = Math.max(0, s.life);
    fxCtx.translate(s.x, s.y);
    fxCtx.rotate(s.angle);
    fxCtx.font = `${s.size}px "Courier New", monospace`;
    fxCtx.textAlign = "center";
    fxCtx.fillStyle = `hsl(${s.hue} 95% 65%)`;
    fxCtx.shadowColor = `hsl(${s.hue} 95% 65%)`;
    fxCtx.shadowBlur = 12;
    fxCtx.fillText(s.glyph, 0, 0);
    fxCtx.restore();
  }
  fxCtx.globalAlpha = 1;
}

window.addEventListener("resize", resizeFx);
resizeFx();
requestAnimationFrame(drawFx);
