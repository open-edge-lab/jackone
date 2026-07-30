/**
 * Costruzione degli elementi carta e della mano.
 * Le carte già viste non vengono rianimate: solo le nuove entrano in scena.
 */

import { cardLabel } from '/shared/cards.js';

/** Id delle carte già mostrate, per animare solo quelle appena arrivate. */
const seen = new Set();

/** Azzera la memoria delle animazioni (a ogni nuova mano). */
export function resetCardMemory() {
  seen.clear();
}

/**
 * @param {object} card carta, oppure {hidden: true} per il dorso
 * @param {{size?: 'sm'|'lg'}} [options]
 * @returns {HTMLElement}
 */
export function cardElement(card, options = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (options.size) el.classList.add(`card--${options.size}`);

  if (card.hidden) {
    el.classList.add('card--back');
    const mark = document.createElement('span');
    mark.textContent = 'J1';
    el.append(mark);
    return el;
  }

  el.classList.add(`card--${card.color}`);
  const label = cardLabel(card);

  const oval = document.createElement('span');
  oval.className = 'card__oval';
  const text = document.createElement('span');
  text.className = label.length > 1 ? 'card__label card__label--small' : 'card__label';
  text.textContent = label;
  oval.append(text);

  const topLeft = document.createElement('span');
  topLeft.className = 'card__corner card__corner--tl';
  topLeft.textContent = label;
  const bottomRight = topLeft.cloneNode(true);
  bottomRight.className = 'card__corner card__corner--br';

  el.append(topLeft, oval, bottomRight);
  el.title = label;

  if (!seen.has(card.id)) {
    seen.add(card.id);
    el.classList.add('is-new');
  }
  return el;
}

/**
 * Riempie un contenitore con una mano di carte.
 * @param {HTMLElement} container
 * @param {Array<object>} cards
 * @param {{size?: 'sm'|'lg'}} [options]
 */
export function renderHand(container, cards, options = {}) {
  container.replaceChildren(...cards.map((card) => cardElement(card, options)));
}
