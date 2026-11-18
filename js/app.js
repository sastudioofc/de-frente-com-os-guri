import { P2PRoom } from './p2p.js';
import { CONFIG } from './config.js';
import { CameraProcessor } from './background.js';

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

async function openCamera() {
  const q = $('#qualitySelect').value;
  const [w, h] = qualityDims(q);
  const camId = $('#camSelect').value;
  const s = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
  });
  if (!state.processor) state.processor = new CameraProcessor({ width: w, height: h });
  state.processor.canvas.width = w;
  state.processor.canvas.height = h;
  state.rawStream?.getTracks().forEach((t) => t.stop());
  state.rawStream = s;
  await state.processor.setSource(s);
}

async function openMic() {
  const micId = $('#micSelect').value;
  const clean = $('#audioMode').value === 'clean';
  const s = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: micId ? { exact: micId } : undefined,
      echoCancellation: clean, noiseSuppression: clean, autoGainControl: clean,
      channelCount: clean ? 1 : 2, sampleRate: 48000,
    },
  });
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
    sel.innerHTML = '';
    devs.filter((d) => d.kind === kind).forEach((d, i) => {
      sel.append(el('option', { value: d.deviceId }, d.label || `${kind === 'videoinput' ? 'Câmera' : 'Microfone'} ${i + 1}`));
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
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
    el('div', { class: 'plate' }, el('span', { class: 'name' }), el('i', { class: 'muted-ico', title: 'Mic desligado' }, '🔇')),
    el('div', { class: 'overlay cam-off hidden' }, el('div', { class: 'avatar' })),
    el('div', { class: 'status hidden' }));
  const v = t.querySelector('video');
  if (local) v.muted = true;
  $('#grid').append(t);
  layout();
  return t;
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
  $('#grid').dataset.count = n;
  $('#countLabel').textContent = `${n} ${n === 1 ? 'guri' : 'guris'}`;
}

function refreshPeer(id) {
  const p = state.mesh.peers.get(id);
  if (!p) return;
  updateTile(id, { name: p.info.name, mic: p.info.mic, cam: p.info.cam, stream: p.stream || undefined, connection: p.stream ? 'connected' : 'connecting' });
}

function setupSpeakingDetection() {
  // destaca quem está falando (borda dourada)
  const ctx = new AudioContext();
  const analysers = new Map();
  const buf = new Uint8Array(256);
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
      document.getElementById('tile-' + id)?.classList.toggle('speaking', a.level > 10 && track.enabled);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, 120);
}

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
    try { await openMic(); } catch { $('#joinError').textContent = 'Não consegui acessar o microfone.'; btn.disabled = false; return; }
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
  const bitrate = { 1080: 4000, 720: 2500, 480: 1000 }[$('#qualitySelect').value];
  setTimeout(() => state.mesh.setMaxBitrate(bitrate), 3000);
  setInterval(() => state.mesh.setMaxBitrate(bitrate), 15000);
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

  try {
    await openCamera();
    $('#lobbyPreview').srcObject = state.processor.outputStream;
  } catch (err) {
    console.error(err);
    state.processor = state.processor || new CameraProcessor();
    $('#camError').textContent = 'Não consegui abrir a câmera. Permita o acesso no navegador e recarregue.';
    $('#camError').classList.remove('hidden');
  }
  try { await openMic(); } catch (err) { console.warn(err); }
  await listDevices();
  navigator.mediaDevices.addEventListener?.('devicechange', listDevices);

  renderBgGrid();
  if (state.bg !== 'none') applyBg(state.bg);

  $('#blurRange').addEventListener('input', (e) => (state.processor.blurPx = +e.target.value));
  $('#camSelect').addEventListener('change', () => { store.set('cam', $('#camSelect').value); openCamera().catch((e) => toast('Erro na câmera: ' + e.message)); });
  $('#qualitySelect').addEventListener('change', () => openCamera().catch((e) => toast('Erro na câmera: ' + e.message)));
  $('#micSelect').addEventListener('change', () => { store.set('mic', $('#micSelect').value); openMic().catch((e) => toast('Erro no mic: ' + e.message)); });
  $('#audioMode').addEventListener('change', () => openMic().catch((e) => toast('Erro no mic: ' + e.message)));
  $('#joinForm').addEventListener('submit', join);

  $('#micBtn').addEventListener('click', () => setMic(!state.mic));
  $('#camBtn').addEventListener('click', () => setCam(!state.cam));
  $('#bgBtn').addEventListener('click', () => $('#bgDrawer').classList.toggle('hidden'));
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
    b.closest('.drawer')?.classList.add('hidden');
  }));
  document.addEventListener('keydown', (e) => {
    if ($('#room').classList.contains('hidden') || e.target.matches('input, select, textarea')) return;
    if (e.key === 'm' || e.key === 'M') setMic(!state.mic);
    if (e.key === 'v' || e.key === 'V') setCam(!state.cam);
    if (e.key === 'b' || e.key === 'B') $('#bgDrawer').classList.toggle('hidden');
  });
}

init();
