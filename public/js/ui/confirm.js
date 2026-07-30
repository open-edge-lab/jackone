/**
 * Richiesta di conferma per le azioni senza ritorno (uscire dal tavolo).
 *
 * Usa un overlay tutto suo: il modale dei riepiloghi è memoizzato da `table.js`
 * e riutilizzarlo lo farebbe sfasare al primo aggiornamento di stato.
 */

const el = {
  box: document.getElementById('confirm'),
  title: document.getElementById('confirm-title'),
  text: document.getElementById('confirm-text'),
  ok: document.getElementById('confirm-ok'),
  cancel: document.getElementById('confirm-cancel'),
};

/** Chiusura in corso: evita che due richieste si sovrappongano. */
let close = null;

/**
 * Mostra la richiesta e attende la risposta.
 * @param {{title: string, text?: string, confirmLabel?: string}} options
 * @returns {Promise<boolean>} true se l'utente ha confermato
 */
export function confirmAction({ title, text = '', confirmLabel = 'Conferma' }) {
  close?.(false);

  el.title.textContent = title;
  el.text.textContent = text;
  el.text.classList.toggle('hidden', !text);
  el.ok.textContent = confirmLabel;
  el.box.classList.remove('hidden');
  el.ok.focus();

  return new Promise((resolve) => {
    close = (answer) => {
      close = null;
      el.box.classList.add('hidden');
      el.ok.removeEventListener('click', accept);
      el.cancel.removeEventListener('click', reject);
      el.box.removeEventListener('click', backdrop);
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const accept = () => close(true);
    const reject = () => close(false);
    // Un click fuori dal riquadro equivale ad annullare.
    const backdrop = (event) => { if (event.target === el.box) close(false); };
    const onKey = (event) => { if (event.key === 'Escape') close(false); };

    el.ok.addEventListener('click', accept);
    el.cancel.addEventListener('click', reject);
    el.box.addEventListener('click', backdrop);
    document.addEventListener('keydown', onKey);
  });
}
