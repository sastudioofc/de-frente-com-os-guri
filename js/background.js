// Processador de câmera: recorta a pessoa com IA (MediaPipe Selfie Segmenter) e troca o fundo.
// Tudo roda no navegador de cada um — nada de vídeo passa por servidor.

const MODEL_LOCAL = new URL('../models/selfie_segmenter.tflite', import.meta.url).href;
const MODEL_REMOTE =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

// Timer num Worker: continua batendo mesmo com a aba em segundo plano
// (requestAnimationFrame congela quando você troca de aba e a câmera "travaria" pros outros).
function workerTicker(fps, cb) {
  const src = `let t;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = cb;
  w.postMessage(1000 / fps);
  return () => w.terminate();
}

export class CameraProcessor {
  constructor({ width = 1280, height = 720, fps = 30 } = {}) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.mode = 'none'; // 'none' | 'blur' | 'image'
    this.blurPx = 14;
    this.bgImage = null;
    this.segmenter = null;
    this.segmenterLoading = null;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    // canvas auxiliares
    this.personCanvas = document.createElement('canvas');
    this.personCtx = this.personCanvas.getContext('2d');
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.maskImageData = null;

    this.outputStream = this.canvas.captureStream(fps);
    this.lastTs = -1;
    this.busy = false;
    this.nextAllowed = 0;
  }

  get videoTrack() {
    return this.outputStream.getVideoTracks()[0];
  }

  async setSource(stream) {
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    if (!this.stopTicker) this.stopTicker = workerTicker(this.fps, () => this._frame());
  }

  async _loadSegmenter() {
    if (this.segmenter) return this.segmenter;
    if (this.segmenterLoading) return this.segmenterLoading;
    this.segmenterLoading = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import(new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href);
      const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
      let modelAssetPath = MODEL_LOCAL;
      try {
        const r = await fetch(MODEL_LOCAL, { method: 'HEAD' });
        if (!r.ok) modelAssetPath = MODEL_REMOTE; // último recurso: direto do Google
      } catch {
        modelAssetPath = MODEL_REMOTE;
      }
      const make = (delegate) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      try {
        this.segmenter = await make('GPU');
      } catch (e) {
        console.warn('GPU indisponível, usando CPU', e);
        this.segmenter = await make('CPU');
      }
      return this.segmenter;
    })();
    this.segmenterLoading.catch(() => { this.segmenterLoading = null; }); // deixa tentar de novo
    return this.segmenterLoading;
  }

  async setMode(mode, opts = {}) {
    if (mode === 'image') {
      if (opts.src) this.bgImage = await loadImage(opts.src);
      if (!this.bgImage) mode = 'none';
    }
    if (typeof opts.blurPx === 'number') this.blurPx = opts.blurPx;
    if (mode !== 'none') {
      try {
        await this._loadSegmenter();
      } catch (e) {
        console.error('Falha ao carregar IA de recorte', e);
        throw new Error('Não consegui carregar o recorte de fundo. Verifique a internet e tente de novo.');
      }
    }
    this.mode = mode;
  }

  _drawCover(ctx, src, sw, sh, dw, dh) {
    const s = Math.max(dw / sw, dh / sh);
    const w = sw * s, h = sh * s;
    ctx.drawImage(src, (dw - w) / 2, (dh - h) / 2, w, h);
  }

  _frame() {
    const v = this.video;
    if (this.busy || v.readyState < 2 || !v.videoWidth) return;
    const t0 = performance.now();
    // Limite automático: se o PC estiver sofrendo, pula quadros em vez de travar a página.
    if (t0 < this.nextAllowed) return;
    this.busy = true;
    try {
      const W = this.canvas.width, H = this.canvas.height;
      const ctx = this.ctx;
      const vw = v.videoWidth, vh = v.videoHeight;

      if (this.mode === 'none' || !this.segmenter) {
        this._drawCover(ctx, v, vw, vh, W, H);
        return;
      }

      // 1) máscara da pessoa via IA, numa versão pequena do quadro (rápido até em PC fraco)
      const SW = 320, SH = Math.round((320 * H) / W);
      const small = (this.smallCanvas ??= document.createElement('canvas'));
      if (small.width !== SW || small.height !== SH) { small.width = SW; small.height = SH; }
      const sctx = (this.smallCtx ??= small.getContext('2d', { willReadFrequently: false }));
      this._drawCover(sctx, v, vw, vh, SW, SH);

      let ts = t0;
      if (ts <= this.lastTs) ts = this.lastTs + 1;
      this.lastTs = ts;
      const result = this.segmenter.segmentForVideo(small, ts);
      // Com 2 máscaras: [fundo, pessoa]. Com 1: detectamos sozinhos se ela marca pessoa ou fundo.
      const masks = result.confidenceMasks || [];
      const mask = masks.length > 1 ? masks[masks.length - 1] : masks[0];
      if (!mask) {
        this._drawCover(ctx, v, vw, vh, W, H);
        result.close?.();
        return;
      }
      const mw = mask.width, mh = mask.height;
      const data = mask.getAsFloat32Array();
      if (this.maskCanvas.width !== mw || this.maskCanvas.height !== mh) {
        this.maskCanvas.width = mw;
        this.maskCanvas.height = mh;
        this.maskImageData = this.maskCtx.createImageData(mw, mh);
      }
      if (masks.length === 1) this._detectInversion(data, mw, mh);
      const inv = masks.length === 1 && this.inverted;
      const px = this.maskImageData.data;
      for (let i = 0, j = 3; i < data.length; i++, j += 4) {
        // curva suave pra borda ficar natural
        let a = ((inv ? 1 - data[i] : data[i]) - 0.35) * 2.5;
        a = a < 0 ? 0 : a > 1 ? 1 : a;
        px[j] = a * 255;
      }
      this.maskCtx.putImageData(this.maskImageData, 0, 0);
      result.close?.();

      // 2) pessoa recortada (a máscara pequena ampliada já sai com borda suave)
      if (this.personCanvas.width !== W || this.personCanvas.height !== H) {
        this.personCanvas.width = W;
        this.personCanvas.height = H;
      }
      const pctx = this.personCtx;
      pctx.globalCompositeOperation = 'source-over';
      pctx.clearRect(0, 0, W, H);
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(this.maskCanvas, 0, 0, W, H);
      pctx.globalCompositeOperation = 'source-in';
      this._drawCover(pctx, v, vw, vh, W, H);
      pctx.globalCompositeOperation = 'source-over';

      // 3) fundo
      if (this.mode === 'blur') {
        // desfoque barato: reduz bastante e amplia de volta
        const f = Math.max(4, Math.round(this.blurPx / 2));
        const bw = Math.max(16, Math.round(W / f)), bh = Math.max(9, Math.round(H / f));
        const bc = (this.blurCanvas ??= document.createElement('canvas'));
        if (bc.width !== bw || bc.height !== bh) { bc.width = bw; bc.height = bh; }
        const bctx = (this.blurCtx ??= bc.getContext('2d'));
        bctx.filter = 'blur(1.5px)';
        this._drawCover(bctx, v, vw, vh, bw, bh);
        bctx.filter = 'none';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bc, 0, 0, W, H);
      } else {
        const img = this.bgImage;
        this._drawCover(ctx, img, img.naturalWidth || img.width, img.naturalHeight || img.height, W, H);
      }
      // 4) pessoa por cima
      ctx.drawImage(this.personCanvas, 0, 0);
    } catch (e) {
      console.warn('frame error', e);
    } finally {
      this.busy = false;
      const cost = performance.now() - t0;
      this.avgCost = (this.avgCost || cost) * 0.9 + cost * 0.1;
      // usa no máximo ~60% do tempo da página com o vídeo
      this.nextAllowed = t0 + Math.max(0, this.avgCost / 0.6 - 1000 / this.fps);
    }
  }

  // Quem está numa call fica no centro/embaixo; os cantos de cima quase sempre são fundo.
  // Se a máscara for alta nos cantos e baixa no centro, ela está marcando o fundo -> invertemos.
  _detectInversion(d, w, h) {
    const avg = (x0, y0, x1, y1) => {
      let s = 0, n = 0;
      for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y += 2)
        for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x += 2) { s += d[y * w + x]; n++; }
      return n ? s / n : 0;
    };
    const corners = (avg(0, 0, 0.12, 0.25) + avg(0.88, 0, 1, 0.25)) / 2;
    const center = avg(0.35, 0.4, 0.65, 0.95);
    const diff = corners - center; // >0 sugere máscara de fundo
    this.invScore = (this.invScore || 0) * 0.95 + (Math.abs(diff) > 0.3 ? Math.sign(diff) : 0) * 0.05;
    if (this.invScore > 0.4) this.inverted = true;
    else if (this.invScore < -0.4) this.inverted = false;
  }

  stop() {
    this.stopTicker?.();
    this.stopTicker = null;
    this.video.srcObject?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
