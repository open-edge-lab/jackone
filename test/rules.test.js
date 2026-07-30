import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeck, createDeck, discardCards, drawCard, shuffle } from '../server/game/deck.js';
import { RESULT, handScore, isBust, dealerMustDraw, settle } from '../server/game/rules.js';
import { KIND, cardPoints, forcedDrawCount } from '../shared/cards.js';

const count = (cards, predicate) => cards.filter(predicate).length;

test('il mazzo contiene le 108 carte UNO nelle proporzioni corrette', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(count(deck, (c) => c.kind === KIND.NUMBER), 76);
  assert.equal(count(deck, (c) => c.kind === KIND.NUMBER && c.value === 0), 4);
  assert.equal(count(deck, (c) => c.kind === KIND.SKIP), 8);
  assert.equal(count(deck, (c) => c.kind === KIND.REVERSE), 8);
  assert.equal(count(deck, (c) => c.kind === KIND.DRAW2), 8);
  assert.equal(count(deck, (c) => c.kind === KIND.WILD), 4);
  assert.equal(count(deck, (c) => c.kind === KIND.DRAW4), 4);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108, 'ogni carta ha un id univoco');
});

test('lo stesso seed produce sempre lo stesso mescolamento', () => {
  const a = shuffle(buildDeck(), 42);
  const b = shuffle(buildDeck(), 42);
  const c = shuffle(buildDeck(), 43);
  assert.deepEqual(a.cards.map((x) => x.id), b.cards.map((x) => x.id));
  assert.notDeepEqual(a.cards.map((x) => x.id), c.cards.map((x) => x.id));
});

test('quando la pila di pescaggio finisce si rimescolano gli scarti', () => {
  let deck = { draw: [], discard: buildDeck().slice(0, 5), seed: 7 };
  const before = deck.discard.length;
  const { card, deck: after } = drawCard(deck);
  assert.ok(card, 'una carta viene comunque pescata');
  assert.equal(after.draw.length, before - 1);
  assert.equal(after.discard.length, 0);
});

test('gli scarti si accumulano senza perdere carte', () => {
  const deck = discardCards(createDeck(1), buildDeck().slice(0, 3));
  assert.equal(deck.discard.length, 3);
});

test('i punti delle carte seguono il regolamento JackOne', () => {
  assert.equal(cardPoints({ kind: KIND.NUMBER, value: 7 }), 7);
  assert.equal(cardPoints({ kind: KIND.NUMBER, value: 0 }), 0);
  assert.equal(cardPoints({ kind: KIND.WILD }), 0.5);
  assert.equal(cardPoints({ kind: KIND.DRAW4 }), 0);
  assert.equal(cardPoints({ kind: KIND.DRAW2 }), 0);
  assert.equal(cardPoints({ kind: KIND.SKIP }), 0);
  assert.equal(cardPoints({ kind: KIND.REVERSE }), 0);
});

test('il "+N" obbliga a pescare il numero corrispondente di carte', () => {
  assert.equal(forcedDrawCount({ kind: KIND.DRAW2 }), 2);
  assert.equal(forcedDrawCount({ kind: KIND.DRAW4 }), 4);
  assert.equal(forcedDrawCount({ kind: KIND.NUMBER, value: 9 }), 0);
});

test('i mezzi punti dei cambia colore si sommano senza deriva dei decimali', () => {
  const wilds = Array.from({ length: 3 }, () => ({ kind: KIND.WILD }));
  assert.equal(handScore(wilds), 1.5);
  assert.equal(handScore([{ kind: KIND.NUMBER, value: 9 }, { kind: KIND.WILD }]), 9.5);
  assert.equal(handScore([]), 0);
});

test('si sballa solo oltre 21', () => {
  assert.equal(isBust(21), false);
  assert.equal(isBust(21.5), true);
  assert.equal(isBust(22), true);
});

test('il banco pesca sotto 17 e si ferma da 17 in su', () => {
  assert.equal(dealerMustDraw(16.5, false), true);
  assert.equal(dealerMustDraw(17, false), false);
  assert.equal(dealerMustDraw(12, true), false, 'un gettone lo ha fermato');
  assert.equal(dealerMustDraw(22, false), false, 'ha già sballato');
});

test('lo sballo fa perdere la puntata anche se il banco sballa', () => {
  const out = settle({ score: 24, busted: true, bet: 10 }, { score: 25, busted: true });
  assert.deepEqual(out, { result: RESULT.BUST, delta: -10 });
});

test('il 21 esatto paga 2:1 anche contro un banco a 21', () => {
  const out = settle({ score: 21, busted: false, bet: 10 }, { score: 21, busted: false });
  assert.deepEqual(out, { result: RESULT.EXACT, delta: 20 });
});

test('esiti standard contro il banco', () => {
  const dealer = { score: 18, busted: false };
  assert.deepEqual(settle({ score: 19, busted: false, bet: 5 }, dealer), { result: RESULT.WIN, delta: 5 });
  assert.deepEqual(settle({ score: 18, busted: false, bet: 5 }, dealer), { result: RESULT.PUSH, delta: 0 });
  assert.deepEqual(settle({ score: 17.5, busted: false, bet: 5 }, dealer), { result: RESULT.LOSE, delta: -5 });
  assert.deepEqual(
    settle({ score: 4, busted: false, bet: 5 }, { score: 23, busted: true }),
    { result: RESULT.WIN, delta: 5 },
  );
});
