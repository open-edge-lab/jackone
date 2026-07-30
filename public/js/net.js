/**
 * Connessione WebSocket del client: invio messaggi, riconnessione automatica
 * con backoff e ripresa della sessione tramite token salvato nel browser.
 */

import { C2S } from '../shared/protocol.js';
import { BASE } from './base.js';

const TOKEN_KEY = 'jackone.token';
const MAX_RETRY = 5000;

const handlers = new Map();
let socket = null;
let retryDelay = 500;
let closedByUs = false;

/** @returns {string|null} token di sessione salvato */
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Salva (o cancella, con null) il token di sessione. */
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* modalità privata: si gioca comunque, senza riprendere la sessione */
  }
}

/**
 * Registra un ascoltatore. I tipi speciali 'open' e 'closed' segnalano lo stato
 * della connessione.
 * @param {string} type
 * @param {Function} fn
 */
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
}

function emit(type, payload) {
  for (const fn of handlers.get(type) ?? []) fn(payload);
}

/** Apre la connessione al server che ha servito la pagina. */
export function connect() {
  closedByUs = false;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}${BASE}`);

  socket.addEventListener('open', () => {
    retryDelay = 500;
    emit('open');
    send(C2S.HELLO, { token: getToken() });
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    emit(message.t, message);
  });

  socket.addEventListener('close', () => {
    socket = null;
    if (closedByUs) return;
    emit('closed');
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY);
  });

  socket.addEventListener('error', () => socket?.close());
}

/**
 * Invia un messaggio, se la connessione è aperta.
 * @param {string} t tipo del messaggio
 * @param {object} [payload]
 */
export function send(t, payload = {}) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ t, ...payload }));
}
