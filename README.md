# 🎙️ Estúdio · De Frente Com Os Guri

Site de chamada de vídeo do programa: todo mundo entra pelo navegador com a câmera ligada e escolhe o próprio fundo. Roda **100% no GitHub Pages**, de graça e sem servidor.

**O que tem:**
- Chamada de vídeo e áudio com até 6 pessoas (Chrome, Edge, Firefox; no celular também funciona)
- **Fundos**: desfoque, 4 prontos (Estúdio, Templo, Neon, Madeira) ou **qualquer imagem sua**. O recorte é feito com IA no computador de cada um.
- Borda dourada em quem está falando
- Mutar o mic (tecla **M**), desligar a câmera (**V**) e abrir o painel de fundo (**B**)
- Troca de câmera e de microfone, qualidade de 480p, 720p ou 1080p e modo "som cru" pra mic bom
- Botão de convite (copia o link da sala; se tiver senha, ela vai junto no link)
- Senha opcional

## 🎛️ Como usar

1. Abram o site, coloquem o nome e a **mesma sala** (ex.: `defrente`).
2. **Senha (opcional):** se usarem, todo mundo tem que digitar a mesma. Quem não tiver a senha não consegue nem achar vocês, porque a conexão é criptografada com ela.
3. Escolham o fundo antes de entrar. Dá pra trocar durante a call no botão **Fundo**.
4. Pra usar uma imagem sua, clique em **"+ Sua imagem"**. Ela fica salva no seu navegador.
5. Pra chamar alguém, clique em **Convite** e mande o link.

**Dica pro fundo ficar bonito:** luz de frente pro rosto (nunca uma janela atrás).

## ⚙️ Como funciona

- O vídeo e o áudio vão **direto de um participante pro outro** (WebRTC).
- Pra um navegador achar o outro, o site usa relays públicos e gratuitos do Nostr, através da biblioteca [Trystero](https://github.com/dmotz/trystero). Eles só passam a "apresentação"; o vídeo não passa por eles.
- Cada vez que alguém altera um arquivo na branch `main`, o GitHub publica o site sozinho em uns 1 a 2 minutos (veja a aba **Actions**).

## 🔧 Ajustes (arquivo `js/config.js`)

- `maxUsers`: máximo de pessoas por sala.
- `turn`: servidor TURN. Use se **alguém entrar e a câmera dele não aparecer**, o que é comum em 4G ou em operadora com CGNAT. Tem grátis na [Metered.ca](https://www.metered.ca/stun-turn) (50 GB/mês) e na [Cloudflare](https://developers.cloudflare.com/calls/turn/). Cole a URL, o usuário e a senha no formato do exemplo que está no arquivo.
- `relays`: lista de relays Nostr. Deixe vazio pra usar a lista padrão.

Dá pra editar direto no site do GitHub: abra o arquivo, clique no lápis e depois em "Commit".

## 🖼️ Personalizar

- **Fundo fixo pra todo mundo:** suba a imagem em `backgrounds/` (de preferência 1920×1080 em JPG) e adicione uma linha na lista `PRESETS` no começo de `js/app.js`.
- **Logo:** substitua `img/logo.svg` pela logo oficial (se for PNG, ajuste o nome no `index.html`).

## 🗂️ Estrutura

```
index.html             tela de entrada e sala
js/app.js              interface, dispositivos, controles
js/p2p.js              conexão entre participantes (Trystero)
js/background.js       recorte com IA e troca de fundo (MediaPipe)
js/config.js           configurações
vendor/                bibliotecas (Trystero e MediaPipe), já embutidas
.github/workflows/     publicação automática no GitHub Pages
```
