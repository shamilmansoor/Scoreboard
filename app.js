/**
 * Table Tennis Scoreboard - Application Logic & State Engine
 * Follows official International Table Tennis Federation (ITTF) rules.
 */

(function () {
  'use strict';

  // ==========================================================================
  // Core Constants & Game Logic
  // ==========================================================================

  const DEFAULT_TO = 11;
  const other = p => (p[0] === 'a' ? 'b' : 'a');
  const mate = p => p[0] + (p[1] === '0' ? '1' : '0');
  const needSets = s => Math.ceil(s.best / 2);
  const servesPerTurn = to => (to === 21 ? 5 : 2);
  const clone = o => JSON.parse(JSON.stringify(o));

  function tally(games) {
    let a = 0, b = 0;
    for (const g of games) {
      if (g.a > g.b) a++; else b++;
    }
    return { a, b };
  }

  const defaultName = (type, id) => {
    if (type === 'doubles') {
      return id.toUpperCase().replace(/(\w)(\d)/, (_, l, d) => l + (+d + 1));
    }
    return id[0] === 'a' ? 'Player A' : 'Player B';
  };

  /**
   * Replays current game points to derive scores, active server, receiver,
   * deuce state, game/match points, and change-of-ends conditions.
   */
  function derive(s) {
    const dbl = s.type === 'doubles';
    const live = s.status === 'live';
    const before = live ? s.games : s.games.slice(0, -1);
    const w = tally(before);
    const need = needSets(s);
    const deciding = w.a === need - 1 && w.b === need - 1;

    let order = dbl
      ? [s.cur.first, s.cur.recv, mate(s.cur.first), mate(s.cur.recv)]
      : [s.cur.first, other(s.cur.first) + '0'];

    let turn = 0, a = 0, b = 0, swapAt = -1;
    const toPoints = s.to || DEFAULT_TO;
    const swapScore = toPoints === 21 ? 10 : 5;
    const perTurn = servesPerTurn(toPoints);

    for (const p of s.cur.log) {
      if (p === 'a') a++; else b++;
      const t = a + b;

      // Serve changes every 2 points (every 5 in classic 21-point games),
      // and every point once both players reach deuce.
      if ((a >= toPoints - 1 && b >= toPoints - 1) || t % perTurn === 0) {
        turn++;
      }

      // Deciding game: change ends when leading side reaches 5 (or 10 in 21-pt)
      if (deciding && swapAt < 0 && Math.max(a, b) >= swapScore) {
        swapAt = t;
        if (dbl) {
          const S = order[turn % 4];
          const R = order[(turn + 1) % 4];
          order = [S, mate(R), mate(S), R];
          turn = 0;
        }
      }
    }

    const server = order[turn % order.length];
    const recv = dbl ? order[(turn + 1) % 4] : other(server) + '0';
    const t = a + b;
    const over = Math.max(a, b) >= toPoints && Math.abs(a - b) >= 2;
    const winner = over ? (a > b ? 'a' : 'b') : null;

    const gp = side => {
      const x = side === 'a' ? a : b;
      const y = side === 'a' ? b : a;
      return !over && x + 1 >= toPoints && x + 1 - y >= 2;
    };

    const gamePoint = { a: gp('a'), b: gp('b') };
    const matchPoint = {
      a: gamePoint.a && w.a === need - 1,
      b: gamePoint.b && w.b === need - 1
    };

    return {
      a,
      b,
      server,
      recv,
      over,
      winner,
      deciding,
      gamePoint,
      matchPoint,
      deuce: a === b && a >= toPoints - 1,
      ends: swapAt >= 0 && swapAt === t,
      swapped: swapAt >= 0
    };
  }

  function buildMatch(u) {
    const dbl = u.type === 'doubles';
    const ids = dbl ? ['a0', 'a1', 'b0', 'b1'] : ['a0', 'b0'];
    const names = {};
    ids.forEach(id => {
      names[id] = ((u.names && u.names[id]) || '').trim() || defaultName(u.type, id);
    });
    return {
      v: 1,
      rev: 0,
      status: 'live',
      type: u.type,
      best: u.best,
      to: u.to || DEFAULT_TO,
      names,
      games: [],
      cur: {
        first: u.first,
        recv: dbl ? u.recv : other(u.first),
        log: []
      },
      flip: false
    };
  }

  function pointFor(s, side) {
    if (s.status !== 'live') return s;
    const n = clone(s);
    if (derive(n).over) return s;
    n.cur.log.push(side);
    const d = derive(n);
    if (d.over) {
      n.games.push({
        a: d.a,
        b: d.b,
        first: n.cur.first,
        recv: n.cur.recv,
        log: n.cur.log.slice()
      });
      n.status = tally(n.games)[d.winner] >= needSets(n) ? 'done' : 'break';
    }
    return n;
  }

  function undo(s) {
    const n = clone(s);
    if (n.status === 'live') {
      if (n.cur.log.length === 0) {
        if (!n.games.length) return s;
        const g = n.games.pop();
        n.cur = { first: g.first, recv: g.recv, log: g.log };
        n.flip = !n.flip; // revert automatic side change
      }
    } else {
      const g = n.games.pop();
      n.cur = { first: g.first, recv: g.recv, log: g.log };
      n.status = 'live';
    }
    n.cur.log.pop();
    return n;
  }

  function nextDefaults(s) {
    return { first: s.cur.recv, recv: s.cur.first };
  }

  function nextGame(s, first, recv) {
    const n = clone(s);
    n.cur = { first, recv, log: [] };
    n.status = 'live';
    n.flip = !n.flip;
    return n;
  }

  // ==========================================================================
  // Sound Synthesis & Web Audio Engine
  // ==========================================================================

  let audioCtx = null;
  let soundEnabled = true;

  function initAudio() {
    if (!audioCtx) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
      } catch (e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  // Plays a sequence of short notes. Each note: frequency, optional glide-to
  // frequency, start offset, volume, decay time and stop time (seconds).
  function play(type, notes) {
    if (!soundEnabled) return;
    initAudio();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      for (const n of notes) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const t = now + (n.at || 0);
        osc.type = type;
        osc.frequency.setValueAtTime(n.f, t);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.glide);
        gain.gain.setValueAtTime(n.vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + n.decay);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + n.stop);
      }
    } catch (e) {}
  }

  const Sound = {
    playBallPing: () => play('triangle', [{ f: 640, to: 320, glide: 0.05, vol: 0.4, decay: 0.06, stop: 0.07 }]),
    playAlert: () => play('sine', [580, 880].map((f, i) => ({ f, at: i * 0.09, vol: 0.25, decay: 0.14, stop: 0.15 }))),
    playUndo: () => play('sine', [{ f: 420, to: 280, glide: 0.08, vol: 0.25, decay: 0.09, stop: 0.1 }]),
    // C, E, G, C
    playWin: () => play('triangle', [523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ f, at: i * 0.12, vol: 0.35, decay: 0.35, stop: 0.38 })))
  };

  // ==========================================================================
  // Celebration Confetti System
  // ==========================================================================

  let confettiCanvas = null;
  let confettiCtx = null;
  let confettiParticles = [];
  let confettiAnimationId = null;

  function initConfetti() {
    if (!confettiCanvas) {
      confettiCanvas = document.createElement('canvas');
      confettiCanvas.id = 'confetti-canvas';
      document.body.appendChild(confettiCanvas);
      confettiCtx = confettiCanvas.getContext('2d');
    }
  }

  function resizeConfetti() {
    if (!confettiCanvas) return;
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeConfetti);

  function triggerConfetti() {
    initConfetti();
    resizeConfetti();
    const colors = ['#1d4f9a', '#c0392b', '#e8821e', '#f5f1e8', '#1a1814'];
    confettiParticles = [];
    for (let i = 0; i < 110; i++) {
      confettiParticles.push({
        x: window.innerWidth * Math.random(),
        y: window.innerHeight * -0.1,
        w: Math.random() * 9 + 6,
        h: Math.random() * 5 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 4 + 4,
        rot: Math.random() * 360,
        vrot: (Math.random() - 0.5) * 12,
        opacity: 1
      });
    }

    if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
    let frames = 0;

    function renderFrame() {
      if (!confettiCtx) return;
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      let alive = 0;

      for (const p of confettiParticles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        if (frames > 120) p.opacity -= 0.015;

        if (p.opacity > 0 && p.y < confettiCanvas.height + 20) {
          alive++;
          confettiCtx.save();
          confettiCtx.translate(p.x, p.y);
          confettiCtx.rotate((p.rot * Math.PI) / 180);
          confettiCtx.globalAlpha = Math.max(0, p.opacity);
          confettiCtx.fillStyle = p.color;
          confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          confettiCtx.restore();
        }
      }

      frames++;
      if (alive > 0) {
        confettiAnimationId = requestAnimationFrame(renderFrame);
      } else {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        confettiAnimationId = null;
      }
    }

    renderFrame();
  }

  // ==========================================================================
  // Helper Utilities & Storage
  // ==========================================================================

  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = s =>
    String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // JSON storage that never throws (storage can be blocked in private windows).
  // `raw` reads/writes plain strings, used for the theme and sound settings.
  const store = area => ({
    get(k) { try { return JSON.parse(area().getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { area().setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { area().removeItem(k); } catch (e) {} },
    raw(k, v) {
      try {
        if (v === undefined) return area().getItem(k);
        area().setItem(k, v);
      } catch (e) { return null; }
    }
  });
  const LS = store(() => localStorage);
  const SS = store(() => sessionStorage);

  const HOST = 'ttsb-host';        // controller: active display code (localStorage)
  const DISPLAY = 'ttsb-display';  // display: joined code (sessionStorage, per tab)
  const SOLO = 'ttsb-solo';
  const THEME_KEY = 'ttsb-theme';
  const SOUND_KEY = 'ttsb-sound';

  // Load sound preference
  const savedSound = LS.raw(SOUND_KEY);
  if (savedSound !== null) {
    soundEnabled = savedSound === 'true';
  }

  // ==========================================================================
  // Application State
  // ==========================================================================

  // 'solo' (scoring on the table view) and 'remote' (phone pad) control the match;
  // 'display' only follows a controller.
  let role = 'games'; // 'games' | 'display' | 'remote' | 'solo'
  const isController = () => role === 'solo' || role === 'remote';
  let S = null;      // Active match state
  let db = null;
  let dbState = 'loading'; // 'loading' | 'ok' | 'none'
  let ref = null;
  let unsub = null;
  let room = null;
  let connState = 'idle';
  let slowTimer = null;
  let wl = null;
  let armT = null;

  // Local BroadcastChannel for cross-tab sync when db is not available
  let localChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      localChannel = new BroadcastChannel('ttsb-local-sync');
      localChannel.onmessage = e => {
        const msg = e.data;
        if (!msg || !room || msg.room !== room) return;
        if (role === 'display') {
          // The controller is the only source of truth: always follow it.
          if (msg.type === 'state') {
            celebrateIfWon(S, msg.data);
            S = msg.data; // already a copy (structured clone)
            connState = 'live';
            clearTimeout(slowTimer);
            render();
          } else if (msg.type === 'closed') {
            displayEnded();
          }
        } else if (msg.type === 'hello') {
          // A screen just joined with our code: send it the current match, even
          // while this device is on the start page or setting up the next match.
          try {
            localChannel.postMessage({ type: 'state', room, data: S || { status: 'waiting', rev: 0 } });
          } catch (e) {}
        }
      };
    }
  } catch (e) {}

  const ui = {
    code: '',
    err: '',
    busy: false,
    armed: null,
    warn: '',
    showShortcuts: false,
    showCode: false,
    isFlippingCoin: false,
    setup: {
      type: 'singles',
      best: 3,
      to: 11,
      names: {},
      first: 'a0',
      recv: 'b0'
    },
    next: null,
    nextKey: -1
  };

  const teamName = (s, side) =>
    s.type === 'doubles'
      ? s.names[side + '0'] + ' / ' + s.names[side + '1']
      : s.names[side + '0'];

  function fixPick(u, type) {
    const t = type || u.type;
    if (t === 'singles') {
      u.first = u.first[0] + '0';
      u.recv = other(u.first) + '0';
    } else {
      if (u.recv[0] === u.first[0]) u.recv = other(u.first) + '0';
    }
  }

  // ==========================================================================
  // Render Components & Views
  // ==========================================================================

  function renderNavBar(titleRight = '') {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return `
      <nav class="top-navbar">
        <div class="brand">
          ${role === 'games'
            ? `<span class="wordmark">Scoreboard</span>`
            : isController()
            ? `<button type="button" class="wordmark link" data-act="games" title="Start page">Scoreboard</button><span class="crumb">Table tennis</span>`
            : `<span class="wordmark">Scoreboard</span><span class="crumb">Table tennis</span>`}
        </div>
        <div class="nav-actions">
          ${titleRight}
          <button type="button" class="icon-btn" data-act="toggle-sound" title="${soundEnabled ? 'Mute Sound' : 'Enable Sound'}" aria-label="Toggle sound">
            ${soundEnabled
              ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`
              : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
            }
          </button>
          <button type="button" class="icon-btn" data-act="toggle-theme" title="Toggle Light/Dark Theme" aria-label="Toggle theme">
            ${isDark
              ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
              : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
            }
          </button>
          <button type="button" class="icon-btn" data-act="open-shortcuts" title="Keyboard Shortcuts (?)" aria-label="Keyboard shortcuts">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </button>
        </div>
      </nav>
    `;
  }

  function seg(act, val, opts) {
    return (
      '<div class="seg" role="radiogroup">' +
      opts
        .map(
          o =>
            `<button type="button" role="radio" aria-checked="${o[0] === val}" class="${
              o[0] === val ? 'on' : ''
            }" data-act="${act}" data-v="${o[0]}">${o[1]}</button>`
        )
        .join('') +
      '</div>'
    );
  }

  function pickerHTML(u, scope, names) {
    const dbl = u.type === 'doubles';
    const ids = dbl ? ['a0', 'a1', 'b0', 'b1'] : ['a0', 'b0'];
    const nm = id => (names && names[id]) || defaultName(u.type, id);
    const chip = (act, id, sel) =>
      `<button type="button" role="radio" aria-checked="${sel}" class="chip ${id[0]}${
        sel ? ' on' : ''
      }" data-act="${act}" data-scope="${scope}" data-id="${id}"><span data-chip-name="${id}">${esc(
        nm(id)
      )}</span></button>`;

    let h = `
      <div class="field">
        <span class="lab">Serves first</span>
        <div class="chips" role="radiogroup">${ids
          .map(id => chip('pick-first', id, u.first === id))
          .join('')}</div>
      </div>
    `;

    if (dbl) {
      const rid = ids.filter(id => id[0] !== u.first[0]);
      h += `
        <div class="field">
          <span class="lab">Receives first</span>
          <div class="chips" role="radiogroup">${rid
            .map(id => chip('pick-recv', id, u.recv === id))
            .join('')}</div>
        </div>
      `;
    }

    h += `
      <div class="coin-container">
        <button type="button" class="link-btn coin-btn ${ui.isFlippingCoin ? 'flipping' : ''}" data-act="toss" data-scope="${scope}">
          Toss a coin for serve
        </button>
      </div>
    `;
    return h;
  }

  function setupHTML() {
    const u = ui.setup, dbl = u.type === 'doubles';
    const inp = (id, label) => `
      <input type="text" id="n-${id}" data-name="${id}" maxlength="24" autocomplete="off"
        placeholder="${esc(defaultName(u.type, id))}" value="${esc(u.names[id] || '')}"
        aria-label="${esc(label || defaultName(u.type, id))}">
    `;

    const teams = dbl
      ? `
        <div class="team a">
          <span class="team-badge">Team A</span>
          ${inp('a0', 'Player A1')}
          ${inp('a1', 'Player A2')}
        </div>
        <div class="team b">
          <span class="team-badge">Team B</span>
          ${inp('b0', 'Player B1')}
          ${inp('b1', 'Player B2')}
        </div>`
      : `
        <div class="team a">
          <span class="team-badge">Player A</span>
          ${inp('a0', 'Player A')}
        </div>
        <div class="team b">
          <span class="team-badge">Player B</span>
          ${inp('b0', 'Player B')}
        </div>`;

    return `
      <div class="sheet">
        <h2 class="sheet-title">New match</h2>
        <div class="field-row">
          <div class="field">
            <span class="lab">Format</span>
            ${seg('set-type', u.type, [['singles', 'Singles'], ['doubles', 'Doubles']])}
          </div>
          <div class="field">
            <span class="lab">Points per game</span>
            ${seg('set-to', String(u.to || 11), [['11', '11'], ['21', '21']])}
          </div>
        </div>
        <div class="field">
          <span class="lab">Length</span>
          ${seg('set-best', String(u.best), [
            ['1', '1 game'],
            ['3', 'Best of 3'],
            ['5', 'Best of 5'],
            ['7', 'Best of 7']
          ])}
        </div>
        <div class="versus">${teams}</div>
        ${pickerHTML(u, 'setup', u.names)}
        <button type="button" class="btn primary block" data-act="start">Start match</button>
      </div>
    `;
  }

  function infoText(s) {
    const format = s.type === 'doubles' ? 'Doubles' : 'Singles';
    const best = s.best === 1 ? 'one game' : `best of ${s.best}`;
    return `${format}, ${best}, to ${s.to || 11}`;
  }

  function noticeInfo(s, d) {
    const dbl = s.type === 'doubles';
    const verb = dbl ? 'win' : 'wins';
    let msg = '', cls = '';

    if (s.status === 'done') {
      const W = tally(s.games);
      const w = W.a > W.b ? 'a' : 'b';
      msg = `${teamName(s, w)} ${verb} the match ${W[w]}–${W[other(w)]}`;
      cls = 'win';
    } else if (s.status === 'break') {
      const g = s.games[s.games.length - 1];
      const w = g.a > g.b ? 'a' : 'b';
      msg = `Game ${s.games.length} to ${s.type === 'doubles' ? 'Team ' + w.toUpperCase() : teamName(s, w)}, ${Math.max(g.a, g.b)}–${Math.min(g.a, g.b)}. Change ends.`;
      cls = 'brk';
    } else if (d.ends) {
      msg = 'Change ends';
      cls = 'warn';
    } else if (d.matchPoint.a || d.matchPoint.b) {
      msg = 'Match point';
      cls = 'hot';
    } else if (d.gamePoint.a || d.gamePoint.b) {
      msg = 'Game point';
      cls = 'hot';
    } else if (d.deuce) {
      msg = 'Deuce. One serve each, win by two.';
    }

    return { msg, cls };
  }

  // --------------------------------------------------------------------------
  // Top-view table arena
  // Arena coordinate system (landscape): 230 x 100 units. Table occupies
  // x 41.4–188.6, y 9–91 (ITTF ratio 274 : 152.5). Net at x = 115.
  // Portrait layouts rotate everything 90° clockwise: (x, y) -> (100 - y, x).
  // --------------------------------------------------------------------------

  const initials = n => {
    const words = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const s = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
    return s.toUpperCase();
  };

  function serveCount(s, d, short) {
    const to = s.to || DEFAULT_TO;
    const per = servesPerTurn(to);
    const n = d.a >= to - 1 && d.b >= to - 1 ? [1, 1] : [((d.a + d.b) % per) + 1, per];
    return short ? `${n[0]}/${n[1]}` : `${n[0]} of ${n[1]}`;
  }

  // Scene drawn as if the server is at the LEFT end; rotated 180° otherwise.
  function tableSceneSVG(s,uid, serverLeft, layer) {
    const live = s.status === 'live';
    const dbl = s.type === 'doubles';
    const T = { x: 41.4, y: 9, w: 147.2, h: 82 };


    // Serve flight: start at server paddle, bounce own half, bounce receiver half.
    const p = dbl
      ? { s: [36, 72], b1: [72, 69], b2: [160, 31], e: [194, 28] }
      : { s: [36, 50], b1: [72, 56], b2: [160, 44], e: [194, 50] };
    const path = `M${p.s} Q${(p.s[0] + p.b1[0]) / 2},${p.s[1] - 3} ${p.b1} Q115,${(p.b1[1] + p.b2[1]) / 2 - 4} ${p.b2} Q${(p.b2[0] + p.e[0]) / 2},${p.e[1] - 3} ${p.e}`;

    // Just the serve line, an arrow at the receiver, and the ball travelling along it.
    const flight = live
      ? `
        <path class="serve-path" d="${path}" marker-end="url(#arr-${uid})" />
        <g class="ball">
          <circle class="ball-shadow" r="1.6" cx="0.9" cy="1.1" />
          <circle class="ball-core" r="1.7">
            <animate attributeName="r" values="1.7;1.3;2.2;1.3;1.8;1.7" keyTimes="0;0.16;0.36;0.55;0.7;1" dur="2.6s" repeatCount="indefinite" />
          </circle>
          <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.7;0.74;1" dur="2.6s" repeatCount="indefinite" />
          <animateMotion dur="2.6s" repeatCount="indefinite" path="${path}" keyPoints="0;1;1" keyTimes="0;0.7;1" calcMode="linear" />
        </g>`
      : '';

    const rot = serverLeft ? '' : 'rotate(180 115 50)';

    // Serve line drawn on its own layer so it passes over the score cards.
    if (layer === 'fx') {
      return `
        <defs>
          <marker id="arr-${uid}" viewBox="0 0 6 6" refX="4" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L6,3 L0,6 z" fill="#f08a24" />
          </marker>
        </defs>
        <g transform="${rot}">${flight}</g>
      `;
    }

    return `
      <defs>
        <linearGradient id="tbl-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2056a3" />
          <stop offset="1" stop-color="#1b4a92" />
        </linearGradient>
        <pattern id="mesh-${uid}" width="1.2" height="1.2" patternUnits="userSpaceOnUse">
          <rect width="1.2" height="1.2" fill="rgba(20,18,15,.6)" />
          <rect width="0.6" height="0.6" fill="rgba(245,241,232,.3)" />
        </pattern>
      </defs>
      <!-- table -->
      <rect class="tbl-shadow" x="${T.x + 1.4}" y="${T.y + 2}" width="${T.w}" height="${T.h}" rx="1" />
      <rect x="${T.x}" y="${T.y}" width="${T.w}" height="${T.h}" rx="0.8" fill="url(#tbl-${uid})" />
      <rect class="tbl-edge" x="${T.x + 0.6}" y="${T.y + 0.6}" width="${T.w - 1.2}" height="${T.h - 1.2}" />
      <line class="tbl-center" x1="${T.x + 0.6}" y1="50" x2="${T.x + T.w - 0.6}" y2="50" />
      <!-- net -->
      <rect x="113.6" y="5" width="2.8" height="90" fill="url(#mesh-${uid})" class="net-mesh" />
      <line class="net-tape" x1="115" y1="5" x2="115" y2="95" />
      <rect class="net-post" x="112.6" y="2.6" width="4.8" height="3.6" rx="0.8" />
      <rect class="net-post" x="112.6" y="93.8" width="4.8" height="3.6" rx="0.8" />
    `;
  }

  let lastPts = {};

  function boardHTML(s, d, tap) {
    const live = s.status === 'live';
    const dbl = s.type === 'doubles';
    const order = s.flip !== d.swapped ? ['b', 'a'] : ['a', 'b']; // [left end, right end]
    const W = tally(s.games);
    const need = needSets(s);
    const winner = s.status === 'done' ? (W.a > W.b ? 'a' : 'b') : s.status === 'break' ? d.winner : null;
    const endOf = side => (order[0] === side ? 'L' : 'R');
    const serverLeft = endOf(d.server[0]) === 'L';
    const ids = dbl ? ['a0', 'a1', 'b0', 'b1'] : ['a0', 'b0'];

    // Where each player stands. In doubles the server and receiver occupy the
    // right-hand half of their end; partners stand in the left-hand half.
    const posOf = id => {
      const end = endOf(id[0]);
      let y = 50;
      if (dbl) {
        const rightHand = [d.server, d.recv].find(p => p[0] === id[0]);
        y = id === rightHand ? 77 : 23; // for the left end (facing right, right hand = down)
      }
      if (end === 'R') y = 100 - y;
      return { x: end === 'L' ? 8.5 : 91.5, y, end };
    };

    const players = ids
      .map(id => {
        const pos = posOf(id);
        const srv = live && id === d.server;
        const rcv = live && id === d.recv;
        // Only the server gets a label (the serve line already points at the receiver).
        const role = srv ? `<span class="pl-role srv"><i class="dot"></i>${serveCount(s, d, true)}</span>` : '';
        return `
          <div class="pl team-${id[0]} end-${pos.end}${pos.y < 50 ? ' y-lo' : ' y-hi'}${srv ? ' is-server' : ''}${rcv ? ' is-receiver' : ''}"
               data-flip="pl-${id}" style="--x:${pos.x}%;--y:${pos.y}%">
            <div class="pl-body">
              <div class="pl-token">
                <span class="pl-init">${esc(initials(s.names[id]))}</span>
                <span class="pl-paddle" aria-hidden="true"></span>
              </div>
              <div class="pl-name">${esc(s.names[id])}</div>
              ${role}
            </div>
          </div>
        `;
      })
      .join('');

    // One quiet line above the table: the notice when there is one, else the game.
    const note = noticeInfo(s, d);
    const gameNo = live ? s.games.length + 1 : s.games.length;
    const gameLabel = s.best > 1 ? `Game ${gameNo} of ${s.best}` : 'Single game';
    const boardBar = `<p class="board-bar ${note.cls}" role="status">${esc(note.msg || gameLabel)}</p>`;

    // Flip-card scorers on each half of the table, with games won as dots below.
    const tableScores = order
      .map((side, i) => {
        const hot = live && (d.matchPoint[side] || d.gamePoint[side]);
        const turned = lastPts[side] !== undefined && lastPts[side] !== d[side];
        const pips = s.best > 1
          ? `<span class="games-won" aria-label="${W[side]} of ${need} games won">${Array.from({ length: need }, (_, k) => `<i class="${k < W[side] ? 'on' : ''}"></i>`).join('')}</span>`
          : '';
        return `
          <div class="tbl-score team-${side}${hot ? ' hot' : ''}${winner === side ? ' won' : ''}${winner && winner !== side ? ' lost' : ''}"
               data-flip="sc-${side}" style="--x:${i === 0 ? 34 : 66}%;--y:50%">
            <span class="flip${turned ? ' turned' : ''}" aria-label="${esc(teamName(s, side))}: ${d[side]} points"><span>${d[side]}</span></span>
            ${pips}
          </div>
        `;
      })
      .join('');
    lastPts = { a: d.a, b: d.b };

    const taps =
      tap && live
        ? order
            .map(
              (side, i) => `
              <div class="tap-zone tap-${i === 0 ? 'L' : 'R'}" data-act="pt" data-side="${side}" role="button" tabindex="0"
                   aria-label="Point to ${esc(teamName(s, side))}"></div>`
            )
            .join('')
        : '';

    return `
      <div class="board-container">
        ${boardBar}
        <div class="arena${live ? '' : ' paused'}${dbl ? ' dbl' : ''}">
          <svg class="arena-svg land" viewBox="0 0 230 100" aria-hidden="true">
            ${tableSceneSVG(s,'l', serverLeft)}
          </svg>
          <svg class="arena-svg port" viewBox="0 0 100 230" aria-hidden="true">
            <g transform="translate(100 0) rotate(90)">${tableSceneSVG(s,'p', serverLeft)}</g>
          </svg>
          ${tableScores}
          <svg class="arena-svg land fx" viewBox="0 0 230 100" aria-hidden="true">
            ${tableSceneSVG(s,'lf', serverLeft, 'fx')}
          </svg>
          <svg class="arena-svg port fx" viewBox="0 0 100 230" aria-hidden="true">
            <g transform="translate(100 0) rotate(90)">${tableSceneSVG(s,'pf', serverLeft, 'fx')}</g>
          </svg>
          ${players}
          ${taps}
        </div>
      </div>
    `;
  }

  function histHTML(s) {
    if (!s.games.length) return '';
    return `
      <table class="hist">
        <thead><tr><th></th>${s.games.map((_, i) => `<th>G${i + 1}</th>`).join('')}</tr></thead>
        <tbody>
          ${['a', 'b']
            .map(
              side => `<tr class="team-${side}"><th>${esc(teamName(s, side))}</th>${s.games
                .map(g => `<td class="${g[side] > g[other(side)] ? 'w' : ''}">${g[side]}</td>`)
                .join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  function toolsHTML(s) {
    const canUndo = s.games.length > 0 || s.cur.log.length > 0;
    return `
      <div class="tools">
        <button type="button" class="btn" data-act="undo" ${canUndo ? '' : 'disabled'}>Undo <kbd>Z</kbd></button>
        <button type="button" class="btn" data-act="flip">Swap ends <kbd>S</kbd></button>
        <button type="button" class="btn danger${ui.armed === 'new' ? ' armed' : ''}" data-act="new-match">
          ${ui.armed === 'new' ? 'Tap again to end' : 'End match'}
        </button>
      </div>
    `;
  }

  function nextPanelHTML(s) {
    const key = s.games.length;
    if (ui.nextKey !== key) {
      ui.next = nextDefaults(s);
      fixPick(ui.next, s.type);
      ui.nextKey = key;
    }
    const g = s.games[s.games.length - 1];
    return `
      <div class="sheet">
        <h2 class="sheet-title">Game ${s.games.length + 1}</h2>
        <p class="sheet-sub">Game ${s.games.length} finished ${g.a}–${g.b}. Players change ends.</p>
        ${pickerHTML(Object.assign({ type: s.type }, ui.next), 'next', s.names)}
        <button type="button" class="btn primary block" data-act="next-game">Start game ${s.games.length + 1}</button>
      </div>
    `;
  }

  // ==========================================================================
  // Screen Layouts (Home, Display, Remote, Solo)
  // ==========================================================================

  // Registry of supported sports. Add an entry (and its screens) to support a new game.
  const GAMES = [
    { id: 'tt', name: 'Table tennis', blurb: 'Singles and doubles to 11 or 21, with ITTF serve and end rules.' }
  ];

  // Flat top-view drawing for each sport's tile.
  const GAME_ART = {
    tt: `
      <svg viewBox="0 0 120 70" aria-hidden="true">
        <rect width="120" height="70" fill="#7a3328"/>
        <rect x="20" y="11" width="80" height="48" fill="#1d4f9a"/>
        <rect x="21.2" y="12.2" width="77.6" height="45.6" fill="none" stroke="#f5f1e8" stroke-width="1.2"/>
        <line x1="21" y1="35" x2="99" y2="35" stroke="#f5f1e8" stroke-width=".5"/>
        <line x1="60" y1="7" x2="60" y2="63" stroke="#f5f1e8" stroke-width="1.6"/>
        <path d="M17 47 Q38 45 40 46 Q60 33 82 24 Q92 22 103 23" fill="none" stroke="#f5f1e8" stroke-width=".6" stroke-dasharray="1.6 1.6" opacity=".7"/>
        <circle r="1.9" fill="#f08a24">
          <animateMotion dur="2.6s" repeatCount="indefinite" path="M17 47 Q38 45 40 46 Q60 33 82 24 Q92 22 103 23" keyPoints="0;1;1" keyTimes="0;.7;1" calcMode="linear"/>
        </circle>
        <circle cx="11" cy="47" r="5" fill="#f5f1e8" stroke="#1d4f9a" stroke-width="2"/>
        <circle cx="109" cy="23" r="5" fill="#f5f1e8" stroke="#c0392b" stroke-width="2"/>
      </svg>`
  };

  // Start page: the only two choices in the app.
  //   1. Start a match (pick a sport) — every match gets a code automatically.
  //   2. Join a match with a code — shared by all sports; any number of screens can join.
  function gamesHTML() {
    const saved = LS.get(SOLO);
    const resumable = saved && saved.cur;
    const hosted = LS.get(HOST);
    const note =
      dbState === 'loading'
        ? 'Checking for the sync service…'
        : dbState === 'ok'
        ? 'Sync is on: screens can join from any device.'
        : 'Sync is offline: screens can only join from other tabs of this browser.';

    const tile = g => `
        <li class="tile ready">
          <span class="tile-art">${GAME_ART[g.id] || ''}</span>
          <span class="tile-tag on">Ready</span>
          <span class="tile-name">${esc(g.name)}</span>
          <span class="tile-desc">${esc(g.blurb)}</span>
          ${resumable && hosted && hosted.code ? `<span class="tile-live"><i class="dot"></i>Match in progress, code <b>${esc(hosted.code)}</b></span>` : ''}
          <span class="tile-act">
            <button type="button" class="btn primary" data-act="pick-game" data-v="${g.id}">New match</button>
            ${resumable ? `<button type="button" class="btn" data-act="resume-solo">Resume</button>` : ''}
          </span>
        </li>`;

    return `
      <div class="wrap landing">
        ${renderNavBar()}

        <section class="hero">
          <div class="hero-copy">
            <h1>Keep score.<br>Show it on every screen.</h1>
            <p>Score any match on one phone or tablet. Every TV, laptop or phone with the code follows it live.</p>
          </div>

          <section class="choice join" aria-labelledby="join-title">
            <p class="choice-kicker">Watching on this screen?</p>
            <h2 id="join-title">Join a match</h2>
            <div class="join-box">
              <input type="text" id="code-input" class="codein big" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="CODE" value="${esc(ui.code)}" aria-label="Match code">
              <button type="button" class="btn primary" data-act="role-display" ${!ui.busy ? '' : 'disabled'}>
                ${ui.busy ? 'Joining…' : 'Join'}
              </button>
            </div>
            <p class="err" role="alert">${esc(ui.err)}</p>
            <p class="choice-note">Enter the 4-letter code from the scoring device. Any number of screens can join, for any sport.</p>
          </section>
        </section>

        <section class="sports" aria-labelledby="start-title">
          <div class="sports-head">
            <h2 id="start-title">Start a match</h2>
            <p>Every match gets its own code.</p>
          </div>
          <ul class="sport-grid">
            ${GAMES.map(tile).join('')}
            <li class="tile more" aria-disabled="true">
              <span class="tile-name">More games coming soon</span>
            </li>
          </ul>
        </section>

        <ol class="how">
          <li><span><b>Start</b> a match on a phone or tablet.</span></li>
          <li><span><b>Share</b> the 4-letter code it shows.</span></li>
          <li><span><b>Join</b> on TVs and laptops. They follow every point until you close the match.</span></li>
        </ol>
        <p class="note sync-note">${note}</p>
      </div>
      ${renderShortcutsModal()}
    `;
  }

  // Scoring-device header: the match code, the scoring view, and closing the match.
  function linkControlsHTML() {
    const view = S && S.cur
      ? `<button type="button" class="btn small" data-act="toggle-view">${role === 'solo' ? 'Big buttons' : 'Table view'}</button>`
      : '';
    if (!room) return view;
    return `
      <button type="button" class="room-badge as-btn" data-act="show-code" title="How others join">Code <b>${esc(room)}</b></button>
      ${view}
      <button type="button" class="btn small danger${ui.armed === 'stop-host' ? ' armed' : ''}" data-act="stop-host">
        ${ui.armed === 'stop-host' ? 'Tap again to close' : 'Close match'}
      </button>
    `;
  }

  function codePanelHTML() {
    if (!room || !ui.showCode) return '';
    const chars = room.split('').map(c => `<span>${esc(c)}</span>`).join('');
    return `
      <section class="code-panel" aria-label="Match code">
        <div class="bigcode small" aria-label="Code ${esc(room)}">${chars}</div>
        <ol>
          <li>On any screen, open this page.</li>
          <li>Under <b>Join a match</b>, enter <b>${esc(room)}</b>.</li>
          <li>As many screens as you like can join. They follow this device until you close the match.</li>
        </ol>
        <button type="button" class="link-btn" data-act="hide-code">Hide</button>
      </section>
    `;
  }

  // Joined screen: nothing but the scoreboard. Double-click (or F) toggles full screen.
  function displayHTML() {
    if (!S || S.status === 'waiting' || !S.cur) {
      const chars = (room || '····').split('').map(c => `<span>${esc(c)}</span>`).join('');
      return `
        <div class="bare-stage">
          <div class="waiting-box">
            <div class="bigcode" aria-label="Code ${esc(room || '')}">${chars}</div>
            <p class="lede">${S && S.status === 'waiting' ? 'Next match coming up' : 'Waiting for the match'}</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="bare-stage">
        ${boardHTML(S, derive(S), false)}
      </div>
    `;
  }

  function controlHTML(s) {
    const d = derive(s), live = s.status === 'live';
    const order = s.flip !== d.swapped ? ['b', 'a'] : ['a', 'b'];
    const note = noticeInfo(s, d);
    let main = '';

    if (live) {
      const dbl = s.type === 'doubles';
      main = `
        <p class="serve-line ${note.cls}" role="status">${
          note.msg
            ? esc(note.msg)
            : `<span><i class="dot"></i><b>${esc(s.names[d.server])}</b> serves to <b>${esc(s.names[d.recv])}</b>, ${serveCount(s, d)}</span>`
        }</p>
        <div class="pad">
          ${order
            .map(side => {
              const ids = dbl ? [side + '0', side + '1'] : [side + '0'];
              const names = ids
                .map(id => `<span class="p-row${id === d.server ? ' on' : ''}">${id === d.server ? '<i class="dot"></i>' : ''}${esc(s.names[id])}</span>`)
                .join('');
              const srvSide = d.server[0] === side;
              return `
                <button type="button" class="padbtn ${side}${srvSide ? ' serving' : ''}"
                  data-act="pt" data-side="${side}"
                  aria-label="Point to ${esc(teamName(s, side))}, currently ${d[side]}">
                  <span class="pn">${names}</span>
                  <span class="ps">${d[side]}</span>
                  <span class="pad-plus">+1</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `;
    } else if (s.status === 'break') {
      main = nextPanelHTML(s);
    } else {
      main = matchDoneHTML(s);
    }

    return `
      ${live ? '' : `<p class="serve-line ${note.cls}">${esc(note.msg)}</p>`}
      ${main}
      ${histHTML(s)}
      ${toolsHTML(s)}
    `;
  }

  function matchDoneHTML(s) {
    const W = tally(s.games);
    const w = W.a > W.b ? 'a' : 'b';
    return `
      <div class="sheet">
        <h2 class="sheet-title">${esc(teamName(s, w))} ${s.type === 'doubles' ? 'win' : 'wins'}, ${W[w]}–${W[other(w)]}</h2>
        <p class="sheet-sub">${s.games.map((g, i) => `Game ${i + 1}: ${g.a}–${g.b}`).join(' · ')}</p>
        <button type="button" class="btn primary block" data-act="new-match-now">Set up the next match</button>
      </div>
    `;
  }

  function remoteHTML() {
    const hdrR = `
      <div class="match-controls">
        ${linkControlsHTML()}
        <button type="button" class="btn small" data-act="home">Home</button>
      </div>
    `;

    const body = !S || !S.cur ? setupHTML() : controlHTML(S);

    return `
      <div class="wrap">
        ${renderNavBar()}
        <header class="match-header">
          <div class="match-title">${S && S.cur ? esc(infoText(S)) : 'Table tennis'}</div>
          ${hdrR}
        </header>
        ${ui.warn ? `<p class="err" role="alert">${esc(ui.warn)}</p>` : ''}
        ${codePanelHTML()}
        ${body}
      </div>
      ${renderShortcutsModal()}
    `;
  }

  function soloHTML() {
    const hdrR = `
      <div class="match-controls">
        ${linkControlsHTML()}
        <button type="button" class="btn small" data-act="fs">Full screen</button>
        <button type="button" class="btn small" data-act="home">Home</button>
      </div>
    `;

    if (!S || !S.cur) {
      return `
        <div class="wrap">
          ${renderNavBar()}
          <header class="match-header">
            <div class="match-title">Table tennis</div>
            ${hdrR}
          </header>
          ${setupHTML()}
        </div>
        ${renderShortcutsModal()}
      `;
    }

    const d = derive(S);
    const live = S.status === 'live';
    let below;
    if (live) {
      below = `
        ${toolsHTML(S)}
        <p class="keys">Tap a side of the table or its score to give it the point. Keys: <kbd>←</kbd> <kbd>→</kbd></p>
      `;
    } else if (S.status === 'break') {
      below = `${nextPanelHTML(S)}${toolsHTML(S)}`;
    } else {
      below = `${matchDoneHTML(S)}${toolsHTML(S)}`;
    }

    return `
      <div class="stage">
        ${renderNavBar()}
        <header class="match-header">
          <div class="match-title">${esc(infoText(S))}</div>
          ${hdrR}
        </header>
        ${ui.warn ? `<p class="err" role="alert">${esc(ui.warn)}</p>` : ''}
        ${codePanelHTML()}
        ${boardHTML(S, d, true)}
        ${histHTML(S)}
        ${below}
      </div>
      ${renderShortcutsModal()}
    `;
  }

  function renderShortcutsModal() {
    if (!ui.showShortcuts) return '';
    return `
      <div class="modal-backdrop" data-act="close-shortcuts">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>Keyboard shortcuts</h3>
            <button type="button" class="icon-btn" data-act="close-shortcuts" aria-label="Close">✕</button>
          </div>
          <div class="shortcut-list">
            <span class="kbd">←</span><span>Point to the left side</span>
            <span class="kbd">→</span><span>Point to the right side</span>
            <span class="kbd">Z</span><span>Undo the last point</span>
            <span class="kbd">S</span><span>Swap ends</span>
            <span class="kbd">M</span><span>Sound on or off</span>
            <span class="kbd">T</span><span>Light or dark theme</span>
            <span class="kbd">F</span><span>Full screen (double-click on a joined screen)</span>
            <span class="kbd">?</span><span>Show these shortcuts</span>
          </div>
          <button type="button" class="btn primary" data-act="close-shortcuts">Got It</button>
        </div>
      </div>
    `;
  }

  const reduceMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render() {
    const app = $('#app');
    if (!app) return;

    // FLIP: remember where players/scores were so they can glide to new spots
    // (switching ends, doubles rotation) instead of jumping.
    const prev = {};
    app.querySelectorAll('[data-flip]').forEach(el => {
      prev[el.dataset.flip] = el.getBoundingClientRect();
    });

    document.body.className = role;
    if (role === 'display') app.innerHTML = displayHTML();
    else if (role === 'remote') app.innerHTML = remoteHTML();
    else if (role === 'solo') app.innerHTML = soloHTML();
    else app.innerHTML = gamesHTML();

    if (reduceMotion()) return;
    app.querySelectorAll('[data-flip]').forEach(el => {
      const p = prev[el.dataset.flip];
      if (!p || !el.animate) return;
      const r = el.getBoundingClientRect();
      const dx = p.left - r.left, dy = p.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.classList.add('moving');
      const T = (x, y) => ({ transform: `translate(${x}px, ${y}px)` });
      let frames = [T(dx, dy), T(0, 0)];
      let duration = Math.min(1400, 500 + Math.hypot(dx, dy) * 1.1);

      // Players changing ends walk around the side of the table, not through it.
      const arena = el.classList.contains('pl') && el.closest('.arena');
      if (arena) {
        const A = arena.getBoundingClientRect();
        if (Math.abs(dx) > A.width * 0.4) {
          const y0 = r.top + dy / 2 < A.top + A.height / 2 ? A.top + A.height * 0.05 : A.bottom - A.height * 0.05;
          frames = [T(dx, dy), Object.assign(T(dx, y0 - r.top), { offset: 0.2 }), Object.assign(T(0, y0 - r.top), { offset: 0.8 }), T(0, 0)];
          duration = 1800;
        } else if (Math.abs(dy) > A.height * 0.4) {
          const x0 = r.left + dx / 2 < A.left + A.width / 2 ? A.left + A.width * 0.05 : A.right - A.width * 0.05;
          frames = [T(dx, dy), Object.assign(T(x0 - r.left, dy), { offset: 0.2 }), Object.assign(T(x0 - r.left, 0), { offset: 0.8 }), T(0, 0)];
          duration = 1800;
        }
      }

      el.animate(frames, { duration, easing: 'ease-in-out' });
      setTimeout(() => el.classList.remove('moving'), duration);
    });
  }

  // ==========================================================================
  // State Commit & Multi-Screen Broadcast
  // ==========================================================================

  function commit(n) {
    n.rev = ((S && S.rev) || 0) + 1;
    S = n;
    render();

    if (isController()) {
      LS.set(SOLO, S);
      if (room) {
        broadcastState();
        queueWrite();
      }
    }
  }

  function broadcastState() {
    if (localChannel && room && S) {
      try {
        localChannel.postMessage({ type: 'state', room, data: S });
      } catch (e) {}
    }
  }

  let writing = false, pending = false;
  async function queueWrite() {
    if (!ref) return;
    pending = true;
    if (writing) return;
    writing = true;
    while (pending) {
      pending = false;
      try {
        await ref.set(Object.assign({}, S, { updatedAt: Date.now() }));
        if (ui.warn) {
          ui.warn = '';
          render();
        }
      } catch (e) {
        ui.warn = 'The display did not get the last update. Check the connection and tap again.';
        render();
      }
    }
    writing = false;
  }

  function addPoint(side) {
    if (!S || S.status !== 'live' || !isController()) return;
    const n = pointFor(S, side);
    if (n === S) return;

    // Haptics
    try {
      if (navigator.vibrate) navigator.vibrate(20);
    } catch (e) {}

    // Audio feedback
    const d = derive(n);
    if (n.status === 'done') {
      Sound.playWin();
      triggerConfetti();
    } else if (d.matchPoint.a || d.matchPoint.b || d.gamePoint.a || d.gamePoint.b) {
      Sound.playAlert();
    } else {
      Sound.playBallPing();
    }

    commit(n);
  }

  function arm(key, fn) {
    if (ui.armed === key) {
      ui.armed = null;
      clearTimeout(armT);
      fn();
      return;
    }
    ui.armed = key;
    render();
    clearTimeout(armT);
    armT = setTimeout(() => {
      ui.armed = null;
      render();
    }, 4500);
  }

  function toSetup() {
    if (S && S.cur) {
      ui.setup = {
        type: S.type,
        best: S.best,
        to: S.to || DEFAULT_TO,
        names: clone(S.names),
        first: 'a0',
        recv: 'b0'
      };
    }
    ui.armed = null;
    // The display (if any) shows "next match is being set up" until the new one starts.
    commit({ status: 'waiting' });
  }

  // ==========================================================================
  // Display link
  // The controlling device (one device or phone remote) owns the match. It can
  // host a 4-letter code; a display joins with that code and only follows.
  // Only the controller can close the display.
  // ==========================================================================

  const genCode = () => {
    const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  };

  // ---- Controller side -----------------------------------------------------

  async function hostDisplay(resumeCode) {
    if (!isController() || room) return;
    let code = resumeCode || null;
    try {
      if (!code && db) {
        for (let i = 0; i < 6 && !code; i++) {
          const c = genCode();
          const snap = await db.doc('rooms/' + c).get();
          const d = snap.exists ? snap.data() : null;
          if (!d || Date.now() - (d.updatedAt || 0) > 6 * 3600 * 1000) code = c;
        }
      }
      if (!code) code = genCode();
      room = code;
      ref = db ? db.doc('rooms/' + code) : null;
      LS.set(HOST, { code });
      ui.showCode = !resumeCode;
      if (S) {
        broadcastState();
        queueWrite();
      } else if (ref) {
        await ref.set({ status: 'waiting', rev: 0, updatedAt: Date.now() });
      }
      render();
    } catch (e) {
      room = null;
      ref = null;
      ui.warn = 'Could not create a display code. Check the connection and try again.';
      render();
    }
  }

  function stopDisplay() {
    if (localChannel && room) {
      try {
        localChannel.postMessage({ type: 'closed', room });
      } catch (e) {}
    }
    if (ref) ref.delete().catch(() => {});
    ref = null;
    room = null;
    ui.showCode = false;
    ui.armed = null;
    LS.del(HOST);
    render();
  }

  // Re-attach a display link that was active before this page was reloaded.
  function resumeHost() {
    const h = LS.get(HOST);
    if (h && h.code && !room) hostDisplay(h.code);
  }

  // ---- Display side --------------------------------------------------------

  async function joinDisplay(raw, quiet) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    ui.code = code;
    if (code.length !== 4) {
      ui.err = 'Enter the 4-letter code shown on the controlling device.';
      render();
      return;
    }
    ui.err = '';
    ui.busy = true;
    render();

    try {
      let first = null;
      if (db) {
        const snap = await db.doc('rooms/' + code).get();
        if (!snap.exists) {
          ui.err = 'No match uses that code. Check it on the controlling device.';
          ui.busy = false;
          if (quiet) SS.del(DISPLAY);
          render();
          return;
        }
        first = clone(snap.data());
      }
      role = 'display';
      room = code;
      S = first;
      ui.busy = false;
      ui.err = '';
      SS.set(DISPLAY, { code });
      keepAwake();
      subscribe(code);
      // Ask the controller for the current state (same-browser link).
      if (localChannel) {
        try { localChannel.postMessage({ type: 'hello', room: code }); } catch (e) {}
      }
      // Without the sync service a code can't be checked up front: if no scoring
      // device answers, go back instead of waiting forever with no way out.
      if (!db) {
        clearTimeout(joinTimer);
        joinTimer = setTimeout(() => {
          if (role === 'display' && room === code && connState !== 'live') {
            displayEnded(`No match is using code ${code} right now.`);
          }
        }, 3000);
      }
      render();
    } catch (e) {
      ui.err = 'Could not reach the match. Check the connection and try again.';
      ui.busy = false;
      render();
    }
  }

  function subscribe(code) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    connState = 'connecting';
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => {
      if (connState !== 'live') {
        connState = 'slow';
        render();
      }
    }, 10000);

    if (db) {
      ref = db.doc('rooms/' + code);
      unsub = ref.onSnapshot(
        snap => {
          const was = connState;
          if (!snap.metadata.fromCache) {
            connState = 'live';
            clearTimeout(slowTimer);
          }
          if (!snap.exists) {
            if (!snap.metadata.fromCache) displayEnded();
            return;
          }
          const d = clone(snap.data());
          if (!S || (d.rev || 0) > (S.rev || 0)) {
            celebrateIfWon(S, d);
            S = d;
            render();
          } else if (was !== connState) render();
        },
        () => {
          connState = 'slow';
          render();
        }
      );
    }
  }

  // The controller closed the link: the display goes back to its code screen.
  // Joined screens celebrate the match win too (only on the live transition, not on join).
  function celebrateIfWon(prev, next) {
    if (prev && prev.cur && prev.status === 'live' && next && next.status === 'done') {
      triggerConfetti();
    }
  }

  let joinTimer = null;

  function displayEnded(message) {
    clearTimeout(joinTimer);
    if (unsub) {
      unsub();
      unsub = null;
    }
    clearTimeout(slowTimer);
    ref = null;
    room = null;
    S = null;
    connState = 'idle';
    SS.del(DISPLAY);
    role = 'games';
    ui.err = message || 'The scoring device closed this match.';
    ui.busy = false;
    render();
  }

  function tryResume() {
    const sv = SS.get(DISPLAY);
    if (sv && sv.code && role === 'games') joinDisplay(sv.code, true);
  }

  // ==========================================================================
  // Device Keep-Awake Screen Lock
  // ==========================================================================

  async function keepAwake() {
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible' && !wl) {
        wl = await navigator.wakeLock.request('screen');
        wl.addEventListener('release', () => {
          wl = null;
        });
      }
    } catch (e) {
      wl = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (role === 'display' || role === 'solo')) {
      keepAwake();
    }
  });

  // ==========================================================================
  // Action Dispatcher & Event Handlers
  // ==========================================================================

  function pickObj(scope) {
    return scope === 'next' ? ui.next : ui.setup;
  }
  function pickType(scope) {
    return scope === 'next' ? S.type : ui.setup.type;
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const isDark = cur === 'dark' || (!cur && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const nextTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    LS.raw(THEME_KEY, nextTheme);
    render();
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    LS.raw(SOUND_KEY, String(soundEnabled));
    if (soundEnabled) Sound.playBallPing();
    render();
  }

  function act(a, el) {
    initAudio();

    switch (a) {
      case 'role-display':
        joinDisplay($('#code-input') ? $('#code-input').value : ui.code);
        break;
      // Scoring starts on the table view; 'toggle-view' switches to the phone pad.
      case 'role-solo':
      case 'resume-solo': {
        const sv = a === 'resume-solo' ? LS.get(SOLO) : null;
        role = 'solo';
        S = sv && sv.cur ? sv : null;
        ui.err = '';
        keepAwake();
        render();
        resumeHost();
        break;
      }
      case 'hide-code':
        ui.showCode = false;
        render();
        break;
      case 'show-code':
        ui.showCode = true;
        render();
        break;
      case 'stop-host':
        // Close match: ends the code, sends every joined screen back to its start page.
        arm('stop-host', () => {
          LS.del(SOLO); // before telling the screens, so their start page has no stale "Resume"
          stopDisplay();
          S = null;
          role = 'games';
          render();
        });
        break;
      case 'toggle-view':
        if (!isController()) break;
        role = role === 'solo' ? 'remote' : 'solo';
        render();
        break;
      case 'home':
      case 'games':
        if (role === 'display') break; // a joined screen is only closed by the scoring device
        role = 'games';
        ui.err = '';
        render();
        break;
      case 'pick-game':
        if (el.dataset.v === 'tt') act('role-solo');
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      case 'toggle-sound':
        toggleSound();
        break;
      case 'open-shortcuts':
        ui.showShortcuts = true;
        render();
        break;
      case 'close-shortcuts':
        ui.showShortcuts = false;
        render();
        break;
      case 'set-type':
        ui.setup.type = el.dataset.v;
        fixPick(ui.setup);
        render();
        break;
      case 'set-best':
        ui.setup.best = +el.dataset.v;
        render();
        break;
      case 'set-to':
        ui.setup.to = +el.dataset.v;
        render();
        break;
      case 'pick-first': {
        const u = pickObj(el.dataset.scope);
        u.first = el.dataset.id;
        // ITTF doubles: in the next game the first receiver is the player who
        // served to the chosen first server in the previous game.
        if (el.dataset.scope === 'next' && S && S.type === 'doubles') {
          const prev = S.games[S.games.length - 1];
          if (prev && u.first[0] === prev.recv[0]) {
            u.recv = u.first === prev.recv ? prev.first : mate(prev.first);
          }
        }
        fixPick(u, pickType(el.dataset.scope));
        render();
        break;
      }
      case 'pick-recv': {
        const u = pickObj(el.dataset.scope);
        u.recv = el.dataset.id;
        render();
        break;
      }
      case 'toss': {
        const scope = el.dataset.scope;
        const u = pickObj(scope);
        const t = pickType(scope);
        const ids = t === 'doubles' ? ['a0', 'a1', 'b0', 'b1'] : ['a0', 'b0'];

        ui.isFlippingCoin = true;
        render();

        setTimeout(() => {
          u.first = ids[Math.floor(Math.random() * ids.length)];
          if (t === 'doubles') {
            const opp = [other(u.first) + '0', other(u.first) + '1'];
            u.recv = opp[Math.floor(Math.random() * 2)];
          }
          fixPick(u, t);
          ui.isFlippingCoin = false;
          Sound.playBallPing();
          render();
        }, 550);
        break;
      }
      case 'start': {
        fixPick(ui.setup);
        ui.armed = null;
        commit(buildMatch(ui.setup));
        if (!room) hostDisplay(); // every match gets a code
        break;
      }
      case 'pt':
        addPoint(el.dataset.side);
        break;
      case 'undo': {
        if (!S || !S.cur) break;
        const n = undo(S);
        if (n !== S) {
          Sound.playUndo();
          commit(n);
        }
        break;
      }
      case 'flip': {
        if (!S || !S.cur) break;
        const n = clone(S);
        n.flip = !n.flip;
        commit(n);
        break;
      }
      case 'next-game': {
        const n = nextGame(S, ui.next.first, ui.next.recv);
        commit(n);
        break;
      }
      case 'new-match': {
        if (S && S.status === 'done') toSetup();
        else arm('new', toSetup);
        break;
      }
      case 'new-match-now':
        toSetup();
        break;
      case 'fs':
        try {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        } catch (e) {}
        break;
    }
  }

  // A joined screen has no buttons: double-click anywhere for full screen.
  document.addEventListener('dblclick', () => {
    if (role === 'display') act('fs');
  });

  // Click & Touch Delegation
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    act(el.dataset.act, el);
  });

  // Text Inputs
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'code-input') {
      ui.code = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return;
    }
    if (t.dataset && t.dataset.name) {
      ui.setup.names[t.dataset.name] = t.value;
      const chip = document.querySelector(`[data-chip-name="${t.dataset.name}"]`);
      if (chip) chip.textContent = t.value.trim() || defaultName(ui.setup.type, t.dataset.name);
    }
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', e => {
    const el = e.target;
    if (
      el &&
      el.getAttribute &&
      el.getAttribute('role') === 'button' &&
      (e.key === 'Enter' || e.key === ' ')
    ) {
      e.preventDefault();
      act(el.dataset.act, el);
      return;
    }

    if (e.target.closest && e.target.closest('input, textarea')) {
      if (e.target.id === 'code-input' && e.key === 'Enter') act('role-display');
      return;
    }

    if (e.key === 'Escape') {
      if (ui.showShortcuts) {
        ui.showShortcuts = false;
        render();
        return;
      }
    }

    if (e.key === '?') {
      ui.showShortcuts = !ui.showShortcuts;
      render();
      return;
    }

    if (e.key.toLowerCase() === 'm') {
      toggleSound();
      return;
    }

    if (e.key.toLowerCase() === 't') {
      toggleTheme();
      return;
    }

    if (e.key.toLowerCase() === 'f') {
      act('fs');
      return;
    }

    if (!isController() || !S || S.status !== 'live' || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }

    const flipped = S.cur ? S.flip !== derive(S).swapped : false;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') {
      addPoint(flipped ? 'b' : 'a');
      e.preventDefault();
    } else if (k === 'arrowright' || k === 'l') {
      addPoint(flipped ? 'a' : 'b');
      e.preventDefault();
    } else if (k === 'z' || k === 'u') {
      act('undo');
      e.preventDefault();
    } else if (k === 's') {
      act('flip');
      e.preventDefault();
    }
  });

  // ==========================================================================
  // Initialization
  // ==========================================================================

  // Apply saved theme on boot
  const savedTheme = LS.raw(THEME_KEY);
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  const dbReady = x => {
    db = x || null;
    dbState = x ? 'ok' : 'none';
    if (role === 'games') render();
    tryResume();
  };

  if (window.claude && typeof window.claude.use === 'function') {
    render(); // show the start page while the sync service loads
    window.claude.use('db').then(dbReady, () => dbReady(null));
  } else {
    dbReady(null);
  }
})();
