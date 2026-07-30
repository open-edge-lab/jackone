/**
 * Prefisso sotto cui è servita l'applicazione.
 *
 * In LAN si apre la root (`http://host:3000/`), dietro un reverse proxy un
 * sottopercorso (`https://host/jackone/`). Tutto ciò che il client costruisce
 * a mano — indirizzo del WebSocket e link d'invito — deve partire da qui.
 * Asset e import dei moduli non passano di qui: sono relativi al documento e
 * si sistemano da soli.
 *
 * Vale la pena ricordare che la forma senza barra finale (`/jackone`) non è
 * risolvibile: è il reverse proxy a doverla reindirizzare su `/jackone/`.
 */
export const BASE = location.pathname.replace(/[^/]*$/, '');
