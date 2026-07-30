/**
 * Definizione delle carte UNO e del loro valore in JackOne.
 * Modulo condiviso: importato sia dal server sia dal client.
 */

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const WILD_COLOR = 'wild';

export const KIND = {
  NUMBER: 'number',
  DRAW2: 'draw2',
  DRAW4: 'draw4',
  SKIP: 'skip',
  REVERSE: 'reverse',
  WILD: 'wild',
};

/** Punteggio da raggiungere senza superarlo. */
export const TARGET_SCORE = 21;
/** Il banco pesca finché resta sotto questa soglia. */
export const DEALER_STAND_SCORE = 17;
/** Fiches iniziali di ogni giocatore. */
export const START_CHIPS = 100;
/** Puntata minima per mano. */
export const MIN_BET = 5;
/** Moltiplicatore di vincita sul 21 esatto (2:1). */
export const EXACT_PAYOUT = 2;

/**
 * Punti che la carta aggiunge alla mano.
 * Numeri: valore nominale. Cambia colore: mezzo punto. Tutte le altre: zero.
 * @param {{kind: string, value?: number}} card
 * @returns {number}
 */
export function cardPoints(card) {
  if (card.kind === KIND.NUMBER) return card.value;
  if (card.kind === KIND.WILD) return 0.5;
  return 0;
}

/**
 * Numero di carte che la carta obbliga a pescare (0 se non è un "+N").
 * @param {{kind: string}} card
 * @returns {number}
 */
export function forcedDrawCount(card) {
  if (card.kind === KIND.DRAW2) return 2;
  if (card.kind === KIND.DRAW4) return 4;
  return 0;
}

/**
 * Etichetta breve mostrata sulla carta.
 * @param {{kind: string, value?: number}} card
 * @returns {string}
 */
export function cardLabel(card) {
  switch (card.kind) {
    case KIND.NUMBER: return String(card.value);
    case KIND.DRAW2: return '+2';
    case KIND.DRAW4: return '+4';
    case KIND.SKIP: return '⊘';
    case KIND.REVERSE: return '⇄';
    case KIND.WILD: return '★';
    default: return '?';
  }
}

/**
 * Descrizione testuale usata nel log della mano.
 * @param {{kind: string, color: string, value?: number}} card
 * @returns {string}
 */
export function cardName(card) {
  const colore = card.color === WILD_COLOR ? '' : ` ${COLOR_NAMES[card.color]}`;
  switch (card.kind) {
    case KIND.NUMBER: return `${card.value}${colore}`;
    case KIND.DRAW2: return `+2${colore}`;
    case KIND.DRAW4: return 'cambia colore +4';
    case KIND.SKIP: return `divieto${colore}`;
    case KIND.REVERSE: return `cambio giro${colore}`;
    case KIND.WILD: return 'cambia colore';
    default: return 'carta';
  }
}

export const COLOR_NAMES = {
  red: 'rosso',
  yellow: 'giallo',
  green: 'verde',
  blue: 'blu',
  wild: 'jolly',
};

/**
 * Formatta un punteggio che può avere mezzi punti (es. 17,5).
 * @param {number} score
 * @returns {string}
 */
export function formatScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1).replace('.', ',');
}
