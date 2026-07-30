import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NICK_MAX,
  PLAYER_COLORS,
  cleanNickname,
  colorAt,
  nicknameInitials,
  preferredColorIndex,
  randomNickname,
  validateNickname,
} from '../shared/identity.js';

test('il nickname viene ripulito senza perdere spazi e trattini leciti', () => {
  assert.equal(cleanNickname('   Anna   '), 'Anna');
  assert.equal(cleanNickname('Mario   Rossi'), 'Mario Rossi');
  assert.equal(cleanNickname('Jack-One_99'), 'Jack-One_99');
  assert.equal(cleanNickname(`An${String.fromCharCode(7)}na`), 'Anna', 'via i caratteri di controllo');
  assert.equal(cleanNickname('x'.repeat(40)).length, NICK_MAX);
  assert.equal(cleanNickname(null), '');
});

test('la validazione accetta i nickname sensati e rifiuta gli altri', () => {
  assert.equal(validateNickname('Anna').ok, true);
  assert.equal(validateNickname('Mario Rossi').ok, true);
  assert.equal(validateNickname('Jack-One_99').ok, true);
  assert.equal(validateNickname('Ada').ok, true);

  assert.equal(validateNickname('a').ok, false, 'troppo corto');
  assert.equal(validateNickname('x'.repeat(17)).ok, false, 'troppo lungo');
  assert.equal(validateNickname('<script>').ok, false, 'caratteri non ammessi');
  assert.equal(validateNickname('_pippo').ok, false, 'deve iniziare con lettera o cifra');
  assert.ok(validateNickname('a').message.includes('almeno'));
});

test('le iniziali riassumono il nickname in due lettere', () => {
  assert.equal(nicknameInitials('Mario Rossi'), 'MR');
  assert.equal(nicknameInitials('Jack-One'), 'JO');
  assert.equal(nicknameInitials('Anna'), 'AN');
  assert.equal(nicknameInitials('Bo'), 'BO');
  assert.equal(nicknameInitials('Ada (bot)'), 'AB', 'i simboli non entrano nell\'avatar');
  assert.equal(nicknameInitials(''), '?');
});

test('il colore preferito è stabile e dentro la tavolozza', () => {
  const first = preferredColorIndex('Anna');
  assert.equal(first, preferredColorIndex('Anna'), 'stesso nickname, stesso colore');
  assert.equal(first, preferredColorIndex('ANNA'), 'non distingue maiuscole e minuscole');
  assert.ok(first >= 0 && first < PLAYER_COLORS.length);
  assert.equal(colorAt(first), PLAYER_COLORS[first]);
  assert.equal(colorAt(PLAYER_COLORS.length), PLAYER_COLORS[0], 'gli indici girano');
});

test('i nickname proposti a caso sono sempre validi', () => {
  for (let i = 0; i < 60; i += 1) {
    const nickname = randomNickname();
    assert.equal(validateNickname(nickname).ok, true, `nickname non valido: ${nickname}`);
    assert.ok(nickname.length <= NICK_MAX);
  }
});
