/* Music + sound effects, synthesised live with the Web Audio API (no audio files).
   - four looping music tracks driven by a 16-step sequencer
   - one-shot sound effects for the games
   - a "tension" layer (heartbeat + rising drone, music ducked) that games can dial up */
(function () {
  'use strict';
  const { $, $$, h } = BB;

  const LS = 'bb.audio';
  const TRACKS = [
    { id: 'lounge', name: 'Midnight Lounge', mood: 'Smooth' },
    { id: 'neon', name: 'Neon Run', mood: 'Synthwave' },
    { id: 'roller', name: 'High Roller', mood: 'House' },
    { id: 'vault', name: 'The Vault', mood: 'Dark & tense' },
  ];
  const st = { music: true, track: 'lounge', musicVol: 0.55, sfx: true, sfxVol: 0.7 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* defaults */ }
  if (!TRACKS.some((t) => t.id === st.track)) st.track = 'lounge';
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { /* ignore */ } };

  let ctx = null, comp, musicBus, duck, sfxBus, tensBus, noiseBuf;
  let timer = 0, nextT = 0, step = 0, running = false;

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const pickOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ---------- engine ---------- */
  function boot() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    musicBus = ctx.createGain(); duck = ctx.createGain();
    musicBus.connect(duck); duck.connect(comp);
    tensBus = ctx.createGain(); tensBus.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    volumes(true);
    return true;
  }

  function volumes(instant) {
    if (!ctx) return;
    const now = ctx.currentTime, tc = instant ? 0.001 : 0.08;
    musicBus.gain.setTargetAtTime(st.music ? st.musicVol * 0.85 : 0, now, tc);
    tensBus.gain.setTargetAtTime(st.music ? st.musicVol : 0, now, tc);
    sfxBus.gain.setTargetAtTime(st.sfx ? st.sfxVol : 0, now, tc);
  }

  function tone(bus, o) {
    const t = o.t, dur = o.dur, peak = o.g == null ? 0.2 : o.g;
    const a = Math.min(o.a || 0.004, dur * 0.4);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.det) osc.detune.setValueAtTime(o.det, t);
    let node = osc;
    if (o.lp) {
      const fl = ctx.createBiquadFilter();
      fl.type = o.ft || 'lowpass'; fl.Q.value = o.q || 0.8;
      fl.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) fl.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur);
      osc.connect(fl); node = fl;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (o.pluck) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else {
      const r = Math.min(o.r || 0.08, dur * 0.5);
      g.gain.setValueAtTime(peak, t + dur - r);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
    }
    node.connect(g); g.connect(bus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noise(bus, o) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = o.ft || 'highpass'; fl.Q.value = o.q || 0.7;
    fl.frequency.setValueAtTime(o.fc || 6000, o.t);
    if (o.fcTo) fl.frequency.exponentialRampToValueAtTime(o.fcTo, o.t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.linearRampToValueAtTime(o.g || 0.1, o.t + (o.a || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    src.connect(fl); fl.connect(g); g.connect(bus);
    src.start(o.t, Math.random() * 1.5); src.stop(o.t + o.dur + 0.05);
  }

  /* ---------- instruments ---------- */
  const kick = (t, g) => tone(musicBus, { f: 150, slide: 42, t, dur: 0.24, g, pluck: 1, a: 0.002 });
  const hat = (t, g, dur) => noise(musicBus, { t, dur: dur || 0.04, g, fc: 8000 });
  const snare = (t, g) => { noise(musicBus, { t, dur: 0.17, g, ft: 'bandpass', fc: 1900, q: 0.8 }); tone(musicBus, { type: 'triangle', f: 200, slide: 120, t, dur: 0.1, g: g * 0.6, pluck: 1 }); };
  const epiano = (n, t, dur, g) => { tone(musicBus, { type: 'triangle', f: mtof(n), t, dur, g, pluck: 1, lp: 2400, lpTo: 700 }); tone(musicBus, { f: mtof(n) * 2, t, dur: dur * 0.5, g: g * 0.25, pluck: 1 }); };
  const bass = (n, t, dur, g) => { tone(musicBus, { f: mtof(n), t, dur, g, a: 0.01 }); tone(musicBus, { type: 'triangle', f: mtof(n), t, dur, g: g * 0.35, lp: 500, a: 0.01 }); };
  const pad = (notes, t, dur, g, cut) => notes.forEach((n, i) => tone(musicBus, { type: 'sawtooth', f: mtof(n), det: i % 2 ? 9 : -9, t, dur, g, lp: cut || 900, a: 0.35, r: 0.5 }));

  /* ---------- tracks: play(step 0-15, bar, time, stepDuration, chord) ---------- */
  const DEFS = {
    lounge: {
      bpm: 86, swing: 0.18,
      prog: [{ b: 38, c: [53, 57, 60, 64] }, { b: 43, c: [53, 57, 59, 64] }, { b: 36, c: [52, 55, 59, 62] }, { b: 45, c: [55, 60, 64, 67] }],
      lead: [72, 74, 76, 79, 81, 84],
      play(s, bar, t, sd, ch) {
        if (s === 0 || s === 8) kick(t, 0.26);
        if (s === 4 || s === 12) noise(musicBus, { t, dur: 0.12, g: 0.035, ft: 'bandpass', fc: 2400, q: 0.6 });
        if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.03 : 0.014, 0.05);
        if (s === 0) ch.c.forEach((n, i) => epiano(n, t + i * 0.014, sd * 7, 0.055));
        if (s === 10) ch.c.forEach((n) => epiano(n, t, sd * 3, 0.04));
        if (s === 0) bass(ch.b, t, sd * 5, 0.2);
        if (s === 8) bass(ch.b + 7, t, sd * 3, 0.15);
        if (s === 14) bass(ch.b + (bar % 2 ? 5 : 10), t, sd * 2, 0.12);
        if ((s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14) && Math.random() < 0.28) epiano(pickOf(this.lead), t, sd * 5, 0.05);
      },
    },
    neon: {
      bpm: 104,
      prog: [{ b: 45, c: [57, 60, 64] }, { b: 41, c: [57, 60, 65] }, { b: 48, c: [55, 60, 64] }, { b: 43, c: [55, 59, 62] }],
      play(s, bar, t, sd, ch) {
        if (s % 4 === 0) kick(t, 0.42);
        if (s === 4 || s === 12) snare(t, 0.13);
        if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.045 : 0.02, s % 4 === 2 ? 0.07 : 0.03);
        if (s % 2 === 0) tone(musicBus, { type: 'sawtooth', f: mtof(ch.b - 12), t, dur: sd * 1.8, g: 0.15, pluck: 1, lp: 800, lpTo: 180, q: 3 });
        const n = ch.c[[0, 1, 2, 1][s % 4]] + (s % 8 >= 4 ? 12 : 0);
        tone(musicBus, { type: 'square', f: mtof(n), t, dur: sd * 1.6, g: 0.032, pluck: 1, lp: 2600, lpTo: 900 });
        if (s === 0) pad(ch.c, t, sd * 16, 0.02, 1000);
        if (bar % 4 >= 2 && (s === 0 || s === 6 || s === 12)) tone(musicBus, { type: 'triangle', f: mtof(ch.c[2] + 12 + (s === 6 ? 2 : 0)), t, dur: sd * 5, g: 0.05, a: 0.02, r: 0.2 });
      },
    },
    roller: {
      bpm: 120,
      prog: [{ b: 41, c: [56, 60, 63] }, { b: 41, c: [56, 60, 63] }, { b: 37, c: [56, 60, 65] }, { b: 39, c: [55, 58, 63] }],
      play(s, bar, t, sd, ch) {
        if (s % 4 === 0) kick(t, 0.5);
        if (s === 4 || s === 12) { noise(musicBus, { t, dur: 0.14, g: 0.1, ft: 'bandpass', fc: 1500, q: 1.2 }); noise(musicBus, { t: t + 0.012, dur: 0.12, g: 0.07, ft: 'bandpass', fc: 1700, q: 1.2 }); }
        if (s % 4 === 2) hat(t, 0.05, 0.13); else if (s % 2 === 1) hat(t, 0.014, 0.03);
        if (s % 4 === 2 || s === 15) tone(musicBus, { f: mtof(ch.b - 12), t, dur: sd * 1.8, g: 0.24, a: 0.01 });
        if (s === 3 || s === 6 || s === 11 || s === 14) ch.c.forEach((n) => tone(musicBus, { type: 'sawtooth', f: mtof(n), t, dur: sd * 1.5, g: 0.036, pluck: 1, lp: 2000, lpTo: 500, q: 2 }));
        if (s === 0) pad(ch.c, t, sd * 16, 0.012, 700);
        if (bar % 4 === 3 && s === 8) noise(musicBus, { t, dur: sd * 8, g: 0.04, ft: 'bandpass', fc: 500, fcTo: 5000, q: 1.5, a: sd * 6 });
      },
    },
    vault: {
      bpm: 72,
      prog: [{ b: 38, c: [50, 53, 57] }, { b: 38, c: [50, 53, 57] }, { b: 39, c: [51, 55, 58] }, { b: 38, c: [50, 53, 56] }],
      eerie: [74, 75, 81, 77, 80],
      play(s, bar, t, sd, ch) {
        if (s === 0) {
          tone(musicBus, { type: 'sawtooth', f: mtof(ch.b - 12), t, dur: sd * 16, g: 0.1, lp: 190, a: 0.4, r: 0.6 });
          tone(musicBus, { f: mtof(ch.b), t, dur: sd * 16, g: 0.07, a: 0.4, r: 0.6 });
          ch.c.forEach((n) => tone(musicBus, { type: 'triangle', f: mtof(n), t, dur: sd * 16, g: 0.03, lp: 900, a: 0.8, r: 1 }));
        }
        if (s === 0 || s === 8) tone(musicBus, { f: 74, slide: 38, t, dur: 0.22, g: 0.42, pluck: 1 });
        if (s === 2 || s === 10) tone(musicBus, { f: 66, slide: 36, t, dur: 0.2, g: 0.26, pluck: 1 });
        if (s % 4 === 0) noise(musicBus, { t, dur: 0.018, g: 0.03, fc: 9000 });
        if ((s === 4 || s === 12) && Math.random() < 0.4) tone(musicBus, { f: mtof(pickOf(this.eerie)), t, dur: sd * 8, g: 0.03, a: 0.12, r: 1 });
        if (bar % 4 === 3 && s === 0) noise(musicBus, { t, dur: sd * 16, g: 0.03, ft: 'bandpass', fc: 300, fcTo: 3200, q: 2, a: sd * 12 });
      },
    },
  };

  function pump() {
    if (!running || !ctx) return;
    const T = DEFS[st.track] || DEFS.lounge, sd = 60 / T.bpm / 4;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05; // recover after a stall
    while (nextT < ctx.currentTime + 0.2) {
      const s = step % 16, bar = Math.floor(step / 16);
      const sw = s % 2 === 1 && T.swing ? T.swing * sd : 0;
      try { T.play(s, bar, nextT + sw, sd, T.prog[bar % T.prog.length]); } catch (e) { console.warn('[audio] music step failed', e); }
      nextT += sd; step++;
    }
  }

  function startMusic() {
    if (!ctx || running || document.hidden || !st.music) return;
    running = true; step = 0; nextT = ctx.currentTime + 0.08;
    timer = setInterval(pump, 30);
    pump();
  }
  function stopMusic() { running = false; clearInterval(timer); }

  /* ---------- sound effects ---------- */
  const SFX = {
    click(t) { tone(sfxBus, { type: 'square', f: 1100, t, dur: 0.03, g: 0.045, pluck: 1, lp: 3000 }); },
    bet(t) { noise(sfxBus, { t, dur: 0.05, g: 0.11, ft: 'bandpass', fc: 3200, q: 2 }); tone(sfxBus, { type: 'triangle', f: 520, slide: 760, t, dur: 0.09, g: 0.09, pluck: 1 }); },
    win(t) { [72, 76, 79, 84].forEach((n, i) => tone(sfxBus, { type: 'triangle', f: mtof(n), t: t + i * 0.07, dur: 0.28, g: 0.14, pluck: 1 })); },
    bigwin(t) {
      [60, 64, 67, 72, 76, 79, 84, 88].forEach((n, i) => {
        tone(sfxBus, { type: 'triangle', f: mtof(n), t: t + i * 0.075, dur: 0.5, g: 0.15, pluck: 1 });
        tone(sfxBus, { f: mtof(n + 12), t: t + i * 0.075, dur: 0.4, g: 0.05, pluck: 1 });
      });
      noise(sfxBus, { t: t + 0.55, dur: 0.9, g: 0.05, fc: 6000 });
    },
    lose(t) { tone(sfxBus, { f: 190, slide: 70, t, dur: 0.3, g: 0.2, pluck: 1 }); },
    push(t) { tone(sfxBus, { type: 'triangle', f: 440, t, dur: 0.16, g: 0.1, pluck: 1 }); },
    card(t) { noise(sfxBus, { t, dur: 0.09, g: 0.1, ft: 'bandpass', fc: 2600, fcTo: 900, q: 0.9 }); },
    tick(t, a) { const v = a == null ? 1 : a; noise(sfxBus, { t, dur: 0.02, g: 0.07 * v, fc: 5000 }); tone(sfxBus, { type: 'triangle', f: 1500, t, dur: 0.02, g: 0.03 * v, pluck: 1 }); },
    gem(t, n) { const f = 660 * Math.pow(2, Math.min(n || 0, 18) / 12); tone(sfxBus, { f, t, dur: 0.45, g: 0.16, pluck: 1 }); tone(sfxBus, { f: f * 1.5, t, dur: 0.3, g: 0.06, pluck: 1 }); },
    bomb(t) { noise(sfxBus, { t, dur: 0.5, g: 0.34, ft: 'lowpass', fc: 1800, fcTo: 120 }); tone(sfxBus, { f: 120, slide: 35, t, dur: 0.45, g: 0.4, pluck: 1 }); },
    coin(t) { for (let i = 0; i < 7; i++) tone(sfxBus, { f: 2100 + (i % 2) * 500, t: t + i * 0.1, dur: 0.08, g: 0.03, pluck: 1 }); },
    coinLand(t) { tone(sfxBus, { f: 1500, t, dur: 0.5, g: 0.1, pluck: 1 }); tone(sfxBus, { f: 2250, t, dur: 0.35, g: 0.05, pluck: 1 }); },
    cashout(t) { [79, 84, 91].forEach((n, i) => tone(sfxBus, { f: mtof(n), t: t + i * 0.06, dur: 0.25, g: 0.13, pluck: 1 })); },
    launch(t) { noise(sfxBus, { t, dur: 0.5, g: 0.08, ft: 'bandpass', fc: 400, fcTo: 2400, q: 1.2 }); },
    kenoHit(t, n) { const f = 520 * Math.pow(2, ((n || 1) * 2) / 12); tone(sfxBus, { type: 'triangle', f, t, dur: 0.4, g: 0.17, pluck: 1 }); tone(sfxBus, { f: f * 2, t, dur: 0.3, g: 0.06, pluck: 1 }); },
    kenoMiss(t) { tone(sfxBus, { type: 'triangle', f: 170, t, dur: 0.07, g: 0.09, pluck: 1 }); },
    scan(t, a) { tone(sfxBus, { type: 'square', f: 700 + (a || 0) * 500, t, dur: 0.04, g: 0.035, pluck: 1, lp: 2500 }); },
    lock(t) { tone(sfxBus, { f: 90, slide: 45, t, dur: 0.35, g: 0.34, pluck: 1 }); noise(sfxBus, { t, dur: 0.12, g: 0.06, fc: 3000 }); },
    impact(t) { tone(sfxBus, { f: 110, slide: 38, t, dur: 0.6, g: 0.45, pluck: 1 }); noise(sfxBus, { t, dur: 0.35, g: 0.12, ft: 'lowpass', fc: 2400, fcTo: 200 }); },
    aww(t) { tone(sfxBus, { type: 'sawtooth', f: 300, slide: 140, t, dur: 0.45, g: 0.06, pluck: 1, lp: 900 }); },
  };

  function sfx(name, arg) {
    if (!st.sfx || !ctx || ctx.state !== 'running') return;
    const f = SFX[name];
    if (f) { try { f(ctx.currentTime + 0.005, arg); } catch (e) { console.warn('[audio] sfx failed: ' + name, e); } } // never let audio break a game
  }

  /* ---------- tension layer: 0 = off, 1..6 = rising ---------- */
  let tLevel = 0, tBeat = 0, tNodes = null;

  function beat() {
    if (!tLevel || !ctx) return;
    if (st.sfx && ctx.state === 'running') {
      const t = ctx.currentTime + 0.01;
      tone(sfxBus, { f: 82, slide: 40, t, dur: 0.2, g: 0.5, pluck: 1 });
      tone(sfxBus, { f: 70, slide: 36, t: t + 0.17, dur: 0.2, g: 0.32, pluck: 1 });
    }
    tBeat = setTimeout(beat, Math.max(400, 1050 - tLevel * 115));
  }

  function tension(level) {
    level = Math.max(0, Math.min(6, level | 0));
    if (level === tLevel) return;
    tLevel = level;
    clearTimeout(tBeat);
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setTargetAtTime(level ? 0.22 : 1, now, level ? 0.2 : 0.6);
    if (level && !tNodes) {
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 240; fl.Q.value = 6;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 58.3;
      const o3 = ctx.createOscillator(); o3.frequency.value = 880;
      const g3 = ctx.createGain(); g3.gain.value = 0.04;
      o1.connect(fl); o2.connect(fl); fl.connect(g); o3.connect(g3); g3.connect(g); g.connect(tensBus);
      o1.start(); o2.start(); o3.start();
      tNodes = { g, fl, o1, o2, o3 };
    }
    if (tNodes && level) {
      tNodes.g.gain.setTargetAtTime(0.05 + level * 0.022, now, 0.5);
      tNodes.fl.frequency.setTargetAtTime(200 + level * 230, now, 0.8);
      tNodes.o1.frequency.setTargetAtTime(55 * Math.pow(2, (level - 1) / 24), now, 1);
      tNodes.o2.frequency.setTargetAtTime(58.3 * Math.pow(2, (level - 1) / 24), now, 1);
      tNodes.o3.frequency.setTargetAtTime(880 * Math.pow(2, level / 12), now, 1.2);
    } else if (tNodes) {
      const n = tNodes; tNodes = null;
      n.g.gain.setTargetAtTime(0.0001, now, 0.15);
      setTimeout(() => { try { n.o1.stop(); n.o2.stop(); n.o3.stop(); } catch (e) { /* already stopped */ } }, 900);
    }
    if (level) beat();
  }

  /* ---------- settings ---------- */
  function paintButton() {
    const b = $('#snd-btn');
    if (!b) return;
    b.classList.toggle('off', !st.music && !st.sfx);
    b.classList.toggle('playing', st.music);
  }

  function setMusic(on) {
    st.music = !!on; save(); boot(); volumes();
    if (st.music) startMusic(); else stopMusic();
    paintButton();
  }
  function setTrack(id) {
    if (!DEFS[id]) return;
    st.track = id; step = 0; save();
    if (!st.music) setMusic(true);
  }
  function setSfx(on) { st.sfx = !!on; save(); boot(); volumes(); paintButton(); if (on) sfx('click'); }

  const ICON_VOL = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M15.500 8.500a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function panel(forceOpen) {
    let p = $('#snd-pop');
    if (p) { if (forceOpen !== true) p.remove(); return; }
    boot();
    if (st.music) startMusic();
    p = h(`<div class="snd-pop" id="snd-pop" role="dialog" aria-label="Music and sound">
      <div class="snd-head"><b>Music</b><button class="switch${st.music ? ' on' : ''}" id="snd-music" role="switch" aria-checked="${st.music}" aria-label="Music on or off"><i></i></button></div>
      <div class="snd-tracks">${TRACKS.map((t) => `
        <button class="snd-track${t.id === st.track ? ' on' : ''}" data-t="${t.id}">
          <span class="eq"><i></i><i></i><i></i><i></i></span><span class="st-name">${t.name}</span><small>${t.mood}</small>
        </button>`).join('')}</div>
      <label class="snd-vol">${ICON_VOL}<input type="range" min="0" max="100" value="${Math.round(st.musicVol * 100)}" id="snd-mvol" aria-label="Music volume"></label>
      <div class="snd-head gap"><b>Sound effects</b><button class="switch${st.sfx ? ' on' : ''}" id="snd-sfx" role="switch" aria-checked="${st.sfx}" aria-label="Sound effects on or off"><i></i></button></div>
      <label class="snd-vol">${ICON_VOL}<input type="range" min="0" max="100" value="${Math.round(st.sfxVol * 100)}" id="snd-svol" aria-label="Effects volume"></label>
      <p class="snd-note">Synthesised live in your browser — no audio files.</p>
    </div>`);
    document.body.appendChild(p);
    p.classList.toggle('music-on', st.music);

    $('#snd-music', p).addEventListener('click', (e) => {
      setMusic(!st.music);
      e.currentTarget.classList.toggle('on', st.music);
      e.currentTarget.setAttribute('aria-checked', st.music);
      p.classList.toggle('music-on', st.music);
    });
    $('#snd-sfx', p).addEventListener('click', (e) => {
      setSfx(!st.sfx);
      e.currentTarget.classList.toggle('on', st.sfx);
      e.currentTarget.setAttribute('aria-checked', st.sfx);
    });
    $('.snd-tracks', p).addEventListener('click', (e) => {
      const b = e.target.closest('.snd-track');
      if (!b) return;
      setTrack(b.dataset.t);
      $$('.snd-track', p).forEach((x) => x.classList.toggle('on', x === b));
      $('#snd-music', p).classList.add('on');
      p.classList.add('music-on');
    });
    $('#snd-mvol', p).addEventListener('input', (e) => { st.musicVol = e.target.value / 100; save(); volumes(); });
    $('#snd-svol', p).addEventListener('input', (e) => { st.sfxVol = e.target.value / 100; save(); volumes(); });
    $('#snd-svol', p).addEventListener('change', () => sfx('gem', 3));

    const outside = (e) => {
      if (!p.isConnected) { document.removeEventListener('mousedown', outside); return; }
      if (p.contains(e.target) || e.target.closest('#snd-btn, [data-open="sound"]')) return;
      p.remove();
      document.removeEventListener('mousedown', outside);
    };
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  }

  /* Browsers only allow audio after a user gesture, so start on the first one. */
  function unlock() {
    if (!boot()) return;
    if (st.music) startMusic();
    if (ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  }
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopMusic(); else if (st.music && ctx) startMusic();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const p = $('#snd-pop'); if (p) p.remove(); } });

  const btn = $('#snd-btn');
  if (btn) btn.addEventListener('click', () => panel());
  paintButton();

  BB.audio = { sfx, tension, panel, setMusic, setTrack, setSfx, tracks: TRACKS, sfxNames: Object.keys(SFX), state: () => Object.assign({}, st, { ctx: ctx ? ctx.state : 'none', playing: running }) };
})();
