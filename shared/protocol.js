/**
 * Protocollo WebSocket di JackOne.
 * Ogni messaggio è JSON nella forma { t: TIPO, ...payload }.
 * Modulo condiviso: importato sia dal server sia dal client.
 */

/** Messaggi inviati dal client al server. */
export const C2S = {
  HELLO: 'HELLO',
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  /** Ingresso da spettatore: nessun posto occupato, nessuna azione di gioco. */
  WATCH_ROOM: 'WATCH_ROOM',
  LEAVE_ROOM: 'LEAVE_ROOM',
  SET_AVATAR: 'SET_AVATAR',
  ADD_BOT: 'ADD_BOT',
  REMOVE_BOT: 'REMOVE_BOT',
  START_GAME: 'START_GAME',
  BET: 'BET',
  HIT: 'HIT',
  STAND: 'STAND',
  SWAP_TARGET: 'SWAP_TARGET',
  USE_BLOCK: 'USE_BLOCK',
  NEXT_HAND: 'NEXT_HAND',
  CHAT: 'CHAT',
};

/** Messaggi inviati dal server al client. */
export const S2C = {
  WELCOME: 'WELCOME',
  ROOM_STATE: 'ROOM_STATE',
  EVENTS: 'EVENTS',
  CHAT: 'CHAT',
  ERROR: 'ERROR',
  LEFT: 'LEFT',
};

/** Tipi di evento presenti in S2C.EVENTS: guidano animazioni e log. */
export const EV = {
  HAND_STARTED: 'HAND_STARTED',
  BET_PLACED: 'BET_PLACED',
  CARD_DEALT: 'CARD_DEALT',
  CARD_DISCARDED: 'CARD_DISCARDED',
  CARD_DRAWN: 'CARD_DRAWN',
  FORCED_DRAW: 'FORCED_DRAW',
  FORCED_DRAW_CANCELLED: 'FORCED_DRAW_CANCELLED',
  BLOCK_GAINED: 'BLOCK_GAINED',
  TURN_BLOCKED: 'TURN_BLOCKED',
  SWAP_REQUIRED: 'SWAP_REQUIRED',
  SWAP_DONE: 'SWAP_DONE',
  SWAP_NO_TARGET: 'SWAP_NO_TARGET',
  PLAYER_BUST: 'PLAYER_BUST',
  PLAYER_STOOD: 'PLAYER_STOOD',
  DEALER_REVEAL: 'DEALER_REVEAL',
  DEALER_CARD: 'DEALER_CARD',
  DEALER_BUST: 'DEALER_BUST',
  DEALER_BLOCKED: 'DEALER_BLOCKED',
  HAND_RESULT: 'HAND_RESULT',
  PLAYER_ELIMINATED: 'PLAYER_ELIMINATED',
  GAME_OVER: 'GAME_OVER',
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_LEFT: 'PLAYER_LEFT',
  PLAYER_OFFLINE: 'PLAYER_OFFLINE',
  PLAYER_ONLINE: 'PLAYER_ONLINE',
  VIEWER_JOINED: 'VIEWER_JOINED',
  VIEWER_LEFT: 'VIEWER_LEFT',
};

/** Fasi della macchina a stati della mano. */
export const PHASE = {
  LOBBY: 'LOBBY',
  BETTING: 'BETTING',
  PLAYER_TURN: 'PLAYER_TURN',
  AWAIT_SWAP: 'AWAIT_SWAP',
  DEALER_BLOCK_WINDOW: 'DEALER_BLOCK_WINDOW',
  DEALER_DRAW: 'DEALER_DRAW',
  PAYOUT: 'PAYOUT',
  GAME_OVER: 'GAME_OVER',
};

/** Durate dei timer di fase, in millisecondi. */
export const TIMERS = {
  BET: 20000,
  TURN: 30000,
  SWAP: 15000,
  BLOCK_WINDOW: 5000,
  DEALER_STEP: 1200,
  HEARTBEAT: 15000,
};

/** Codici di errore restituiti al client. */
export const ERR = {
  BAD_MESSAGE: 'BAD_MESSAGE',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  NAME_TAKEN: 'NAME_TAKEN',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  ILLEGAL_ACTION: 'ILLEGAL_ACTION',
  GAME_RUNNING: 'GAME_RUNNING',
  VIEWER_ONLY: 'VIEWER_ONLY',
};

/** Numero massimo di posti al tavolo (umani + bot). */
export const MAX_SEATS = 6;

/**
 * Ospiti collegati contemporaneamente a una stanza. Il tetto non serve a
 * limitare il pubblico ma la memoria: ogni ospite può caricare un avatar.
 */
export const MAX_VIEWERS = 12;
