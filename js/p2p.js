// Conexão entre os participantes sem servidor próprio.
// O Trystero usa relays públicos do Nostr só pra apresentar um navegador pro outro;
// o vídeo e o áudio vão direto entre vocês (WebRTC). Com senha, até a apresentação vai criptografada.
import { joinRoom } from '../vendor/trystero.mjs';
import { CONFIG } from './config.js?v=__V__';

export class P2PRoom extends EventTarget {
  constructor({ roomId, password, name, localStream, maxUsers }) {
    super();
    this.localStream = localStream;
    this.screenStream = null;
    this.peers = new Map(); // userId -> { info: {name, mic, cam, screen}, stream, screen }
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

    this.room = joinRoom(
      {
        appId: CONFIG.appId,
        password: password || undefined,
        identity: 'none', // cada aba/entrada é uma pessoa
        maxUsers,
        rtcConfig: { iceServers },
        turnConfig: CONFIG.turn && CONFIG.turn.length ? CONFIG.turn : undefined,
        relayConfig: CONFIG.relays && CONFIG.relays.length ? { urls: CONFIG.relays } : undefined,
      },
      roomId,
    );

    this.profile = this.room.makeUserState('profile', { name: 'Guri', mic: true, cam: true, screen: false });
    this.profile.set({ name, mic: true, cam: true, screen: false });

    this.room.addStream(localStream, { metadata: { type: 'cam' } });
    this.room.onPeerJoin(({ userId }) => {
      this._ensure(userId);
      this.room.addStream(this.localStream, { target: userId, metadata: { type: 'cam' } });
      if (this.screenStream) this.room.addStream(this.screenStream, { target: userId, metadata: { type: 'screen' } });
      this._emit('peer-update', { id: userId });
    });
    this.room.onPeerLeave(({ userId }) => {
      if (!this.peers.has(userId)) return;
      this.peers.delete(userId);
      this._emit('peer-left', { id: userId });
    });
    this.room.onPeerStream((stream, { userId, metadata }) => {
      const p = this._ensure(userId);
      if (metadata && metadata.type === 'screen') {
        p.screen = stream;
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (p.screen === stream) { p.screen = null; this._emit('peer-update', { id: userId }); }
        });
      } else {
        p.stream = stream;
      }
      this._emit('peer-update', { id: userId });
    });
    this.profile.onChange(
      (val, { userId, self, removed }) => {
        if (self || removed || !val) return;
        const p = this._ensure(userId);
        Object.assign(p.info, val);
        if (val.screen === false) p.screen = null;
        this._emit('peer-update', { id: userId });
      },
      { replay: true },
    );
    this.room.onError((err) => this._emit('error', err));
  }

  _ensure(id) {
    if (!this.peers.has(id)) {
      const known = this.profile?.get?.(id);
      this.peers.set(id, { info: { name: '…', mic: true, cam: true, screen: false, ...(known || {}) }, stream: null, screen: null });
    }
    return this.peers.get(id);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(patch) {
    this.profile.set((prev) => ({ ...prev, ...patch }));
  }

  // ---- compartilhar tela ----
  async startScreen(stream) {
    this.screenStream = stream;
    await this.room.addStream(stream, { metadata: { type: 'screen' } });
    this.setState({ screen: true });
  }
  stopScreen() {
    if (!this.screenStream) return;
    try { this.room.removeStream(this.screenStream); } catch {}
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.setState({ screen: false });
  }

  // ---- estado compartilhado / mensagens (pauta, cronômetro, chat) ----
  makeState(name, initial) { return this.room.makeState(name, initial); }
  makeAction(name) { return this.room.makeAction(name); }

  // conexões WebRTC por pessoa (pra medir qualidade)
  connections() {
    const out = new Map();
    for (const p of Object.values(this.room.getPeers())) if (p.connection) out.set(p.userId, p.connection);
    return out;
  }

  async replaceAudioTrack(oldTrack, newTrack) {
    if (oldTrack && newTrack) await this.room.replaceTrack(oldTrack, newTrack);
  }

  async setMaxBitrate(kbps, pc) {
    const pcs = pc ? [pc] : [...this.connections().values()];
    const screenTrack = this.screenStream?.getVideoTracks()[0];
    for (const c of pcs) {
      for (const sender of c.getSenders()) {
        if (sender.track?.kind !== 'video' || sender.track === screenTrack) continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        if (params.encodings[0].maxBitrate === kbps * 1000) continue;
        params.encodings[0].maxBitrate = kbps * 1000;
        try { await sender.setParameters(params); } catch {}
      }
    }
  }

  leave() {
    this.stopScreen();
    return this.room.leave();
  }
}
