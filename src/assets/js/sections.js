// Catálogo de secções e campos editáveis no CMS. Usado pelo renderer e pelo painel.
import { uid } from './dom.js';

export const FONTS = ['Rajdhani', 'Inter', 'Russo One', 'Orbitron', 'Oxanium', 'Chakra Petch', 'Bebas Neue', 'Exo 2', 'Teko', 'Poppins', 'Montserrat', 'Barlow Condensed'];
const fontOptions = FONTS.map((f) => [f, f]);
const BTN = [['primary', 'Principal (verde)'], ['secondary', 'Secundário (vermelho)'], ['ghost', 'Contorno']];
const ALIGN = [['left', 'Esquerda'], ['center', 'Centro']];

export const SECTION_TYPES = {
  hero: {
    label: 'Destaque (Hero)', icon: '⭐', group: 'Básicos',
    fields: [
      { key: 'eyebrow', label: 'Texto acima do título', type: 'text' },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'subtitle', label: 'Subtítulo', type: 'textarea' },
      { key: 'buttons', label: 'Botões', type: 'list', itemLabel: 'label', max: 4, newItem: { label: 'Botão', href: '/', variant: 'primary' },
        fields: [{ key: 'label', label: 'Texto', type: 'text' }, { key: 'href', label: 'Link', type: 'url' }, { key: 'variant', label: 'Estilo', type: 'select', options: BTN }] },
      { key: 'image', label: 'Imagem de fundo', type: 'image' },
      { key: 'overlay', label: 'Escurecer o fundo (%)', type: 'range', min: 0, max: 95 },
      { key: 'sideImage', label: 'Imagem lateral (opcional)', type: 'image' },
      { key: 'height', label: 'Altura', type: 'select', options: [['sm', 'Pequena'], ['md', 'Média'], ['lg', 'Grande'], ['full', 'Ecrã inteiro']] },
      { key: 'align', label: 'Alinhamento', type: 'select', options: ALIGN },
    ],
    defaults: { eyebrow: '', title: 'Novo destaque', subtitle: 'Escreve aqui uma frase de apresentação.', buttons: [{ label: 'Saber mais', href: '/', variant: 'primary' }], image: '', overlay: 60, sideImage: '', height: 'md', align: 'left' },
  },
  text: {
    label: 'Texto', icon: '📝', group: 'Básicos',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'body', label: 'Texto', type: 'rich' },
      { key: 'align', label: 'Alinhamento', type: 'select', options: [...ALIGN, ['right', 'Direita']] },
    ],
    defaults: { heading: 'Título da secção', body: '<p>Escreve aqui o teu texto.</p>', align: 'left' },
  },
  split: {
    label: 'Imagem + texto', icon: '🖼️', group: 'Básicos',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'body', label: 'Texto', type: 'rich' },
      { key: 'image', label: 'Imagem', type: 'image' },
      { key: 'imageAlt', label: 'Descrição da imagem (acessibilidade)', type: 'text' },
      { key: 'imagePosition', label: 'Posição da imagem', type: 'select', options: [['left', 'Esquerda'], ['right', 'Direita']] },
      { key: 'buttonLabel', label: 'Texto do botão', type: 'text' },
      { key: 'buttonHref', label: 'Link do botão', type: 'url' },
    ],
    defaults: { heading: 'Título', body: '<p>Texto ao lado da imagem.</p>', image: '/assets/img/logo-square.webp', imageAlt: '', imagePosition: 'right', buttonLabel: '', buttonHref: '' },
  },
  features: {
    label: 'Cartões', icon: '🗂️', group: 'Básicos',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'intro', label: 'Introdução', type: 'textarea' },
      { key: 'columns', label: 'Colunas', type: 'select', options: [[2, '2'], [3, '3'], [4, '4']] },
      { key: 'items', label: 'Cartões', type: 'list', itemLabel: 'title', max: 12, newItem: { icon: '✨', title: 'Novo cartão', text: 'Descrição', href: '', linkLabel: '' },
        fields: [{ key: 'icon', label: 'Ícone (emoji)', type: 'text' }, { key: 'title', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }, { key: 'href', label: 'Link', type: 'url' }, { key: 'linkLabel', label: 'Texto do link', type: 'text' }] },
    ],
    defaults: { heading: 'Destaques', intro: '', columns: 3, items: [{ icon: '🎮', title: 'Cartão 1', text: 'Descrição', href: '', linkLabel: '' }, { icon: '🏆', title: 'Cartão 2', text: 'Descrição', href: '', linkLabel: '' }, { icon: '🇵🇹', title: 'Cartão 3', text: 'Descrição', href: '', linkLabel: '' }] },
  },
  cta: {
    label: 'Chamada para ação', icon: '📣', group: 'Básicos',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'buttonLabel', label: 'Texto do botão', type: 'text' },
      { key: 'buttonHref', label: 'Link do botão', type: 'url' },
      { key: 'variant', label: 'Estilo do botão', type: 'select', options: BTN },
    ],
    defaults: { title: 'Pronto para começar?', text: 'Junta-te à comunidade.', buttonLabel: 'Entrar', buttonHref: '/login', variant: 'primary' },
  },
  image: {
    label: 'Imagem', icon: '🏞️', group: 'Media',
    fields: [
      { key: 'src', label: 'Imagem', type: 'image' },
      { key: 'alt', label: 'Descrição (acessibilidade)', type: 'text' },
      { key: 'caption', label: 'Legenda', type: 'text' },
      { key: 'href', label: 'Link ao clicar (opcional)', type: 'url' },
      { key: 'size', label: 'Tamanho', type: 'select', options: [['normal', 'Normal'], ['wide', 'Largo'], ['full', 'Largura total']] },
      { key: 'rounded', label: 'Cantos arredondados', type: 'toggle', defaultOn: true },
    ],
    defaults: { src: '/assets/img/logo.webp', alt: 'ROB RUN Portugal', caption: '', href: '', size: 'normal', rounded: true },
  },
  gallery: {
    label: 'Galeria', icon: '🧩', group: 'Media',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'columns', label: 'Colunas', type: 'select', options: [[2, '2'], [3, '3'], [4, '4']] },
      { key: 'images', label: 'Imagens', type: 'list', itemLabel: 'caption', max: 40, newItem: { src: '', alt: '', caption: '' },
        fields: [{ key: 'src', label: 'Imagem', type: 'image' }, { key: 'alt', label: 'Descrição', type: 'text' }, { key: 'caption', label: 'Legenda', type: 'text' }] },
    ],
    defaults: { heading: 'Galeria', columns: 3, images: [] },
  },
  video: {
    label: 'Vídeo (YouTube/TikTok)', icon: '▶️', group: 'Media',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'url', label: 'Link do vídeo (YouTube ou TikTok)', type: 'url' },
      { key: 'caption', label: 'Legenda', type: 'text' },
    ],
    defaults: { heading: '', url: '', caption: '' },
  },
  rules: {
    label: 'Regras / lista numerada', icon: '📜', group: 'Comunidade',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'intro', label: 'Introdução', type: 'textarea' },
      { key: 'items', label: 'Itens', type: 'list', itemLabel: 'title', max: 30, newItem: { title: 'Nova regra', text: '' },
        fields: [{ key: 'title', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }] },
    ],
    defaults: { heading: 'Regras', intro: '', items: [{ title: 'Respeito', text: 'Trata todos com respeito.' }] },
  },
  discord: {
    label: 'Convite Discord', icon: '💬', group: 'Comunidade',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'buttonLabel', label: 'Texto do botão', type: 'text' },
      { key: 'url', label: 'Link do convite ({{discordUrl}} usa o das Definições)', type: 'url' },
    ],
    defaults: { title: 'Junta-te ao Discord', text: 'Conversa com a comunidade.', buttonLabel: 'Entrar no Discord', url: '{{discordUrl}}' },
  },
  faq: {
    label: 'Perguntas frequentes', icon: '❓', group: 'Comunidade',
    fields: [
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'items', label: 'Perguntas', type: 'list', itemLabel: 'q', max: 40, newItem: { q: 'Nova pergunta?', a: 'Resposta.' },
        fields: [{ key: 'q', label: 'Pergunta', type: 'text' }, { key: 'a', label: 'Resposta', type: 'textarea' }] },
    ],
    defaults: { heading: 'Perguntas frequentes', items: [{ q: 'Pergunta?', a: 'Resposta.' }] },
  },
  notice: {
    label: 'Aviso', icon: 'ℹ️', group: 'Comunidade',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'tone', label: 'Tipo', type: 'select', options: [['info', 'Informação'], ['warning', 'Atenção'], ['success', 'Sucesso']] },
    ],
    defaults: { title: 'Aviso', text: 'Texto do aviso.', tone: 'info' },
  },
  feed: {
    label: 'Lista dinâmica', icon: '📡', group: 'Dinâmicos',
    fields: [
      { key: 'source', label: 'Conteúdo', type: 'select', options: [['clips', 'Clips'], ['news', 'Notícias'], ['guides', 'Guias'], ['clans', 'Clãs']] },
      { key: 'heading', label: 'Título', type: 'text' },
      { key: 'intro', label: 'Introdução', type: 'textarea' },
      { key: 'limit', label: 'Quantidade', type: 'number', min: 1, max: 60 },
      { key: 'layout', label: 'Disposição', type: 'select', options: [['grid', 'Grelha'], ['list', 'Lista']] },
      { key: 'paginate', label: 'Botão "Carregar mais"', type: 'toggle' },
      { key: 'moreLabel', label: 'Texto do link "ver mais"', type: 'text' },
      { key: 'moreHref', label: 'Link "ver mais"', type: 'url' },
    ],
    defaults: { source: 'news', heading: 'Últimas novidades', intro: '', limit: 6, layout: 'grid', paginate: false, moreLabel: '', moreHref: '' },
  },
  clipSubmit: {
    label: 'Formulário de clips', icon: '🎬', group: 'Dinâmicos',
    fields: [{ key: 'heading', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }],
    defaults: { heading: 'Publicar um clip', text: 'Cola o link do YouTube ou TikTok.' },
  },
  auth: {
    label: 'Login Google', icon: '🔐', group: 'Dinâmicos',
    fields: [{ key: 'heading', label: 'Título', type: 'text' }, { key: 'text', label: 'Texto', type: 'textarea' }],
    defaults: { heading: 'Entrar', text: 'Usa a tua conta Google.' },
  },
  profile: {
    label: 'Perfil do jogador', icon: '👤', group: 'Dinâmicos',
    fields: [{ key: 'heading', label: 'Título', type: 'text' }],
    defaults: { heading: 'Perfil' },
  },
  spacer: {
    label: 'Espaço / divisória', icon: '↕️', group: 'Básicos',
    fields: [{ key: 'height', label: 'Altura (px)', type: 'range', min: 8, max: 240 }, { key: 'line', label: 'Mostrar linha', type: 'toggle' }],
    defaults: { height: 48, line: false },
  },
};

export const STYLE_FIELDS = [
  { key: 'bgColor', label: 'Cor de fundo', type: 'color' },
  { key: 'bgImage', label: 'Imagem de fundo', type: 'image' },
  { key: 'bgOverlay', label: 'Escurecer imagem (%)', type: 'range', min: 0, max: 95 },
  { key: 'textColor', label: 'Cor do texto', type: 'color' },
  { key: 'padTop', label: 'Espaço em cima (px)', type: 'range', min: 0, max: 240 },
  { key: 'padBottom', label: 'Espaço em baixo (px)', type: 'range', min: 0, max: 240 },
  { key: 'width', label: 'Largura do conteúdo', type: 'select', options: [['', 'Normal'], ['narrow', 'Estreita'], ['wide', 'Larga'], ['full', 'Total']] },
  { key: 'align', label: 'Alinhamento do texto', type: 'select', options: [['', 'Automático'], ['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita']] },
  { key: 'borderColor', label: 'Cor da borda', type: 'color' },
  { key: 'borderWidth', label: 'Espessura da borda (px)', type: 'range', min: 0, max: 8 },
  { key: 'radius', label: 'Cantos arredondados (px)', type: 'range', min: 0, max: 48 },
  { key: 'anchor', label: 'Âncora (ex.: regras → /pagina#regras)', type: 'text' },
  { key: 'hideOnMobile', label: 'Esconder em telemóvel', type: 'toggle' },
  { key: 'hideOnDesktop', label: 'Esconder em computador', type: 'toggle' },
];

export const THEME_FIELDS = [
  { type: 'heading', label: 'Cores' },
  { key: 'colors.primary', label: 'Principal (verde)', type: 'color' },
  { key: 'colors.secondary', label: 'Secundária (vermelho)', type: 'color' },
  { key: 'colors.bg', label: 'Fundo', type: 'color' },
  { key: 'colors.surface', label: 'Superfícies / cartões', type: 'color' },
  { key: 'colors.surface2', label: 'Superfícies (2.º nível)', type: 'color' },
  { key: 'colors.text', label: 'Texto', type: 'color' },
  { key: 'colors.muted', label: 'Texto secundário', type: 'color' },
  { key: 'colors.accent', label: 'Destaque (branco)', type: 'color' },
  { key: 'colors.border', label: 'Bordas', type: 'color' },
  { type: 'heading', label: 'Tipografia' },
  { key: 'fonts.heading', label: 'Fonte dos títulos', type: 'select', options: fontOptions },
  { key: 'fonts.body', label: 'Fonte do texto', type: 'select', options: fontOptions },
  { key: 'uppercaseHeadings', label: 'Títulos em maiúsculas', type: 'toggle' },
  { type: 'heading', label: 'Forma e espaço' },
  { key: 'radius', label: 'Cantos arredondados (px)', type: 'range', min: 0, max: 32 },
  { key: 'spacing', label: 'Espaçamento geral (%)', type: 'range', min: 60, max: 160 },
  { key: 'borderWidth', label: 'Espessura das bordas (px)', type: 'range', min: 0, max: 4 },
  { key: 'bgStyle', label: 'Estilo do fundo', type: 'select', options: [['glow', 'Brilho verde/vermelho'], ['grid', 'Grelha subtil'], ['plain', 'Liso']] },
];

export const HEADER_FIELDS = [
  { type: 'heading', label: 'Logo' },
  { key: 'logo.src', label: 'Imagem do logo', type: 'image' },
  { key: 'logo.height', label: 'Altura do logo (px)', type: 'range', min: 20, max: 120 },
  { key: 'logo.align', label: 'Posição do logo', type: 'select', options: [['left', 'Esquerda'], ['center', 'Centro']] },
  { key: 'logo.showText', label: 'Mostrar texto ao lado', type: 'toggle' },
  { key: 'logo.text', label: 'Texto do logo', type: 'text' },
  { type: 'heading', label: 'Navegação' },
  { type: 'note', label: 'O menu mostra as páginas marcadas "Mostrar no menu", pela ordem da lista de páginas. Arrasta as páginas para reordenar.' },
  { key: 'extraLinks', label: 'Links extra no menu', type: 'list', itemLabel: 'label', max: 8, newItem: { label: 'Link', href: '/' },
    fields: [{ key: 'label', label: 'Texto', type: 'text' }, { key: 'href', label: 'Link', type: 'url' }] },
  { key: 'sticky', label: 'Cabeçalho fixo ao rolar', type: 'toggle', defaultOn: true },
  { key: 'showLogin', label: 'Mostrar botão Entrar / perfil', type: 'toggle', defaultOn: true },
  { key: 'ctaLabel', label: 'Botão de destaque (texto)', type: 'text' },
  { key: 'ctaHref', label: 'Botão de destaque (link)', type: 'url' },
  { key: 'bgColor', label: 'Cor de fundo', type: 'color' },
];

export const FOOTER_FIELDS = [
  { key: 'logo.src', label: 'Logo do rodapé', type: 'image' },
  { key: 'logo.height', label: 'Altura do logo (px)', type: 'range', min: 20, max: 120 },
  { key: 'logo.align', label: 'Posição', type: 'select', options: [['left', 'Esquerda'], ['center', 'Centro']] },
  { key: 'text', label: 'Texto', type: 'textarea' },
  { key: 'links', label: 'Links', type: 'list', itemLabel: 'label', max: 20, newItem: { label: 'Link', href: '/' },
    fields: [{ key: 'label', label: 'Texto', type: 'text' }, { key: 'href', label: 'Link', type: 'url' }] },
  { key: 'showSocial', label: 'Mostrar redes sociais', type: 'toggle', defaultOn: true },
  { key: 'disclaimer', label: 'Aviso de comunidade independente', type: 'textarea' },
  { key: 'copyright', label: 'Direitos / assinatura', type: 'text' },
  { key: 'bgColor', label: 'Cor de fundo', type: 'color' },
];

export const SETTINGS_FIELDS = [
  { key: 'siteName', label: 'Nome da comunidade', type: 'text' },
  { key: 'tagline', label: 'Slogan', type: 'text' },
  { key: 'description', label: 'Descrição (motores de busca)', type: 'textarea' },
  { key: 'favicon', label: 'Ícone do separador (favicon)', type: 'image' },
  { key: 'discordUrl', label: 'Convite do Discord', type: 'url' },
  { key: 'contactEmail', label: 'Email de contacto (aparece na privacidade)', type: 'text' },
  { type: 'heading', label: 'Redes sociais' },
  { key: 'social.tiktok', label: 'TikTok', type: 'url' },
  { key: 'social.youtube', label: 'YouTube', type: 'url' },
  { key: 'social.instagram', label: 'Instagram', type: 'url' },
  { key: 'social.x', label: 'X / Twitter', type: 'url' },
  { key: 'social.twitch', label: 'Twitch', type: 'url' },
];

export const PAGE_FIELDS = [
  { key: 'title', label: 'Título da página', type: 'text' },
  { key: 'slug', label: 'Endereço (/endereco)', type: 'text' },
  { key: 'showInMenu', label: 'Mostrar no menu', type: 'toggle', defaultOn: true },
  { key: 'seo.description', label: 'Descrição para motores de busca', type: 'textarea' },
];

export function newSection(type) {
  const def = SECTION_TYPES[type];
  return { id: uid('s'), type, props: structuredClone(def.defaults), style: {} };
}
