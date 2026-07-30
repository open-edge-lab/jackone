/**
 * Costruzione, mescolamento e pescaggio del mazzo UNO da 108 carte.
 *
 * Tutto il modulo è puro e deterministico: la casualità viaggia in un seed
 * numerico contenuto nello stato del mazzo, così una mano può essere
 * riprodotta identica nei test.
 */

import { COLORS, KIND, WILD_COLOR } from '../../shared/cards.js';

/**
 * PRNG mulberry32: da un seed a 32 bit produce un float in [0,1) e il seed successivo.
 * @param {number} seed
 * @returns {[number, number]} coppia [valore, nuovoSeed]
 */
export function nextRandom(seed) {
  let s = (seed + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/**
 * Intero casuale in [0, max).
 * @param {number} seed
 * @param {number} max
 * @returns {[number, number]} coppia [intero, nuovoSeed]
 */
export function nextInt(seed, max) {
  const [value, newSeed] = nextRandom(seed);
  return [Math.floor(value * max), newSeed];
}

/**
 * Costruisce il mazzo UNO standard da 108 carte in ordine canonico.
 *
 * Per ciascuno dei 4 colori: uno 0, due carte per ogni numero da 1 a 9,
 * due divieto, due cambio giro, due +2 (25 carte × 4 = 100).
 * Più 4 cambia colore e 4 cambia colore +4.
 *
 * @returns {Array<{id: string, color: string, kind: string, value?: number}>}
 */
export function buildDeck() {
  const cards = [];
  const push = (color, kind, value, copy) => {
    const suffix = kind === KIND.NUMBER ? `${value}` : kind;
    cards.push({
      id: `${color}-${suffix}-${copy}`,
      color,
      kind,
      ...(kind === KIND.NUMBER ? { value } : {}),
    });
  };

  for (const color of COLORS) {
    push(color, KIND.NUMBER, 0, 0);
    for (let value = 1; value <= 9; value += 1) {
      push(color, KIND.NUMBER, value, 0);
      push(color, KIND.NUMBER, value, 1);
    }
    for (const kind of [KIND.SKIP, KIND.REVERSE, KIND.DRAW2]) {
      push(color, kind, undefined, 0);
      push(color, kind, undefined, 1);
    }
  }
  for (let copy = 0; copy < 4; copy += 1) {
    push(WILD_COLOR, KIND.WILD, undefined, copy);
    push(WILD_COLOR, KIND.DRAW4, undefined, copy);
  }

  return cards;
}

/**
 * Mescola una copia dell'array con Fisher-Yates guidato dal seed.
 * @param {Array} cards
 * @param {number} seed
 * @returns {{cards: Array, seed: number}}
 */
export function shuffle(cards, seed) {
  const out = cards.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const [j, next] = nextInt(s, i + 1);
    s = next;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { cards: out, seed: s };
}

/**
 * Crea lo stato iniziale del mazzo.
 * @param {number} seed
 * @param {{rigged?: boolean}} [options] rigged porta le carte speciali in cima,
 *   utile per provare a mano tutti gli effetti senza aspettare la fortuna.
 * @returns {{draw: Array, discard: Array, seed: number}}
 */
export function createDeck(seed, options = {}) {
  const shuffled = shuffle(buildDeck(), seed);
  let draw = shuffled.cards;
  if (options.rigged) {
    const special = draw.filter((c) => c.kind !== KIND.NUMBER);
    const numbers = draw.filter((c) => c.kind === KIND.NUMBER);
    // Le carte si pescano dal fondo dell'array: le speciali vanno in coda.
    draw = numbers.concat(special);
  }
  return { draw, discard: [], seed: shuffled.seed };
}

/**
 * Pesca una carta. Se la pila di pescaggio è vuota rimescola gli scarti;
 * se anche gli scarti sono finiti ricostruisce un mazzo nuovo.
 * @param {{draw: Array, discard: Array, seed: number}} deck
 * @returns {{card: object, deck: {draw: Array, discard: Array, seed: number}}}
 */
export function drawCard(deck) {
  let { draw, discard, seed } = deck;

  if (draw.length === 0) {
    const source = discard.length > 0 ? discard : buildDeck();
    const reshuffled = shuffle(source, seed);
    draw = reshuffled.cards;
    discard = [];
    seed = reshuffled.seed;
  }

  const next = draw.slice();
  const card = next.pop();
  return { card, deck: { draw: next, discard, seed } };
}

/**
 * Sposta le carte indicate nella pila degli scarti.
 * @param {{draw: Array, discard: Array, seed: number}} deck
 * @param {Array} cards
 * @returns {{draw: Array, discard: Array, seed: number}}
 */
export function discardCards(deck, cards) {
  if (cards.length === 0) return deck;
  return { ...deck, discard: deck.discard.concat(cards) };
}
