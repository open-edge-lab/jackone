/**
 * Proiezione dello stato di gioco verso un singolo client.
 *
 * Le mani dei giocatori sono pubbliche (servono per scegliere il bersaglio dello
 * scambio); l'unica informazione nascosta è la prima carta del banco finché non
 * viene scoperta.
 */

import { MIN_BET, TARGET_SCORE } from '../shared/cards.js';
import { PHASE } from '../shared/protocol.js';
import { STATUS, blockCandidates, dealerScore, seatScore, swapTargets } from './game/engine.js';
import { handScore } from './game/rules.js';

/** Carta segnaposto inviata al posto di quella coperta del banco. */
const HIDDEN_CARD = { id: 'hidden', hidden: true };

/** Carte degli scarti mostrate in cima alla pila. */
const DISCARD_PREVIEW = 4;

/**
 * Indirizzo della foto di un partecipante, o null se usa le iniziali.
 *
 * Le immagini non viaggiano nello stato — che viene ritrasmesso a ogni azione —
 * ma vengono scaricate una volta sola dal server HTTP. La versione nella query
 * serve a invalidare la cache del browser quando la foto cambia.
 * @param {object} room
 * @param {string} id
 * @returns {string|null}
 */
function avatarUrl(room, id) {
  const avatar = room.avatars.get(id);
  return avatar ? `/avatar/${room.code}/${id}?v=${avatar.version}` : null;
}

/**
 * @param {object} room
 * @param {string} playerId destinatario della proiezione
 * @returns {object} stato pronto da inviare
 */
export function projectState(room, playerId) {
  const state = room.state;
  const turnSeat = state.turnSeat >= 0 ? state.seats[state.turnSeat] : null;
  const you = state.seats.find((s) => s.id === playerId) ?? null;

  const dealerCards = state.dealer.holeRevealed
    ? state.dealer.cards
    : state.dealer.cards.map((card, index) => (index === 0 ? HIDDEN_CARD : card));
  const visibleDealerScore = state.dealer.holeRevealed
    ? dealerScore(state)
    : handScore(state.dealer.cards.slice(1));

  return {
    code: room.code,
    phase: state.phase,
    handNo: state.handNo,
    hostId: state.hostId,
    youId: playerId,
    minBet: MIN_BET,
    target: TARGET_SCORE,
    // Tempo residuo invece di una scadenza assoluta: gli orologi dei client
    // non devono essere allineati con quello del server.
    timer: {
      id: room.timerSeq,
      left: room.deadline ? Math.max(0, room.deadline - Date.now()) : 0,
    },
    turnPlayerId: turnSeat ? turnSeat.id : null,
    pendingDraw: state.pendingDraw,
    swap: state.swap
      ? { playerId: state.swap.playerId, targets: swapTargets(state, state.swap.playerId).map((t) => t.id) }
      : null,
    canBlock: state.phase === PHASE.DEALER_BLOCK_WINDOW
      && blockCandidates(state).some((s) => s.id === playerId),
    dealer: {
      cards: dealerCards,
      score: visibleDealerScore,
      revealed: state.dealer.holeRevealed,
      stopped: state.dealer.stopped,
      busted: state.dealer.busted,
    },
    // Le carte scartate sono già state viste da tutti: nessun mascheramento.
    discard: {
      count: state.deck.discard.length,
      top: state.deck.discard.slice(-DISCARD_PREVIEW),
    },
    players: state.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      colorIndex: seat.colorIndex,
      avatar: avatarUrl(room, seat.id),
      isBot: seat.isBot,
      connected: seat.connected,
      chips: seat.chips,
      bet: seat.bet,
      hasBet: seat.hasBet,
      cards: seat.cards,
      score: seatScore(seat),
      blocks: seat.blocks,
      status: seat.status,
      result: seat.result,
      delta: seat.delta,
      isYou: seat.id === playerId,
    })),
    // Solo gli ospiti effettivamente collegati: quelli caduti restano in
    // anagrafica per reggere un ricarico di pagina, ma non vanno mostrati.
    viewers: [...room.viewers.values()]
      .filter((viewer) => viewer.connected)
      .map((viewer) => ({
        id: viewer.id,
        name: viewer.name,
        colorIndex: viewer.colorIndex,
        avatar: avatarUrl(room, viewer.id),
        isYou: viewer.id === playerId,
      })),
    isViewer: room.isViewer(playerId),
    results: state.results,
    winnerId: state.winnerId,
    you: you
      ? {
        id: you.id,
        chips: you.chips,
        canBet: state.phase === PHASE.BETTING && you.status === STATUS.WAITING && !you.hasBet,
        canAct: state.phase === PHASE.PLAYER_TURN
          && turnSeat?.id === playerId
          && you.status === STATUS.PLAYING,
        mustSwap: state.phase === PHASE.AWAIT_SWAP && state.swap?.playerId === playerId,
      }
      : null,
    isHost: state.hostId === playerId,
    canStart: state.phase === PHASE.LOBBY
      && state.hostId === playerId
      && state.seats.length >= 1,
    log: room.log.slice(-60),
  };
}
