import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { createApp } from '../server/app.js';
import { C2S, ERR, MAX_SEATS, PHASE, S2C } from '../shared/protocol.js';

let app;
let port;

before(async () => {
  app = createApp({});
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  port = app.server.address().port;
});

after(async () => {
  await app.close();
});

/** Client di prova: apre la connessione e mette in coda i messaggi ricevuti. */
class Client {
  constructor() {
    this.messages = [];
    this.waiters = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      for (const waiter of this.waiters.splice(0)) waiter(message);
    });
  }

  static async open() {
    const client = new Client();
    await new Promise((resolve, reject) => {
      client.ws.once('open', resolve);
      client.ws.once('error', reject);
    });
    return client;
  }

  send(t, payload = {}) {
    this.ws.send(JSON.stringify({ t, ...payload }));
  }

  /** Attende il primo messaggio del tipo indicato (anche se già arrivato). */
  async waitFor(type, { timeout = 2000 } = {}) {
    const existing = this.messages.find((m) => m.t === type);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Nessun ${type} entro ${timeout}ms`)), timeout);
      const check = (message) => {
        if (message.t === type) {
          clearTimeout(timer);
          resolve(message);
        } else {
          this.waiters.push(check);
        }
      };
      this.waiters.push(check);
    });
  }

  /** Ultimo stato ricevuto. */
  get state() {
    return [...this.messages].reverse().find((m) => m.t === S2C.ROOM_STATE)?.state ?? null;
  }

  clear() {
    this.messages.length = 0;
  }

  close() {
    this.ws.close();
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test('il primo saluto senza token non assegna nessuna stanza', async () => {
  const client = await Client.open();
  client.send(C2S.HELLO, { token: null });
  const welcome = await client.waitFor(S2C.WELCOME);

  assert.equal(welcome.playerId, null);
  assert.equal(welcome.code, null);
  client.close();
});

test('creare una stanza restituisce un codice di quattro caratteri', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const welcome = await host.waitFor(S2C.WELCOME);

  assert.match(welcome.code, /^[A-Z0-9]{4}$/);
  assert.ok(welcome.playerId);
  assert.ok(welcome.token);

  const state = (await host.waitFor(S2C.ROOM_STATE)).state;
  assert.equal(state.phase, PHASE.LOBBY);
  assert.equal(state.players.length, 1);
  assert.equal(state.isHost, true);
  host.close();
});

test('un secondo giocatore entra col codice e tutti vedono il tavolo aggiornato', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  host.clear();

  const guest = await Client.open();
  guest.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  await guest.waitFor(S2C.WELCOME);
  await settle();

  assert.equal(guest.state.players.length, 2);
  assert.equal(guest.state.isHost, false);
  assert.equal(host.state.players.length, 2, 'anche l\'host riceve il nuovo stato');
  assert.deepEqual(host.state.players.map((p) => p.name), ['Anna', 'Marco']);

  host.close();
  guest.close();
});

test('codice inesistente e nome duplicato vengono rifiutati', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const lost = await Client.open();
  lost.send(C2S.JOIN_ROOM, { name: 'Marco', code: 'ZZZZ' });
  assert.equal((await lost.waitFor(S2C.ERROR)).code, ERR.ROOM_NOT_FOUND);
  lost.close();

  const twin = await Client.open();
  twin.send(C2S.JOIN_ROOM, { name: 'anna', code });
  assert.equal((await twin.waitFor(S2C.ERROR)).code, ERR.NAME_TAKEN);
  twin.close();

  host.close();
});

test('solo l\'host può aggiungere bot e avviare la partita', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const guest = await Client.open();
  guest.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  await guest.waitFor(S2C.WELCOME);

  guest.send(C2S.START_GAME);
  assert.equal((await guest.waitFor(S2C.ERROR)).code, ERR.NOT_HOST);

  host.send(C2S.ADD_BOT);
  await settle();
  assert.equal(host.state.players.length, 3);
  assert.ok(host.state.players.some((p) => p.isBot));

  host.send(C2S.START_GAME);
  await settle();
  assert.equal(host.state.phase, PHASE.BETTING, 'la partita entra nella fase puntate');
  assert.equal(guest.state.phase, PHASE.BETTING);

  host.close();
  guest.close();
});

test('si entra col codice anche a partita già iniziata', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  host.send(C2S.ADD_BOT);
  await settle();
  host.send(C2S.START_GAME);
  await settle();
  host.send(C2S.BET, { amount: 10 });
  await settle();
  assert.notEqual(host.state.phase, PHASE.LOBBY, 'la mano è in corso');

  const late = await Client.open();
  late.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  const welcome = await late.waitFor(S2C.WELCOME);
  await settle();

  assert.ok(welcome.playerId, 'nessun errore: il tavolo esiste ancora');
  assert.equal(late.messages.some((m) => m.t === S2C.ERROR), false);
  assert.equal(welcome.code, code);

  const seat = late.state.players.find((p) => p.name === 'Marco');
  assert.ok(seat, 'il nuovo posto compare a tutti');
  assert.equal(seat.status, 'waiting', 'resta in attesa fino alla mano successiva');
  assert.ok(host.state.players.some((p) => p.name === 'Marco'));

  host.close();
  late.close();
});

test('la carta coperta del banco non viaggia verso i client', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  await host.waitFor(S2C.WELCOME);
  host.send(C2S.START_GAME);
  await settle();

  host.send(C2S.BET, { amount: 10 });
  await settle();

  const { dealer } = host.state;
  assert.equal(dealer.cards.length, 2);
  assert.equal(dealer.cards[0].hidden, true, 'la prima carta è solo un segnaposto');
  assert.equal(dealer.cards[0].kind, undefined);
  assert.ok(dealer.cards[1].kind, 'la seconda è scoperta');

  host.close();
});

test('riconnettersi con il token restituisce lo stesso posto', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code, token, playerId } = await host.waitFor(S2C.WELCOME);
  host.send(C2S.START_GAME);
  await settle();
  host.send(C2S.BET, { amount: 25 });
  await settle();

  host.ws.terminate();
  await settle();

  const back = await Client.open();
  back.send(C2S.HELLO, { token });
  const welcome = await back.waitFor(S2C.WELCOME);

  assert.equal(welcome.playerId, playerId);
  assert.equal(welcome.code, code);
  const seat = back.state.players.find((p) => p.id === playerId);
  assert.equal(seat.bet, 25, 'la mano in corso è intatta');
  assert.equal(seat.connected, true);

  back.close();
});

test('i nickname troppo corti o con caratteri strani vengono rifiutati', async () => {
  const client = await Client.open();
  client.send(C2S.CREATE_ROOM, { name: 'a' });
  const short = await client.waitFor(S2C.ERROR);
  assert.equal(short.code, ERR.BAD_MESSAGE);
  assert.match(short.message, /almeno/);
  client.clear();

  client.send(C2S.CREATE_ROOM, { name: '<script>' });
  assert.equal((await client.waitFor(S2C.ERROR)).code, ERR.BAD_MESSAGE);
  assert.equal(client.state, null, 'nessuna stanza creata');
  client.close();
});

test('ogni giocatore riceve un colore diverso, visibile a tutti', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const guest = await Client.open();
  guest.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  await guest.waitFor(S2C.WELCOME);
  host.send(C2S.ADD_BOT);
  await settle();

  const colors = host.state.players.map((p) => p.colorIndex);
  assert.equal(colors.length, 3);
  assert.ok(colors.every((c) => Number.isInteger(c)));
  assert.equal(new Set(colors).size, 3);
  assert.deepEqual(
    guest.state.players.map((p) => [p.name, p.colorIndex]),
    host.state.players.map((p) => [p.name, p.colorIndex]),
    'tutti vedono gli stessi nickname con gli stessi colori',
  );

  host.close();
  guest.close();
});

test('la chat arriva a tutti i presenti', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  const guest = await Client.open();
  guest.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  await guest.waitFor(S2C.WELCOME);

  guest.send(C2S.CHAT, { text: 'ciao a tutti' });
  await settle();

  const line = host.state.log.find((entry) => entry.text === 'Marco: ciao a tutti');
  assert.ok(line, 'il messaggio compare nel registro');
  const marco = host.state.players.find((p) => p.name === 'Marco');
  assert.equal(line.playerId, marco.id, 'la riga porta l\'autore, per colorarla');
  host.close();
  guest.close();
});

test('uscire dal tavolo libera il posto', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  const guest = await Client.open();
  guest.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  await guest.waitFor(S2C.WELCOME);

  guest.send(C2S.LEAVE_ROOM);
  await guest.waitFor(S2C.LEFT);
  await settle();

  assert.equal(host.state.players.length, 1);
  host.close();
  guest.close();
});

// ------------------------------------------------------------------ ospiti

/** Riempie il tavolo con dei bot fino al limite dei posti. */
async function fillWithBots(host, seats) {
  for (let i = host.state.players.length; i < seats; i += 1) {
    host.send(C2S.ADD_BOT);
    await settle();
  }
}

test('si entra come ospite anche a tavolo pieno', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  await settle();
  await fillWithBots(host, MAX_SEATS);
  assert.equal(host.state.players.length, MAX_SEATS, 'il tavolo è al completo');

  const respinto = await Client.open();
  respinto.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  assert.equal((await respinto.waitFor(S2C.ERROR)).code, ERR.ROOM_FULL, 'da giocatore non si entra');
  respinto.close();

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  const welcome = await ospite.waitFor(S2C.WELCOME);
  await settle();

  assert.equal(welcome.role, 'viewer');
  assert.ok(welcome.playerId);
  assert.equal(ospite.state.you, null, 'nessun posto, nessun comando');
  assert.equal(ospite.state.isViewer, true);
  assert.equal(ospite.state.isHost, false);
  assert.equal(ospite.state.players.length, MAX_SEATS, 'ma vede tutto il tavolo');

  host.close();
  ospite.close();
});

test('i giocatori vedono chi è collegato come ospite', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  await ospite.waitFor(S2C.WELCOME);
  await settle();

  assert.deepEqual(host.state.viewers.map((v) => v.name), ['Marco']);
  assert.equal(host.state.players.length, 1, 'l\'ospite non occupa un posto');
  assert.ok(host.state.log.some((l) => l.text === 'Marco guarda la partita'));
  const [visto] = host.state.viewers;
  assert.equal(visto.isYou, false);
  assert.equal(ospite.state.viewers[0].isYou, true);

  ospite.send(C2S.LEAVE_ROOM);
  await ospite.waitFor(S2C.LEFT);
  await settle();
  assert.equal(host.state.viewers.length, 0, 'chi smette di guardare sparisce dall\'elenco');
  assert.ok(host.state.log.some((l) => l.text === 'Marco smette di guardare'));

  host.close();
  ospite.close();
});

test('l\'ospite non può giocare né comandare il tavolo', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  host.send(C2S.ADD_BOT);
  await settle();
  host.send(C2S.START_GAME);
  await settle();

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  await ospite.waitFor(S2C.WELCOME);
  await settle();
  const prima = JSON.stringify(host.state.players);
  ospite.clear();

  for (const azione of [C2S.BET, C2S.HIT, C2S.STAND, C2S.USE_BLOCK, C2S.START_GAME, C2S.ADD_BOT]) {
    ospite.send(azione, { amount: 50 });
  }
  await settle();

  const errori = ospite.messages.filter((m) => m.t === S2C.ERROR);
  assert.equal(errori.length, 6, 'ogni azione viene respinta');
  assert.ok(errori.every((e) => e.code === ERR.VIEWER_ONLY));
  assert.equal(JSON.stringify(host.state.players), prima, 'il tavolo non si è mosso');

  host.close();
  ospite.close();
});

test('l\'ospite commenta in chat e la riga è marcata come tale', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  const { playerId } = await ospite.waitFor(S2C.WELCOME);

  ospite.send(C2S.CHAT, { text: 'bella mano' });
  await settle();

  const riga = host.state.log.find((l) => l.text === 'Marco: bella mano');
  assert.ok(riga, 'il commento arriva ai giocatori');
  assert.equal(riga.role, 'viewer', 'la riga si distingue da quella di chi gioca');
  assert.equal(riga.playerId, playerId, 'porta l\'autore, per colorarla');

  host.close();
  ospite.close();
});

test('un ospite che entra o esce non tocca il timer della fase in corso', async () => {
  // Due umani e nessun bot: durante il turno nessuna mossa automatica scatta,
  // quindi ogni variazione del timer sarebbe imputabile solo all'ospite.
  const anna = await Client.open();
  anna.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await anna.waitFor(S2C.WELCOME);
  const marco = await Client.open();
  marco.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  await marco.waitFor(S2C.WELCOME);
  anna.send(C2S.START_GAME);
  await settle();
  anna.send(C2S.BET, { amount: 10 });
  marco.send(C2S.BET, { amount: 10 });
  await settle();
  assert.equal(anna.state.phase, PHASE.PLAYER_TURN);

  const prima = anna.state.timer.id;

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Ospite', code });
  await ospite.waitFor(S2C.WELCOME);
  await settle();
  assert.equal(anna.state.timer.id, prima, 'l\'ingresso non riavvia il conto alla rovescia');

  ospite.send(C2S.CHAT, { text: 'ciao' });
  await settle();
  assert.equal(anna.state.timer.id, prima, 'nemmeno la chat lo riavvia');

  ospite.send(C2S.LEAVE_ROOM);
  await ospite.waitFor(S2C.LEFT);
  await settle();
  assert.equal(anna.state.timer.id, prima, 'nemmeno l\'uscita');
  assert.equal(anna.state.phase, PHASE.PLAYER_TURN, 'la mano prosegue indisturbata');

  anna.close();
  marco.close();
  ospite.close();
});

test('un ospite riprende il suo posto in elenco con il token', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  const { token, playerId } = await ospite.waitFor(S2C.WELCOME);
  await settle();

  ospite.ws.terminate();
  await settle();
  assert.equal(host.state.viewers.length, 0, 'un ospite caduto non resta in elenco');

  const back = await Client.open();
  back.send(C2S.HELLO, { token });
  const welcome = await back.waitFor(S2C.WELCOME);
  await settle();

  assert.equal(welcome.playerId, playerId);
  assert.equal(welcome.role, 'viewer', 'si torna ospite, non giocatore');
  assert.equal(back.state.isViewer, true);
  assert.deepEqual(host.state.viewers.map((v) => v.name), ['Marco']);

  host.close();
  back.close();
});

test('il nickname di un ospite non può ripetere quello di un giocatore', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const gemello = await Client.open();
  gemello.send(C2S.WATCH_ROOM, { name: 'anna', code });
  assert.equal((await gemello.waitFor(S2C.ERROR)).code, ERR.NAME_TAKEN);
  gemello.close();

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  await ospite.waitFor(S2C.WELCOME);
  await settle();

  const dopo = await Client.open();
  dopo.send(C2S.JOIN_ROOM, { name: 'Marco', code });
  assert.equal((await dopo.waitFor(S2C.ERROR)).code, ERR.NAME_TAKEN, 'vale anche al contrario');
  dopo.close();

  host.close();
  ospite.close();
});

// ------------------------------------------------------------------ avatar

/** PNG 1×1 trasparente: il contenuto non conta, conta che sia valido. */
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
  + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('la foto di un giocatore viaggia come indirizzo e si scarica dal server', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code, playerId } = await host.waitFor(S2C.WELCOME);
  await settle();
  assert.equal(host.state.players[0].avatar, null, 'senza foto restano le iniziali');

  host.send(C2S.SET_AVATAR, { data: PNG_1x1 });
  await settle();

  const url = host.state.players[0].avatar;
  assert.match(url, new RegExp(`^/avatar/${code}/${playerId}\\?v=1$`));
  assert.ok(
    JSON.stringify(host.state).length < 4000,
    'i byte dell\'immagine non finiscono dentro lo stato',
  );

  const risposta = await fetch(`http://127.0.0.1:${port}${url}`);
  assert.equal(risposta.status, 200);
  assert.equal(risposta.headers.get('content-type'), 'image/png');
  assert.ok((await risposta.arrayBuffer()).byteLength > 0);

  // Una foto nuova cambia versione, così la cache del browser non serve la vecchia.
  host.send(C2S.SET_AVATAR, { data: PNG_1x1 });
  await settle();
  assert.match(host.state.players[0].avatar, /\?v=2$/);

  host.send(C2S.SET_AVATAR, { data: null });
  await settle();
  assert.equal(host.state.players[0].avatar, null, 'si può tornare alle iniziali');

  host.close();
});

test('anche gli ospiti hanno la loro foto', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);

  const ospite = await Client.open();
  ospite.send(C2S.WATCH_ROOM, { name: 'Marco', code });
  await ospite.waitFor(S2C.WELCOME);
  ospite.send(C2S.SET_AVATAR, { data: PNG_1x1 });
  await settle();

  const url = host.state.viewers[0].avatar;
  assert.ok(url, 'i giocatori vedono la foto dell\'ospite');
  assert.equal((await fetch(`http://127.0.0.1:${port}${url}`)).status, 200);

  host.close();
  ospite.close();
});

test('le immagini non valide vengono rifiutate e non lasciano tracce', async () => {
  const host = await Client.open();
  host.send(C2S.CREATE_ROOM, { name: 'Anna' });
  const { code } = await host.waitFor(S2C.WELCOME);
  await settle();

  const rifiuti = [
    'non una data url',
    'data:text/html;base64,PGI+',                    // tipo non ammesso
    'data:image/gif;base64,R0lGOD',                  // formato non ammesso
    `data:image/png;base64,${'A'.repeat(70000)}`,    // oltre AVATAR_MAX_BYTES
  ];
  for (const data of rifiuti) host.send(C2S.SET_AVATAR, { data });
  await settle();

  const errori = host.messages.filter((m) => m.t === S2C.ERROR);
  assert.equal(errori.length, rifiuti.length, 'ogni immagine viene rifiutata');
  assert.ok(errori.every((e) => e.code === ERR.BAD_MESSAGE));
  assert.equal(host.state.players[0].avatar, null, 'nessuna foto impostata');

  assert.equal((await fetch(`http://127.0.0.1:${port}/avatar/${code}/inesistente`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/avatar/ZZZZ/qualcuno`)).status, 404);

  host.close();
});

test('i messaggi malformati non abbattono la connessione', async () => {
  const client = await Client.open();
  client.ws.send('non è json');
  assert.equal((await client.waitFor(S2C.ERROR)).code, ERR.BAD_MESSAGE);

  client.send('QUALCOSA_DI_IGNOTO');
  await settle();
  assert.equal(client.ws.readyState, WebSocket.OPEN);
  client.close();
});
