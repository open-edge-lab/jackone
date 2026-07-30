/**
 * Stato del client: una sola copia dello stato ricevuto dal server più i dati
 * di sessione. Ogni aggiornamento notifica i renderer iscritti.
 */

const subscribers = new Set();

export const app = {
  /** @type {object|null} ultimo stato ricevuto dal server */
  state: null,
  /** @type {string|null} */
  playerId: null,
  /** @type {string|null} */
  code: null,
  /** @type {'player'|'viewer'|null} come si è entrati nella stanza */
  role: null,
  /** @type {boolean} true mentre la connessione è caduta */
  offline: false,
};

/**
 * @param {Function} fn chiamato a ogni aggiornamento
 */
export function subscribe(fn) {
  subscribers.add(fn);
}

/**
 * Applica un aggiornamento e notifica i renderer.
 * @param {object} patch
 */
export function update(patch) {
  Object.assign(app, patch);
  for (const fn of subscribers) fn(app);
}
