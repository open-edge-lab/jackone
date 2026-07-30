import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME,
  base64ByteLength,
  parseAvatarDataUrl,
} from '../shared/avatar.js';

/** Data URL di `bytes` byte nel tipo indicato, senza costruire l'immagine vera. */
function fakeDataUrl(bytes, mime = 'image/webp') {
  // Ogni 3 byte diventano 4 caratteri base64: si arrotonda per eccesso.
  const base64 = 'A'.repeat(Math.ceil(bytes / 3) * 4);
  return `data:${mime};base64,${base64}`;
}

test('la lunghezza in byte si ricava dalla base64 senza decodificarla', () => {
  // "JackOne" → 7 byte, con un carattere di riempimento.
  const base64 = Buffer.from('JackOne').toString('base64');
  assert.equal(base64ByteLength(base64), 7);
  assert.equal(base64ByteLength(Buffer.from('ab').toString('base64')), 2);
  assert.equal(base64ByteLength(Buffer.from('abc').toString('base64')), 3);
});

test('una data URL valida viene accettata in tutti i formati previsti', () => {
  for (const mime of AVATAR_MIME) {
    const parsed = parseAvatarDataUrl(fakeDataUrl(300, mime));
    assert.ok(parsed, `${mime} deve essere accettato`);
    assert.equal(parsed.mime, mime);
    assert.ok(parsed.byteLength > 0);
    // La base64 restituita deve essere ricostruibile in byte veri.
    assert.equal(Buffer.from(parsed.base64, 'base64').length, parsed.byteLength);
  }
});

test('i tipi non previsti vengono rifiutati', () => {
  assert.equal(parseAvatarDataUrl(fakeDataUrl(300, 'image/gif')), null);
  assert.equal(parseAvatarDataUrl(fakeDataUrl(300, 'image/svg+xml')), null, 'niente SVG: contiene script');
  assert.equal(parseAvatarDataUrl(fakeDataUrl(300, 'text/html')), null);
});

test('oltre il limite di dimensione si rifiuta', () => {
  assert.ok(parseAvatarDataUrl(fakeDataUrl(AVATAR_MAX_BYTES - 300)), 'appena sotto il limite passa');
  assert.equal(parseAvatarDataUrl(fakeDataUrl(AVATAR_MAX_BYTES + 300)), null);
});

test('le stringhe malformate non fanno passare nulla', () => {
  const rifiutate = [
    '',
    'non una data url',
    'data:image/webp,QUJD',                 // manca il ;base64
    'data:image/webp;base64,',              // payload vuoto
    'data:image/webp;base64,QUJ',           // lunghezza non multipla di 4
    'data:image/webp;base64,QU J D',        // caratteri non ammessi
    'data:image/webp;base64,<script>',
    null,
    undefined,
    42,
    {},
  ];
  for (const valore of rifiutate) {
    assert.equal(parseAvatarDataUrl(valore), null, `doveva essere rifiutata: ${String(valore)}`);
  }
});
