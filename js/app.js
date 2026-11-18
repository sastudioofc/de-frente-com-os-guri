import { P2PRoom } from './p2p.js?v=__V__';
import { CONFIG } from './config.js?v=__V__';
import { setupExtras } from './extras.js?v=__V__';
import { CameraProcessor } from './background.js?v=__V__';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const store = {
  get(k, d) { try { const v = localStorage.getItem('guri:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('guri:' + k, JSON.stringify(v)); } catch {} },
};

const PRESETS = [
  { id: 'none', label: 'Nenhum', mode: 'none' },
  { id: 'blur', label: 'Desfoque', mode: 'blur' },
  { id: 'estudio', label: 'Estúdio', mode: 'image', src: 'backgrounds/estudio.jpg' },
  { id: 'templo', label: 'Templo', mode: 'image', src: 'backgrounds/templo.jpg' },
  { id: 'neon', label: 'Neon', mode: 'image', src: 'backgrounds/neon.jpg' },
  { id: 'madeira', label: 'Madeira', mode: 'image', src: 'backgrounds/madeira.jpg' },
];

const state = {
  mesh: null,
  processor: null,
  rawStream: null,
  audioTrack: null,
  localStream: null,
  mic: true,
  cam: true,
  name: '',
  room: '',
  bg: store.get('bg', 'none'),
  stage: false,
  pinned: null, // id do tile fixado no palco
  speaker: null, // quem está falando mais alto
  extras: null,
  customBgs: store.get('customBgs', []), // [{id, src(dataURL)}]
};

// ---------------- util ----------------
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
async function copy(text, okMsg = 'Copiado!') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { prompt('Copie o link:', text); }
}
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

// ---------------- mídia ----------------
function qualityDims(q) {
  return { 1080: [1920, 1080], 720: [1280, 720], 480: [854, 480] }[q] || [1280, 720];
}

function camErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'A câmera está bloqueada pro site. Clique no cadeado ao lado do endereço, mude Câmera pra "Permitir" e clique em Tentar de novo. No Windows, veja também Configurações → Privacidade → Câmera.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada. Confira se ela está conectada (se for o celular como webcam, abra o app no celular antes).';
    case 'NotReadableError':
    case 'AbortError':
      return 'A câmera está ocupada ou travada por outro programa (OBS, Discord, Zoom, app da webcam…). Feche-os e clique em Tentar de novo.';
    default:
      return 'Não consegui abrir a câmera' + (err && err.message ? ` (${err.message})` : '') + '.';
  }
}

function showCamStatus(msg) {
  const box = $('#camError');
  if (!msg) { box.classList.add('hidden'); box.textContent = ''; return; }
  box.innerHTML = '';
  const retry = el('button', { class: 'btn', type: 'button' }, 'Tentar de novo');
  retry.addEventListener('click', async () => {
    try { await openCamera(); $('#lobbyPreview').srcObject = state.processor.outputStream; } catch {}
    await listDevices();
  });
  box.append(el('div', {}, el('p', {}, msg), retry));
  box.classList.remove('hidden');
}

async function openCamera() {
  const q = $('#qualitySelect').value;
  const [w, h] = qualityDims(q);
  const camId = $('#camSelect').value;
  if (!state.processor) state.processor = new CameraProcessor({ width: w, height: h });
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') { showCamStatus(camErrorMessage(err)); throw err; }
    // tenta outra câmera / do jeito mais simples (ex.: câmera virtual desconectada)
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (err2) {
      showCamStatus(camErrorMessage(err2));
      throw err2;
    }
  }
  showCamStatus('');
  state.processor.canvas.width = w;
  state.processor.canvas.height = h;
  state.rawStream?.getTracks().forEach((t) => t.stop());
  state.rawStream = s;
  await state.processor.setSource(s);
}

function micErrorMessage(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'O microfone está bloqueado pro site. Clique no cadeado ao lado do endereço, libere o Microfone e recarregue a página. No Windows, veja também Configurações → Privacidade → Microfone.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado. Confira se ele está conectado e aparece no Windows (Configurações → Sistema → Som).';
    case 'NotReadableError':
    case 'AbortError':
      return 'O microfone está ocupado ou travado por outro programa. Feche os outros apps que estão usando o mic e clique em "Tentar de novo".';
    default:
      return 'Não consegui acessar o microfone' + (err && err.message ? ` (${err.message})` : '') + '.';
  }
}

function showMicStatus(msg) {
  const box = $('#micStatus');
  if (!msg) { box.classList.add('hidden'); box.textContent = ''; return; }
  box.textContent = msg + ' ';
  const retry = el('button', { class: 'btn', type: 'button' }, 'Tentar de novo');
  retry.addEventListener('click', async () => {
    try { await openMic(); await listDevices(); } catch {}
  });
  box.append(retry);
  box.classList.remove('hidden');
}

async function openMic() {
  const micId = $('#micSelect').value;
  const clean = $('#audioMode').value === 'clean';
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: micId ? { exact: micId } : undefined,
        echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean,
        channelCount: { ideal: clean ? 1 : 2 },
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') { showMicStatus(micErrorMessage(err)); throw err; }
    // tenta de novo do jeito mais simples possível (qualquer microfone, sem ajustes)
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err2) {
      showMicStatus(micErrorMessage(err2));
      throw err2;
    }
  }
  showMicStatus('');
  const track = s.getAudioTracks()[0];
  track.enabled = state.mic;
  const old = state.audioTrack;
  state.audioTrack = track;
  if (state.localStream) {
    if (old) state.localStream.removeTrack(old);
    state.localStream.addTrack(track);
  }
  if (state.mesh) await state.mesh.replaceAudioTrack(old, track);
  old?.stop();
  startMeter(track);
}

let meterCtx;
function startMeter(track) {
  try {
    meterCtx?.close();
    meterCtx = new AudioContext();
    const src = meterCtx.createMediaStreamSource(new MediaStream([track]));
    const an = meterCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const bar = $('#micMeter');
    const loop = () => {
      if (meterCtx.state === 'closed') return;
      an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      bar.style.width = Math.min(100, (peak / 128) * 160) + '%';
      requestAnimationFrame(loop);
    };
    loop();
  } catch {}
}

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, saved) => {
    const cur = sel.value || saved;
    // marca o dispositivo que está realmente em uso
    const active = (kind === 'audioinput' ? state.audioTrack : state.rawStream?.getVideoTracks()[0])?.getSettings?.().deviceId;
    sel.innerHTML = '';
    const list = devs.filter((d) => d.kind === kind && d.deviceId !== '');
    list.forEach((d, i) => {
      sel.append(el('option', { value: d.deviceId }, d.label || `${kind === 'videoinput' ? 'Câmera' : 'Microfone'} ${i + 1}`));
    });
    if (!list.length) {
      // sem permissão o navegador esconde a lista; ainda dá pra usar o padrão
      sel.append(el('option', { value: '' }, kind === 'videoinput' ? 'Câmera padrão (libere o acesso)' : 'Microfone padrão (libere o acesso)'));
    }
    const want = active || cur;
    if ([...sel.options].some((o) => o.value === want)) sel.value = want;
  };
  fill($('#camSelect'), 'videoinput', store.get('cam', ''));
  fill($('#micSelect'), 'audioinput', store.get('mic', ''));
}

// ---------------- fundos ----------------
function allBgs() {
  return [
    ...PRESETS,
    ...state.customBgs.map((c, i) => ({ id: c.id, label: `Meu ${i + 1}`, mode: 'image', src: c.src, custom: true })),
  ];
}

function renderBgGrid() {
  const grid = $('#bgGrid');
  grid.innerHTML = '';
  for (const b of allBgs()) {
    const thumb = el('button', { class: 'bg-thumb' + (state.bg === b.id ? ' active' : ''), type: 'button', title: b.label });
    if (b.mode === 'image') thumb.style.backgroundImage = `url("${b.src}")`;
    else thumb.classList.add(b.mode === 'blur' ? 'is-blur' : 'is-none');
    thumb.append(el('span', {}, b.label));
    thumb.addEventListener('click', () => applyBg(b.id));
    if (b.custom) {
      const del = el('i', { class: 'del', title: 'Remover' }, '✕');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        state.customBgs = state.customBgs.filter((c) => c.id !== b.id);
        store.set('customBgs', state.customBgs);
        if (state.bg === b.id) applyBg('none'); else renderBgGrid();
      });
      thumb.append(del);
    }
    grid.append(thumb);
  }
  const up = el('label', { class: 'bg-thumb upload', title: 'Enviar imagem' }, el('b', {}, '+'), el('span', {}, 'Sua imagem'));
  const input = el('input', { type: 'file', accept: 'image/*', hidden: '' });
  input.addEventListener('change', onUpload);
  up.append(input);
  grid.append(up);
  $('#blurRow').classList.toggle('hidden', state.bg !== 'blur');
}

async function onUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  // reduz para 1920px pra não pesar
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1920 / Math.max(img.width, img.height));
  const c = el('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const src = c.toDataURL('image/jpeg', 0.88);
  const id = 'c' + Date.now();
  state.customBgs.push({ id, src });
  store.set('customBgs', state.customBgs); // se estourar o storage, a imagem vale só nesta sessão
  await applyBg(id);
}

async function applyBg(id) {
  const b = allBgs().find((x) => x.id === id) || PRESETS[0];
  const status = $('#bgStatus');
  if (b.mode !== 'none' && !state.processor?.segmenter) status.textContent = 'Carregando recorte com IA… (só na primeira vez)';
  try {
    await state.processor.setMode(b.mode, { src: b.src, blurPx: +$('#blurRange').value });
    state.bg = b.id;
    store.set('bg', b.id);
    status.textContent = '';
  } catch (err) {
    status.textContent = err.message;
  }
  renderBgGrid();
}

// ---------------- sala ----------------
function tileFor(id, { local = false } = {}) {
  let t = document.getElementById('tile-' + id);
  if (t) return t;
  t = el('div', { class: 'tile' + (local ? ' local' : ''), id: 'tile-' + id },
    el('video', { autoplay: '', playsinline: '' }),
    el('div', { class: 'plate' }, el('span', { class: 'name' }), el('i', { class: 'muted-ico', title: 'Mic desligado' }, '🔇'),
      el('span', { class: 'net hidden', title: 'Qualidade da conexão' }, el('i'), el('i'), el('i'))),
    el('div', { class: 'overlay cam-off hidden' }, el('div', { class: 'avatar' })),
    el('div', { class: 'status hidden' }),
    el('div', { class: 'net-warn hidden' }, '⚠ Internet instável'),
    el('button', { class: 'pin', type: 'button', title: 'Fixar no palco' }, '📌'));
  const v = t.querySelector('video');
  if (local) v.muted = true;
  t.querySelector('.pin').addEventListener('click', (e) => { e.stopPropagation(); togglePin(t.id); });
  t.addEventListener('dblclick', () => togglePin(t.id));
  $('#grid').append(t);
  layout();
  return t;
}

function screenTile(id, name, stream, { local = false } = {}) {
  const tid = 'tile-screen-' + id;
  let t = document.getElementById(tid);
  const isNew = !t;
  if (!t) {
    t = el('div', { class: 'tile screen', id: tid },
      el('video', { autoplay: '', playsinline: '' }),
      el('div', { class: 'plate' }, el('span', { class: 'name' })),
      el('button', { class: 'pin', type: 'button', title: 'Fixar no palco' }, '📌'));
    if (local) t.querySelector('video').muted = true;
    t.querySelector('.pin').addEventListener('click', (e) => { e.stopPropagation(); togglePin(tid); });
    t.addEventListener('dblclick', () => togglePin(tid));
    $('#grid').append(t);
  }
  const v = t.querySelector('video');
  if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => clickToPlay(v)); }
  t.querySelector('.name').textContent = '🖥️ Tela de ' + name;
  if (isNew) {
    layout();
    // tela nova vai pro palco automaticamente
    setStage(true);
    toast(local ? 'Você está compartilhando a tela' : `${name} está compartilhando a tela`);
  }
  updateStage();
  return t;
}

function removeScreenTile(id) {
  const t = document.getElementById('tile-screen-' + id);
  if (!t) return;
  if (state.pinned === t.id) state.pinned = null;
  t.remove();
  layout();
  updateStage();
}

// ---------------- palco ----------------
function setStage(on) {
  state.stage = on;
  $('#grid').classList.toggle('stage', on);
  $('#stageBtn').classList.toggle('on', on);
  updateStage();
}
function togglePin(tid) {
  state.pinned = state.pinned === tid ? null : tid;
  if (state.pinned && !state.stage) setStage(true);
  updateStage();
}
function updateStage() {
  const tiles = [...$('#grid').children];
  tiles.forEach((t) => t.classList.toggle('pinned', t.id === state.pinned));
  if (!state.stage) { tiles.forEach((t) => t.classList.remove('main')); return; }
  let main = state.pinned && document.getElementById(state.pinned);
  if (!main) main = tiles.filter((t) => t.classList.contains('screen')).pop();
  if (!main && state.speaker) main = document.getElementById('tile-' + state.speaker);
  if (!main) main = tiles.find((t) => t.id !== 'tile-me') || tiles[0];
  tiles.forEach((t) => t.classList.toggle('main', t === main));
}

function updateTile(id, { name, mic, cam, stream, connection }) {
  const t = tileFor(id, { local: id === 'me' });
  const v = t.querySelector('video');
  if (stream && v.srcObject !== stream) {
    v.srcObject = stream;
    v.play().catch(() => clickToPlay(v));
  }
  t.querySelector('.name').textContent = name;
  t.querySelector('.avatar').textContent = (name || '?').trim().charAt(0).toUpperCase();
  t.classList.toggle('mic-off', mic === false);
  t.querySelector('.cam-off').classList.toggle('hidden', cam !== false);
  const st = t.querySelector('.status');
  const bad = connection && !['connected', 'new'].includes(connection);
  st.classList.toggle('hidden', !bad);
  st.textContent = { connecting: 'Conectando…', disconnected: 'Reconectando…', failed: 'Falha na conexão' }[connection] || '';
}

function clickToPlay(v) {
  const resume = () => { v.play().catch(() => {}); document.removeEventListener('click', resume); };
  document.addEventListener('click', resume);
  toast('Clique em qualquer lugar pra liberar o som', 4000);
}

function layout() {
  const n = $('#grid').children.length;
  const people = $('#grid').querySelectorAll('.tile:not(.screen)').length;
  $('#grid').dataset.count = n;
  $('#countLabel').textContent = `${people} ${people === 1 ? 'guri' : 'guris'}`;
}

function refreshPeer(id) {
  const p = state.mesh.peers.get(id);
  if (!p) return;
  updateTile(id, { name: p.info.name, mic: p.info.mic, cam: p.info.cam, stream: p.stream || undefined, connection: p.stream ? 'connected' : 'connecting' });
  if (p.screen && p.info.screen !== false) screenTile(id, p.info.name, p.screen);
  else removeScreenTile(id);
  updateStage();
}

function setupSpeakingDetection() {
  // destaca quem está falando (borda dourada)
  const ctx = new AudioContext();
  const analysers = new Map();
  const buf = new Uint8Array(256);
  let loudest = null, cand = null, candSince = 0;
  setInterval(() => {
    const entries = [['me', state.localStream], ...[...state.mesh.peers].map(([id, p]) => [id, p.stream])];
    for (const [id, stream] of entries) {
      const track = stream?.getAudioTracks()[0];
      if (!track) continue;
      let a = analysers.get(id);
      if (!a || a.track !== track) {
        try {
          const src = ctx.createMediaStreamSource(new MediaStream([track]));
          const an = ctx.createAnalyser();
          an.fftSize = 256;
          src.connect(an);
          a = { an, track, level: 0 };
          analysers.set(id, a);
        } catch { continue; }
      }
      a.an.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      a.level = a.level * 0.6 + peak * 0.4;
      const speaking = a.level > 10 && track.enabled;
      document.getElementById('tile-' + id)?.classList.toggle('speaking', speaking);
      if (speaking && id !== 'me' && (!loudest || a.level > loudest.level)) loudest = { id, level: a.level };
    }
    // palco: troca pra quem está falando depois de ~1s falando mais alto (evita ficar pulando)
    const now = performance.now();
    if (loudest && loudest.id !== state.speaker) {
      if (cand !== loudest.id) { cand = loudest.id; candSince = now; }
      else if (now - candSince > 1000) { state.speaker = loudest.id; updateStage(); }
    } else cand = null;
    loudest = null;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, 120);
}

// ---------------- compartilhar tela ----------------
async function toggleScreen() {
  if (state.mesh.screenStream) return stopScreen();
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
  } catch (err) {
    if (err.name !== 'NotAllowedError') toast('Não deu pra compartilhar a tela: ' + err.message, 4000);
    return;
  }
  const vt = stream.getVideoTracks()[0];
  if (vt) vt.contentHint = 'detail';
  vt?.addEventListener('ended', stopScreen); // botão "parar de compartilhar" do navegador
  await state.mesh.startScreen(stream);
  $('#screenBtn').classList.add('on');
  screenTile('me', 'você', stream, { local: true });
}
function stopScreen() {
  if (!state.mesh?.screenStream) return;
  state.mesh.stopScreen();
  $('#screenBtn').classList.remove('on');
  removeScreenTile('me');
}

// ---------------- qualidade da conexão ----------------
function setNet(id, q) {
  const t = document.getElementById('tile-' + id);
  if (!t) return;
  const n = t.querySelector('.net');
  n.classList.remove('hidden', 'good', 'ok', 'bad');
  n.classList.add(q);
  n.title = { good: 'Conexão boa', ok: 'Conexão razoável', bad: 'Conexão ruim' }[q];
  t.querySelector('.net-warn').classList.toggle('hidden', q !== 'bad');
}

function startConnectionMonitor(baseKbps) {
  const prev = new Map(); // userId -> { lost, recv }
  const caps = new Map(); // pc -> kbps aplicado
  setInterval(async () => {
    let myWorst = 'good';
    const rank = { good: 0, ok: 1, bad: 2 };
    for (const [userId, pc] of state.mesh.connections()) {
      let stats;
      try { stats = await pc.getStats(); } catch { continue; }
      let rtt = 0, avail = 0, lost = 0, recv = 0, upLoss = 0;
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) {
          rtt = Math.max(rtt, r.currentRoundTripTime || 0);
          if (r.availableOutgoingBitrate) avail = r.availableOutgoingBitrate;
        }
        if (r.type === 'inbound-rtp' && r.kind === 'video') { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video') upLoss = Math.max(upLoss, r.fractionLost || 0);
      });
      const p = prev.get(userId) || { lost, recv };
      const dl = Math.max(0, lost - p.lost), dr = Math.max(0, recv - p.recv);
      prev.set(userId, { lost, recv });
      const loss = dl + dr > 0 ? dl / (dl + dr) : 0;
      const q = rtt > 0.6 || loss > 0.08 ? 'bad' : rtt > 0.28 || loss > 0.02 ? 'ok' : 'good';
      setNet(userId, q);
      const up = rtt > 0.6 || upLoss > 0.08 ? 'bad' : rtt > 0.28 || upLoss > 0.02 ? 'ok' : 'good';
      if (rank[up] > rank[myWorst]) myWorst = up;

      // baixa a qualidade sozinho quando a internet aperta (e sobe de novo quando melhora)
      let cap = baseKbps;
      if (avail) cap = Math.min(cap, (avail / 1000) * 0.8);
      if (upLoss > 0.1) cap = Math.min(cap, (caps.get(pc) || baseKbps) * 0.7);
      cap = Math.round(Math.max(250, cap));
      const cur = caps.get(pc) || baseKbps;
      if (Math.abs(cap - cur) / cur > 0.15 || !caps.has(pc)) {
        caps.set(pc, cap);
        state.mesh.setMaxBitrate(cap, pc);
      }
    }
    if (state.mesh.connections().size) setNet('me', myWorst);
  }, 2000);
}

function openDrawer(id) {
  const d = document.getElementById(id);
  const willOpen = d.classList.contains('hidden');
  document.querySelectorAll('.drawer').forEach((x) => x.classList.add('hidden'));
  if (willOpen) d.classList.remove('hidden');
  ['bgDrawer:bgBtn', 'agendaDrawer:agendaBtn', 'chatDrawer:chatBtn'].forEach((pair) => {
    const [dr, bt] = pair.split(':');
    $('#' + bt).classList.toggle('on', !document.getElementById(dr).classList.contains('hidden'));
  });
  if (id === 'chatDrawer' && willOpen) state.extras?.onChatOpened();
}
const isDrawerOpen = (id) => !document.getElementById(id).classList.contains('hidden');

async function join(e) {
  e.preventDefault();
  const btn = $('#joinBtn');
  btn.disabled = true;
  $('#joinError').textContent = '';
  state.name = $('#nameInput').value.trim();
  state.room = $('#roomInput').value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  store.set('name', state.name);
  store.set('room', state.room);
  store.set('cam', $('#camSelect').value);
  store.set('mic', $('#micSelect').value);

  if (!state.audioTrack) {
    try { await openMic(); } catch (err) { $('#joinError').textContent = micErrorMessage(err); btn.disabled = false; return; }
  }
  state.localStream = new MediaStream([state.processor.videoTrack, state.audioTrack]);

  const password = $('#pwdInput').value;
  state.mesh = new P2PRoom({ roomId: state.room, password, name: state.name, localStream: state.localStream, maxUsers: CONFIG.maxUsers });
  state.mesh.addEventListener('peer-update', (ev) => refreshPeer(ev.detail.id));
  state.mesh.addEventListener('peer-left', (ev) => {
    document.getElementById('tile-' + ev.detail.id)?.remove();
    layout();
  });
  state.mesh.addEventListener('error', (ev) => {
    const e = ev.detail;
    console.warn('room error', e);
    if (e.code === 'room-full') toast(`Sala cheia (máx. ${CONFIG.maxUsers}).`, 5000);
    else if (e.code === 'decrypt-failed') toast('Alguém está tentando entrar com a senha errada.', 5000);
    else if (e.code === 'relay-failed') toast('Problema pra achar os outros participantes. Verifique a internet.', 5000);
    else if (e.code === 'peer-connect-failed') toast('Não deu pra conectar com um participante (rede bloqueando). Veja "TURN" no README.', 7000);
  });
  if (password) sessionStorage.setItem('guri:pwd', password);

  history.replaceState(null, '', `${location.pathname}?sala=${encodeURIComponent(state.room)}`);
  $('#lobby').classList.add('hidden');
  $('#room').classList.remove('hidden');
  $('#roomLabel').textContent = 'sala: ' + state.room;
  // ajustes de dispositivo vão pro diálogo
  document.querySelectorAll('#joinForm .row2').forEach((r) => $('#settingsSlot').append(r));
  $('#settingsSlot').append($('#joinForm .meter'));
  $('#bgSlotDrawer').append($('#bgPicker'));

  updateTile('me', { name: state.name + ' (você)', mic: state.mic, cam: state.cam, stream: state.localStream });
  setupSpeakingDetection();
  startConnectionMonitor({ 1080: 4000, 720: 2500, 480: 1000 }[$('#qualitySelect').value]);
  state.extras = setupExtras({ mesh: state.mesh, myName: () => state.name, toast, openDrawer, isDrawerOpen });
}

function setMic(on) {
  state.mic = on;
  if (state.audioTrack) state.audioTrack.enabled = on;
  $('#micBtn').classList.toggle('off', !on);
  state.mesh?.setState({ mic: on });
  if (state.mesh) updateTile('me', { name: state.name + ' (você)', mic: on, cam: state.cam });
}
function setCam(on) {
  state.cam = on;
  state.processor.videoTrack.enabled = on;
  $('#camBtn').classList.toggle('off', !on);
  state.mesh?.setState({ cam: on });
  if (state.mesh) updateTile('me', { name: state.name + ' (você)', mic: state.mic, cam: on });
}

// ---------------- init ----------------
async function init() {
  const hashPwd = new URLSearchParams(location.hash.slice(1)).get('senha');
  $('#pwdInput').value = hashPwd || sessionStorage.getItem('guri:pwd') || '';
  $('#nameInput').value = store.get('name', '');
  $('#roomInput').value = params.get('sala') || store.get('room', 'defrente');
  $('#nameInput').addEventListener('input', () => ($('#lobbyPlate').textContent = $('#nameInput').value || 'Você'));
  $('#lobbyPlate').textContent = $('#nameInput').value || 'Você';
  $('#bgSlotLobby').append($('#bgPicker'));

  // pede câmera e microfone de uma vez (um aviso só de permissão)
  try {
    const perm = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    perm.getTracks().forEach((t) => t.stop());
  } catch (err) {
    console.warn('permissão conjunta falhou, tentando separado', err);
  }

  try {
    await openCamera();
    $('#lobbyPreview').srcObject = state.processor.outputStream;
  } catch (err) {
    console.error(err);
    state.processor = state.processor || new CameraProcessor();
  }
  try { await openMic(); } catch (err) { console.warn(err); }
  await listDevices();
  navigator.mediaDevices.addEventListener?.('devicechange', listDevices);

  renderBgGrid();
  if (state.bg !== 'none') applyBg(state.bg);

  $('#blurRange').addEventListener('input', (e) => (state.processor.blurPx = +e.target.value));
  // correção de luz
  const light = store.get('light', { auto: true, b: 100, c: 100 });
  const applyLight = () => {
    const auto = $('#autoLight').checked, b = +$('#brightRange').value, c = +$('#contrastRange').value;
    $('#brightVal').textContent = b + '%';
    $('#contrastVal').textContent = c + '%';
    state.processor.setLight({ auto, brightness: b / 100, contrast: c / 100 });
    store.set('light', { auto, b, c });
  };
  $('#autoLight').checked = light.auto;
  $('#brightRange').value = light.b;
  $('#contrastRange').value = light.c;
  ['autoLight', 'brightRange', 'contrastRange'].forEach((id) => $('#' + id).addEventListener('input', applyLight));
  applyLight();
  $('#camSelect').addEventListener('change', async () => {
    store.set('cam', $('#camSelect').value);
    try { await openCamera(); $('#lobbyPreview').srcObject = state.processor.outputStream; } catch {}
  });
  $('#qualitySelect').addEventListener('change', () => openCamera().catch((e) => toast('Erro na câmera: ' + e.message)));
  $('#micSelect').addEventListener('change', () => { store.set('mic', $('#micSelect').value); openMic().catch((e) => toast('Erro no mic: ' + e.message)); });
  $('#audioMode').addEventListener('change', () => openMic().catch((e) => toast('Erro no mic: ' + e.message)));
  $('#joinForm').addEventListener('submit', join);

  $('#micBtn').addEventListener('click', () => setMic(!state.mic));
  $('#camBtn').addEventListener('click', () => setCam(!state.cam));
  $('#bgBtn').addEventListener('click', () => openDrawer('bgDrawer'));
  $('#agendaBtn').addEventListener('click', () => openDrawer('agendaDrawer'));
  $('#chatBtn').addEventListener('click', () => openDrawer('chatDrawer'));
  $('#screenBtn').addEventListener('click', toggleScreen);
  $('#stageBtn').addEventListener('click', () => setStage(!state.stage));
  if (!navigator.mediaDevices.getDisplayMedia) $('#screenBtn').classList.add('hidden'); // celular não compartilha tela
  $('#inviteBtn').addEventListener('click', () => {
    const pwd = $('#pwdInput').value;
    const url = `${location.origin}${location.pathname}?sala=${encodeURIComponent(state.room)}` + (pwd ? `#senha=${encodeURIComponent(pwd)}` : '');
    copy(url, 'Convite copiado! Manda pros guri.');
  });
  $('#settingsBtn').addEventListener('click', () => $('#settingsDialog').showModal());
  $('#leaveBtn').addEventListener('click', async () => {
    try { await state.mesh?.leave(); } catch {}
    location.href = `${location.pathname}?sala=${encodeURIComponent(state.room)}`;
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
    b.closest('dialog')?.close();
    const d = b.closest('.drawer');
    if (d) { d.classList.add('hidden'); ['bgBtn', 'agendaBtn', 'chatBtn'].forEach((id) => $('#' + id).classList.remove('on')); }
  }));
  document.addEventListener('keydown', (e) => {
    if ($('#room').classList.contains('hidden') || e.target.matches('input, select, textarea')) return;
    if (e.key === 'm' || e.key === 'M') setMic(!state.mic);
    if (e.key === 'v' || e.key === 'V') setCam(!state.cam);
    if (e.key === 'b' || e.key === 'B') openDrawer('bgDrawer');
    if (e.key === 'c' || e.key === 'C') openDrawer('chatDrawer');
    if (e.key === 't' || e.key === 'T') toggleScreen();
    if (e.key === 'p' || e.key === 'P') setStage(!state.stage);
  });
}

init();
