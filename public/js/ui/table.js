/**
 * Rendering del tavolo: banco, posti, comandi contestuali, riepiloghi e timer.
 * Il client non calcola nulla: disegna soltanto lo stato ricevuto dal server.
 */

import { C2S, PHASE } from '/shared/protocol.js';
import { MIN_BET, formatScore } from '/shared/cards.js';
import { send } from '../net.js';
import { avatarElement, colorOf, playerTag } from './avatar.js';
import { renderHand } from './card.js';
import { confirmAction } from './confirm.js';
import { renderLog } from './log.js';

const el = {
  code: document.getElementById('table-code'),
  hand: document.getElementById('table-hand'),
  phase: document.getElementById('table-phase'),
  viewers: document.getElementById('table-viewers'),
  dealerCards: document.getElementById('dealer-cards'),
  dealerScore: document.getElementById('dealer-score'),
  discard: document.getElementById('discard'),
  discardCount: document.getElementById('discard-count'),
  discardCards: document.getElementById('discard-cards'),
  players: document.getElementById('players'),
  controls: document.getElementById('controls'),
  timer: document.getElementById('timer'),
  timerBar: document.getElementById('timer-bar'),
  logList: document.getElementById('log-list'),
  youBar: document.getElementById('you-bar'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalActions: document.getElementById('modal-actions'),
};

const PHASE_LABEL = {
  [PHASE.BETTING]: 'Puntate',
  [PHASE.PLAYER_TURN]: 'Turni dei giocatori',
  [PHASE.AWAIT_SWAP]: 'Scambio mazzi',
  [PHASE.DEALER_BLOCK_WINDOW]: 'Finestra dei gettoni',
  [PHASE.DEALER_DRAW]: 'Gioca il banco',
  [PHASE.PAYOUT]: 'Riepilogo della mano',
  [PHASE.GAME_OVER]: 'Partita conclusa',
};

const RESULT_LABEL = {
  EXACT: 'JackOne! 21 esatto',
  WIN: 'Vince',
  PUSH: 'Pareggio',
  LOSE: 'Perde',
  BUST: 'Sballato',
};

let controlsKey = '';
let modalKey = '';
let betValue = MIN_BET;
let timerId = -1;
let timerDeadline = 0;
let timerTotal = 0;

/**
 * Disegna l'intero tavolo.
 * @param {object} state stato proiettato dal server
 */
export function renderTable(state) {
  el.code.textContent = state.code;
  el.hand.textContent = state.handNo;
  el.phase.textContent = PHASE_LABEL[state.phase] ?? '';

  renderDealer(state);
  renderDiscard(state);
  renderViewers(state);
  renderPlayers(state);
  renderYouBar(state);
  renderControls(state);
  renderModal(state);
  renderLog(el.logList, state.log, colorMap(state));
  syncTimer(state);
}

/**
 * @returns {Map<string, string>} colore di ogni partecipante, per id. Ci sono
 *   anche gli ospiti: scrivono in chat e le loro righe vanno colorate.
 */
function colorMap(state) {
  const entries = [...state.players, ...(state.viewers ?? [])];
  return new Map(entries.map((person) => [person.id, colorOf(person)]));
}

// ------------------------------------------------------------------ ospiti

/** Chi sta guardando senza giocare, riassunto nella barra in alto. */
function renderViewers(state) {
  const viewers = state.viewers ?? [];
  el.viewers.classList.toggle('hidden', viewers.length === 0);
  if (viewers.length === 0) return;

  const count = document.createElement('span');
  count.className = 'viewers__count';
  count.textContent = `👁 ${viewers.length}`;

  el.viewers.replaceChildren(count, ...viewers.map((viewer) => avatarElement(viewer, { size: 'sm' })));
  el.viewers.title = `Ospiti: ${viewers.map((v) => v.name).join(', ')}`;
}

// ------------------------------------------------------------------ banco

function renderDealer(state) {
  renderHand(el.dealerCards, state.dealer.cards);
  el.dealerScore.textContent = state.dealer.cards.length
    ? `${formatScore(state.dealer.score)}${state.dealer.revealed ? '' : ' +'}`
    : '—';
  el.dealerScore.className = `score${state.dealer.busted ? ' score--bust' : ''}`;
}

// ----------------------------------------------------------------- scarti

/** Durata dell'evidenza sulle carte appena scartate. */
const FRESH_DISCARD_MS = 2500;

/** Id delle carte scartate da poco, da mostrare in evidenza. */
const freshDiscards = new Set();
let freshTimer = null;

/**
 * Segna una carta come appena scartata. La chiama `main.js` sugli eventi
 * `CARD_DISCARDED`, che arrivano subito prima dello stato aggiornato.
 * @param {object} card
 */
export function noteDiscarded(card) {
  freshDiscards.add(card.id);
  clearTimeout(freshTimer);
  freshTimer = setTimeout(() => {
    freshDiscards.clear();
    for (const node of el.discardCards.querySelectorAll('.is-fresh')) {
      node.classList.remove('is-fresh');
    }
  }, FRESH_DISCARD_MS);
}

/** Pila degli scarti: le ultime carte a ventaglio più il totale. */
function renderDiscard(state) {
  const discard = state.discard ?? { count: 0, top: [] };
  el.discard.classList.toggle('hidden', discard.count === 0);
  if (discard.count === 0) return;

  el.discardCount.textContent = String(discard.count);
  renderHand(el.discardCards, discard.top, { size: 'sm' });

  for (const [index, card] of discard.top.entries()) {
    if (freshDiscards.has(card.id)) el.discardCards.children[index].classList.add('is-fresh');
  }
}

// ------------------------------------------------------------------ posti

function renderPlayers(state) {
  const canPick = Boolean(state.you?.mustSwap);
  const targets = new Set(state.swap?.targets ?? []);

  el.players.replaceChildren(...state.players.map((player) => {
    const seat = document.createElement('article');
    seat.className = 'seat';
    seat.style.setProperty('--seat-color', colorOf(player));
    seat.classList.toggle('is-you', player.isYou);
    seat.classList.toggle('is-turn', player.id === state.turnPlayerId);
    seat.classList.toggle('is-bust', player.status === 'bust');
    seat.classList.toggle('is-out', player.status === 'out');

    if (canPick && targets.has(player.id)) {
      seat.classList.add('is-target');
      seat.tabIndex = 0;
      seat.setAttribute('role', 'button');
      const pick = () => send(C2S.SWAP_TARGET, { targetId: player.id });
      seat.addEventListener('click', pick);
      seat.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); }
      });
    }

    const head = document.createElement('div');
    head.className = 'seat__head';
    head.append(avatarElement(player));

    const name = document.createElement('span');
    name.className = 'seat__name';
    name.textContent = player.name;
    name.style.color = colorOf(player);
    head.append(name);

    if (player.isYou) head.append(badge('tu', 'you'));
    if (player.isBot) head.append(badge('bot', 'bot'));

    if (player.blocks > 0) head.append(badge(`⊘ ${player.blocks}`, 'block'));
    if (!player.connected && !player.isBot) head.append(badge('offline', 'off'));

    const hand = document.createElement('div');
    hand.className = 'hand';
    renderHand(hand, player.cards, { size: 'sm' });

    const foot = document.createElement('div');
    foot.className = 'seat__foot';
    foot.append(statusText(player, state));

    seat.append(head, hand, foot, statsRow(player));
    return seat;
  }));
}

/** Fiches, puntata e punteggio del posto, etichettati e leggibili da lontano. */
function statsRow(player) {
  const row = document.createElement('div');
  row.className = 'seat__stats';
  row.append(
    stat('fiches', String(player.chips), 'chips'),
    stat('punta', player.bet > 0 ? String(player.bet) : '—', 'bet'),
    stat('punti', formatScore(player.score), `score${scoreVariant(player)}`),
  );
  return row;
}

/**
 * @param {string} label etichetta breve, in minuscolo
 * @param {string} value valore già formattato
 * @param {string} variant suffisso di classe (`chips`, `bet`, `score`…)
 */
function stat(label, value, variant) {
  const box = document.createElement('span');
  box.className = `stat stat--${variant}`;
  const caption = document.createElement('i');
  caption.textContent = label;
  const number = document.createElement('b');
  number.textContent = value;
  box.append(caption, number);
  return box;
}

/** @returns {string} suffisso di classe per colorare il punteggio */
function scoreVariant(player) {
  if (player.status === 'bust') return ' is-bust';
  if (player.score === 21) return ' is-exact';
  return '';
}

// ------------------------------------------------------- barra personale

/** Riepilogo sempre visibile di chi sta giocando a questo schermo. */
function renderYouBar(state) {
  const you = state.players.find((player) => player.isYou);
  el.youBar.classList.toggle('hidden', !you);
  if (!you) return;

  el.youBar.style.setProperty('--seat-color', colorOf(you));
  el.youBar.replaceChildren(
    playerTag(you),
    stat('fiches', String(you.chips), 'chips'),
    stat('punta', you.bet > 0 ? String(you.bet) : '—', 'bet'),
    stat('punti', formatScore(you.score), `score${scoreVariant(you)}`),
  );
}

function badge(text, variant) {
  const span = document.createElement('span');
  span.className = `badge badge--${variant}`;
  span.textContent = text;
  return span;
}

function statusText(player, state) {
  const span = document.createElement('span');
  if (player.result) {
    span.textContent = RESULT_LABEL[player.result] ?? '';
    if (player.delta !== 0) {
      const delta = document.createElement('b');
      delta.className = `delta ${player.delta > 0 ? 'delta--up' : 'delta--down'}`;
      delta.textContent = ` ${player.delta > 0 ? '+' : ''}${player.delta}`;
      span.append(delta);
    }
    return span;
  }
  if (player.status === 'out') span.textContent = 'Eliminato';
  else if (player.status === 'bust') span.textContent = 'Sballato';
  else if (player.status === 'stood') span.textContent = 'Sta';
  else if (state.phase === PHASE.BETTING) span.textContent = player.hasBet ? 'Ha puntato' : 'Deve puntare';
  else if (player.id === state.turnPlayerId) span.textContent = 'Sta giocando';
  else span.textContent = '';
  return span;
}

// --------------------------------------------------------------- comandi

function renderControls(state) {
  const you = state.you;
  const key = [
    state.phase,
    state.handNo,
    state.turnPlayerId,
    you?.canBet,
    you?.canAct,
    you?.mustSwap,
    state.canBlock,
    you?.chips,
    state.isHost,
  ].join('|');
  if (key === controlsKey) return;
  controlsKey = key;

  const nodes = [];

  if (!you) {
    nodes.push(message('Stai guardando la partita. Puoi commentare nel <b>registro</b>.'));
  } else if (state.phase === PHASE.BETTING && you.canBet) {
    nodes.push(betPanel(you));
  } else if (state.phase === PHASE.PLAYER_TURN && you.canAct) {
    nodes.push(
      button('Carta', 'btn btn--primary btn--hit', () => send(C2S.HIT)),
      button('Stai', 'btn btn--hit', () => send(C2S.STAND)),
    );
  } else if (state.phase === PHASE.AWAIT_SWAP && you.mustSwap) {
    nodes.push(message('Cambio giro: <b>scegli un giocatore</b> con cui scambiare la mano.'));
  } else if (state.canBlock) {
    nodes.push(
      button('Blocca il banco ⊘', 'btn btn--block-dealer', () => send(C2S.USE_BLOCK)),
      message('Spendi un gettone per fermarlo dov\'è.'),
    );
  } else {
    // Chi sta giocando viene nominato per esteso, con avatar e colore.
    const actor = state.phase === PHASE.PLAYER_TURN
      ? state.players.find((p) => p.id === state.turnPlayerId)
      : state.players.find((p) => p.id === state.swap?.playerId);
    const label = state.phase === PHASE.AWAIT_SWAP ? 'Sta scambiando la mano' : 'Tocca a';
    nodes.push(actor ? turnBanner(actor, label) : message(waitingMessage(state)));
  }

  if (state.phase === PHASE.PAYOUT && state.isHost) {
    nodes.push(button('Prossima mano', 'btn btn--accent', () => send(C2S.NEXT_HAND)));
  }
  if (state.phase === PHASE.GAME_OVER && state.isHost) {
    nodes.push(button('Nuova partita', 'btn btn--accent', () => send(C2S.START_GAME)));
  }

  el.controls.replaceChildren(...nodes);
}

/**
 * Targhetta "Tocca a <nickname>" con avatar e colore di chi sta giocando.
 * @param {object} player
 * @param {string} label
 */
function turnBanner(player, label) {
  const banner = document.createElement('div');
  banner.className = 'turn-banner';
  const caption = document.createElement('span');
  caption.className = 'turn-banner__label';
  caption.textContent = label;
  banner.append(caption, playerTag(player, { upper: true }));
  return banner;
}

function waitingMessage(state) {
  switch (state.phase) {
    case PHASE.BETTING: return 'In attesa delle altre puntate…';
    case PHASE.PLAYER_TURN: return 'Turno in corso…';
    case PHASE.AWAIT_SWAP: return 'Scambio mazzi in corso…';
    case PHASE.DEALER_BLOCK_WINDOW: return 'Chi ha un gettone può fermare il banco…';
    case PHASE.DEALER_DRAW: return 'Il banco sta pescando…';
    case PHASE.PAYOUT: return 'Mano conclusa.';
    case PHASE.GAME_OVER: return 'Partita conclusa.';
    default: return '';
  }
}

function betPanel(you) {
  const row = document.createElement('div');
  row.className = 'bet-row';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(Math.min(MIN_BET, you.chips));
  input.max = String(you.chips);
  input.step = '1';
  betValue = Math.max(Math.min(MIN_BET, you.chips), Math.min(betValue, you.chips));
  input.value = String(betValue);
  input.addEventListener('input', () => { betValue = Number(input.value); });

  const quick = [MIN_BET, 10, 25].filter((amount) => amount <= you.chips);
  const shortcuts = quick.map((amount) => button(String(amount), 'btn', () => {
    input.value = String(amount);
    betValue = amount;
  }));
  shortcuts.push(button('Tutto', 'btn', () => {
    input.value = String(you.chips);
    betValue = you.chips;
  }));

  const confirm = button('Punta', 'btn btn--primary', () => {
    send(C2S.BET, { amount: Number(input.value) });
  });

  row.append(...shortcuts, input, confirm);
  return row;
}

function button(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function message(html) {
  const p = document.createElement('p');
  p.className = 'controls__msg';
  p.innerHTML = html;
  return p;
}

// ------------------------------------------------------------- riepiloghi

function renderModal(state) {
  const key = modalKeyFor(state);
  if (key === modalKey) return;
  modalKey = key;

  if (!key) {
    el.modal.classList.add('hidden');
    return;
  }

  el.modalActions.replaceChildren();
  if (state.phase === PHASE.PAYOUT) {
    el.modalTitle.textContent = `Mano ${state.handNo}: il banco fa ${formatScore(state.results.dealerScore)}${state.results.dealerBusted ? ' e sballa' : ''}`;
    el.modalBody.replaceChildren(...state.results.players.map((result) => {
      const player = state.players.find((p) => p.id === result.playerId);
      return resultRow(result, player ?? { name: result.name, colorIndex: 0 });
    }));
    el.modalActions.append(closeButton());
    if (state.isHost) {
      el.modalActions.append(button('Prossima mano', 'btn btn--accent', () => send(C2S.NEXT_HAND)));
    }
  } else {
    const standings = [...state.players].sort((a, b) => b.chips - a.chips);
    const winner = standings[0];
    el.modalTitle.textContent = winner ? `Vince ${winner.name}!` : 'Partita conclusa';
    el.modalBody.replaceChildren(...standings.map((player) => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = player.name;
      name.style.color = colorOf(player);
      const chips = document.createElement('span');
      chips.className = 'outcome';
      chips.textContent = `${player.chips} fiches`;
      row.append(avatarElement(player), name, chips);
      return row;
    }));
    el.modalActions.append(closeButton(), leaveButton(state.isViewer));
    if (state.isHost) {
      el.modalActions.append(button('Nuova partita', 'btn btn--primary', () => send(C2S.START_GAME)));
    }
  }

  el.modal.classList.remove('hidden');
}

/**
 * Chiude il riepilogo senza toccare la partita. La chiave resta quella della
 * fase corrente: così il modale non si riapre al prossimo aggiornamento, ma
 * torna alla mano (o alla partita) successiva.
 */
function closeButton() {
  return button('Chiudi', 'btn', () => el.modal.classList.add('hidden'));
}

/** Abbandono del tavolo, con conferma: si perde il posto e si torna al login. */
function leaveButton(isViewer) {
  return button(isViewer ? 'Smetti di guardare' : 'Esci dal tavolo', 'btn btn--ghost', async () => {
    if (await confirmLeave(isViewer)) send(C2S.LEAVE_ROOM);
  });
}

/**
 * @param {boolean} [isViewer] chi guarda non ha fiches da perdere: avvisarlo
 *   del contrario sarebbe solo un ostacolo in più per andarsene
 * @returns {Promise<boolean>} conferma dell'abbandono del tavolo
 */
export function confirmLeave(isViewer = false) {
  return confirmAction({
    title: isViewer ? 'Smettere di guardare?' : 'Uscire dal tavolo?',
    text: isViewer
      ? 'Torni alla schermata iniziale. Puoi rientrare quando vuoi con il codice del tavolo.'
      : 'Perdi le fiches e la mano in corso. Gli altri continuano a giocare senza di te.',
    confirmLabel: isViewer ? 'Smetti' : 'Esci',
  });
}

// La chiave include l'host: chi eredita il ruolo deve vedere comparire i comandi.
function modalKeyFor(state) {
  if (state.phase === PHASE.PAYOUT && state.results) return `payout:${state.handNo}:${state.isHost}`;
  if (state.phase === PHASE.GAME_OVER) return `over:${state.isHost}`;
  return '';
}

function resultRow(player, identity) {
  const row = document.createElement('div');
  row.className = 'result-row';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = player.name;
  name.style.color = colorOf(identity);
  row.append(avatarElement(identity));

  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = formatScore(player.score);

  const outcome = document.createElement('span');
  outcome.className = 'outcome';
  outcome.textContent = RESULT_LABEL[player.result] ?? '';

  const delta = document.createElement('b');
  delta.className = `delta ${player.delta > 0 ? 'delta--up' : 'delta--down'}`;
  delta.textContent = `${player.delta > 0 ? '+' : ''}${player.delta}`;

  row.append(name, score, outcome, delta);
  return row;
}

// ---------------------------------------------------------------- timer

function syncTimer(state) {
  const timer = state.timer ?? { id: 0, left: 0 };
  if (!timer.left) {
    timerDeadline = 0;
    el.timer.classList.add('hidden');
    return;
  }
  // La barra riparte solo quando il server avvia davvero un nuovo timer.
  if (timer.id !== timerId) {
    timerId = timer.id;
    timerTotal = timer.left;
    timerDeadline = Date.now() + timer.left;
  }
  el.timer.classList.remove('hidden');
}

/** Anima la barra del tempo residuo. */
function tick() {
  if (timerDeadline) {
    const left = Math.max(0, timerDeadline - Date.now());
    const ratio = timerTotal ? left / timerTotal : 0;
    el.timerBar.style.transform = `scaleX(${ratio})`;
    el.timerBar.classList.toggle('is-urgent', ratio < 0.25);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/** Azzera le memorie di rendering quando si cambia tavolo. */
export function resetTable() {
  controlsKey = '';
  modalKey = '';
  timerId = -1;
  timerDeadline = 0;
  freshDiscards.clear();
  clearTimeout(freshTimer);
  el.modal.classList.add('hidden');
}
