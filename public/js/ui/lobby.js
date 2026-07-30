/**
 * Schermata di attesa: codice del tavolo, elenco dei posti, ospiti collegati
 * e comandi dell'host.
 */

import { BASE } from '../base.js';
import { avatarElement, colorOf } from './avatar.js';

const el = {
  code: document.getElementById('lobby-code'),
  url: document.getElementById('lobby-url'),
  players: document.getElementById('lobby-players'),
  viewersBox: document.getElementById('lobby-viewers-box'),
  viewers: document.getElementById('lobby-viewers'),
  hostActions: document.getElementById('lobby-host'),
  wait: document.getElementById('lobby-wait'),
};

/**
 * Riga dell'elenco: pastiglia colorata, nickname e un'etichetta sulla destra.
 * @param {object} person giocatore od ospite
 * @param {string} tagText etichetta, stringa vuota per nessuna
 * @returns {HTMLElement}
 */
function personRow(person, tagText) {
  const li = document.createElement('li');
  li.style.borderLeft = `3px solid ${colorOf(person)}`;
  li.append(avatarElement(person));

  const name = document.createElement('span');
  name.textContent = person.isYou ? `${person.name} (tu)` : person.name;
  name.style.fontWeight = person.isYou ? '700' : '600';
  li.append(name);

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = tagText;
  li.append(tag);

  return li;
}

/**
 * @param {object} state stato proiettato dal server
 */
export function renderLobby(state) {
  el.code.textContent = state.code;
  el.url.textContent = location.host + BASE;

  el.players.replaceChildren(...state.players.map((player) => {
    let tag = '';
    if (player.id === state.hostId) tag = 'host';
    else if (player.isBot) tag = 'automatico';
    else if (!player.connected) tag = 'offline';
    return personRow(player, tag);
  }));

  const viewers = state.viewers ?? [];
  el.viewersBox.classList.toggle('hidden', viewers.length === 0);
  el.viewers.replaceChildren(...viewers.map((viewer) => personRow(viewer, 'ospite')));

  // L'ospite non ha comandi e non sta aspettando il proprio turno di giocare:
  // il messaggio d'attesa va cambiato, non solo nascosto.
  el.hostActions.classList.toggle('hidden', !state.isHost);
  el.wait.classList.toggle('hidden', state.isHost);
  el.wait.textContent = state.isViewer
    ? 'Stai guardando come ospite: la partita comincerà senza di te.'
    : 'In attesa che l\'host inizi la partita…';
}
