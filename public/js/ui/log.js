/**
 * Registro degli eventi e della chat, mantenuto sempre in fondo.
 */

let lastId = 0;

/**
 * @param {HTMLElement} list contenitore <ul>
 * @param {Array<{id: number, kind: string, text: string, playerId: string|null,
 *   role?: string}>} entries
 * @param {Map<string, string>} colors colore per id partecipante
 */
export function renderLog(list, entries, colors) {
  const newest = entries.length ? entries[entries.length - 1].id : 0;
  if (newest === lastId && list.childElementCount === entries.length) return;
  lastId = newest;

  list.replaceChildren(...entries.map((entry) => {
    const li = document.createElement('li');
    li.className = `kind-${entry.kind}`;
    // Chi commenta da fuori va distinto da chi è al tavolo.
    if (entry.role === 'viewer') li.classList.add('is-viewer');
    // Chi ha generato la riga si riconosce dal colore del proprio posto.
    const color = entry.playerId ? colors.get(entry.playerId) : null;
    if (color) {
      li.classList.add('has-player');
      li.style.borderLeftColor = color;
    }
    li.textContent = entry.text;
    return li;
  }));
  list.scrollTop = list.scrollHeight;
}
