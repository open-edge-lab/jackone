/**
 * Regole di punteggio e di pagamento di JackOne. Funzioni pure, nessuno stato.
 */

import {
  cardPoints,
  EXACT_PAYOUT,
  TARGET_SCORE,
  DEALER_STAND_SCORE,
} from '../../shared/cards.js';

/** Esiti possibili di una mano per un giocatore. */
export const RESULT = {
  EXACT: 'EXACT',   // 21 esatto, paga 2:1
  WIN: 'WIN',       // batte il banco, paga 1:1
  PUSH: 'PUSH',     // pareggio, puntata restituita
  LOSE: 'LOSE',     // punteggio inferiore al banco
  BUST: 'BUST',     // sballato
};

/**
 * Somma dei punti di una mano. I mezzi punti dei cambia colore sono arrotondati
 * al decimo per evitare la deriva dei float.
 * @param {Array<object>} cards
 * @returns {number}
 */
export function handScore(cards) {
  const total = cards.reduce((sum, card) => sum + cardPoints(card), 0);
  return Math.round(total * 10) / 10;
}

/**
 * @param {number} score
 * @returns {boolean} true se il punteggio ha superato 21
 */
export function isBust(score) {
  return score > TARGET_SCORE;
}

/**
 * @param {number} score
 * @returns {boolean} true se il punteggio è esattamente 21
 */
export function isExact(score) {
  return score === TARGET_SCORE;
}

/**
 * @param {number} score punteggio attuale del banco
 * @param {boolean} stopped true se un gettone ha fermato il banco
 * @returns {boolean} true se il banco deve pescare un'altra carta
 */
export function dealerMustDraw(score, stopped) {
  return !stopped && !isBust(score) && score < DEALER_STAND_SCORE;
}

/**
 * Calcola l'esito di un giocatore contro il banco e la variazione di fiches.
 *
 * Il 21 esatto vince sempre 2:1, anche se il banco arriva a sua volta a 21.
 *
 * @param {{score: number, busted: boolean, bet: number}} player
 * @param {{score: number, busted: boolean}} dealer
 * @returns {{result: string, delta: number}} delta è il guadagno netto in fiches
 */
export function settle(player, dealer) {
  if (player.busted) return { result: RESULT.BUST, delta: -player.bet };
  if (isExact(player.score)) return { result: RESULT.EXACT, delta: player.bet * EXACT_PAYOUT };
  if (dealer.busted) return { result: RESULT.WIN, delta: player.bet };
  if (player.score > dealer.score) return { result: RESULT.WIN, delta: player.bet };
  if (player.score === dealer.score) return { result: RESULT.PUSH, delta: 0 };
  return { result: RESULT.LOSE, delta: -player.bet };
}

/**
 * Etichetta italiana dell'esito, usata nel riepilogo di fine mano.
 * @param {string} result
 * @returns {string}
 */
export function resultLabel(result) {
  switch (result) {
    case RESULT.EXACT: return 'JackOne! 21 esatto';
    case RESULT.WIN: return 'Vince';
    case RESULT.PUSH: return 'Pareggio';
    case RESULT.LOSE: return 'Perde';
    case RESULT.BUST: return 'Sballato';
    default: return '—';
  }
}
