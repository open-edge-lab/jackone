# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

JackOne: blackjack giocato con le carte UNO, multiplayer in LAN. Server Node.js autoritativo,
client vanilla servito così com'è. Unica dipendenza runtime: `ws`.

## Lingua

**Tutto il progetto è in italiano**: commenti, JSDoc, nomi dei test, stringhe di log, testi
dell'interfaccia, messaggi d'errore verso il client. I nomi di variabili e funzioni sono in
inglese (`drawInitialCard`, `viewerCount`), i commenti che li spiegano in italiano. Il codice
nuovo deve seguire la stessa convenzione.

## Comandi

```bash
npm start                        # http://localhost:3000
npm start -- --port 8080         # altra porta
node server/index.js --rigged    # carte speciali in cima al mazzo (debug)

npm test                         # tutta la suite (node:test)
node --test test/engine.test.js  # un solo file
node --test --test-name-pattern="il divieto"   # un solo test per nome

npm start &                      # lo smoke test richiede un server già avviato
node scripts/smoke.mjs 3000      # gioca una mano intera da terminale e stampa il registro
```

Non c'è build step, bundler, linter né TypeScript: si modifica e si ricarica. Non esiste
watch mode, il server va riavviato a mano.

## Architettura

### Il motore è un riduttore puro

`server/game/engine.js` espone `reduce(state, action) → {state, events}`: sincrono, senza
socket, timer o I/O, con `structuredClone` dello stato in ingresso. Tutto il regolamento vive
qui ed è verificabile senza rete. Timer e connessioni stanno in `server/rooms.js` e si
limitano a **iniettare azioni** nel motore.

Corollario: una regola di gioco si cambia solo in `engine.js`/`rules.js`, e il test giusto è
in `test/engine.test.js`, non in un test di integrazione.

### `dispatch` contro `announce` — la trappola principale

`Room.dispatch(action)` fa girare il motore e poi chiama `scheduleTimers()`, che **azzera e
riavvia il timer della fase in corso**. Qualunque cosa non sia gioco (ingresso o uscita di un
ospite, cambio avatar, chat) deve passare da `Room.announce(events)`, che aggiorna registro e
client senza toccare i timer. Usare `dispatch` per un evento non di gioco regala 30 secondi
extra a chi è di turno ogni volta che qualcuno si affaccia a guardare.

Il test *«un ospite che entra o esce non tocca il timer della fase in corso»* in
`test/integration.test.js` esiste per bloccare questa regressione.

### Il client non calcola nulla

`server/view.js` → `projectState(room, playerId)` produce, **per ogni singolo destinatario**,
esattamente ciò che serve a disegnare la schermata: liste già filtrate, booleani già decisi
(`canBet`, `canAct`, `mustSwap`, `canBlock`, `isHost`, `isViewer`), tempo residuo in
millisecondi invece di una scadenza assoluta (gli orologi dei client non devono essere
allineati). L'unica informazione nascosta è la prima carta del banco.

Aggiungere una funzionalità visibile significa quasi sempre aggiungere un campo qui e leggerlo
nel renderer. Il client non deve dedurre stato di gioco da solo.

### Validazione a due strati

I reducer del motore ririsolvono sempre il posto da `playerId` e fanno **silenziosamente
no-op** se non lo trovano o se la fase è sbagliata: un id senza posto è quindi già inerte per
ogni azione. `server/app.js` aggiunge sopra un cancello esplicito, che serve a dare un errore
comprensibile (`VIEWER_ONLY`, `NOT_HOST`, `ROOM_FULL`) e a tenere fuori da `dispatch` le azioni
che non devono toccare i timer.

### Sessioni, ospiti, avatar

Nessuna autenticazione: nickname più codice tavolo di 4 caratteri. Il "login" è un token opaco
per stanza in `Room.tokens` (`token → id`), salvato in `localStorage` e rispedito con `HELLO`
a ogni apertura di socket; `net.js` riconnette da solo con backoff.

**Ospiti**: anagrafica separata in `Room.viewers`, ma il socket sta nella stessa
`Room.sockets` chiavata sull'id, così `broadcast` e `projectState` funzionano senza modifiche
e l'ospite riceve uno stato con `you: null`. Guarda e chatta, nient'altro. Entra sempre, anche
a tavolo pieno o a partita iniziata.

**Avatar**: i byte non entrano mai nello stato (che viene ritrasmesso a ogni azione, a ogni
client). Restano in `Room.avatars` e viaggia solo una URL versionata
`/avatar/<codice>/<id>?v=N`, servita dal gestore HTTP in `app.js` con cache immutabile. La foto
è ritagliata e ridotta a 128×128 nel browser prima di partire.

### `shared/` è isomorfo

`shared/` è importato dal server **e servito al browser** su `/shared/...` (ramo dedicato in
`resolveStatic`, `server/app.js`). I moduli lì dentro non possono usare API Node (`Buffer`,
`fs`) né il DOM. `shared/avatar.js` per esempio misura la base64 con l'aritmetica proprio per
non dipendere né da `Buffer` né da `atob`; la conversione in byte la fa il chiamante.

Serve a far applicare le stesse regole da entrambe le parti: `identity.js` (validazione
nickname, colori, iniziali) è usato dal client per l'anteprima e dal server per la verifica
vera.

### Bot e giocatori caduti

`server/game/bots.js` serve due casi con la stessa logica: i bot dell'host e gli umani
disconnessi, che il server gioca in automatico per non bloccare il tavolo (politica prudente:
punta il minimo, sta subito). Un posto non viene mai liberato per disconnessione — `detach`
segna `connected: false`, il posto resta e si riprende col token.

## Scrivere test del motore

`test/engine.test.js` costruisce le mani con `dealt(cards)`, che impila un mazzo esatto:
`mkDeck` rovescia l'array perché le carte si pescano dal fondo. L'ordine di consumo è giro 1
(giocatori, poi banco), giro 2, poi le pescate.

**Le carte iniziali impilate devono essere numeri.** La distribuzione scarta e ripesca le
speciali, quindi metterne una fra le prime consuma carte in più e disallinea tutte le pescate
successive del test.

I test di integrazione (`test/integration.test.js`) usano client WebSocket veri contro un
server su porta effimera, con un helper `settle()` da 60 ms fra le azioni.
