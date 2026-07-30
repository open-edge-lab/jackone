/**
 * Avvio del client JackOne: collega la rete allo stato e sceglie la schermata
 * da mostrare a ogni aggiornamento.
 */

import { C2S, EV, PHASE, S2C } from '../shared/protocol.js';
import { BASE } from './base.js';
import {
  cleanNickname,
  preferredColorIndex,
  randomNickname,
  validateNickname,
} from '../shared/identity.js';
import { connect, on, send, setToken } from './net.js';
import { app, subscribe, update } from './store.js';
import { paintAvatar } from './ui/avatar.js';
import { photoFromFile, storePhoto, storedPhoto } from './ui/avatar-picker.js';
import { renderLobby } from './ui/lobby.js';
import { confirmLeave, noteDiscarded, renderTable, resetTable } from './ui/table.js';
import { resetCardMemory } from './ui/card.js';

const NAME_KEY = 'jackone.name';
/** Parametro del link d'invito: `/?t=ABCD` precompila il codice del tavolo. */
const CODE_PARAM = 't';

const screens = {
  join: document.getElementById('screen-join'),
  lobby: document.getElementById('screen-lobby'),
  table: document.getElementById('screen-table'),
};

const el = {
  name: document.getElementById('input-name'),
  code: document.getElementById('input-code'),
  formJoin: document.getElementById('form-join'),
  nickAvatar: document.getElementById('nick-avatar'),
  nickPreview: document.getElementById('nick-preview'),
  nickNote: document.getElementById('nick-note'),
  btnRandom: document.getElementById('btn-random'),
  btnPhoto: document.getElementById('btn-photo'),
  btnPhotoClear: document.getElementById('btn-photo-clear'),
  inputPhoto: document.getElementById('input-photo'),
  btnCreate: document.getElementById('btn-create'),
  btnJoin: document.getElementById('btn-join'),
  btnWatch: document.getElementById('btn-watch'),
  btnLeaveLobby: document.getElementById('btn-leave-lobby'),
  btnLeaveTable: document.getElementById('btn-leave-table'),
  btnCopyLobby: document.getElementById('btn-copy-lobby'),
  btnCopyTable: document.getElementById('btn-copy-table'),
  btnAddBot: document.getElementById('btn-add-bot'),
  btnRemoveBot: document.getElementById('btn-remove-bot'),
  btnStart: document.getElementById('btn-start'),
  btnLogToggle: document.getElementById('btn-log-toggle'),
  logPanel: document.getElementById('log-panel'),
  formChat: document.getElementById('form-chat'),
  inputChat: document.getElementById('input-chat'),
  toast: document.getElementById('toast'),
  connection: document.getElementById('connection'),
};

// ------------------------------------------------------------- schermate

function show(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle('hidden', key !== name);
  }
}

subscribe((store) => {
  el.connection.classList.toggle('hidden', !store.offline);

  if (!store.state) {
    show('join');
    return;
  }
  if (store.state.phase === PHASE.LOBBY) {
    renderLobby(store.state);
    show('lobby');
    return;
  }
  renderTable(store.state);
  show('table');
});

// ------------------------------------------------------------------ rete

on('open', () => update({ offline: false }));
on('closed', () => update({ offline: true }));

on(S2C.WELCOME, (message) => {
  if (message.playerId) {
    setToken(message.token);
    update({ playerId: message.playerId, code: message.code, role: message.role ?? 'player' });
    // La foto viaggia a parte: qui vale sia per un ingresso sia per un rientro
    // dopo una disconnessione, perché il server non la conserva fra le stanze.
    const photo = storedPhoto();
    if (photo) send(C2S.SET_AVATAR, { data: photo });
  } else {
    setToken(null);
    resetTable();
    update({ playerId: null, code: null, role: null, state: null });
  }
});

on(S2C.ROOM_STATE, (message) => update({ state: message.state }));

on(S2C.EVENTS, (message) => {
  for (const event of message.events) {
    // A ogni nuova mano le carte tornano "mai viste" e rientrano animate.
    if (event.type === EV.HAND_STARTED) resetCardMemory();
    // Le speciali appena scartate vanno evidenziate quando entrano nella pila.
    if (event.type === EV.CARD_DISCARDED) noteDiscarded(event.card);
    // Il turno che si chiude da solo va spiegato a chi lo subisce.
    if (event.type === EV.TURN_BLOCKED && event.playerId === app.state?.youId) {
      toast('Divieto: il tuo turno finisce qui', 'info');
    }
  }
});

on(S2C.LEFT, () => {
  setToken(null);
  resetTable();
  update({ playerId: null, code: null, role: null, state: null });
});

on(S2C.ERROR, (message) => toast(message.message ?? 'Errore'));

let toastTimer = null;
/**
 * @param {string} text
 * @param {'error'|'info'|'ok'} [kind] tinta dell'avviso
 */
function toast(text, kind = 'error') {
  el.toast.textContent = text;
  el.toast.className = `toast toast--${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
}

// -------------------------------------------------------------- comandi

const NOTE_DEFAULT = 'Sarà il nome con cui ti vedono al tavolo.';

/**
 * Aggiorna l'anteprima del nickname (iniziali, colore, messaggio) e abilita o
 * blocca i pulsanti di accesso. La validazione è la stessa applicata dal server.
 */
function refreshNickPreview() {
  const nickname = cleanNickname(el.name.value);
  const check = nickname ? validateNickname(nickname) : { ok: false, message: '' };
  const photo = storedPhoto();

  // Stessa pastiglia che si vedrà al tavolo: foto se c'è, iniziali altrimenti.
  paintAvatar(el.nickAvatar, nickname
    ? { name: nickname, colorIndex: preferredColorIndex(nickname), avatar: photo }
    : { name: '', colorIndex: null, avatar: photo });
  el.nickPreview.textContent = nickname || 'Scegli un nickname';
  el.btnPhotoClear.classList.toggle('hidden', !photo);

  const invalid = Boolean(nickname) && !check.ok;
  el.nickNote.textContent = invalid ? check.message : NOTE_DEFAULT;
  el.nickNote.classList.toggle('nick__note--error', invalid);
  el.btnCreate.disabled = !check.ok;
  el.btnJoin.disabled = !check.ok;
  el.btnWatch.disabled = !check.ok;
  return check.ok ? nickname : null;
}

/** Nickname valido da inviare al server, oppure null con avviso a schermo. */
function playerName() {
  const nickname = refreshNickPreview();
  if (!nickname) {
    el.name.focus();
    toast(validateNickname(cleanNickname(el.name.value)).message ?? 'Scegli un nickname');
    return null;
  }
  try {
    localStorage.setItem(NAME_KEY, nickname);
  } catch { /* niente da fare */ }
  return nickname;
}

el.btnCreate.addEventListener('click', () => {
  const name = playerName();
  if (name) send(C2S.CREATE_ROOM, { name });
});

/** Codice del tavolo valido da inviare, oppure null con avviso a schermo. */
function tableCode() {
  const code = el.code.value.trim().toUpperCase();
  if (code.length !== 4) {
    el.code.focus();
    toast('Il codice ha 4 caratteri');
    return null;
  }
  return code;
}

el.formJoin.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = playerName();
  if (!name) return;
  const code = tableCode();
  if (code) send(C2S.JOIN_ROOM, { name, code });
});

// Da ospite si entra sempre: il tavolo pieno o la partita in corso non contano,
// perché non si occupa nessun posto.
el.btnWatch.addEventListener('click', () => {
  const name = playerName();
  if (!name) return;
  const code = tableCode();
  if (code) send(C2S.WATCH_ROOM, { name, code });
});

el.btnLeaveLobby.addEventListener('click', () => send(C2S.LEAVE_ROOM));

el.btnLeaveTable.addEventListener('click', async () => {
  if (await confirmLeave(app.state?.isViewer)) send(C2S.LEAVE_ROOM);
});

/**
 * Copia negli appunti il link d'invito al tavolo.
 * `navigator.clipboard` non esiste fuori dai contesti sicuri (in LAN si gioca
 * su http://), quindi resta il ripiego con la textarea temporanea.
 */
async function copyInvite() {
  const code = app.state?.code;
  if (!code) return;
  const link = `${location.origin}${BASE}?${CODE_PARAM}=${code}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const box = document.createElement('textarea');
      box.value = link;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.append(box);
      box.select();
      document.execCommand('copy');
      box.remove();
    }
    toast('Invito copiato negli appunti', 'ok');
  } catch {
    toast(`Invito: ${link}`, 'info');
  }
}

el.btnCopyLobby.addEventListener('click', copyInvite);
el.btnCopyTable.addEventListener('click', copyInvite);
el.btnAddBot.addEventListener('click', () => send(C2S.ADD_BOT));
el.btnRemoveBot.addEventListener('click', () => send(C2S.REMOVE_BOT));
el.btnStart.addEventListener('click', () => send(C2S.START_GAME));

el.btnLogToggle.addEventListener('click', () => el.logPanel.classList.toggle('is-open'));

el.formChat.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.inputChat.value.trim();
  if (!text) return;
  send(C2S.CHAT, { text });
  el.inputChat.value = '';
});

// Scorciatoie da tastiera per il turno: C = carta, S = stai.
document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea')) return;
  const state = app.state;
  if (!state?.you?.canAct) return;
  if (event.key === 'c' || event.key === 'C') send(C2S.HIT);
  if (event.key === 's' || event.key === 'S') send(C2S.STAND);
});

// -------------------------------------------------------------- partenza

el.name.addEventListener('input', refreshNickPreview);

el.btnRandom.addEventListener('click', () => {
  el.name.value = randomNickname();
  refreshNickPreview();
  el.name.focus();
});

// ---------------------------------------------------------------- foto

el.btnPhoto.addEventListener('click', () => el.inputPhoto.click());

el.inputPhoto.addEventListener('change', async () => {
  const file = el.inputPhoto.files?.[0];
  // Il campo viene svuotato subito: altrimenti riscegliere lo stesso file non
  // farebbe scattare un nuovo `change`.
  el.inputPhoto.value = '';
  if (!file) return;

  try {
    const photo = await photoFromFile(file);
    storePhoto(photo);
    refreshNickPreview();
    // A tavolo già preso, la foto va comunicata subito agli altri.
    if (app.playerId) send(C2S.SET_AVATAR, { data: photo });
    toast('Foto impostata', 'ok');
  } catch (error) {
    toast(error.message ?? 'Immagine non valida');
  }
});

el.btnPhotoClear.addEventListener('click', () => {
  storePhoto(null);
  refreshNickPreview();
  if (app.playerId) send(C2S.SET_AVATAR, { data: null });
});

try {
  const saved = localStorage.getItem(NAME_KEY);
  if (saved) el.name.value = saved;
} catch { /* niente da fare */ }
refreshNickPreview();

el.code.addEventListener('input', () => {
  el.code.value = el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Chi arriva da un link d'invito trova il codice già scritto: niente refusi.
const invited = new URLSearchParams(location.search).get(CODE_PARAM);
if (invited) {
  el.code.value = invited.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (el.name.value) el.code.focus();
}

connect();
