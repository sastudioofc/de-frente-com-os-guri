// Conexão entre os participantes sem servidor próprio.
// O Trystero usa relays públicos do Nostr só pra apresentar um navegador pro outro;
// o vídeo e o áudio vão direto entre vocês (WebRTC). Com senha, até a apresentação vai criptografada.
import { joinRoom } from '../vendor/trystero.mjs';
import { CONFIG } from './config.js';

export class P2PRoom extends EventTarget {
  constructor({ roomId, password, name, localStream, maxUsers }) {
    super();
    this.localStream = localStream;
    this.peers = new Map(); // userId -> { info: {name, mic, cam}, stream }
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

    this.profile = this.room.makeUserState('profile', { name: 'Guri', mic: true, cam: true });
    this.profile.set({ name, mic: true, cam: true });

    this.room.addStream(localStream);
    this.room.onPeerJoin(({ userId }) => {
      this._ensure(userId);
      this.room.addStream(this.localStream, { target: userId });
      this._emit('peer-update', { id: userId });
    });
    this.room.onPeerLeave(({ userId }) => {
      if (!this.peers.has(userId)) return;
      this.peers.delete(userId);
      this._emit('peer-left', { id: userId });
    });
    this.room.onPeerStream((stream, { userId }) => {
      this._ensure(userId).stream = stream;
      this._emit('peer-update', { id: userId });
    });
    this.profile.onChange(
      (val, { userId, self, removed }) => {
        if (self || removed || !val) return;
        Object.assign(this._ensure(userId).info, val);
        this._emit('peer-update', { id: userId });
      },
      { replay: true },
    );
    this.room.onError((err) => this._emit('error', err));
  }

  _ensure(id) {
    if (!this.peers.has(id)) {
      const known = this.profile?.get?.(id);
      this.peers.set(id, { info: { name: '…', mic: true, cam: true, ...(known || {}) }, stream: null });
    }
    return this.peers.get(id);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setState(patch) {
    this.profile.set((prev) => ({ ...prev, ...patch }));
  }

  async replaceAudioTrack(oldTrack, newTrack) {
    if (oldTrack && newTrack) await this.room.replaceTrack(oldTrack, newTrack);
  }

  async setMaxBitrate(kbps) {
    for (const p of Object.values(this.room.getPeers())) {
      const pc = p.connection;
      if (!pc) continue;
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = kbps * 1000;
        try { await sender.setParameters(params); } catch {}
      }
    }
  }

  leave() {
    return this.room.leave();
  }
}
