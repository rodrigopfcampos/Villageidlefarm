// Todos os textos da interface (pt-BR) num lugar só, para traduzir depois.
// Regra: nenhum componente escreve texto solto; tudo vem daqui (STR, nomes e mensagens).

import type {
  AnimalType,
  BuffKind,
  ErrorCode,
  ExtractionStatus,
  ItemId,
  Rarity,
} from '@vif/shared';
import { BUFFS_BY_KIND, ERROR_MESSAGES_PT } from '@vif/shared';

export const LOCALE = 'pt-BR';

export const STR = {
  loading: 'Carregando…',
  close: 'Fechar',
  cancel: 'Cancelar',
  confirm: 'Confirmar',
  coins: 'Moedas',
  level: 'Nível',
  levelShort: 'Nv.',
  xp: 'XP',
  vip: 'VIP',
  you_have: 'Você tem',
  max: 'Máx.',
  qty: 'Quantidade',
  total: 'Total',
  each: 'cada',
  free: 'grátis',
  keyHint: (k: string) => `(${k})`,

  // HUD
  hud: {
    clock: 'Hora local',
    xpTitle: (xp: number, next: number) => `XP ${xp} / ${next}`,
    buffsTitle: 'Cartas ativas',
    noBuffs: 'Nenhuma carta ativa',
    vipTitle: 'VIP ativo',
    nightTitle: 'Evento noturno',
    nightActive: 'Evento noturno',
    nightEndsIn: (t: string) => `termina em ${t}`,
    nightStartsIn: (t: string) => `começa em ${t}`,
    nightNext: 'Evento às 19h',
    nightSpeed: 'Plantas 1,5× mais rápidas para quem está ativo',
    attendance: (have: string, need: string) => `Presença ${have} / ${need}`,
    cardClaimed: 'Carta de hoje já ganha',
    cardPending: 'Fique 30 min ativo para ganhar 1 carta',
    claimCard: 'Pegar carta',
  },

  toolbar: {
    inventory: 'Inventário',
    shop: 'Loja',
    cards: 'Cartas',
    album: 'Álbum',
    steam: 'Steam',
  },

  // Painel Plantar
  plant: {
    title: 'Plantar',
    slot: (id: string) => `Canteiro ${id}`,
    time: 'Tempo',
    seed: 'Semente',
    profit: 'Lucro',
    perHour: (n: string) => `${n}/h`,
    owned: (n: number) => `Você tem ${n}`,
    plantBtn: 'Plantar',
    buyAndPlant: 'Comprar e plantar',
    lockedLevel: (lv: number) => `Nível ${lv}`,
    moreLocked: (n: number, lv: number) =>
      n === 1 ? `+1 cultura a partir do nível ${lv}` : `+${n} culturas a partir do nível ${lv}`,
    noMoney: 'Sem moedas',
    occupied: 'Este canteiro já está plantado.',
    readyIn: (t: string) => `Fica pronto em ${t}`,
    ready: 'Pronto para colher!',
    harvest: 'Colher',
    planted: (name: string) => `${name} plantada!`,
    harvested: 'Colhido!',
  },

  unlock: {
    title: 'Desbloquear canteiro',
    text: 'Libere este canteiro para plantar mais.',
    cost: 'Custo',
    needLevel: (lv: number) => `Precisa do nível ${lv}`,
    btn: 'Desbloquear por',
    already: 'Este canteiro já está liberado.',
    done: 'Canteiro liberado!',
  },

  // Inventário
  inventory: {
    title: 'Inventário',
    empty: 'Seu inventário está vazio. Plante e colha para encher!',
    filters: {
      all: 'Tudo',
      crop: 'Colheitas',
      seed: 'Sementes',
      animal_product: 'Produtos',
      card: 'Cartas usadas',
    },
    steamBadge: 'Pode ir para a Steam',
    sellTitle: 'Vender na loja',
    sellPrice: 'A loja paga por unidade:',
    notSellable: 'A loja não compra este item.',
    sellBtn: 'Vender por',
    sold: (qty: number, name: string, total: string) => `Vendeu ${qty}× ${name} por ${total}`,
    pick: 'Escolha um item para ver os detalhes.',
    toSteam: 'Enviar para a Steam',
  },

  // Loja NPC
  shop: {
    title: 'Loja',
    seeds: 'Sementes',
    animals: 'Animais',
    buyBtn: 'Comprar por',
    bought: (qty: number, name: string) => `Comprou ${qty}× ${name}`,
    boughtAnimal: (name: string) => `${name} chegou na fazenda!`,
    locked: (lv: number) => `Libera no nível ${lv}`,
    grows: (t: string) => `Cresce em ${t}`,
    produces: (name: string, t: string) => `Dá ${name} a cada ${t}`,
  },

  // Cartas e álbum
  cards: {
    title: 'Cartas',
    tabCards: 'Minhas cartas',
    tabAlbum: 'Álbum',
    empty: 'Você ainda não tem cartas. Colha plantas e participe do evento noturno para ganhar.',
    slots: (used: number, max: number) => `Vagas de carta: ${used} / ${max}`,
    slotsVipHint: 'Com VIP são 2 vagas.',
    activate: 'Ativar',
    activated: (name: string) => `Carta ${name} ativada!`,
    duration: 'Duração',
    instant: 'Na hora',
    instantNote: 'Efeito na hora: não ocupa vaga.',
    activeNow: 'Ativas agora',
    remaining: (t: string) => `${t} restantes`,
    pick: 'Escolha uma carta para ver o efeito.',
    rule: 'Vale só para o que for produzido enquanto a carta está ativa.',
    copies: (n: number) => `×${n}`,
    albumIntro:
      'Cada carta usada entra no álbum para sempre (enviar a cópia para a Steam não tira do álbum). Complete uma linha para ganhar um bônus permanente.',
    lineDone: (pct: number) => `+${pct}%`,
    lineMissing: (n: number) => `faltam ${n}`,
    albumCount: (have: number, total: number) => `${have} / ${total} cartas`,
    newCard: (name: string) => `Nova carta: ${name}!`,
    source: { drop: 'Colheita', night_event: 'Evento noturno', system: 'Presente' } as Record<
      string,
      string
    >,
  },

  // Retirada para a Steam
  steam: {
    title: 'Enviar para a Steam',
    intro:
      'Envie itens para o seu inventário Steam e negocie no mercado da Steam. Cada envio é de 1 unidade.',
    quota: (used: number, limit: number, hours: number) =>
      `Envios usados: ${used} / ${limit} nas últimas ${hours} h`,
    nextSlot: (t: string) => `Próxima vaga em ${t}`,
    slotFree: 'Você pode enviar agora.',
    vipHint: 'Com VIP são 4 envios a cada 7 h.',
    minLevel: (lv: number) => `Envios liberam no nível ${lv}.`,
    pickItem: 'Escolha um item',
    noItems: 'Nenhum item que possa ir para a Steam. Colheitas, produtos e cartas usadas podem.',
    confirmTitle: 'Confirmar envio',
    confirmText: (name: string) => `Enviar 1× ${name} para a Steam? O item sai do jogo agora.`,
    send: 'Enviar 1 unidade',
    sent: (name: string) => `${name} enviado para a Steam!`,
    history: 'Histórico',
    noHistory: 'Nenhum envio ainda.',
    unavailable:
      'Steam ainda não conectada. Os envios voltam a funcionar quando a ponte estiver no ar.',
    status: {
      pending: 'Pendente',
      granted: 'Na Steam',
      failed: 'Falhou (devolvido)',
      returned: 'Voltou ao jogo',
    } as Record<ExtractionStatus, string>,
  },

  // Tela "enquanto você esteve fora"
  offline: {
    title: 'Enquanto você esteve fora',
    away: (t: string) => `Você ficou fora por ${t}.`,
    credited: (t: string) => `Sua fazenda trabalhou por ${t}.`,
    capped: (t: string) =>
      `Limite atingido: a fazenda só produz até ${t} sem você. Volte antes para não perder produção!`,
    readyPlots: (n: number) =>
      n === 1 ? '1 canteiro pronto para colher' : `${n} canteiros prontos para colher`,
    noneReady: 'Nada pronto ainda. As plantas continuam crescendo.',
    harvestAll: 'Colher tudo',
    continue: 'Continuar',
    harvestedAll: 'Tudo colhido!',
  },

  levelUp: (lv: number) => `Você subiu para o nível ${lv}!`,
  eventStart: 'O evento noturno começou! Plantas crescem 1,5× mais rápido.',
  eventEnd: 'O evento noturno terminou.',
  eventCardClaimed: (name: string) => `Carta do evento ganha: ${name}!`,
} as const;

/** Mensagens amigáveis por código de erro (cai em ERROR_MESSAGES_PT se faltar). */
const FRIENDLY_ERRORS: Partial<Record<ErrorCode, string>> = {
  NOT_AUTHENTICATED: 'Sua sessão expirou. Entre de novo pela Steam.',
  NOT_READY: 'Ainda não está pronto. Espere mais um pouco.',
  SLOT_LOCKED: 'Este canteiro ainda está bloqueado.',
  SLOT_OCCUPIED: 'Este canteiro já tem uma planta.',
  INSUFFICIENT_FUNDS: 'Moedas insuficientes.',
  INSUFFICIENT_ITEMS: 'Você não tem itens suficientes.',
  RATE_LIMITED: 'Calma! Muitas ações seguidas. Tente de novo em alguns segundos.',
  ALREADY_CLAIMED: 'Você já pegou a carta do evento hoje.',
  DUPLICATE_REQUEST: 'Essa ação já foi feita.',
  LEVEL_TOO_LOW: 'Seu nível ainda é baixo para isso.',
  NOT_FOR_SALE: 'A loja não negocia este item.',
  CARD_SLOT_FULL: 'Todas as vagas de carta estão ocupadas. Espere uma carta acabar.',
  BUFF_ALREADY_ACTIVE: 'Já tem uma carta desse tipo ativa. Espere ela acabar.',
  CARD_ALREADY_USED: 'Essa carta já foi usada.',
  EXTRACTION_QUOTA: 'Você já usou todos os envios para a Steam desta janela de 7 h.',
  NOT_EXTRACTABLE: 'Este item não pode ir para a Steam.',
  NOT_ACTIVE: 'Fique 30 minutos ativo no evento para ganhar a carta.',
  STEAM_UNAVAILABLE: 'Steam ainda não conectada. Tente mais tarde.',
  NETWORK_ERROR: 'Sem conexão com o servidor. Tente de novo.',
  NOT_IMPLEMENTED: 'Isso ainda não está disponível.',
};

export function errorMessage(code: ErrorCode): string {
  return FRIENDLY_ERRORS[code] ?? ERROR_MESSAGES_PT[code] ?? ERROR_MESSAGES_PT.UNKNOWN;
}

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Rara',
  epic: 'Épica',
  legendary: 'Lendária',
};

/**
 * Nomes dos buffs. O catálogo (cards.json) também traz `name`/`description`; este mapa só
 * garante o texto traduzível. Buff novo sem entrada aqui usa o nome do catálogo.
 */
const BUFF_NAMES: Record<string, string> = {
  gold: 'Ouro',
  bountiful_harvest: 'Colheita farta',
  animals: 'Animais',
  fertilizer: 'Adubo',
  xp: 'XP',
  clear_sky: 'Céu limpo',
  exploration: 'Exploração',
  luck: 'Sorte',
};

export function buffName(kind: string): string {
  return BUFF_NAMES[kind] ?? BUFFS_BY_KIND.get(kind as BuffKind)?.name ?? prettifyId(kind);
}

/** Descrição do efeito (por enquanto, a do catálogo). */
export function buffDescription(kind: string): string {
  const d = BUFFS_BY_KIND.get(kind as BuffKind)?.description ?? '';
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : '';
}

/** Nome das culturas pelo nome base do ícone (icon/<base>); cobre os 40 ícones do atlas. */
const CROP_NAMES: Record<string, string> = {
  apple: 'Maçã',
  artichoke: 'Alcachofra',
  asparagus: 'Aspargo',
  banana: 'Banana',
  bell_pepper: 'Pimentão',
  blackberry: 'Amora',
  blueberry: 'Mirtilo',
  broccoli: 'Brócolis',
  cabbage: 'Repolho',
  carrot: 'Cenoura',
  cauliflower: 'Couve-flor',
  celery: 'Aipo',
  cherry: 'Cereja',
  chili_pepper: 'Pimenta',
  corn: 'Milho',
  eggplant: 'Berinjela',
  fig: 'Figo',
  garlic: 'Alho',
  ginger: 'Gengibre',
  grape: 'Uva',
  green_apple: 'Maçã verde',
  kale: 'Couve',
  kiwi: 'Kiwi',
  leek: 'Alho-poró',
  lemon: 'Limão',
  lettuce: 'Alface',
  mango: 'Manga',
  melon: 'Melão',
  onion: 'Cebola',
  orange: 'Laranja',
  peach: 'Pêssego',
  pear: 'Pera',
  pineapple: 'Abacaxi',
  pomegranate: 'Romã',
  potato: 'Batata',
  pumpkin: 'Abóbora',
  spinach: 'Espinafre',
  strawberry: 'Morango',
  watermelon: 'Melancia',
};

const PRODUCT_NAMES: Record<string, string> = {
  egg: 'Ovo',
  duck_egg: 'Ovo de pata',
  milk: 'Leite',
  wool: 'Lã',
  goat_milk: 'Leite de cabra',
  goose_egg: 'Ovo de ganso',
  truffle: 'Trufa',
  rabbit_fur: 'Pelo de coelho',
  alpaca_wool: 'Lã de alpaca',
  turkey_egg: 'Ovo de perua',
};

const ANIMAL_NAMES: Record<string, string> = {
  chicken: 'Galinha',
  duck: 'Pato',
  rabbit: 'Coelho',
  pig: 'Porco',
  sheep: 'Ovelha',
  goat: 'Cabra',
  cow: 'Vaca',
  goose: 'Ganso',
  alpaca: 'Alpaca',
  turkey: 'Peru',
};

/** "card_gold_rare" → "Ouro (Rara)" */
export function cardName(buff: string, rarity: Rarity): string {
  return `${buffName(buff)} (${RARITY_NAMES[rarity]})`;
}

function prettifyId(id: string): string {
  const s = id.replace(/^(seed|crop|prod|animal|card)_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Nome do item derivado do id (o catálogo não tem nome; ver pedido de contrato). */
export function itemName(id: ItemId): string {
  let m = /^crop_(.+)$/.exec(id);
  if (m?.[1]) return CROP_NAMES[m[1]] ?? prettifyId(id);
  m = /^seed_(.+)$/.exec(id);
  if (m?.[1]) return `Semente de ${lowerFirst(CROP_NAMES[m[1]] ?? prettifyId(m[1]))}`;
  m = /^prod_(.+)$/.exec(id);
  if (m?.[1]) return PRODUCT_NAMES[m[1]] ?? prettifyId(id);
  m = /^card_(.+)_(common|uncommon|rare|epic|legendary)$/.exec(id);
  if (m?.[1]) return `Carta ${cardName(m[1], m[2] as Rarity)}`;
  return prettifyId(id);
}

export function animalName(type: AnimalType): string {
  return ANIMAL_NAMES[type.replace(/^animal_/, '')] ?? prettifyId(type);
}
