/**
 * Stanze di gioco: anagrafica dei posti, timer di fase, mosse automatiche e
 * diffusione dello stato ai client connessi.
 *
 * Qui vive tutto ciò che il motore non può contenere (tempo e socket): i timer
 * si limitano a iniettare azioni nel motore, che resta puro.
 */

import { randomUUID } from 'node:crypto';

import { EV, MAX_SEATS, PHASE, S2C, TIMERS } from '../shared/protocol.js';
import { parseAvatarDataUrl } from '../shared/avatar.js';
import { preferredColorIndex } from '../shared/identity.js';

import { createGame, findSeat, reduce } from './game/engine.js';
import { BOT_NAMES, autoAction } from './game/bots.js';
import { describeEvent } from './eventlog.js';
import { projectState } from './view.js';

/** Caratteri del codice stanza: niente I, O, 0, 1 per evitare letture ambigue. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
/** Pausa sul riepilogo prima della mano successiva. */
const PAYOUT_PAUSE = 8000;
/** Tolleranza prima di buttare una stanza rimasta senza collegamenti. */
const EMPTY_LOBBY_TTL = 120000;
const EMPTY_GAME_TTL = 600000;
/** Righe di log conservate per stanza. */
const LOG_LIMIT = 200;

export class Room {
  /**
   * @param {string} code codice pubblico della stanza
   * @param {{rigged?: boolean, onEmpty?: Function}} options
   */
  constructor(code, { rigged = false, onEmpty } = {}) {
    this.code = code;
    this.state = createGame({ hostId: null, seed: (Math.random() * 2 ** 31) | 0, rigged });
    /**
     * Socket per partecipante, giocatori e ospiti insieme: `broadcast` scorre
     * questa mappa e `projectState` sa già degradare per chi non ha un posto.
     * @type {Map<string, {send: Function, close: Function}>}
     */
    this.sockets = new Map();
    /** @type {Map<string, string>} token di sessione → id giocatore od ospite */
    this.tokens = new Map();
    /**
     * Ospiti: guardano e scrivono in chat, non compaiono fra i posti e non
     * entrano mai nello stato del motore.
     * @type {Map<string, {id: string, name: string, colorIndex: number, connected: boolean}>}
     */
    this.viewers = new Map();
    /** @type {Map<string, {mime: string, bytes: Buffer, version: number}>} avatar per id */
    this.avatars = new Map();
    this.log = [];
    this.logSeq = 0;
    this.timer = null;
    this.autoTimer = null;
    this.deadline = 0;
    /** Cambia a ogni timer avviato: permette al client di non riavviare la barra. */
    this.timerSeq = 0;
    this.onEmpty = onEmpty;
  }

  /** @returns {boolean} true se non resta nessun umano collegato o riconnettibile */
  get isAbandoned() {
    return this.state.seats.filter((s) => !s.isBot).length === 0;
  }

  // ------------------------------------------------------------- iscrizioni

  /**
   * Aggiunge un giocatore umano e restituisce le sue credenziali di sessione.
   * @param {string} name
   * @returns {{playerId: string, token: string}}
   */
  addHuman(name) {
    const playerId = randomUUID();
    const token = randomUUID();
    this.tokens.set(token, playerId);
    this.dispatch({ type: 'ADD_PLAYER', id: playerId, name });
    if (!this.state.hostId) this.state.hostId = playerId;
    return { playerId, token };
  }

  /** Aggiunge un giocatore automatico con un nickname ancora libero al tavolo. */
  addBot() {
    const taken = new Set(this.state.seats.map((seat) => seat.name.toLowerCase()));
    const name = BOT_NAMES.find((candidate) => !taken.has(candidate.toLowerCase()))
      ?? `Bot ${this.state.seats.length + 1}`;
    this.dispatch({ type: 'ADD_PLAYER', id: `bot-${randomUUID()}`, name, isBot: true });
  }

  /** Rimuove l'ultimo bot aggiunto. */
  removeLastBot() {
    const bots = this.state.seats.filter((s) => s.isBot);
    if (bots.length === 0) return;
    this.dispatch({ type: 'REMOVE_PLAYER', id: bots[bots.length - 1].id });
  }

  /**
   * Iscrive un ospite: nessun posto occupato, quindi nessuna azione sul motore.
   * Il colore è quello suggerito dal nickname, senza la ricerca di unicità
   * riservata ai posti: gli ospiti non devono essere distinguibili a colpo
   * d'occhio in mezzo alle carte.
   * @param {string} name
   * @returns {{playerId: string, token: string}} credenziali di sessione, con
   *   la stessa forma di `addHuman`: l'id è quello dell'ospite
   */
  addViewer(name) {
    const playerId = `viewer-${randomUUID()}`;
    const token = randomUUID();
    this.tokens.set(token, playerId);
    this.viewers.set(playerId, {
      id: playerId,
      name,
      colorIndex: preferredColorIndex(name),
      connected: false, // diventa true quando il socket si aggancia con attach()
    });
    return { playerId, token };
  }

  /** @returns {boolean} true se l'id appartiene a un ospite e non a un posto */
  isViewer(id) {
    return this.viewers.has(id);
  }

  /** Toglie definitivamente un ospite dalla stanza. */
  removeViewer(id) {
    const viewer = this.viewers.get(id);
    if (!viewer) return;

    this.viewers.delete(id);
    this.sockets.delete(id);
    this.avatars.delete(id);
    for (const [token, owner] of this.tokens) {
      if (owner === id) this.tokens.delete(token);
    }
    this.announce([{ type: EV.VIEWER_LEFT, playerId: id, name: viewer.name }]);
    this.checkEmpty();
  }

  /** @returns {string|undefined} id del giocatore associato al token */
  playerIdForToken(token) {
    return this.tokens.get(token);
  }

  /** @returns {boolean} true se c'è ancora posto al tavolo */
  get hasSeat() {
    return this.state.seats.length < MAX_SEATS;
  }

  /** @returns {number} ospiti attualmente collegati */
  get viewerCount() {
    return [...this.viewers.values()].filter((v) => v.connected).length;
  }

  /**
   * @returns {boolean} true se il nome è già in uso, da un posto o da un ospite
   *   (gli ospiti scrivono in chat, quindi i nomi doppi confondono comunque)
   */
  hasName(name) {
    const wanted = name.trim().toLowerCase();
    const taken = (other) => other.name.trim().toLowerCase() === wanted;
    return this.state.seats.some(taken) || [...this.viewers.values()].some(taken);
  }

  // -------------------------------------------------------------- avatar

  /**
   * Imposta o cancella la foto di un partecipante (posto od ospite).
   * I byte non viaggiano nello stato: il client li scarica da `/avatar/...`,
   * qui si aggiorna solo la versione che compare nella URL.
   * @param {string} id
   * @param {string|null} dataUrl null per tornare alle iniziali
   * @returns {boolean} false se la data URL è stata rifiutata
   */
  setAvatar(id, dataUrl) {
    if (dataUrl === null || dataUrl === undefined || dataUrl === '') {
      if (!this.avatars.delete(id)) return true;
      this.announce([]);
      return true;
    }

    const parsed = parseAvatarDataUrl(dataUrl);
    if (!parsed) return false;

    const version = (this.avatars.get(id)?.version ?? 0) + 1;
    this.avatars.set(id, {
      mime: parsed.mime,
      bytes: Buffer.from(parsed.base64, 'base64'),
      version,
    });
    this.announce([]);
    return true;
  }

  // ------------------------------------------------------------ connessioni

  /** Collega (o ricollega) il socket di un partecipante. */
  attach(id, socket) {
    // La stanza è di nuovo abitata: annulla l'eventuale chiusura programmata.
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    this.sockets.set(id, socket);

    const viewer = this.viewers.get(id);
    if (viewer) {
      const returning = viewer.connected;
      viewer.connected = true;
      // Mai `dispatch` per un ospite: riavvierebbe il timer della fase in corso.
      this.announce(returning ? [] : [{ type: EV.VIEWER_JOINED, playerId: id, name: viewer.name }]);
      return;
    }

    this.dispatch({ type: 'SET_CONNECTED', id, connected: true });
  }

  /** Segnala la caduta di un socket: il posto resta, ma viene giocato in automatico. */
  detach(id) {
    this.sockets.delete(id);

    const viewer = this.viewers.get(id);
    if (viewer) {
      // La voce resta: con il token in mano, un semplice ricarico di pagina
      // riporta l'ospite al suo posto in elenco.
      viewer.connected = false;
      this.announce([]);
      this.checkEmpty();
      return;
    }

    if (findSeat(this.state, id)) {
      this.dispatch({ type: 'SET_CONNECTED', id, connected: false });
    }
    this.checkEmpty();
  }

  /** Rimuove definitivamente un giocatore dalla stanza. */
  leave(playerId) {
    this.sockets.delete(playerId);
    this.avatars.delete(playerId);
    for (const [token, id] of this.tokens) {
      if (id === playerId) this.tokens.delete(token);
    }
    this.dispatch({ type: 'REMOVE_PLAYER', id: playerId });
    this.checkEmpty();
  }

  /**
   * Un ospite collegato basta a tenere viva la stanza: si può restare a
   * guardare un tavolo di soli bot, o aspettare che i giocatori tornino.
   */
  checkEmpty() {
    if (this.sockets.size === 0 && this.onEmpty) this.onEmpty(this);
  }

  /** Chiude i timer della stanza. */
  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.autoTimer);
    this.timer = null;
    this.autoTimer = null;
  }

  // ------------------------------------------------------------------ gioco

  /**
   * Applica un'azione al motore, diffonde il risultato e riprogramma i timer.
   * @param {object} action
   */
  dispatch(action) {
    const { state, events } = reduce(this.state, action);
    this.state = state;
    this.appendLog(events);
    this.scheduleTimers();
    this.broadcast(events);
  }

  /**
   * Aggiorna registro e client senza passare dal motore.
   *
   * È la via obbligata per tutto ciò che non è gioco (ospiti, avatar): passare
   * da `dispatch` farebbe ripartire `scheduleTimers`, regalando tempo extra a
   * chi è di turno ogni volta che qualcuno si affaccia a guardare.
   * @param {Array<object>} events
   */
  announce(events) {
    this.appendLog(events);
    this.broadcast(events);
  }

  appendLog(events) {
    for (const event of events) {
      const line = describeEvent(event);
      if (!line) continue;
      this.logSeq += 1;
      // L'autore serve al client per colorare la riga con il colore del posto.
      this.log.push({ id: this.logSeq, ...line, playerId: event.playerId ?? null });
    }
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(-LOG_LIMIT);
  }

  /** Aggiunge un messaggio di chat al log condiviso; scrivono anche gli ospiti. */
  chat(playerId, text) {
    const author = findSeat(this.state, playerId) ?? this.viewers.get(playerId);
    if (!author) return;
    const clean = String(text).slice(0, 200).trim();
    if (!clean) return;
    this.logSeq += 1;
    this.log.push({
      id: this.logSeq,
      kind: 'chat',
      text: `${author.name}: ${clean}`,
      playerId,
      ...(this.isViewer(playerId) ? { role: 'viewer' } : {}),
    });
    this.broadcast([]);
  }

  /**
   * Programma il timer della fase corrente e l'eventuale mossa automatica.
   * Ogni chiamata azzera i timer precedenti: lo stato è la sola verità.
   */
  scheduleTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.autoTimer);
    this.timer = null;
    this.autoTimer = null;
    this.deadline = 0;

    const { state } = this;
    const timeout = (ms, action) => {
      this.deadline = Date.now() + ms;
      this.timerSeq += 1;
      this.timer = setTimeout(() => this.dispatch(action), ms);
    };

    switch (state.phase) {
      case PHASE.BETTING:
        if (state.seats.some((s) => s.status === 'waiting' && !s.hasBet)) {
          timeout(TIMERS.BET, { type: 'AUTO_BET' });
        }
        break;
      case PHASE.PLAYER_TURN: {
        const seat = state.seats[state.turnSeat];
        if (seat) timeout(TIMERS.TURN, { type: 'STAND', playerId: seat.id });
        break;
      }
      case PHASE.AWAIT_SWAP:
        timeout(TIMERS.SWAP, { type: 'AUTO_SWAP' });
        break;
      case PHASE.DEALER_BLOCK_WINDOW:
        timeout(TIMERS.BLOCK_WINDOW, { type: 'BLOCK_TIMEOUT' });
        break;
      case PHASE.DEALER_DRAW:
        timeout(TIMERS.DEALER_STEP, { type: 'DEALER_STEP' });
        break;
      case PHASE.PAYOUT:
        timeout(PAYOUT_PAUSE, { type: 'NEXT_HAND' });
        break;
      default:
        break;
    }

    const auto = autoAction(state);
    if (auto) {
      this.autoTimer = setTimeout(() => this.dispatch(auto.action), auto.delay);
    }
  }

  // ------------------------------------------------------------ diffusione

  /** Invia lo stato proiettato (più gli eventi per le animazioni) a ogni client. */
  broadcast(events) {
    for (const [playerId, socket] of this.sockets) {
      if (events.length > 0) socket.send({ t: S2C.EVENTS, events });
      socket.send({ t: S2C.ROOM_STATE, state: projectState(this, playerId) });
    }
  }

  /** Invia lo stato al solo destinatario indicato. */
  sendState(playerId) {
    const socket = this.sockets.get(playerId);
    if (socket) socket.send({ t: S2C.ROOM_STATE, state: projectState(this, playerId) });
  }
}

/**
 * Registro delle stanze attive.
 */
export class RoomRegistry {
  constructor({ rigged = false } = {}) {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.rigged = rigged;
  }

  /** @returns {Room} */
  create() {
    const code = this.freshCode();
    const room = new Room(code, {
      rigged: this.rigged,
      onEmpty: (r) => this.scheduleCleanup(r),
    });
    this.rooms.set(code, room);
    return room;
  }

  /** @returns {Room|undefined} */
  get(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  /**
   * Ritrova la stanza di un giocatore a partire dal token di sessione,
   * usata per riprendere la partita dopo una disconnessione.
   * @param {string} token
   * @returns {Room|null}
   */
  findByToken(token) {
    for (const room of this.rooms.values()) {
      if (room.playerIdForToken(token)) return room;
    }
    return null;
  }

  freshCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Impossibile generare un codice stanza libero');
  }

  /**
   * Una stanza rimasta senza socket viene chiusa dopo una tolleranza, così una
   * ricarica di pagina non distrugge la partita. Con una partita in corso la
   * tolleranza è più lunga: chi torna col codice deve ritrovare il tavolo.
   */
  scheduleCleanup(room) {
    clearTimeout(room.cleanupTimer);
    const grace = room.state.phase === PHASE.LOBBY ? EMPTY_LOBBY_TTL : EMPTY_GAME_TTL;
    room.cleanupTimer = setTimeout(() => {
      if (room.sockets.size !== 0) return;
      room.dispose();
      this.rooms.delete(room.code);
      console.log(`  Stanza ${room.code} chiusa: nessun collegamento da ${Math.round(grace / 60000)} minuti`);
    }, grace);
    room.cleanupTimer.unref?.();
  }
}
