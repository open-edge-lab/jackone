/**
 * Avvio di JackOne dalla riga di comando.
 *
 *   node server/index.js [--port 3000] [--rigged]
 *
 * --rigged porta le carte speciali in cima al mazzo: serve per provare a mano
 * tutti gli effetti senza dipendere dalla fortuna.
 */

import os from 'node:os';
import { createApp } from './app.js';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const PORT = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT) || 3000;
const RIGGED = args.includes('--rigged');

/** @returns {Array<string>} indirizzi IPv4 raggiungibili dagli altri dispositivi in LAN */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);
}

const { server } = createApp({ rigged: RIGGED });

server.listen(PORT, () => {
  console.log(`\n  JackOne è in ascolto${RIGGED ? '  [mazzo truccato per i test]' : ''}`);
  console.log(`  Su questo PC:  http://localhost:${PORT}`);
  for (const address of lanAddresses()) {
    console.log(`  In LAN:        http://${address}:${PORT}`);
  }
  console.log('');
});
