// Ambient sound, synthesised with Web Audio. Nothing is created until the
// listener asks for it, and no audio files are involved.

export function createAmbience() {
  let ctx = null;
  let master = null;
  let filter = null;
  let pingBus = null;
  let pingTimer = 0;
  let enabled = false;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Drone: a low chord through a slowly breathing low-pass filter.
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 0.7;
    filter.connect(master);
    const voices = [
      [55, 'sine', 0.3],
      [55.35, 'sine', 0.3],
      [82.5, 'triangle', 0.1],
      [110.2, 'sine', 0.08],
      [164.8, 'sine', 0.035],
    ];
    for (const [frequency, type, level] of voices) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(filter);
      osc.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 110;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();

    // Air handling: band-passed noise.
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 240;
    band.Q.value = 0.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;
    noise.connect(band).connect(noiseGain).connect(master);
    noise.start();

    // Pings go through a feedback delay for a sense of distance.
    pingBus = ctx.createGain();
    pingBus.gain.value = 1;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    pingBus.connect(master);
    pingBus.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(master);
  }

  function ping() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const notes = [659.3, 880, 987.8, 1318.5];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = notes[Math.floor(Math.random() * notes.length)];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    osc.connect(gain).connect(pingBus);
    osc.start(now);
    osc.stop(now + 1.7);
  }

  function schedulePing() {
    clearTimeout(pingTimer);
    if (!enabled) return;
    pingTimer = setTimeout(() => {
      ping();
      schedulePing();
    }, 7000 + Math.random() * 9000);
  }

  return {
    get enabled() {
      return enabled;
    },
    async toggle() {
      if (!ctx) build();
      enabled = !enabled;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      if (enabled) {
        await ctx.resume();
        master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2.5);
        schedulePing();
      } else {
        master.gain.linearRampToValueAtTime(0, now + 0.6);
        clearTimeout(pingTimer);
      }
      return enabled;
    },
    /** Darker tone while the station is in shadow. */
    setEclipse(amount) {
      if (!ctx) return;
      filter.frequency.setTargetAtTime(320 - amount * 130, ctx.currentTime, 0.8);
    },
    /** Called when the tab is hidden or shown. */
    setActive(active) {
      if (!ctx || !enabled) return;
      if (active) {
        ctx.resume();
        schedulePing();
      } else {
        ctx.suspend();
        clearTimeout(pingTimer);
      }
    },
  };
}
