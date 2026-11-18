// Configurações do estúdio. Pode editar direto aqui no GitHub.
export const CONFIG = {
  // Identificador do app (não mude depois de começar a usar, senão as salas antigas "somem").
  appId: 'defrentecomosguri-estudio-v1',

  // Máximo de pessoas por sala.
  maxUsers: 6,

  // Servidor TURN (opcional). Só precisa se alguém entrar e a câmera dele não aparecer
  // (comum em 4G / operadora com CGNAT). Tem grátis na Metered.ca ou na Cloudflare. Exemplo:
  // turn: [{ urls: ['turn:global.relay.metered.ca:80', 'turns:global.relay.metered.ca:443?transport=tcp'], username: 'xxx', credential: 'yyy' }],
  turn: [],

  // Relays Nostr usados pra apresentar os participantes. Vazio = lista padrão do Trystero (recomendado).
  relays: [],
};
