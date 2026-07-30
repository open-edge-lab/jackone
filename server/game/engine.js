/**
 * Motore di gioco di JackOne.
 *
 * È un riduttore puro e sincrono: `reduce(stato, azione)` restituisce il nuovo
 * stato più la lista di eventi accaduti. Non conosce socket, timer né I/O: i
 * timer vivono in `rooms.js` e si limitano a iniettare azioni. Tutto il
 * regolamento è quindi verificabile senza rete.
 */

import { EV, PHASE } from '../../shared/protocol.js';
import { KIND, MIN_BET, START_CHIPS, forcedDrawCount } from '../../shared/cards.js';
import { PLAYER_COLORS, preferredColorIndex } from '../../shared/identity.js';
import { createDeck, discardCards, drawCard, nextInt } from './deck.js';
import { dealerMustDraw, handScore, isBust, settle } from './rules.js';

/** Stato di un giocatore all'interno della mano. */
export const STATUS = {
  WAITING: 'waiting', // in attesa dell'inizio mano / della puntata
  PLAYING: 'playing', // sta giocando la mano
  STOOD: 'stood',     // ha detto "stai"
  BUST: 'bust',       // ha sballato
  OUT: 'out',         // senza fiches, eliminato dalla partita
};

/**
 * Crea la partita vuota, in lobby.
 * @param {{hostId: string, seed?: number, rigged?: boolean}} options
 * @returns {object} stato iniziale
 */
export function createGame({ hostId, seed = 1, rigged = false }) {
  return {
    phase: PHASE.LOBBY,
    hostId,
    handNo: 0,
    seats: [],
    turnSeat: -1,
    pendingDraw: 0,
    swap: null,
    dealer: { cards: [], holeRevealed: false, stopped: false, busted: false },
    deck: createDeck(seed, { rigged }),
    rigged,
    results: null,
    winnerId: null,
  };
}

/**
 * Applica un'azione allo stato.
 * @param {object} state
 * @param {{type: string}} action
 * @returns {{state: object, events: Array<object>}}
 */
export function reduce(state, action) {
  const draft = structuredClone(state);
  const events = [];

  switch (action.type) {
    case 'ADD_PLAYER': addPlayer(draft, events, action); break;
    case 'REMOVE_PLAYER': removePlayer(draft, events, action); break;
    case 'SET_CONNECTED': setConnected(draft, events, action); break;
    case 'START_GAME': startGame(draft, events); break;
    case 'BET': placeBet(draft, events, action); break;
    case 'AUTO_BET': autoBet(draft, events); break;
    case 'HIT': hit(draft, events, action); break;
    case 'STAND': stand(draft, events, action); break;
    case 'SWAP_TARGET': resolveSwap(draft, events, action); break;
    case 'AUTO_SWAP': autoSwap(draft, events); break;
    case 'USE_BLOCK': useBlock(draft, events, action); break;
    case 'BLOCK_TIMEOUT': closeBlockWindow(draft); break;
    case 'DEALER_STEP': dealerStep(draft, events); break;
    case 'NEXT_HAND': nextHand(draft, events); break;
    default: throw new Error(`Azione sconosciuta: ${action.type}`);
  }

  return { state: draft, events };
}

// ---------------------------------------------------------------- ricerche

/** @returns {object|undefined} */
export function findSeat(state, playerId) {
  return state.seats.find((s) => s.id === playerId);
}

/** @returns {number} punteggio corrente della mano del giocatore */
export function seatScore(seat) {
  return handScore(seat.cards);
}

/** @returns {number} punteggio corrente del banco */
export function dealerScore(state) {
  return handScore(state.dealer.cards);
}

/**
 * Giocatori che possono ricevere uno scambio mazzi: ancora in gioco e diversi
 * da chi ha pescato la carta.
 * @returns {Array<object>}
 */
export function swapTargets(state, playerId) {
  return state.seats.filter((s) => s.id !== playerId && s.status === STATUS.PLAYING);
}

/** @returns {Array<object>} giocatori che possono spendere un gettone sul banco */
export function blockCandidates(state) {
  return state.seats.filter((s) => s.status === STATUS.STOOD && s.blocks > 0);
}

/** @returns {Array<object>} giocatori ancora in partita (con fiches) */
function activeSeats(state) {
  return state.seats.filter((s) => s.status !== STATUS.OUT);
}

// ------------------------------------------------------------ lobby / posti

/**
 * Colore del posto: si parte da quello suggerito dal nickname e si scorre finché
 * se ne trova uno libero, così al tavolo non ci sono mai due colori uguali.
 */
function pickColorIndex(draft, name) {
  const used = new Set(draft.seats.map((seat) => seat.colorIndex));
  const preferred = preferredColorIndex(name);
  for (let step = 0; step < PLAYER_COLORS.length; step += 1) {
    const candidate = (preferred + step) % PLAYER_COLORS.length;
    if (!used.has(candidate)) return candidate;
  }
  return preferred;
}

function addPlayer(draft, events, { id, name, isBot = false }) {
  if (draft.seats.some((s) => s.id === id)) return;
  draft.seats.push({
    id,
    name,
    isBot,
    colorIndex: pickColorIndex(draft, name),
    connected: true,
    chips: START_CHIPS,
    bet: 0,
    hasBet: false,
    cards: [],
    blocks: 0,
    status: STATUS.WAITING,
    result: null,
    delta: 0,
  });
  events.push({ type: EV.PLAYER_JOINED, playerId: id, name });
}

function removePlayer(draft, events, { id }) {
  const seat = findSeat(draft, id);
  if (!seat) return;
  const wasCurrent = draft.phase !== PHASE.LOBBY
    && draft.turnSeat >= 0
    && draft.seats[draft.turnSeat]?.id === id;

  draft.deck = discardCards(draft.deck, seat.cards);
  draft.seats = draft.seats.filter((s) => s.id !== id);
  events.push({ type: EV.PLAYER_LEFT, playerId: id, name: seat.name });

  if (draft.hostId === id) {
    const heir = draft.seats.find((s) => !s.isBot);
    draft.hostId = heir ? heir.id : null;
  }
  if (draft.phase === PHASE.LOBBY) return;

  if (draft.swap && draft.swap.playerId === id) {
    draft.swap = null;
    draft.pendingDraw = 0;
    draft.phase = PHASE.PLAYER_TURN;
  }
  if (wasCurrent) {
    draft.turnSeat -= 1; // l'array si è accorciato: riparti dal posto precedente
    advanceTurn(draft, events);
  } else if (draft.phase === PHASE.BETTING) {
    maybeDeal(draft, events);
  } else if (draft.phase === PHASE.PLAYER_TURN && draft.pendingDraw === 0) {
    // Nessun altro può giocare: passa al banco.
    if (!draft.seats.some((s) => s.status === STATUS.PLAYING)) startDealerPhase(draft, events);
  }
}

function setConnected(draft, events, { id, connected }) {
  const seat = findSeat(draft, id);
  if (!seat || seat.connected === connected) return;
  seat.connected = connected;
  events.push({
    type: connected ? EV.PLAYER_ONLINE : EV.PLAYER_OFFLINE,
    playerId: id,
    name: seat.name,
  });
}

function startGame(draft, events) {
  // Ammesso anche a partita conclusa: l'host può rilanciare senza rifare la stanza.
  if (draft.phase !== PHASE.LOBBY && draft.phase !== PHASE.GAME_OVER) return;
  draft.handNo = 0;
  draft.winnerId = null;
  for (const seat of draft.seats) {
    seat.chips = START_CHIPS;
    seat.status = STATUS.WAITING;
  }
  startBetting(draft, events);
}

// ------------------------------------------------------------------ puntate

function startBetting(draft, events) {
  draft.handNo += 1;
  draft.phase = PHASE.BETTING;
  draft.turnSeat = -1;
  draft.pendingDraw = 0;
  draft.swap = null;
  draft.results = null;
  draft.dealer = { cards: [], holeRevealed: false, stopped: false, busted: false };

  for (const seat of draft.seats) {
    draft.deck = discardCards(draft.deck, seat.cards);
    seat.cards = [];
    seat.blocks = 0;
    seat.bet = 0;
    seat.hasBet = false;
    seat.result = null;
    seat.delta = 0;
    seat.status = seat.chips > 0 ? STATUS.WAITING : STATUS.OUT;
  }
  events.push({ type: EV.HAND_STARTED, handNo: draft.handNo });
}

/** Limita la puntata tra il minimo e le fiches disponibili (all-in se sotto il minimo). */
function clampBet(amount, chips) {
  const floor = Math.min(MIN_BET, chips);
  const value = Number.isFinite(amount) ? Math.floor(amount) : floor;
  return Math.max(floor, Math.min(value, chips));
}

function placeBet(draft, events, { playerId, amount }) {
  if (draft.phase !== PHASE.BETTING) return;
  const seat = findSeat(draft, playerId);
  if (!seat || seat.status !== STATUS.WAITING || seat.hasBet) return;

  seat.bet = clampBet(amount, seat.chips);
  seat.hasBet = true;
  events.push({ type: EV.BET_PLACED, playerId, name: seat.name, amount: seat.bet });
  maybeDeal(draft, events);
}

function autoBet(draft, events) {
  if (draft.phase !== PHASE.BETTING) return;
  for (const seat of draft.seats) {
    if (seat.status === STATUS.WAITING && !seat.hasBet) {
      seat.bet = clampBet(MIN_BET, seat.chips);
      seat.hasBet = true;
      events.push({ type: EV.BET_PLACED, playerId: seat.id, name: seat.name, amount: seat.bet, auto: true });
    }
  }
  maybeDeal(draft, events);
}

function maybeDeal(draft, events) {
  const waiting = draft.seats.filter((s) => s.status === STATUS.WAITING);
  if (waiting.length === 0 || waiting.some((s) => !s.hasBet)) return;
  deal(draft, events);
}

// -------------------------------------------------------------- distribuzione

/**
 * Tentativi massimi di pescata iniziale prima di accettare quel che esce.
 *
 * Serve a tenere il riduttore totale: `drawCard` rimescola gli scarti quando la
 * pila si svuota, quindi un mazzo di sole speciali cicerebbe all'infinito.
 *
 * Il mazzo UNO ha 32 carte non numeriche su 108: anche trovandole tutte in fila
 * — è esattamente ciò che succede con `--rigged` — al trentatreesimo tentativo
 * esce per forza un numero. Il margine tiene fuori il ripiego dal gioco vero.
 */
const INITIAL_DRAW_ATTEMPTS = 40;

/**
 * Pesca una carta iniziale: le speciali finiscono negli scarti e si ripesca,
 * perché le prime due carte devono valere punti.
 *
 * Con `--rigged` le speciali stanno in cima al mazzo, quindi qui se ne scartano
 * parecchie: la modalità resta utile per gli effetti in gioco, non per le
 * carte iniziali.
 *
 * @param {object} deck stato del mazzo
 * @param {Array<object>} events eventi a cui aggiungere gli scarti
 * @param {object} owner intestazione dell'evento (`{playerId}` o `{dealer: true}`)
 * @returns {{card: object, deck: object}}
 */
function drawInitialCard(deck, events, owner) {
  let current = deck;

  for (let attempt = 0; attempt < INITIAL_DRAW_ATTEMPTS; attempt += 1) {
    const { card, deck: next } = drawCard(current);
    current = next;
    if (card.kind === KIND.NUMBER) return { card, deck: current };

    current = discardCards(current, [card]);
    events.push({ type: EV.CARD_DISCARDED, card, ...owner });
  }

  const { card, deck: next } = drawCard(current);
  return { card, deck: next };
}

function deal(draft, events) {
  const players = draft.seats.filter((s) => s.status === STATUS.WAITING);
  for (const seat of players) seat.status = STATUS.PLAYING;

  // Due giri di carte. Le iniziali sono sempre numeri: le speciali che escono
  // vengono scartate e rimpiazzate, così nessuno parte con carte da zero punti.
  for (let round = 0; round < 2; round += 1) {
    for (const seat of players) {
      const { card, deck } = drawInitialCard(draft.deck, events, { playerId: seat.id });
      draft.deck = deck;
      seat.cards.push(card);
      events.push({ type: EV.CARD_DEALT, playerId: seat.id, card, score: seatScore(seat) });
    }
    const { card, deck } = drawInitialCard(draft.deck, events, { dealer: true });
    draft.deck = deck;
    draft.dealer.cards.push(card);
    events.push({ type: EV.CARD_DEALT, dealer: true, card, hidden: round === 0 });
  }

  draft.phase = PHASE.PLAYER_TURN;
  draft.turnSeat = -1;
  advanceTurn(draft, events);
}

// -------------------------------------------------------------- turni umani

function currentSeat(draft) {
  return draft.turnSeat >= 0 ? draft.seats[draft.turnSeat] : undefined;
}

/** Passa al prossimo giocatore ancora in gioco; se non ce ne sono, tocca al banco. */
function advanceTurn(draft, events) {
  for (let i = draft.turnSeat + 1; i < draft.seats.length; i += 1) {
    if (draft.seats[i].status === STATUS.PLAYING) {
      draft.turnSeat = i;
      draft.pendingDraw = 0;
      draft.phase = PHASE.PLAYER_TURN;
      return;
    }
  }
  draft.turnSeat = -1;
  draft.pendingDraw = 0;
  startDealerPhase(draft, events);
}

function hit(draft, events, { playerId }) {
  if (draft.phase !== PHASE.PLAYER_TURN) return;
  const seat = currentSeat(draft);
  if (!seat || seat.id !== playerId || seat.status !== STATUS.PLAYING) return;

  drawForSeat(draft, events, seat, false);
  resolveForcedDraws(draft, events);
  if (draft.phase === PHASE.PLAYER_TURN && seat.status !== STATUS.PLAYING) {
    advanceTurn(draft, events);
  }
}

function stand(draft, events, { playerId }) {
  if (draft.phase !== PHASE.PLAYER_TURN || draft.pendingDraw > 0) return;
  const seat = currentSeat(draft);
  if (!seat || seat.id !== playerId || seat.status !== STATUS.PLAYING) return;

  seat.status = STATUS.STOOD;
  events.push({ type: EV.PLAYER_STOOD, playerId, name: seat.name, score: seatScore(seat) });
  advanceTurn(draft, events);
}

/**
 * Pesca una carta per il giocatore e ne risolve subito l'effetto.
 * @returns {'ok'|'bust'|'await'|'blocked'} esito della pescata
 */
function drawForSeat(draft, events, seat, forced) {
  const { card, deck } = drawCard(draft.deck);
  draft.deck = deck;
  seat.cards.push(card);
  const score = seatScore(seat);
  events.push({ type: EV.CARD_DRAWN, playerId: seat.id, name: seat.name, card, score, forced });

  if (isBust(score)) {
    seat.status = STATUS.BUST;
    draft.pendingDraw = 0;
    events.push({ type: EV.PLAYER_BUST, playerId: seat.id, name: seat.name, score });
    return 'bust';
  }

  const forcedCount = forcedDrawCount(card);
  if (forcedCount > 0) {
    draft.pendingDraw += forcedCount;
    events.push({
      type: EV.FORCED_DRAW,
      playerId: seat.id,
      name: seat.name,
      amount: forcedCount,
      pending: draft.pendingDraw,
    });
    return 'ok';
  }

  // Il divieto blocca chi lo pesca: annulla l'obbligo di pescaggio oppure lascia
  // un gettone, e in ogni caso chiude subito il turno con il punteggio raggiunto.
  if (card.kind === KIND.SKIP) {
    if (draft.pendingDraw > 0) {
      draft.pendingDraw = 0;
      events.push({ type: EV.FORCED_DRAW_CANCELLED, playerId: seat.id, name: seat.name });
    } else {
      seat.blocks += 1;
      events.push({ type: EV.BLOCK_GAINED, playerId: seat.id, name: seat.name, blocks: seat.blocks });
    }
    seat.status = STATUS.STOOD;
    events.push({ type: EV.TURN_BLOCKED, playerId: seat.id, name: seat.name, score });
    return 'blocked';
  }

  if (card.kind === KIND.REVERSE) {
    const targets = swapTargets(draft, seat.id);
    if (targets.length === 0) {
      events.push({ type: EV.SWAP_NO_TARGET, playerId: seat.id, name: seat.name });
      return 'ok';
    }
    draft.phase = PHASE.AWAIT_SWAP;
    draft.swap = { playerId: seat.id };
    events.push({
      type: EV.SWAP_REQUIRED,
      playerId: seat.id,
      name: seat.name,
      targets: targets.map((t) => t.id),
    });
    return 'await';
  }

  return 'ok';
}

/** Esaurisce l'obbligo di pescaggio accumulato dai "+N", una carta alla volta. */
function resolveForcedDraws(draft, events) {
  while (draft.phase === PHASE.PLAYER_TURN && draft.pendingDraw > 0) {
    const seat = currentSeat(draft);
    if (!seat || seat.status !== STATUS.PLAYING) {
      draft.pendingDraw = 0;
      return;
    }
    draft.pendingDraw -= 1;
    drawForSeat(draft, events, seat, true);
  }
}

// ----------------------------------------------------------- scambio mazzi

function resolveSwap(draft, events, { playerId, targetId }) {
  if (draft.phase !== PHASE.AWAIT_SWAP || !draft.swap) return;
  if (draft.swap.playerId !== playerId) return;

  const source = findSeat(draft, playerId);
  const target = swapTargets(draft, playerId).find((t) => t.id === targetId);
  if (!source || !target) return;

  const cards = source.cards;
  const blocks = source.blocks;
  source.cards = target.cards;
  source.blocks = target.blocks;
  target.cards = cards;
  target.blocks = blocks;

  draft.swap = null;
  draft.phase = PHASE.PLAYER_TURN;
  events.push({
    type: EV.SWAP_DONE,
    playerId,
    name: source.name,
    targetId,
    targetName: target.name,
    scores: { [source.id]: seatScore(source), [target.id]: seatScore(target) },
  });

  // Entrambe le mani erano sotto 21 (chi sballa esce subito), quindi lo scambio
  // non può far sballare nessuno: si riprende l'eventuale obbligo di pescaggio.
  resolveForcedDraws(draft, events);
  if (draft.phase === PHASE.PLAYER_TURN && source.status !== STATUS.PLAYING) {
    advanceTurn(draft, events);
  }
}

function autoSwap(draft, events) {
  if (draft.phase !== PHASE.AWAIT_SWAP || !draft.swap) return;
  const targets = swapTargets(draft, draft.swap.playerId);
  if (targets.length === 0) {
    draft.swap = null;
    draft.phase = PHASE.PLAYER_TURN;
    return;
  }
  const [index, seed] = nextInt(draft.deck.seed, targets.length);
  draft.deck = { ...draft.deck, seed };
  resolveSwap(draft, events, { playerId: draft.swap.playerId, targetId: targets[index].id });
}

// ------------------------------------------------------------------- banco

function startDealerPhase(draft, events) {
  draft.turnSeat = -1;
  draft.pendingDraw = 0;

  // Se hanno sballato tutti, il banco non gioca: la mano è già decisa.
  if (!draft.seats.some((s) => s.status === STATUS.STOOD)) {
    finishHand(draft, events);
    return;
  }

  draft.dealer.holeRevealed = true;
  events.push({
    type: EV.DEALER_REVEAL,
    cards: draft.dealer.cards,
    score: dealerScore(draft),
  });
  openDealerStep(draft, events);
}

/** Decide se aprire la finestra dei gettoni, pescare, o chiudere la mano. */
function openDealerStep(draft, events) {
  if (!dealerMustDraw(dealerScore(draft), draft.dealer.stopped)) {
    finishHand(draft, events);
    return;
  }
  draft.phase = blockCandidates(draft).length > 0
    ? PHASE.DEALER_BLOCK_WINDOW
    : PHASE.DEALER_DRAW;
}

function useBlock(draft, events, { playerId }) {
  if (draft.phase !== PHASE.DEALER_BLOCK_WINDOW) return;
  const seat = findSeat(draft, playerId);
  if (!seat || seat.status !== STATUS.STOOD || seat.blocks <= 0) return;

  seat.blocks -= 1;
  draft.dealer.stopped = true;
  events.push({
    type: EV.DEALER_BLOCKED,
    playerId,
    name: seat.name,
    dealerScore: dealerScore(draft),
  });
  finishHand(draft, events);
}

function closeBlockWindow(draft) {
  if (draft.phase !== PHASE.DEALER_BLOCK_WINDOW) return;
  draft.phase = PHASE.DEALER_DRAW;
}

function dealerStep(draft, events) {
  if (draft.phase !== PHASE.DEALER_DRAW) return;

  let pending = 1; // la pescata normale del banco, più eventuali obblighi accumulati
  while (pending > 0) {
    pending -= 1;
    const { card, deck } = drawCard(draft.deck);
    draft.deck = deck;
    draft.dealer.cards.push(card);
    const score = dealerScore(draft);
    events.push({ type: EV.DEALER_CARD, card, score });

    if (isBust(score)) {
      draft.dealer.busted = true;
      events.push({ type: EV.DEALER_BUST, score });
      finishHand(draft, events);
      return;
    }
    // Il divieto annulla gli obblighi accumulati ma non ferma il banco, che
    // riprende subito la regola normale (pesca fino a 17). Solo un gettone
    // speso da un giocatore può congelarlo. Il cambio giro resta senza effetto.
    if (card.kind === KIND.SKIP && pending > 0) {
      pending = 0;
      events.push({ type: EV.FORCED_DRAW_CANCELLED, dealer: true });
    }
    pending += forcedDrawCount(card);
  }

  openDealerStep(draft, events);
}

// ------------------------------------------------------------ fine mano

function finishHand(draft, events) {
  const dScore = dealerScore(draft);
  const dealer = { score: dScore, busted: draft.dealer.busted || isBust(dScore) };
  const results = [];

  for (const seat of draft.seats) {
    if (seat.status !== STATUS.STOOD && seat.status !== STATUS.BUST) continue;
    const score = seatScore(seat);
    const { result, delta } = settle(
      { score, busted: seat.status === STATUS.BUST, bet: seat.bet },
      dealer,
    );
    seat.chips = Math.max(0, seat.chips + delta);
    seat.result = result;
    seat.delta = delta;
    results.push({ playerId: seat.id, name: seat.name, score, result, delta, chips: seat.chips });
  }

  draft.results = { dealerScore: dScore, dealerBusted: dealer.busted, players: results };
  draft.phase = PHASE.PAYOUT;
  events.push({ type: EV.HAND_RESULT, ...draft.results });

  for (const seat of draft.seats) {
    if (seat.chips <= 0 && seat.status !== STATUS.OUT) {
      seat.status = STATUS.OUT;
      events.push({ type: EV.PLAYER_ELIMINATED, playerId: seat.id, name: seat.name });
    }
  }

  const survivors = activeSeats(draft);
  if (survivors.length <= 1) {
    draft.phase = PHASE.GAME_OVER;
    draft.winnerId = survivors[0]?.id ?? null;
    events.push({
      type: EV.GAME_OVER,
      winnerId: draft.winnerId,
      standings: draft.seats
        .map((s) => ({ playerId: s.id, name: s.name, chips: s.chips }))
        .sort((a, b) => b.chips - a.chips),
    });
  }
}

function nextHand(draft, events) {
  if (draft.phase !== PHASE.PAYOUT) return;
  startBetting(draft, events);
}
