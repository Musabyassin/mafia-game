'use strict';
/* خادم لعبة المافيا: غرف بكود، WebSocket، وصفحات التلفاز والهاتف — بنفس سياسة سيد العقار. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { MafiaGame } = require('./engine.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_ROOMS = 300;
const MIN_PLAYERS = 5, MAX_PLAYERS = 12;
const BOT_NAMES = ['سلطان', 'نورة', 'فهد', 'ريم', 'خالد', 'لينا', 'عمر', 'سارة', 'يوسف', 'هند', 'طارق', 'منى'];
const SPEEDS = { slow: 1.5, normal: 1, fast: 0.55, turbo: 0.25 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };

const rooms = new Map();

/* ---------- HTTP ---------- */
function origin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname === '/qr') {
      const c = (url.searchParams.get('c') || '').replace(/\D/g, '').slice(0, 6);
      const svg = await QRCode.toString(`${origin(req)}/play/?c=${c}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(svg);
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/tv' || p === '/play') { res.writeHead(302, { Location: p + '/' + url.search }); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('غير موجود'); }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
      res.end(buf);
    });
  } catch (e) { res.writeHead(500); res.end('error'); }
});

/* ---------- الغرف ---------- */
function newCode() { for (let i = 0; i < 50; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!rooms.has(c)) return c; } return null; }
function newRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = newCode(); if (!code) return null;
  const room = { code, phase: 'lobby', members: [], displays: new Set(), hostDisplays: new Set(), cfg: { reveal: true, speed: 1 }, game: null, last: Date.now(), chat: [], chatAt: new Map(), bcast: null };
  rooms.set(code, room); return room;
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const humans = (room) => room.members.filter((m) => !m.bot);
function ensureHost(room) { const hs = humans(room); if (hs.some((m) => m.host)) return; const n = hs.find((m) => m.ws) || hs[0]; if (n) n.host = true; }

function lobbyMsg(room) {
  return { t: 'lobby', code: room.code, phase: room.phase, cfg: room.cfg, min: MIN_PLAYERS, max: MAX_PLAYERS, players: room.members.map((m, i) => ({ id: i, name: m.name, bot: m.bot, host: !!m.host, connected: m.bot || !!m.ws })) };
}
function stateFor(room, m) {
  const out = { t: 'state', s: room.game.snapshot(m ? room.members.indexOf(m) : null), code: room.code, tv: room.displays.size, cfg: room.cfg };
  if (m) { out.me = room.members.indexOf(m); out.host = !!m.host; }
  return out;
}
function broadcast(room) {
  room.bcast = null;
  if (room.phase === 'lobby' || !room.game) {
    const msg = lobbyMsg(room);
    room.members.forEach((m) => send(m.ws, { ...msg, me: room.members.indexOf(m), host: !!m.host }));
    room.displays.forEach((ws) => send(ws, msg));
    return;
  }
  const base = stateFor(room, null);
  room.displays.forEach((ws) => send(ws, { ...base, ...(ws.spectator ? { spectator: true } : {}) }));
  room.members.forEach((m) => { if (m.ws) send(m.ws, stateFor(room, m)); });
}
function schedule(room) { if (!room.bcast) room.bcast = setTimeout(() => broadcast(room), 25); }
function emitAll(room, e) { const j = JSON.stringify({ t: 'ev', e }); room.displays.forEach((ws) => ws.readyState === 1 && ws.send(j)); room.members.forEach((m) => m.ws && m.ws.readyState === 1 && m.ws.send(j)); }

function startGame(room) {
  const io = {
    update: () => schedule(room),
    event: (e) => emitAll(room, e),
    private: (pid, obj) => { const m = room.members[pid]; if (m) send(m.ws, obj); },
  };
  room.phase = 'playing';
  room.game = new MafiaGame(room.members.map((m) => ({ name: m.name, bot: m.bot })), { reveal: room.cfg.reveal, speed: room.cfg.speed }, io);
  broadcast(room);
}
function resetToLobby(room) {
  if (room.game) room.game.stop();
  room.game = null; room.phase = 'lobby';
  room.members = room.members.filter((m) => m.bot || m.ws);
  ensureHost(room); broadcast(room);
}

/* ---------- الشات بقنوات: عام / مافيا (ليلاً) / أموات ---------- */
function handleChat(room, m, ws, textRaw) {
  const text = String(textRaw || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) return;
  const now = Date.now(), lastAt = room.chatAt.get(m) || 0;
  if (now - lastAt < 500) return;
  room.chatAt.set(m, now);
  const idx = room.members.indexOf(m);
  let channel = 'public';
  if (room.phase === 'playing' && room.game) {
    const p = room.game.S.players[idx];
    if (p && !p.alive) channel = 'dead';
    else if (room.game.S.phase === 'night') {
      if (p && p.role === 'mafia') channel = 'mafia';
      else { send(ws, { t: 'ev', e: { e: 'toast', m: '🌙 الليل: الأبرياء نائمون، لا شات الآن' } }); return; }
    }
  }
  const entry = { id: idx, n: m.name, m: text, ts: now, ch: channel };
  const deliver = (targetWs) => send(targetWs, { t: 'ev', e: { e: 'chat', ...entry } });
  if (channel === 'public') {
    room.chat.push(entry); if (room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
    room.displays.forEach((w) => w.readyState === 1 && deliver(w));
    room.members.forEach((x) => x.ws && deliver(x.ws));
  } else if (channel === 'mafia') {
    room.members.forEach((x) => { const xp = room.game.S.players[room.members.indexOf(x)]; if (x.ws && xp && xp.alive && xp.role === 'mafia') deliver(x.ws); });
  } else { /* dead: للأموات فقط */
    room.members.forEach((x) => { const xp = room.game.S.players[room.members.indexOf(x)]; if (x.ws && xp && !xp.alive) deliver(x.ws); });
  }
}

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const hits = new Map();
setInterval(() => hits.clear(), 60000);

function attach(ws, room, member) {
  ws.room = room; ws.member = member || null;
  if (member) {
    room.displays.delete(ws);
    if (member.ws && member.ws !== ws) { try { member.ws.close(4000, 'replaced'); } catch (e) { /* ignore */ } }
    member.ws = ws; clearTimeout(member.drop);
  } else room.displays.add(ws);
}
function join(ws, room, msg) {
  const name = String(msg.name || '').trim().slice(0, 14) || 'لاعب';
  let m = msg.token && room.members.find((x) => !x.bot && x.token === msg.token);
  if (!m && room.phase === 'playing') m = room.members.find((x) => !x.bot && !x.ws && x.name === name);
  if (!m && (room.phase !== 'lobby' || msg.spectator)) {
    attach(ws, room, null); ws.spectator = true;
    send(ws, { t: 'joined', code: room.code, spectator: true, name });
    send(ws, { t: 'chatHist', list: room.chat });
    broadcast(room);
    return;
  }
  if (!m) {
    if (room.members.length >= MAX_PLAYERS) return send(ws, { t: 'err', m: `الغرفة ممتلئة (${MAX_PLAYERS} لاعبين)` });
    let nm = name, k = 2; while (room.members.some((x) => x.name === nm)) nm = `${name} ${k++}`;
    m = { name: nm, bot: false, token: crypto.randomBytes(12).toString('hex'), ws: null, host: false };
    room.members.push(m);
  }
  attach(ws, room, m); ensureHost(room);
  send(ws, { t: 'joined', code: room.code, token: m.token, id: room.members.indexOf(m), name: m.name });
  broadcast(room);
}

wss.on('connection', (ws, req) => {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const room = ws.room, m = ws.member;
    if (room) room.last = Date.now();
    switch (msg.t) {
      case 'ping': return send(ws, { t: 'pong' });
      case 'create': {
        let r = msg.resume && rooms.get(String(msg.resume));
        if (!r) r = newRoom();
        if (!r) return send(ws, { t: 'err', m: 'الخادم ممتلئ حالياً، حاول لاحقاً' });
        if (msg.role === 'tv') { attach(ws, r, null); r.hostDisplays.add(ws); send(ws, { t: 'created', code: r.code }); send(ws, { t: 'chatHist', list: r.chat }); broadcast(r); }
        else { join(ws, r, msg); send(ws, { t: 'chatHist', list: r.chat }); }
        return;
      }
      case 'watch': { const r = rooms.get(String(msg.code)); if (!r) return send(ws, { t: 'err', m: 'كود الغرفة غير صحيح', fatal: true }); attach(ws, r, null); send(ws, { t: 'created', code: r.code }); send(ws, { t: 'chatHist', list: r.chat }); broadcast(r); return; }
      case 'join': {
        const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); if (n > 40) return send(ws, { t: 'err', m: 'محاولات كثيرة، انتظر قليلاً' });
        const r = rooms.get(String(msg.code || '').trim());
        if (!r) return send(ws, { t: 'err', m: 'كود الغرفة غير صحيح', fatal: true });
        return join(ws, r, msg);
      }
      default: break;
    }
    if (!room || !m) return;
    const g = room.game, idx = room.members.indexOf(m);
    switch (msg.t) {
      case 'chat': return handleChat(room, m, ws, msg.m);
      case 'cfg': if (m.host && room.phase === 'lobby') { room.cfg.reveal = msg.reveal !== false; broadcast(room); } return;
      case 'speed': if (m.host) { room.cfg.speed = SPEEDS[msg.v] != null ? SPEEDS[msg.v] : 1; if (g) g.cfg.speed = room.cfg.speed; broadcast(room); } return;
      case 'addBot': if (m.host && room.phase === 'lobby' && room.members.length < MAX_PLAYERS) { const used = new Set(room.members.map((x) => x.name)); const nm = BOT_NAMES.find((x) => !used.has(x)) || 'آلي ' + room.members.length; room.members.push({ name: nm, bot: true, ws: null }); broadcast(room); } return;
      case 'kick': if (m.host && room.phase === 'lobby') { const t = room.members[Number(msg.id)]; if (t && t !== m) { room.members.splice(room.members.indexOf(t), 1); if (t.ws) { send(t.ws, { t: 'kicked' }); t.ws.room = null; t.ws.member = null; } broadcast(room); } } return;
      case 'start': if (m.host && room.phase === 'lobby') { if (room.members.length < MIN_PLAYERS) { send(ws, { t: 'ev', e: { e: 'toast', m: `يلزم ${MIN_PLAYERS} لاعبين على الأقل — أضف لاعبين آليين` } }); return; } startGame(room); } return;
      case 'again': if (m.host && g && g.S.over) resetToLobby(room); return;
      case 'night': if (g) g.nightAct(idx, msg.target); return;
      case 'ready': if (g) g.dayReady(idx); return;
      case 'vote': if (g) g.vote(idx, msg.target); return;
      case 'leave': leave(ws); return;
      default: return;
    }
  });
  ws.on('close', () => leave(ws, true));
  ws.on('error', () => {});
});
function leave(ws, dropped) {
  const room = ws.room, m = ws.member; if (!room) return;
  room.displays.delete(ws); room.hostDisplays.delete(ws);
  if (m && m.ws === ws) {
    m.ws = null;
    if (room.phase === 'lobby') {
      const rm = () => { if (!m.ws && room.phase === 'lobby') { const i = room.members.indexOf(m); if (i >= 0) room.members.splice(i, 1); ensureHost(room); broadcast(room); } };
      if (dropped) m.drop = setTimeout(rm, 30000); else rm();
    } else if (m.host) { m.host = false; ensureHost(room); }
  }
  if (!dropped) { ws.room = null; ws.member = null; }
  schedule(room);
}
setInterval(() => { wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch (e) { /* ignore */ } }); }, 25000);
setInterval(() => {
  const now = Date.now();
  rooms.forEach((r, c) => {
    const live = r.displays.size + r.members.filter((m) => m.ws).length;
    if (!live && now - r.last > 30 * 60000) { if (r.game) r.game.stop(); rooms.delete(c); }
  });
}, 5 * 60000);

if (require.main === module) server.listen(PORT, () => {
  console.log(`لعبة المافيا تعمل على المنفذ ${PORT}`);
  const os = require('os');
  Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).forEach((n) => console.log(`  التلفاز:  http://${n.address}:${PORT}/tv/\n  الهاتف:   http://${n.address}:${PORT}/play/`));
});
module.exports = { server, rooms };
