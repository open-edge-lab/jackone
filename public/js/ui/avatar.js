/**
 * Avatar del giocatore: foto se ne ha caricata una, altrimenti pastiglia
 * colorata con le iniziali del nickname.
 *
 * Il colore arriva dal server (univoco per tavolo); le iniziali si ricavano
 * dal nickname con le stesse regole usate lato server. La foto è un semplice
 * indirizzo versionato: i byte li scarica il browser, non passano dallo stato.
 */

import { ON_COLOR, colorAt, nicknameInitials } from '/shared/identity.js';

/**
 * @param {{name: string, colorIndex?: number}} player
 * @returns {string} colore assegnato al giocatore
 */
export function colorOf(player) {
  return colorAt(player?.colorIndex ?? 0);
}

/**
 * Applica foto o iniziali a una pastiglia già esistente. Serve sia agli avatar
 * costruiti qui sia all'anteprima della schermata d'ingresso, che vive
 * nell'HTML e non può essere ricreata a ogni battuta.
 * @param {HTMLElement} el
 * @param {{name?: string, colorIndex?: number, avatar?: string|null}} player
 */
export function paintAvatar(el, player) {
  const photo = player?.avatar ?? null;
  const color = colorOf(player);

  el.classList.toggle('avatar--photo', Boolean(photo));
  // Il colore del posto resta anche con la foto: riempie la pastiglia mentre
  // l'immagine si scarica e la incornicia una volta arrivata.
  el.style.setProperty('--avatar-color', color);
  el.style.backgroundColor = color;
  el.style.backgroundImage = photo ? `url("${photo}")` : '';
  el.style.color = ON_COLOR;
  // Sotto la foto le iniziali non si vedrebbero: si tolgono per non lasciarle
  // sbucare dai bordi durante il caricamento.
  el.textContent = photo ? '' : (player?.name ? nicknameInitials(player.name) : '?');
  el.title = player?.name ?? '';
}

/**
 * @param {{name: string, colorIndex?: number, avatar?: string|null}} player
 * @param {{size?: 'sm'|'lg'}} [options]
 * @returns {HTMLElement}
 */
export function avatarElement(player, options = {}) {
  const el = document.createElement('span');
  el.className = 'avatar';
  if (options.size) el.classList.add(`avatar--${options.size}`);
  paintAvatar(el, player);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/**
 * Avatar più nickname, usato dove il giocatore va nominato per esteso.
 * @param {{name: string, colorIndex?: number}} player
 * @param {{size?: 'sm'|'lg', upper?: boolean}} [options]
 * @returns {HTMLElement}
 */
export function playerTag(player, options = {}) {
  const tag = document.createElement('span');
  tag.className = 'player-tag';
  const name = document.createElement('b');
  name.textContent = options.upper ? player.name.toUpperCase() : player.name;
  name.style.color = colorOf(player);
  tag.append(avatarElement(player, { size: options.size }), name);
  return tag;
}
