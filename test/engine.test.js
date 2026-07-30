import test from 'node:test';
import assert from 'node:assert/strict';

import { PHASE } from '../shared/protocol.js';
import { STATUS, createGame, findSeat, reduce, seatScore } from '../server/game/engine.js';

let uid = 0;
const num = (value, color = 'red') => ({ id: `t${uid += 1}`, color, kind: 'number', value });
const skip = (color = 'red') => ({ id: `t${uid += 1}`, color, kind: 'skip' });
const reverse = (color = 'red') => ({ id: `t${uid += 1}`, color, kind: 'reverse' });
const draw2 = (color = 'red') => ({ id: `t${uid += 1}`, color, kind: 'draw2' });
const draw4 = () => ({ id: `t${uid += 1}`, color: 'wild', kind: 'draw4' });
const wild = () => ({ id: `t${uid += 1}`, color: 'wild', kind: 'wild' });

/** Il mazzo si pesca dal fondo: l'array viene rovesciato per rispettare l'ordine dato. */
const mkDeck = (cards) => ({ draw: cards.slice().reverse(), discard: [], seed: 1 });

/** Applica una sequenza di azioni restituendo stato ed eventi accumulati. */
function run(state, ...actions) {
  let current = state;
  const events = [];
  for (const action of actions) {
    const out = reduce(current, action);
    current = out.state;
    events.push(...out.events);
  }
  return { state: current, events };
}

/**
 * Prepara una mano già distribuita.
 * `cards` viene consumato nell'ordine: giro 1 (giocatori, banco), giro 2, poi le pescate.
 */
function dealt(cards, players = ['A', 'B'], bet = 10) {
  let state = createGame({ hostId: players[0], seed: 1 });
  for (const id of players) state = reduce(state, { type: 'ADD_PLAYER', id, name: id }).state;
  state = reduce(state, { type: 'START_GAME' }).state;
  state.deck = mkDeck(cards);
  for (const id of players) {
    state = reduce(state, { type: 'BET', playerId: id, amount: bet }).state;
  }
  return state;
}

const seat = (state, id) => findSeat(state, id);

test('la distribuzione dà due carte a testa e due al banco', () => {
  const state = dealt([num(2), num(3), num(5), num(4), num(6), num(8)]);
  assert.equal(state.phase, PHASE.PLAYER_TURN);
  assert.equal(seat(state, 'A').cards.length, 2);
  assert.equal(seat(state, 'B').cards.length, 2);
  assert.equal(state.dealer.cards.length, 2);
  assert.equal(state.pendingDraw, 0);
  assert.equal(state.swap, null);
  assert.equal(seatScore(seat(state, 'A')), 2 + 4);
  assert.equal(seatScore(seat(state, 'B')), 3 + 6);
});

test('le speciali non arrivano mai fra le carte iniziali: vengono scartate', () => {
  // Giro 1: A=2, B=3, banco=5. Giro 2: escono un +4, un divieto e un cambio
  // giro, che finiscono negli scarti e vengono rimpiazzati dai numeri seguenti.
  const state = dealt([
    num(2), num(3), num(5),
    draw4(), num(4), skip(), num(6), reverse(), num(8),
  ]);

  const hands = [...seat(state, 'A').cards, ...seat(state, 'B').cards, ...state.dealer.cards];
  assert.equal(hands.length, 6);
  assert.ok(hands.every((c) => c.kind === 'number'), 'nessuna speciale in mano a nessuno');
  assert.equal(seatScore(seat(state, 'A')), 2 + 4);
  assert.equal(seatScore(seat(state, 'B')), 3 + 6);

  const scarti = state.deck.discard.map((c) => c.kind);
  assert.deepEqual(scarti, ['draw4', 'skip', 'reverse'], 'le speciali finiscono negli scarti');
  assert.equal(state.pendingDraw, 0, 'il +4 scartato non obbliga nessuno a pescare');
  assert.equal(seat(state, 'A').blocks, 0, 'il divieto scartato non dà gettoni');
  assert.equal(state.swap, null, 'il cambio giro scartato non forza scambi');
});

test('nemmeno con tutte le speciali in cima al mazzo ne passa una', () => {
  // `rigged` mette in cima le 32 carte non numeriche del mazzo UNO: è il caso
  // peggiore possibile per il tetto ai tentativi di pescata iniziale.
  let state = createGame({ hostId: 'A', seed: 7, rigged: true });
  for (const id of ['A', 'B', 'C']) {
    state = reduce(state, { type: 'ADD_PLAYER', id, name: id }).state;
  }
  state = reduce(state, { type: 'START_GAME' }).state;
  for (const id of ['A', 'B', 'C']) {
    state = reduce(state, { type: 'BET', playerId: id, amount: 10 }).state;
  }

  const iniziali = [
    ...['A', 'B', 'C'].flatMap((id) => seat(state, id).cards),
    ...state.dealer.cards,
  ];
  assert.equal(iniziali.length, 8, 'tre giocatori e il banco, due carte a testa');
  assert.deepEqual(
    iniziali.filter((c) => c.kind !== 'number'),
    [],
    'nessuna speciale deve sfuggire al filtro',
  );
});

test('ogni carta iniziale scartata produce un evento con il suo destinatario', () => {
  let state = createGame({ hostId: 'A', seed: 1 });
  for (const id of ['A', 'B']) state = reduce(state, { type: 'ADD_PLAYER', id, name: id }).state;
  state = reduce(state, { type: 'START_GAME' }).state;
  state.deck = mkDeck([
    skip(), num(2), num(3), num(5),      // la prima carta di A viene scartata
    num(4), num(6), draw4(), num(8),     // la carta del banco del secondo giro pure
  ]);
  state = reduce(state, { type: 'BET', playerId: 'A', amount: 10 }).state;
  const { events } = reduce(state, { type: 'BET', playerId: 'B', amount: 10 });

  const scarti = events.filter((e) => e.type === 'CARD_DISCARDED');
  assert.equal(scarti.length, 2);
  assert.equal(scarti[0].card.kind, 'skip');
  assert.equal(scarti[0].playerId, 'A', 'lo scarto porta il posto a cui era destinata la carta');
  assert.equal(scarti[1].card.kind, 'draw4');
  assert.equal(scarti[1].dealer, true, 'anche il banco ripesca le speciali iniziali');
});

test('il "+N" concatena gli obblighi di pescaggio', () => {
  const start = dealt([
    num(2), num(3), num(5), num(2), num(3), num(5), // distribuzione: A=4, B=6, banco=10
    draw2(), draw2(), num(1), num(1), num(1),
  ]);
  const { state } = run(start, { type: 'HIT', playerId: 'A' });
  const a = seat(state, 'A');

  assert.equal(a.cards.length, 7, 'due iniziali + il +2 pescato + quattro carte obbligate');
  assert.equal(seatScore(a), 7);
  assert.equal(state.pendingDraw, 0);
  assert.equal(a.status, STATUS.PLAYING, 'il turno prosegue dopo aver esaurito l\'obbligo');
});

test('il divieto pescato durante un obbligo lo azzera e chiude comunque il turno', () => {
  const start = dealt([
    num(2), num(3), num(5), num(2), num(3), num(5),
    draw4(), skip(), num(9), num(9), num(9),
  ]);
  const { state } = run(start, { type: 'HIT', playerId: 'A' });
  const a = seat(state, 'A');

  assert.equal(state.pendingDraw, 0);
  assert.equal(a.cards.length, 4, 'il +4 e il divieto, poi lo stop');
  assert.equal(seatScore(a), 4, 'nessuna delle due carte dà punti');
  assert.equal(a.blocks, 0, 'usato come scudo, non diventa gettone');
  assert.equal(a.status, STATUS.STOOD, 'il divieto chiude il turno anche da carta obbligata');
  assert.equal(state.seats[state.turnSeat].id, 'B', 'la mano passa al giocatore successivo');
});

test('il divieto pescato a vuoto dà un gettone e chiude il turno', () => {
  const start = dealt([num(2), num(3), num(5), num(2), num(3), num(5), skip()]);
  const { state, events } = run(start, { type: 'HIT', playerId: 'A' });
  const a = seat(state, 'A');

  assert.equal(a.blocks, 1);
  assert.equal(seatScore(a), 4);
  assert.equal(a.status, STATUS.STOOD, 'chi pesca il divieto non può più chiedere carta');
  assert.equal(state.seats[state.turnSeat].id, 'B');
  const blocked = events.find((e) => e.type === 'TURN_BLOCKED');
  assert.ok(blocked, 'il blocco viene annunciato');
  assert.equal(blocked.score, 4, 'il punteggio resta quello raggiunto');
});

test('il cambio giro obbliga a scambiare l\'intera mano', () => {
  const start = dealt([
    num(2), num(9), num(5), num(2), num(9), num(5), // A=4, B=18
    reverse(),
  ]);
  const afterHit = run(start, { type: 'HIT', playerId: 'A' }).state;
  assert.equal(afterHit.phase, PHASE.AWAIT_SWAP);
  assert.equal(afterHit.swap.playerId, 'A');

  const { state } = run(afterHit, { type: 'SWAP_TARGET', playerId: 'A', targetId: 'B' });
  assert.equal(state.phase, PHASE.PLAYER_TURN);
  assert.equal(seatScore(seat(state, 'A')), 18, 'A riceve la mano di B');
  assert.equal(seatScore(seat(state, 'B')), 4, 'B riceve la mano di A con il cambio giro');
  assert.equal(seat(state, 'B').cards.length, 3);
  assert.equal(state.seats[state.turnSeat].id, 'A', 'il turno resta a chi ha pescato');
});

test('chi è bloccato dal divieto non è più un bersaglio dello scambio', () => {
  const start = dealt([
    num(2), num(9), num(5), num(2), num(9), num(5),
    skip(), reverse(),
  ]);
  const { state } = run(
    start,
    { type: 'HIT', playerId: 'A' }, // divieto: gettone e turno chiuso
    { type: 'HIT', playerId: 'B' }, // cambio giro senza bersagli in gioco
  );
  assert.equal(seat(state, 'A').status, STATUS.STOOD);
  assert.equal(seat(state, 'A').blocks, 1);
  assert.equal(state.phase, PHASE.PLAYER_TURN);
  assert.equal(state.swap, null, 'niente scambio: A è fuori dal giro');
});

test('lo scambio trasferisce anche i gettoni accumulati', () => {
  const start = dealt([
    num(2), num(9), num(5), num(2), num(9), num(5),
    reverse(),
  ]);
  // I gettoni arrivano solo insieme all'auto-stand del divieto: qui vengono
  // assegnati a mano per verificare che, comunque ottenuti, seguano la mano.
  findSeat(start, 'B').blocks = 1;
  const { state } = run(
    start,
    { type: 'HIT', playerId: 'A' },
    { type: 'SWAP_TARGET', playerId: 'A', targetId: 'B' },
  );
  assert.equal(seat(state, 'A').blocks, 1);
  assert.equal(seat(state, 'B').blocks, 0);
});

test('lo scambio senza bersagli validi non ha effetto', () => {
  const start = dealt([num(2), num(5), num(2), num(5), reverse()], ['A']);
  const { state } = run(start, { type: 'HIT', playerId: 'A' });

  assert.equal(state.phase, PHASE.PLAYER_TURN);
  assert.equal(state.swap, null);
  assert.equal(seat(state, 'A').cards.length, 3);
});

test('chi ha già detto "stai" non può essere bersaglio dello scambio', () => {
  const start = dealt([
    num(2), num(9), num(5), num(2), num(9), num(5),
    reverse(),
  ]);
  // B non ha ancora giocato: il suo turno viene dopo, quindi è un bersaglio valido.
  const afterStand = run(start, { type: 'STAND', playerId: 'A' }).state;
  assert.equal(afterStand.seats[afterStand.turnSeat].id, 'B');

  const { state } = run(afterStand, { type: 'HIT', playerId: 'B' });
  assert.equal(state.phase, PHASE.PLAYER_TURN, 'A è fuori dai bersagli: nessuno scambio');
  assert.equal(state.swap, null);
});

test('lo scambio automatico allo scadere del timer sceglie un bersaglio valido', () => {
  const start = dealt([
    num(2), num(9), num(5), num(2), num(9), num(5),
    reverse(),
  ]);
  const { state } = run(start, { type: 'HIT', playerId: 'A' }, { type: 'AUTO_SWAP' });
  assert.equal(state.phase, PHASE.PLAYER_TURN);
  assert.equal(seatScore(seat(state, 'A')), 18);
});

test('sballare durante un obbligo chiude il turno e passa al giocatore dopo', () => {
  const start = dealt([
    num(9), num(3), num(5), num(9), num(3), num(5), // A=18, B=6
    draw2(), num(9), num(1),
  ]);
  const { state } = run(start, { type: 'HIT', playerId: 'A' });

  assert.equal(seat(state, 'A').status, STATUS.BUST);
  assert.equal(state.pendingDraw, 0, 'l\'obbligo residuo decade con lo sballo');
  assert.equal(state.seats[state.turnSeat].id, 'B');
});

test('se sballano tutti il banco non gioca e la mano si chiude subito', () => {
  const start = dealt([
    num(9), num(9), num(5), num(9), num(9), num(5), // A=18, B=18, banco=10
    num(9), num(9),
  ]);
  const { state } = run(start, { type: 'HIT', playerId: 'A' }, { type: 'HIT', playerId: 'B' });

  assert.equal(state.phase, PHASE.PAYOUT);
  assert.equal(state.dealer.holeRevealed, false, 'il banco non scopre nemmeno la carta coperta');
  assert.equal(state.dealer.cards.length, 2);
  assert.equal(seat(state, 'A').chips, 90);
  assert.equal(seat(state, 'B').chips, 90);
});

test('il banco pesca fino a 17 rispettando gli obblighi "+N"', () => {
  const start = dealt([
    num(9), num(9), num(5), num(9), num(9), num(5), // A=18, B=18, banco=10
    draw2(), num(3), num(1), num(3),
  ]);
  let state = run(start, { type: 'STAND', playerId: 'A' }, { type: 'STAND', playerId: 'B' }).state;
  assert.equal(state.phase, PHASE.DEALER_DRAW, 'nessun gettone in gioco: nessuna finestra');

  state = run(state, { type: 'DEALER_STEP' }).state;
  assert.equal(state.dealer.cards.length, 5, 'il +2 obbliga il banco a due carte extra');
  assert.equal(state.phase, PHASE.DEALER_DRAW, 'a 14 deve ancora pescare');

  state = run(state, { type: 'DEALER_STEP' }).state;
  assert.equal(state.phase, PHASE.PAYOUT);
  assert.equal(state.results.dealerScore, 17, 'si ferma appena raggiunge 17');
  assert.equal(seat(state, 'A').chips, 110, 'A batte il banco con 18');
});

test('il divieto annulla gli obblighi del banco, che poi riprende a pescare', () => {
  const start = dealt([
    num(9), num(9), num(5), num(9), num(9), num(5), // A=18, B=18, banco=10
    draw2(), skip(), num(4), num(3),
  ]);
  let state = run(start, { type: 'STAND', playerId: 'A' }, { type: 'STAND', playerId: 'B' }).state;

  const { state: dopo, events } = run(state, { type: 'DEALER_STEP' });
  state = dopo;
  assert.equal(state.dealer.cards.length, 4, 'il +2 e poi il divieto, senza le due carte obbligate');
  assert.ok(
    events.some((e) => e.type === 'FORCED_DRAW_CANCELLED' && e.dealer === true),
    'l\'annullamento dell\'obbligo viene registrato',
  );
  assert.equal(state.phase, PHASE.DEALER_DRAW, 'a 10 il banco non è fermo: deve ancora pescare');

  state = run(state, { type: 'DEALER_STEP' }, { type: 'DEALER_STEP' }).state;
  assert.equal(state.phase, PHASE.PAYOUT);
  assert.equal(state.results.dealerScore, 17, 'riprende la regola normale e si ferma a 17');
});

test('un divieto senza obblighi pendenti non ha effetto sul banco', () => {
  const start = dealt([
    num(9), num(9), num(5), num(9), num(9), num(5), // A=18, B=18, banco=10
    skip(), num(7),
  ]);
  let state = run(start, { type: 'STAND', playerId: 'A' }, { type: 'STAND', playerId: 'B' }).state;

  const { state: dopo, events } = run(state, { type: 'DEALER_STEP' });
  state = dopo;
  assert.equal(
    events.some((e) => e.type === 'FORCED_DRAW_CANCELLED'),
    false,
    'non c\'era nessun obbligo da annullare',
  );
  assert.equal(state.phase, PHASE.DEALER_DRAW, 'il divieto non ferma il banco');

  state = run(state, { type: 'DEALER_STEP' }).state;
  assert.equal(state.results.dealerScore, 17, 'il banco arriva comunque a 17');
});

test('il gettone apre la finestra e ferma il banco sul punteggio attuale', () => {
  const start = dealt([
    num(9), num(3), num(5), num(9), num(3), num(5), // A=18, B=6, banco=10
    skip(),
  ]);
  let state = run(
    start,
    { type: 'HIT', playerId: 'A' },   // A prende il gettone
    { type: 'STAND', playerId: 'A' },
    { type: 'STAND', playerId: 'B' },
  ).state;
  assert.equal(state.phase, PHASE.DEALER_BLOCK_WINDOW);

  state = run(state, { type: 'USE_BLOCK', playerId: 'A' }).state;
  assert.equal(state.phase, PHASE.PAYOUT);
  assert.equal(state.dealer.stopped, true);
  assert.equal(state.results.dealerScore, 10, 'fermato sotto 17');
  assert.equal(seat(state, 'A').blocks, 0, 'il gettone è stato speso');
  assert.equal(seat(state, 'A').chips, 110);
  assert.equal(seat(state, 'B').chips, 90, 'B resta sotto il banco e perde');
});

test('senza gettoni la finestra non si apre', () => {
  const start = dealt([num(9), num(3), num(5), num(9), num(3), num(5), num(9)]);
  const state = run(
    start,
    { type: 'STAND', playerId: 'A' },
    { type: 'STAND', playerId: 'B' },
  ).state;
  assert.equal(state.phase, PHASE.DEALER_DRAW);
});

test('il 21 esatto paga 2:1 e i mezzi punti contano', () => {
  const start = dealt([
    num(9), num(3), num(9), num(9), num(3), num(9), // A=18, B=6, banco=18
    num(3), wild(),
  ]);
  const state = run(
    start,
    { type: 'HIT', playerId: 'A' },   // 21 esatto
    { type: 'STAND', playerId: 'A' },
    { type: 'HIT', playerId: 'B' },   // 6,5 con il cambia colore
    { type: 'STAND', playerId: 'B' },
  ).state;

  assert.equal(seatScore(seat(state, 'A')), 21);
  assert.equal(seatScore(seat(state, 'B')), 6.5);
  assert.equal(seat(state, 'A').chips, 120, 'vincita doppia sul 21 esatto');
  assert.equal(seat(state, 'B').chips, 90);
});

test('chi resta senza fiches viene eliminato e la partita si chiude', () => {
  const start = dealt([num(9), num(9), num(9), num(2), num(9), num(9)]); // A=11, B=18, banco=18
  const withStack = structuredClone(start);
  findSeat(withStack, 'A').chips = 10;
  findSeat(withStack, 'A').bet = 10;

  const { state, events } = run(
    withStack,
    { type: 'STAND', playerId: 'A' },
    { type: 'STAND', playerId: 'B' },
  );

  assert.equal(seat(state, 'A').chips, 0);
  assert.equal(seat(state, 'A').status, STATUS.OUT);
  assert.equal(state.phase, PHASE.GAME_OVER);
  assert.equal(state.winnerId, 'B');
  assert.ok(events.some((e) => e.type === 'PLAYER_ELIMINATED' && e.playerId === 'A'));
});

test('la mano successiva riparte dalle puntate azzerando carte e gettoni', () => {
  const start = dealt([
    num(9), num(3), num(5), num(9), num(3), num(5),
    skip(), num(9), num(5),
  ]);
  let state = run(
    start,
    { type: 'HIT', playerId: 'A' },
    { type: 'STAND', playerId: 'A' },
    { type: 'STAND', playerId: 'B' },
    { type: 'BLOCK_TIMEOUT' }, // A ha un gettone ma lascia scadere la finestra
    { type: 'DEALER_STEP' },
  ).state;
  assert.equal(state.phase, PHASE.PAYOUT);

  state = run(state, { type: 'NEXT_HAND' }).state;
  assert.equal(state.phase, PHASE.BETTING);
  assert.equal(state.handNo, 2);
  assert.equal(seat(state, 'A').cards.length, 0);
  assert.equal(seat(state, 'A').blocks, 0);
  assert.equal(seat(state, 'A').hasBet, false);
  assert.ok(state.deck.discard.length > 0, 'le carte giocate finiscono negli scarti');
});

test('le azioni fuori turno o fuori fase vengono ignorate', () => {
  const start = dealt([num(2), num(3), num(5), num(2), num(3), num(5), num(9), num(9)]);
  const state = run(
    start,
    { type: 'HIT', playerId: 'B' },        // non è il suo turno
    { type: 'USE_BLOCK', playerId: 'A' },  // fase sbagliata
    { type: 'NEXT_HAND' },                 // fase sbagliata
  ).state;

  assert.equal(state.phase, PHASE.PLAYER_TURN);
  assert.equal(seat(state, 'B').cards.length, 2);
  assert.equal(state.seats[state.turnSeat].id, 'A');
});

test('ogni posto riceve un colore diverso dagli altri', () => {
  // I due "Ada" partono dallo stesso colore preferito: il secondo deve slittare.
  const names = ['Anna', 'Marco', 'Ada', 'Ada', 'Bruno', 'Cleo'];
  let state = createGame({ hostId: 'p0', seed: 1 });
  names.forEach((name, index) => {
    state = reduce(state, { type: 'ADD_PLAYER', id: `p${index}`, name }).state;
  });

  const colors = state.seats.map((seat) => seat.colorIndex);
  assert.equal(colors.length, names.length);
  assert.equal(new Set(colors).size, names.length, 'nessun colore ripetuto al tavolo');
  assert.ok(colors.every((index) => Number.isInteger(index) && index >= 0));
});

test('la puntata resta tra il minimo e le fiches disponibili', () => {
  let state = createGame({ hostId: 'A', seed: 1 });
  state = reduce(state, { type: 'ADD_PLAYER', id: 'A', name: 'A' }).state;
  state = reduce(state, { type: 'ADD_PLAYER', id: 'B', name: 'B' }).state;
  state = reduce(state, { type: 'START_GAME' }).state;
  findSeat(state, 'B').chips = 3;

  state = reduce(state, { type: 'BET', playerId: 'A', amount: 999 }).state;
  state = reduce(state, { type: 'BET', playerId: 'B', amount: 1 }).state;

  assert.equal(findSeat(state, 'A').bet, 100, 'non si può puntare più delle proprie fiches');
  assert.equal(findSeat(state, 'B').bet, 3, 'sotto il minimo si va all-in');
});
