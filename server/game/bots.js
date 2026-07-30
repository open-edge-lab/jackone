/**
 * Giocatori automatici.
 *
 * La stessa logica serve due casi: i bot aggiunti dall'host e i giocatori umani
 * disconnessi, che vengono giocati in automatico per non bloccare il tavolo.
 * Gli umani offline usano una politica prudente (punta il minimo, sta subito).
 */

import { MIN_BET, TARGET_SCORE } from '../../shared/cards.js';
import { PHASE } from '../../shared/protocol.js';
import { STATUS, blockCandidates, dealerScore, seatScore, swapTargets } from './engine.js';

/** Soglia oltre la quale il bot smette di chiedere carte. */
const BOT_STAND_FROM = 18;

/** Ritardi (ms) per rendere leggibili le mosse automatiche. */
const DELAY = { BET: 500, TURN: 900, SWAP: 900, BLOCK: 800, OFFLINE: 1500 };

/** Un posto è giocato dal server se è un bot o se l'umano è offline. */
export function isAuto(seat) {
  return seat.isBot || !seat.connected;
}

/**
 * Prossima mossa automatica da eseguire, se ce n'è una.
 * @param {object} state stato del motore
 * @returns {{action: object, delay: number}|null}
 */
export function autoAction(state) {
  switch (state.phase) {
    case PHASE.BETTING: {
      const seat = state.seats.find((s) => s.status === STATUS.WAITING && !s.hasBet && isAuto(s));
      if (!seat) return null;
      return {
        action: { type: 'BET', playerId: seat.id, amount: betAmount(seat) },
        delay: seat.isBot ? DELAY.BET : DELAY.OFFLINE,
      };
    }

    case PHASE.PLAYER_TURN: {
      const seat = state.seats[state.turnSeat];
      if (!seat || seat.status !== STATUS.PLAYING || !isAuto(seat)) return null;
      const wantsCard = seat.isBot && seatScore(seat) < BOT_STAND_FROM;
      return {
        action: { type: wantsCard ? 'HIT' : 'STAND', playerId: seat.id },
        delay: seat.isBot ? DELAY.TURN : DELAY.OFFLINE,
      };
    }

    case PHASE.AWAIT_SWAP: {
      const seat = state.seats.find((s) => s.id === state.swap?.playerId);
      if (!seat || !isAuto(seat)) return null;
      const targets = swapTargets(state, seat.id);
      if (targets.length === 0) return null;
      // Ruba la mano migliore fra quelle che non hanno ancora sballato.
      const best = targets.reduce((a, b) => (seatScore(b) > seatScore(a) ? b : a));
      return {
        action: { type: 'SWAP_TARGET', playerId: seat.id, targetId: best.id },
        delay: seat.isBot ? DELAY.SWAP : DELAY.OFFLINE,
      };
    }

    case PHASE.DEALER_BLOCK_WINDOW: {
      const dScore = dealerScore(state);
      const seat = blockCandidates(state).find(
        (s) => s.isBot && seatScore(s) <= TARGET_SCORE && dScore < seatScore(s),
      );
      if (!seat) return null;
      return { action: { type: 'USE_BLOCK', playerId: seat.id }, delay: DELAY.BLOCK };
    }

    default:
      return null;
  }
}

/** Puntata del giocatore automatico: un decimo dello stack, mai sotto il minimo. */
function betAmount(seat) {
  if (!seat.isBot) return MIN_BET;
  return Math.max(MIN_BET, Math.min(seat.chips, Math.round(seat.chips / 10)));
}

/** Nomi assegnati ai bot in ordine di aggiunta. */
export const BOT_NAMES = ['Ada', 'Bruno', 'Cleo', 'Dino', 'Elsa'];
