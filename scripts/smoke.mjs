/**
 * Prova end-to-end: si collega a un server JackOne già avviato, crea un tavolo
 * con due bot e gioca una mano intera stampando il registro.
 *
 *   node server/index.js --port 3210 --rigged
 *   node scripts/smoke.mjs 3210
 *
 * Al posto della porta si può dare un indirizzo intero, per provare un server
 * già installato — anche dietro a un reverse proxy:
 *
 *   node scripts/smoke.mjs wss://172.16.2.12/jackone/
 *
 * Serve a verificare a colpo d'occhio il giro completo (puntate, turni, effetti
 * delle speciali, fase del banco, riepilogo) senza aprire il browser.
 */

import { WebSocket } from 'ws';
import { C2S, PHASE, S2C } from '../shared/protocol.js';

const target = process.argv[2] ?? '3000';
const url = /^wss?:\/\//.test(target) ? target : `ws://127.0.0.1:${target}`;

// Il certificato del server di sviluppo è autofirmato e la verifica lo
// rifiuta. Disattivarla resta una scelta da dichiarare a mano, una volta per
// comando, perché toglie ogni difesa da un intermediario:
//
//   JACKONE_TLS_INSECURE=1 node scripts/smoke.mjs wss://172.16.2.12/jackone/
//
// L'alternativa pulita è NODE_EXTRA_CA_CERTS con il certificato del server.
const insicuro = process.env.JACKONE_TLS_INSECURE === '1';
const ws = new WebSocket(url, insicuro ? { rejectUnauthorized: false } : {});
const send = (t, payload = {}) => ws.send(JSON.stringify({ t, ...payload }));

let lastLogId = 0;
let finished = false;

ws.on('open', () => send(C2S.CREATE_ROOM, { name: 'Tester' }));

ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());

  if (message.t === S2C.ERROR) console.log('ERRORE:', message.code, message.message);

  if (message.t === S2C.WELCOME && message.playerId) {
    console.log(`Tavolo ${message.code}\n`);
    send(C2S.ADD_BOT);
    send(C2S.ADD_BOT);
    setTimeout(() => send(C2S.START_GAME), 100);
    return;
  }

  if (message.t !== S2C.ROOM_STATE) return;
  const state = message.state;

  // Il registro inviato è troncato alle ultime righe: si filtra per id, non per indice.
  for (const line of state.log.filter((entry) => entry.id > lastLogId)) {
    console.log('  ' + line.text);
    lastLogId = line.id;
  }

  if (state.you?.canBet) send(C2S.BET, { amount: 10 });
  if (state.you?.canAct) {
    const me = state.players.find((player) => player.isYou);
    setTimeout(() => send(me.score < 16 ? C2S.HIT : C2S.STAND), 150);
  }
  if (state.you?.mustSwap) {
    setTimeout(() => send(C2S.SWAP_TARGET, { targetId: state.swap.targets[0] }), 150);
  }
  if (state.canBlock) setTimeout(() => send(C2S.USE_BLOCK), 150);

  if (!finished && (state.phase === PHASE.PAYOUT || state.phase === PHASE.GAME_OVER)) {
    finished = true;
    console.log('\nFiches:', state.players.map((p) => `${p.name}=${p.chips}`).join('  '));
    setTimeout(() => process.exit(0), 200);
  }
});

ws.on('error', (error) => {
  console.error('Connessione fallita:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('La mano non si è conclusa entro 60s');
  process.exit(1);
}, 60000);
