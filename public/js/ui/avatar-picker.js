/**
 * Scelta della foto del profilo.
 *
 * L'immagine non viene inviata com'è: si ritaglia al centro in un quadrato e si
 * riduce a `AVATAR_SIZE` pixel prima di codificarla. Una foto da telefono passa
 * così da qualche megabyte a pochi kilobyte, e il server può permettersi di
 * tenerla in memoria per ogni partecipante.
 *
 * La foto resta nel browser (`localStorage`): il server la riceve a ogni
 * ingresso e non la conserva oltre la vita della stanza.
 */

import { AVATAR_MAX_BYTES, AVATAR_SIZE, parseAvatarDataUrl } from '/shared/avatar.js';

const PHOTO_KEY = 'jackone.avatar';

/** Formati provati in ordine: il WebP pesa meno, il JPEG è il ripiego. */
const ENCODINGS = [
  { mime: 'image/webp', quality: 0.8 },
  { mime: 'image/jpeg', quality: 0.82 },
];

/**
 * @returns {string|null} foto salvata, o null se non ce n'è una valida
 */
export function storedPhoto() {
  try {
    const saved = localStorage.getItem(PHOTO_KEY);
    // Una foto salvata da una versione precedente potrebbe non rispettare più
    // i limiti attuali: meglio scoprirlo qui che farsela rifiutare dal server.
    return saved && parseAvatarDataUrl(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * @param {string|null} dataUrl null per cancellare la foto
 */
export function storePhoto(dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(PHOTO_KEY, dataUrl);
    else localStorage.removeItem(PHOTO_KEY);
  } catch { /* niente da fare: la foto varrà solo per questa sessione */ }
}

/**
 * Ritaglia e riduce un file immagine.
 * @param {File} file
 * @returns {Promise<string>} data URL pronta da inviare
 * @throws {Error} con un messaggio già leggibile a schermo
 */
export async function photoFromFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('Serve un file immagine');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Immagine non leggibile');
  }

  // Ritaglio centrale: si prende il quadrato più grande che ci sta dentro, così
  // una foto in verticale non viene schiacciata.
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();

  for (const { mime, quality } of ENCODINGS) {
    const dataUrl = canvas.toDataURL(mime, quality);
    // Un formato non supportato non dà errore: `toDataURL` ripiega su PNG.
    // Lo si riconosce dal prefisso, e si passa alla codifica successiva.
    if (!dataUrl.startsWith(`data:${mime}`)) continue;
    if (parseAvatarDataUrl(dataUrl)) return dataUrl;
  }

  // Ultimo tentativo: il PNG di ripiego, che a 128px sta quasi sempre nel limite.
  const png = canvas.toDataURL('image/png');
  if (parseAvatarDataUrl(png)) return png;

  throw new Error(`Immagine troppo pesante (oltre ${Math.round(AVATAR_MAX_BYTES / 1024)} KB)`);
}
