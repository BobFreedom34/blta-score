// The "Bodovanie a podmienky" part of a tournament's form (Backend card, club manage page, create window of a club): how many points a result
// gives, and the order of the conditions that decide between players level on points. Shared so the three forms look and work the same.
//   TournamentRules.html(id, rules)  -> markup; id keeps the radio groups of two forms on one page apart
//   TournamentRules.mount(root)      -> wires the up/down buttons inside root (call once after the markup is in the page)
//   TournamentRules.read(root)       -> { scoring, tiebreakers } as the API takes them
// The server keeps the same rules (src/standings.js); the defaults here are the ones the server uses for a new tournament.
const TournamentRules = (() => {
  const DEFAULT_ORDER = ['H2H', 'SETS', 'WINS', 'GAMES'];
  const TEXT = {
    sk: {
      scoring: 'Bodovanie',
      BLTA: ['BLTA bodovanie', 'Výhra 2:0 = 3 body · výhra 2:1 = 2 body, prehra 1:2 = 1 bod · prehra 0:2 = 0 bodov.'],
      WIN2: ['2 body za výhru', 'Výhra = 2 body, prehra = 0 bodov (bez ohľadu na skóre).'],
      WIN1: ['1 bod za výhru', 'Výhra = 1 bod, prehra = 0 bodov (bez ohľadu na skóre).'],
      order: 'Podmienky pri rovnosti bodov',
      orderHint: 'Keď majú hráči rovnaký počet bodov, rozhoduje prvá podmienka; ak je rovnaká aj tá, rozhoduje ďalšia. Poradie sa dá meniť šípkami.',
      H2H: 'Vzájomný zápas', SETS: 'Rozdiel setov', WINS: 'Počet výhier', GAMES: 'Rozdiel gemov',
      H2Hnote: 'platí len pri rovnosti dvoch hráčov',
      up: 'Posunúť vyššie', down: 'Posunúť nižšie',
    },
    en: {
      scoring: 'Scoring',
      BLTA: ['BLTA scoring', 'A 2-0 win = 3 points · a 2-1 win = 2 points, a 1-2 loss = 1 point · a 0-2 loss = 0 points.'],
      WIN2: ['2 points for a win', 'A win = 2 points, a loss = 0 points (whatever the score).'],
      WIN1: ['1 point for a win', 'A win = 1 point, a loss = 0 points (whatever the score).'],
      order: 'Tie-break conditions',
      orderHint: 'When players have the same number of points, the first condition decides; if that is level too, the next one does. Change the order with the arrows.',
      H2H: 'Head-to-head match', SETS: 'Set difference', WINS: 'Number of wins', GAMES: 'Game difference',
      H2Hnote: 'only between two level players',
      up: 'Move up', down: 'Move down',
    },
  };
  const textFor = () => TEXT[typeof currentLang !== 'undefined' && currentLang === 'en' ? 'en' : 'sk'];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function html(id, rules) {
    const tx = textFor();
    const scoring = rules && ['BLTA', 'WIN2', 'WIN1'].includes(rules.scoring) ? rules.scoring : 'BLTA';
    const asked = rules && Array.isArray(rules.tiebreakers) ? rules.tiebreakers.filter((k) => DEFAULT_ORDER.includes(k)) : [];
    const order = [...new Set(asked)];
    DEFAULT_ORDER.forEach((k) => { if (!order.includes(k)) order.push(k); });
    return `<div class="tr-box" data-tr>
      <div class="tr-block"><div class="tr-title">${esc(tx.scoring)}</div>
        ${['BLTA', 'WIN2', 'WIN1'].map((k) => `<label class="tr-opt"><input type="radio" name="tr-scoring-${esc(id)}" value="${k}"${scoring === k ? ' checked' : ''}>
          <span><b>${esc(tx[k][0])}</b><small>${esc(tx[k][1])}</small></span></label>`).join('')}
      </div>
      <div class="tr-block"><div class="tr-title">${esc(tx.order)}</div>
        <p class="tr-hint">${esc(tx.orderHint)}</p>
        <ol class="tr-order">${order.map((k) => `<li data-key="${k}"><span class="tr-name">${esc(tx[k])}${k === 'H2H' ? ` <small>(${esc(tx.H2Hnote)})</small>` : ''}</span>
          <button type="button" class="tr-move" data-dir="-1" aria-label="${esc(tx.up)}" title="${esc(tx.up)}">▲</button>
          <button type="button" class="tr-move" data-dir="1" aria-label="${esc(tx.down)}" title="${esc(tx.down)}">▼</button></li>`).join('')}</ol>
      </div>
    </div>`;
  }

  // the numbers in front of the conditions and the arrows that can no longer move are kept up to date
  function refresh(list) {
    [...list.children].forEach((li, i, all) => {
      li.dataset.pos = String(i + 1);
      li.querySelector('[data-dir="-1"]').disabled = i === 0;
      li.querySelector('[data-dir="1"]').disabled = i === all.length - 1;
    });
  }

  function mount(root) {
    root.querySelectorAll('.tr-order').forEach((list) => {
      refresh(list);
      list.addEventListener('click', (e) => {
        const button = e.target.closest('.tr-move');
        if (!button || button.disabled) return;
        const li = button.closest('li');
        if (button.dataset.dir === '-1' && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
        if (button.dataset.dir === '1' && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
        refresh(list);
        const moved = list.querySelector(`li[data-key="${li.dataset.key}"] [data-dir="${button.dataset.dir}"]`);
        if (moved && !moved.disabled) moved.focus();
      });
    });
  }

  function read(root) {
    const picked = root.querySelector('input[type="radio"][name^="tr-scoring-"]:checked');
    return {
      scoring: picked ? picked.value : 'BLTA',
      tiebreakers: [...root.querySelectorAll('.tr-order li')].map((li) => li.dataset.key),
    };
  }

  return { html, mount, read, DEFAULT_ORDER };
})();
