# JackOne

Blackjack giocato con le carte UNO, multiplayer in LAN.
Si arriva a 21 come nel blackjack, ma le carte speciali del mazzo UNO ribaltano il tavolo:
i `+N` ti obbligano a pescare, il cambio giro ti costringe a scambiare la mano con un
avversario, il divieto ti dà il gettone per fermare il banco. Si può anche entrare come
**ospite** e limitarsi a guardare.

Server autoritativo Node.js, connessioni WebSocket, client in HTML/CSS/JS senza build step.

---

## Avvio

```bash
npm install
npm start                 # http://localhost:3000
npm start -- --port 8080  # su un'altra porta
```

All'avvio la console stampa anche gli indirizzi LAN del PC:

```
  JackOne è in ascolto
  Su questo PC:  http://localhost:3000
  In LAN:        http://192.168.1.42:3000
```

## Giocare in più persone

1. Avvia il server su un PC della rete.
2. Su quel PC apri `http://localhost:3000`, scegli il **nickname** e premi **Crea un tavolo**:
   compare un codice di 4 caratteri.
3. Gli altri (PC, tablet o telefono sulla stessa rete Wi-Fi) aprono l'indirizzo LAN
   mostrato in console, inseriscono nickname e codice ed entrano. In alternativa il tasto
   **Copia invito** (in lobby e al tavolo) prepara un link `http://…/?t=CODICE` che
   precompila il codice: basta incollarlo in chat.
4. L'host può aggiungere **bot** per riempire il tavolo, poi preme **Inizia la partita**.

Si entra col codice **anche a partita iniziata**: si resta in attesa fino alla fine della mano
in corso e si punta dalla successiva. Il tavolo resta raggiungibile finché qualcuno è collegato,
più 10 minuti di tolleranza dall'ultima disconnessione (2 minuti se è ancora in lobby); dopo,
il codice non esiste più. Anche riavviare il server cancella i tavoli aperti.

Dal tavolo si esce con il tasto **Esci** in alto: chiede conferma, libera il posto e riporta al
login. Le fiches e la mano in corso vanno perse.

### Guardare come ospite

Il tasto **Entra come ospite** apre il tavolo in sola visione: non occupa un posto, quindi
funziona **sempre**, anche con i 6 posti pieni o a partita già iniziata — è l'unico modo di
vedere una mano in corso senza aspettare quella dopo.

L'ospite vede tutto ciò che vedono i giocatori (carte, banco, punteggi, timer, scarti,
registro) e può **commentare in chat**, con le sue righe distinte da quelle di chi gioca.
Non può puntare, pescare, spendere gettoni né comandare il tavolo: ogni tentativo viene
respinto dal server. I giocatori lo vedono elencato sotto **Ospiti collegati** in lobby e
riassunto con 👁 nella barra in alto al tavolo. Massimo 12 ospiti per tavolo.

### Nickname, foto e colori

Il nickname si sceglie prima di entrare: da 2 a 16 caratteri fra lettere, numeri e i segni
`. _ -`, con anteprima dal vivo dell'avatar e un dado 🎲 che ne propone uno se non hai idee.
Al tavolo non si ripete: chi arriva con un nickname già occupato viene respinto, e valgono
anche i nomi degli ospiti.

Toccando l'avatar nell'anteprima puoi scegliere una **foto** dal dispositivo. Viene ritagliata
al centro e ridotta a 128×128 pixel nel browser, quindi restano pochi kilobyte: la foto si
salva in locale e ti segue nei tavoli successivi finché non la rimuovi. Senza foto resta la
pastiglia colorata con le iniziali. Le immagini non viaggiano dentro lo stato del gioco: il
server le serve una volta sola su `/avatar/<codice>/<id>` e le dimentica insieme al tavolo.

Entrando ricevi un **colore univoco per quel tavolo** — suggerito dal tuo nickname e spostato
sul primo libero in caso di conflitto. Lo ritrovi ovunque: bordo dell'avatar e del tuo posto,
nome colorato, targhetta `TOCCA A <nickname>` nei comandi, bordo delle righe di registro e
chat che hai generato, riepiloghi di fine mano.

Fino a 6 posti per tavolo, umani e bot insieme. Più tavoli possono girare in parallelo
sullo stesso server. Se un giocatore ricarica la pagina o perde la connessione rientra
automaticamente al suo posto; nel frattempo il tavolo prosegue giocandolo in automatico.

---

## Regolamento

### Valore delle carte

| Carta | Punti | Effetto quando la peschi |
|---|---|---|
| Numeri 0–9 | valore nominale | nessuno |
| +2 / +4 | 0 | devi pescare subito 2 / 4 carte |
| Cambio giro | 0 | scambio mazzi obbligatorio |
| Divieto | 0 | **chiude il tuo turno**: annulla l'obbligo di pescaggio, oppure ti dà un gettone |
| Cambia colore | **0,5** | nessuno |

Obiettivo: avvicinarsi a **21**. Oltre 21 si sballa e si perde subito la puntata.

### Svolgimento della mano

1. **Puntate** — minimo 5 fiches, 20 secondi per decidere (allo scadere punti il minimo).
2. **Distribuzione** — 2 carte a testa, 2 al banco (la prima coperta). Le carte iniziali sono
   **sempre numeri**: una speciale che esce in distribuzione finisce negli **scarti** e viene
   rimpiazzata, per giocatori e banco. Nessuno parte quindi con carte da zero punti, e la pila
   degli scarti resta visibile accanto al banco.
3. **Turni** — uno alla volta, `Carta` o `Stai` (30 secondi, poi `Stai` automatico).
   Ogni carta che peschi risolve subito il suo effetto:
   - **+N** → peschi N carte forzate; se tra queste esce un altro `+N` gli obblighi
     **si sommano**;
   - **Divieto** → ti blocca: se hai un obbligo in corso lo **azzera**, altrimenti diventa un
     **gettone blocca-banco**, e in ogni caso il tuo **turno finisce lì**, con il punteggio
     raggiunto (niente più `Carta` né `Stai`);
   - **Cambio giro** → scegli un avversario ancora in gioco e **scambi tutta la mano**
     (carte, punteggio e gettoni). Senza bersagli validi la carta non ha effetto.
4. **Banco** — scopre la carta e pesca finché resta sotto 17. Anche il banco è soggetto ai
   `+N`. Un **divieto** pescato dal banco ne **annulla gli obblighi accumulati**, ma non lo
   ferma: sotto 17 riprende subito a pescare. Il cambio giro sul banco non ha effetto.
   Prima di ogni sua pescata, chi ha un gettone ha 5 secondi per spenderlo e **fermare il
   banco** sul punteggio attuale, anche sotto 17: è l'unico modo di congelarlo.
5. **Esiti** — pagamento 1:1 sulla puntata; **21 esatto paga 2:1** (anche se il banco fa 21);
   pareggio restituisce la puntata; sballo o punteggio inferiore la perde.

### Partita

Si parte con 100 fiches a testa. Chi arriva a zero è eliminato; la partita finisce quando
resta un solo giocatore con fiches. L'host può poi rilanciare una nuova partita.

### Scorciatoie

Durante il tuo turno: `C` chiede una carta, `S` per stare.

---

## Sviluppo

```
shared/          codice condiviso da server e client (carte, protocollo, avatar)
server/
  index.js       avvio da riga di comando
  app.js         server HTTP + WebSocket, instradamento dei messaggi
  rooms.js       stanze, ospiti, avatar, timer di fase, diffusione dello stato
  view.js        proiezione dello stato per singolo destinatario
  eventlog.js    eventi tradotti in righe di registro
  game/          motore puro: deck.js, rules.js, engine.js, bots.js
public/          client: index.html, css/, js/
test/            test con node:test
scripts/smoke.mjs prova end-to-end da terminale
```

Il motore (`server/game/`) è **puro e sincrono**: `reduce(stato, azione)` restituisce il
nuovo stato e la lista di eventi, senza timer né socket. I timer vivono in `rooms.js` e si
limitano a iniettare azioni. Tutto il regolamento è quindi verificabile senza rete.

### VS Code

Le configurazioni sono in `.vscode/launch.json`:

| Configurazione | Cosa fa |
|---|---|
| **JackOne: server + client** | Avvia il server, stampa il link nella Debug Console e apre Edge con il debugger agganciato: i breakpoint funzionano sia in `server/` sia in `public/js` e `shared/`. |
| **JackOne: server (apre il browser di sistema)** | Come sopra ma apre il browser predefinito, senza debug del client. |
| **JackOne: server con mazzo truccato** | Aggiunge `--rigged` per far uscire subito le carte speciali. |
| **JackOne: client (Edge)** | Apre un altro giocatore sulla stessa macchina: ogni avvio usa un profilo Edge separato, quindi è una sessione indipendente. |
| **JackOne: tutti i test** / **test del file aperto** | Esegue `node --test` su tutta la cartella o sul file attivo, con debugger. |

### Test

```bash
npm test
```

Copre composizione del mazzo e punteggi, ogni effetto delle carte speciali, la distribuzione
senza speciali, la fase del banco e i pagamenti, la validazione delle foto, più test di
integrazione con client WebSocket reali (creazione e ingresso nelle stanze, permessi
dell'host, carta coperta del banco, riconnessione con token, ospiti e avatar).

Un test merita attenzione se si mette mano a `rooms.js`: *«un ospite che entra o esce non
tocca il timer della fase in corso»*. Tutto ciò che non è gioco (ospiti, avatar) deve passare
da `Room.announce`, mai da `Room.dispatch`, che riavvia `scheduleTimers` e regalerebbe tempo
extra a chi è di turno.

### Provare gli effetti a mano

Il flag `--rigged` mette le carte speciali in cima al mazzo, così `+4`, divieto e cambio
giro escono subito. Non serve invece a provare le **carte iniziali**: quelle vengono
scartate e ripescate finché non esce un numero.

```bash
node server/index.js --port 3210 --rigged
node scripts/smoke.mjs 3210    # gioca una mano da terminale e stampa il registro
```
