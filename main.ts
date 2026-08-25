// Drift: an eight-pad pentatonic instrument. Every note lives in the same
// scale, so any combination of pads — one finger or five — sounds
// consonant. Vertical position sweeps a shared filter and delay, so the
// same notes feel brighter or darker depending on where you touch.

const MIN_CUTOFF = 350;
const MAX_CUTOFF = 6000;
const ATTACK = 0.012;
const RELEASE = 0.35;

const instrument = document.querySelector<HTMLElement>("#instrument");
const hint = document.querySelector<HTMLElement>("#hint");
const pads = Array.from(document.querySelectorAll<HTMLButtonElement>(".pad"));
const waveformCanvas = document.querySelector<HTMLCanvasElement>("#waveform");
const waveformCtx = waveformCanvas?.getContext("2d") ?? null;
// Same hue the pads glow at, so the trace reads as part of the instrument
// rather than a separate widget bolted on.
const waveformHue = Number(getComputedStyle(document.documentElement).getPropertyValue("--bg-hue")) + 60;

let audioContext: AudioContext | null = null;
let masterFilter: BiquadFilterNode | null = null;
let analyser: AnalyserNode | null = null;
let waveformData: Uint8Array<ArrayBuffer> | null = null;
let brightness = 0.5; // 0 = dark, 1 = bright — also drives the CSS backdrop.

type Voice = { oscillator: OscillatorNode; gain: GainNode };
const voices = new Map<string, Voice>();

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

  filter.connect(compressor);
  filter.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(compressor);
  compressor.connect(context.destination);

  const analyserNode = context.createAnalyser();
  analyserNode.fftSize = 2048;
  compressor.connect(analyserNode);

  audioContext = context;
  masterFilter = filter;
  analyser = analyserNode;
  waveformData = new Uint8Array(analyserNode.fftSize);
  return context;
}

function noteOn(voiceId: string, frequency: number, pad: HTMLElement | null) {
  const context = ensureAudio();
  if (context.state === "suspended") void context.resume();
  if (!masterFilter) return;
  if (voices.has(voiceId)) return;

  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(0.22, context.currentTime + ATTACK);

  oscillator.connect(gain);
  gain.connect(masterFilter);
  oscillator.start();

  voices.set(voiceId, { oscillator, gain });
  pad?.classList.add("active");
  markPlayed();
}

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

instrument?.addEventListener("pointerdown", (event) => {
  const pad = (event.target as HTMLElement).closest<HTMLElement>(".pad");
  if (!pad) return;
  event.preventDefault();
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
    noteOn(`key-${key}`, frequencyOf(pad), pad);
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

function drawWaveform() {
  requestAnimationFrame(drawWaveform);
  if (!waveformCanvas || !waveformCtx) return;

  const width = waveformCanvas.clientWidth;
  const height = waveformCanvas.clientHeight;
  waveformCtx.clearRect(0, 0, width, height);
  waveformCtx.lineWidth = 2;

  if (!analyser || !waveformData) {
    waveformCtx.strokeStyle = `hsl(${waveformHue} 40% 60% / 0.4)`;
    waveformCtx.beginPath();
    waveformCtx.moveTo(0, height / 2);
    waveformCtx.lineTo(width, height / 2);
    waveformCtx.stroke();
    return;
  }

  analyser.getByteTimeDomainData(waveformData);
  waveformCtx.strokeStyle = `hsl(${waveformHue} 90% 65%)`;
  waveformCtx.beginPath();
  const step = width / waveformData.length;
  for (let i = 0; i < waveformData.length; i++) {
    const y = height / 2 + (waveformData[i] / 128 - 1) * (height / 2) * 0.9;
    const x = i * step;
    if (i === 0) waveformCtx.moveTo(x, y);
    else waveformCtx.lineTo(x, y);
  }
  waveformCtx.stroke();
}

window.addEventListener("resize", resizeWaveform);
resizeWaveform();
requestAnimationFrame(drawWaveform);
