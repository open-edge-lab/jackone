/**
 * Applicazione JackOne: server HTTP per il client statico più il server
 * WebSocket che instrada i messaggi verso le stanze.
 *
 * È separata dal punto d'ingresso perché i test la avviano su una porta
 * effimera senza passare dalla riga di comando.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { C2S, ERR, MAX_VIEWERS, PHASE, S2C, TIMERS } from '../shared/protocol.js';
import { cleanNickname, validateNickname } from '../shared/identity.js';
import { RoomRegistry } from './rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Foto dei partecipanti: `/avatar/<codice stanza>/<id>`.
 * La forma chiusa dell'espressione esclude da sé ogni tentativo di traversal.
 */
const AVATAR_URL = /^\/avatar\/([A-Za-z0-9]{4})\/([\w-]+)$/;

/**
 * Risolve un URL in un percorso di file, impedendo di uscire dalle cartelle servite.
 * @param {string} urlPath
 * @returns {string|null}
 */
function resolveStatic(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const [base, dir] = clean.startsWith('/shared/')
    ? [clean.slice('/shared/'.length), SHARED_DIR]
    : [clean === '/' ? 'index.html' : clean.replace(/^\//, ''), PUBLIC_DIR];
  const target = path.resolve(dir, base);
  return target.startsWith(dir) ? target : null;
}

/**
 * Crea server HTTP e WebSocket già collegati.
 * @param {{rigged?: boolean}} [options]
 * @returns {{server: import('node:http').Server, registry: RoomRegistry, close: Function}}
 */
export function createApp({ rigged = false } = {}) {
  const registry = new RoomRegistry({ rigged });

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    const avatarMatch = AVATAR_URL.exec(url.split('?')[0]);
    if (avatarMatch) {
      const [, code, id] = avatarMatch;
      const avatar = registry.get(code)?.avatars.get(id);
      if (!avatar) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nessun avatar');
        return;
      }
      // La versione è già nella URL, quindi il contenuto non cambia mai:
      // il browser può tenerselo senza chiedere altro.
      res.writeHead(200, {
        'Content-Type': avatar.mime,
        'Content-Length': avatar.bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(avatar.bytes);
      return;
    }

    const target = resolveStatic(url);
    if (!target) {
      res.writeHead(403).end('Accesso negato');
      return;
    }
    try {
      const body = await fs.readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Non trovato');
    }
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const socket = {
      send(message) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    };
    /** @type {{playerId: string|null, room: import('./rooms.js').Room|null}} */
    const session = { playerId: null, room: null };

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.send({ t: S2C.ERROR, code: ERR.BAD_MESSAGE, message: 'Messaggio non valido' });
        return;
      }
      try {
        handle(registry, session, socket, message);
      } catch (error) {
        console.error('Errore gestendo', message?.t, error);
        socket.send({ t: S2C.ERROR, code: ERR.BAD_MESSAGE, message: 'Azione non eseguibile' });
      }
    });

    ws.on('close', () => {
      if (session.room && session.playerId) session.room.detach(session.playerId);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, TIMERS.HEARTBEAT);
  heartbeat.unref();

  const close = () => {
    clearInterval(heartbeat);
    for (const room of registry.rooms.values()) room.dispose();
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => server.close(resolve));
  };

  return { server, registry, close };
}

// ---------------------------------------------------------- instradamento

function fail(socket, code, message) {
  socket.send({ t: S2C.ERROR, code, message });
}

/**
 * @param {object} room
 * @param {string} id
 * @returns {'player'|'viewer'} ruolo con cui il client deve presentarsi
 */
function roleOf(room, id) {
  return room.isViewer(id) ? 'viewer' : 'player';
}

/** Azioni di gioco inoltrate al motore, completate con l'id di sessione. */
const GAME_ACTIONS = {
  [C2S.BET]: (msg) => ({ type: 'BET', amount: Number(msg.amount) }),
  [C2S.HIT]: () => ({ type: 'HIT' }),
  [C2S.STAND]: () => ({ type: 'STAND' }),
  [C2S.SWAP_TARGET]: (msg) => ({ type: 'SWAP_TARGET', targetId: String(msg.targetId ?? '') }),
  [C2S.USE_BLOCK]: () => ({ type: 'USE_BLOCK' }),
};

/**
 * Gestisce un messaggio in arrivo da un client.
 * @param {RoomRegistry} registry
 * @param {{playerId: string|null, room: object|null}} session
 * @param {{send: Function}} socket
 * @param {object} message
 */
export function handle(registry, session, socket, message) {
  const { t } = message;

  if (t === C2S.HELLO) {
    const token = String(message.token ?? '');
    const room = token ? registry.findByToken(token) : null;
    const playerId = room?.playerIdForToken(token);
    if (room && playerId) {
      session.room = room;
      session.playerId = playerId;
      room.attach(playerId, socket);
      socket.send({ t: S2C.WELCOME, playerId, token, code: room.code, role: roleOf(room, playerId) });
      room.sendState(playerId);
    } else {
      socket.send({ t: S2C.WELCOME, playerId: null, token: null, code: null, role: null });
    }
    return;
  }

  if (t === C2S.CREATE_ROOM || t === C2S.JOIN_ROOM || t === C2S.WATCH_ROOM) {
    if (session.room) return fail(socket, ERR.ILLEGAL_ACTION, 'Sei già in una stanza');
    // Il nickname viene ripulito e validato con le stesse regole del client.
    const name = cleanNickname(message.name);
    const check = validateNickname(name);
    if (!check.ok) return fail(socket, ERR.BAD_MESSAGE, check.message);

    let room;
    if (t === C2S.CREATE_ROOM) {
      room = registry.create();
    } else {
      const code = String(message.code ?? '').trim().toUpperCase();
      room = registry.get(code);
      if (!room) {
        return fail(socket, ERR.ROOM_NOT_FOUND, `Nessun tavolo "${code}": è stato chiuso o il server è ripartito`);
      }
      // L'ospite non occupa un posto, quindi entra anche a tavolo pieno o a
      // partita iniziata: è l'unico modo di vedere una partita già in corso.
      if (t === C2S.WATCH_ROOM) {
        if (room.viewerCount >= MAX_VIEWERS) {
          return fail(socket, ERR.ROOM_FULL, 'Troppi ospiti collegati a questo tavolo');
        }
      } else if (!room.hasSeat) {
        return fail(socket, ERR.ROOM_FULL, 'Tavolo al completo');
      }
      if (room.hasName(name)) return fail(socket, ERR.NAME_TAKEN, 'Nome già usato al tavolo');
    }

    const { playerId, token } = t === C2S.WATCH_ROOM
      ? room.addViewer(name)
      : room.addHuman(name);
    session.room = room;
    session.playerId = playerId;
    room.attach(playerId, socket);
    socket.send({ t: S2C.WELCOME, playerId, token, code: room.code, role: roleOf(room, playerId) });
    room.sendState(playerId);
    return;
  }

  const { room, playerId } = session;
  if (!room || !playerId) return fail(socket, ERR.NOT_IN_ROOM, 'Non sei in una stanza');

  // Gli ospiti guardano e commentano, nient'altro. Il motore ignorerebbe già le
  // loro azioni (non hanno un posto da risolvere), ma un rifiuto esplicito
  // spiega cosa sta succedendo e tiene `LEAVE_ROOM` fuori da `dispatch`, che
  // riavvierebbe il timer della fase in corso.
  if (room.isViewer(playerId)) {
    switch (t) {
      case C2S.CHAT:
        room.chat(playerId, message.text);
        return;
      case C2S.SET_AVATAR:
        if (!room.setAvatar(playerId, message.data ?? null)) {
          return fail(socket, ERR.BAD_MESSAGE, 'Immagine non valida o troppo grande');
        }
        return;
      case C2S.LEAVE_ROOM:
        room.removeViewer(playerId);
        session.room = null;
        session.playerId = null;
        socket.send({ t: S2C.LEFT });
        return;
      default:
        return fail(socket, ERR.VIEWER_ONLY, 'Stai guardando come ospite: non puoi giocare');
    }
  }

  const isHost = room.state.hostId === playerId;

  switch (t) {
    case C2S.ADD_BOT:
      if (!isHost) return fail(socket, ERR.NOT_HOST, 'Solo l\'host può aggiungere bot');
      if (room.state.phase !== PHASE.LOBBY) return fail(socket, ERR.GAME_RUNNING, 'Partita in corso');
      if (!room.hasSeat) return fail(socket, ERR.ROOM_FULL, 'Tavolo al completo');
      room.addBot();
      return;

    case C2S.REMOVE_BOT:
      if (!isHost) return fail(socket, ERR.NOT_HOST, 'Solo l\'host può togliere bot');
      if (room.state.phase !== PHASE.LOBBY) return fail(socket, ERR.GAME_RUNNING, 'Partita in corso');
      room.removeLastBot();
      return;

    case C2S.START_GAME:
      if (!isHost) return fail(socket, ERR.NOT_HOST, 'Solo l\'host può iniziare');
      room.dispatch({ type: 'START_GAME' });
      return;

    case C2S.NEXT_HAND:
      if (!isHost) return fail(socket, ERR.NOT_HOST, 'Solo l\'host può proseguire');
      room.dispatch({ type: 'NEXT_HAND' });
      return;

    case C2S.CHAT:
      room.chat(playerId, message.text);
      return;

    case C2S.SET_AVATAR:
      if (!room.setAvatar(playerId, message.data ?? null)) {
        return fail(socket, ERR.BAD_MESSAGE, 'Immagine non valida o troppo grande');
      }
      return;

    case C2S.LEAVE_ROOM:
      room.leave(playerId);
      session.room = null;
      session.playerId = null;
      socket.send({ t: S2C.LEFT });
      return;

    default: {
      const build = GAME_ACTIONS[t];
      if (!build) return fail(socket, ERR.BAD_MESSAGE, `Messaggio sconosciuto: ${t}`);
      room.dispatch({ ...build(message), playerId });
    }
  }
}
