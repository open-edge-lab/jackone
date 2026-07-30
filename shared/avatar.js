/**
 * Avatar fotografico: formati ammessi e validazione della data URL.
 *
 * Modulo condiviso da server e client, come `identity.js`: il client controlla
 * prima di inviare per dare un errore immediato, il server ricontrolla sempre
 * perché è l'unica verifica di cui si può fidare.
 *
 * Qui non si decodifica nulla in memoria: si resta sulla stringa base64 e si
 * misura la dimensione con l'aritmetica, così il modulo funziona identico in
 * Node e nel browser senza dipendere né da `Buffer` né da `atob`.
 */

/** Lato del quadrato in cui il client ritaglia la foto, in pixel. */
export const AVATAR_SIZE = 128;

/** Tetto alla dimensione dell'immagine decodificata. */
export const AVATAR_MAX_BYTES = 48 * 1024;

/** Tipi accettati: WebP di prima scelta, JPEG e PNG come ripiego. */
export const AVATAR_MIME = ['image/webp', 'image/jpeg', 'image/png'];

/** `data:<mime>;base64,<payload>` — l'unica forma accettata. */
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Byte corrispondenti a una stringa base64, senza decodificarla.
 * @param {string} base64
 * @returns {number}
 */
export function base64ByteLength(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/**
 * Verifica una data URL di avatar.
 * @param {unknown} dataUrl
 * @returns {{mime: string, base64: string, byteLength: number}|null} null se
 *   la stringa è malformata, di un tipo non ammesso o troppo grande
 */
export function parseAvatarDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;

  const match = DATA_URL.exec(dataUrl);
  if (!match) return null;

  const [, mime, base64] = match;
  if (!AVATAR_MIME.includes(mime)) return null;
  // Una base64 valida ha lunghezza multipla di 4: senza questo controllo il
  // calcolo dei byte darebbe un risultato frazionario.
  if (base64.length === 0 || base64.length % 4 !== 0) return null;

  const byteLength = base64ByteLength(base64);
  if (byteLength > AVATAR_MAX_BYTES) return null;

  return { mime, base64, byteLength };
}
