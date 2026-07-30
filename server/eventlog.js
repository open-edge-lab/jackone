/**
 * Traduzione degli eventi di gioco in righe di log leggibili.
 * Il log vive nella stanza e viaggia dentro lo stato, così anche chi si
 * riconnette ritrova la cronologia della mano.
 */

import { EV } from '../shared/protocol.js';
import { cardName, formatScore } from '../shared/cards.js';
import { resultLabel } from './game/rules.js';

/**
 * @param {object} event evento prodotto dal motore
 * @returns {{text: string, kind: string}|null} riga di log, o null se l'evento
 *   non ha rilevanza narrativa
 */
export function describeEvent(event) {
  switch (event.type) {
    case EV.HAND_STARTED:
      return { kind: 'hand', text: `— Mano ${event.handNo} —` };
    case EV.BET_PLACED:
      return {
        kind: 'bet',
        text: `${event.name} punta ${event.amount}${event.auto ? ' (automatico)' : ''}`,
      };
    case EV.CARD_DRAWN:
      return {
        kind: event.forced ? 'forced' : 'draw',
        text: `${event.name} ${event.forced ? 'è costretto a pescare' : 'pesca'} ${cardName(event.card)} → ${formatScore(event.score)}`,
      };
    case EV.FORCED_DRAW:
      return { kind: 'forced', text: `${event.name} deve pescare ${event.pending} carte` };
    case EV.FORCED_DRAW_CANCELLED:
      return {
        kind: 'block',
        text: event.dealer
          ? 'Il banco annulla l\'obbligo con il divieto'
          : `${event.name} annulla l'obbligo con il divieto`,
      };
    case EV.CARD_DISCARDED:
      return {
        kind: 'discard',
        text: `Scartata ${cardName(event.card)}: le prime due carte non possono essere speciali`,
      };
    case EV.BLOCK_GAINED:
      return { kind: 'block', text: `${event.name} ottiene un gettone blocca-banco (${event.blocks})` };
    case EV.TURN_BLOCKED:
      return {
        kind: 'block',
        text: `${event.name} è bloccato dal divieto: turno chiuso a ${formatScore(event.score)}`,
      };
    case EV.SWAP_REQUIRED:
      return { kind: 'swap', text: `${event.name} deve scambiare la mano` };
    case EV.SWAP_DONE:
      return { kind: 'swap', text: `${event.name} scambia la mano con ${event.targetName}` };
    case EV.SWAP_NO_TARGET:
      return { kind: 'swap', text: `${event.name} pesca il cambio giro ma non ha bersagli` };
    case EV.PLAYER_BUST:
      return { kind: 'bust', text: `${event.name} sballa con ${formatScore(event.score)}` };
    case EV.PLAYER_STOOD:
      return { kind: 'stand', text: `${event.name} sta con ${formatScore(event.score)}` };
    case EV.DEALER_REVEAL:
      return { kind: 'dealer', text: `Il banco scopre le carte: ${formatScore(event.score)}` };
    case EV.DEALER_CARD:
      return { kind: 'dealer', text: `Il banco pesca ${cardName(event.card)} → ${formatScore(event.score)}` };
    case EV.DEALER_BUST:
      return { kind: 'bust', text: `Il banco sballa con ${formatScore(event.score)}` };
    case EV.DEALER_BLOCKED:
      return {
        kind: 'block',
        text: `${event.name} blocca il banco a ${formatScore(event.dealerScore)}`,
      };
    case EV.HAND_RESULT:
      return {
        kind: 'result',
        text: event.players
          .map((p) => `${p.name}: ${resultLabel(p.result)} (${p.delta >= 0 ? '+' : ''}${p.delta})`)
          .join(' · '),
      };
    case EV.PLAYER_ELIMINATED:
      return { kind: 'out', text: `${event.name} è senza fiches ed esce dalla partita` };
    case EV.GAME_OVER:
      return { kind: 'over', text: 'Partita conclusa' };
    case EV.PLAYER_JOINED:
      return { kind: 'join', text: `${event.name} entra al tavolo` };
    case EV.PLAYER_LEFT:
      return { kind: 'join', text: `${event.name} lascia il tavolo` };
    case EV.PLAYER_OFFLINE:
      return { kind: 'join', text: `${event.name} si è disconnesso` };
    case EV.PLAYER_ONLINE:
      return { kind: 'join', text: `${event.name} è tornato` };
    case EV.VIEWER_JOINED:
      return { kind: 'viewer', text: `${event.name} guarda la partita` };
    case EV.VIEWER_LEFT:
      return { kind: 'viewer', text: `${event.name} smette di guardare` };
    default:
      return null;
  }
}
