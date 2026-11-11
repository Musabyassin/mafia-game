/* اتصال WebSocket مع إعادة اتصال تلقائية، ومؤثرات صوتية. */
(function (root) {
  function connect(h) {
    let ws = null, closed = false, tries = 0, pingT = null, retryT = null;
    function open() {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      try { ws = new WebSocket(url); } catch (e) { return retry(); }
      ws.onopen = () => { tries = 0; h.onStatus && h.onStatus('open'); h.onOpen && h.onOpen(); clearInterval(pingT); pingT = setInterval(() => send({ t: 'ping' }), 20000); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } h.onMsg(m); };
      ws.onclose = () => { clearInterval(pingT); h.onStatus && h.onStatus('closed'); if (!closed) retry(); };
      ws.onerror = () => {};
    }
    function retry() { tries++; clearTimeout(retryT); retryT = setTimeout(open, Math.min(5000, 400 * tries)); h.onStatus && h.onStatus('retry'); }
    function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
    function close() { closed = true; clearInterval(pingT); clearTimeout(retryT); try { ws.close(); } catch (e) { /* ignore */ } }
    open();
    return { send, close };
  }

  let ac = null, muted = false;
  function beep(f, d, type, v, w) {
    if (muted) return;
    try {
      ac = ac || new (root.AudioContext || root.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.value = v || 0.05;
      o.connect(g); g.connect(ac.destination);
      const t = ac.currentTime + (w || 0); g.gain.setValueAtTime(v || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.start(t); o.stop(t + d);
    } catch (e) { /* ignore */ }
  }
  const SFX = {
    roll() { [0, 0.07, 0.14, 0.21, 0.28, 0.35].forEach((w) => beep(180 + Math.random() * 120, 0.05, 'square', 0.03, w)); },
    step() { beep(520, 0.03, 'triangle', 0.03); },
    buy() { beep(520, 0.1, 'triangle', 0.06); beep(780, 0.15, 'triangle', 0.06, 0.1); },
    cash() { beep(880, 0.07, 'sine', 0.05); beep(1180, 0.1, 'sine', 0.05, 0.07); },
    pay() { beep(300, 0.12, 'sawtooth', 0.04); beep(220, 0.15, 'sawtooth', 0.04, 0.1); },
    jail() { beep(160, 0.35, 'square', 0.05); },
    win() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.2, 'triangle', 0.07, i * 0.14)); },
  };
  root.Net = { connect };
  root.Sfx = { play(n) { if (SFX[n]) SFX[n](); }, setMuted(v) { muted = !!v; }, get muted() { return muted; }, unlock() { try { ac = ac || new (root.AudioContext || root.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { /* ignore */ } } };
})(typeof self !== 'undefined' ? self : this);
