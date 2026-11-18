// Imagens da Tier List / Chaveamento.
// O estado compartilhado tem limite de tamanho, então as imagens viajam à parte:
// quem sobe manda pra todos; quem chegou depois pede as que faltam e quem tem responde.

export class ImageStore {
  constructor(mesh, onUpdate) {
    this.cache = new Map(); // id -> dataURL
    this.waiting = new Set();
    this.onUpdate = onUpdate;
    this.sendImg = mesh.makeAction('img');
    this.want = mesh.makeAction('imgwant');

    this.sendImg.onMessage((data) => {
      if (!data || typeof data.id !== 'string' || typeof data.d !== 'string' || !data.d.startsWith('data:image/')) return;
      if (data.d.length > 400000) return; // proteção: imagens são pequenas (miniaturas)
      const isNew = !this.cache.has(data.id);
      this.cache.set(data.id, data.d);
      this.waiting.delete(data.id);
      if (isNew) this.onUpdate?.(data.id);
    });
    this.want.onMessage((data, ctx) => {
      if (!data || !Array.isArray(data.ids)) return;
      for (const id of data.ids.slice(0, 200)) {
        const d = this.cache.get(id);
        if (d) this.sendImg.send({ id, d }, { target: ctx.userId });
      }
    });
    this._pending = new Set();
    this._timer = null;
  }

  get(id) { return this.cache.get(id); }
  has(id) { return this.cache.has(id); }

  put(id, dataUrl) {
    this.cache.set(id, dataUrl);
    this.sendImg.send({ id, d: dataUrl });
  }

  // pede as imagens que faltam (agrupado e com repetição até chegar)
  ensure(ids) {
    for (const id of ids) if (!this.cache.has(id)) this._pending.add(id);
    if (!this._pending.size || this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      const ids = [...this._pending].filter((id) => !this.cache.has(id));
      this._pending.clear();
      if (!ids.length) return;
      ids.forEach((id) => this.waiting.add(id));
      this.want.send({ ids });
      // se ninguém respondeu (ex.: conexão ainda abrindo), tenta de novo
      setTimeout(() => this.ensure(ids.filter((id) => !this.cache.has(id))), 4000);
    }, 250);
  }
}

// Reduz qualquer imagem pra uma miniatura quadrada leve (JPEG ~10 KB).
export async function makeThumb(fileOrBlob, size = 180) {
  const bmp = await createImageBitmap(fileOrBlob);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = Math.max(size / bmp.width, size / bmp.height);
  const w = bmp.width * s, h = bmp.height * s;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.82);
}

export const uid = () => Math.random().toString(36).slice(2, 10);

// cor bonita e estável a partir do texto (pros itens sem imagem)
export function colorFor(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = [12, 28, 38, 200, 160, 280, 340, 0, 48, 220][h % 10];
  return `linear-gradient(145deg, hsl(${hue} 45% 38%), hsl(${(hue + 25) % 360} 50% 24%))`;
}
