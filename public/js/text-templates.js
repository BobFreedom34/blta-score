// The text templates: named blocks built from the elements the pages already use (the Propozície page: notes, lists, sub-headings, the three category
// cards, points, coefficients, cycles, the table; and the grey / black tile). The editor (rich-editor.js) shows each one as a card - a live preview next to
// its HTML - and inserts the HTML that is in the card, so colours can be changed there. An inserted block is plain HTML: changing a template here
// does not change blocks that are already in a text. The sample texts are Slovak; the author writes his own over them.
// Every template has to survive the sanitizers unchanged (src/rules.js, src/htmlSanitize.js; scripts/check-text-templates.js checks it).
(function (root) {
  const TEMPLATES = [
    {
      id: 'note',
      name: { sk: 'Poznámka (oranžová)', en: 'Note (orange)' },
      html: '<p class="pr-note">Dôležitá poznámka k pravidlám.</p>',
    },
    {
      id: 'note-green',
      name: { sk: 'Poznámka (zelený závoj)', en: 'Note (green veil)' },
      html: '<p class="pr-note" style="border-left-color:#b2fa06;background:rgba(178,250,6,.12)">Tip alebo zvýraznená informácia.</p>',
    },
    {
      id: 'list',
      name: { sk: 'Zoznam s bodkami', en: 'Bulleted list' },
      html: '<ul class="pr-list"><li><strong>Prvá vec:</strong> popis.</li><li>Druhá vec.</li><li>Tretia vec.</li></ul>',
    },
    {
      id: 'list-numbered',
      name: { sk: 'Číslovaný zoznam', en: 'Numbered list' },
      html: '<ol class="pr-list num"><li>prvý krok</li><li>druhý krok</li><li>tretí krok</li></ol>',
    },
    {
      id: 'subheading',
      name: { sk: 'Podnadpis sekcie', en: 'Sub-heading' },
      html: '<h3 class="pr-sub">Nadpis časti</h3>',
    },
    {
      id: 'categories',
      name: { sk: 'Tri kategórie hráčov', en: 'Three player categories' },
      html: '<div class="pr-cats">'
        + '<div class="pr-cat novice"><div class="pr-cat-name">Novice</div><div class="pr-cat-level">pre začiatočníkov</div><div class="pr-cat-sub">Charakteristika hráčov</div><ul class="pr-list"><li>Prvá vlastnosť.</li><li>Druhá vlastnosť.</li></ul></div>'
        + '<div class="pr-cat nextgen"><div class="pr-cat-name">Next Gen</div><div class="pr-cat-level">pre pokročilých</div><div class="pr-cat-sub">Charakteristika hráčov</div><ul class="pr-list"><li>Prvá vlastnosť.</li><li>Druhá vlastnosť.</li></ul></div>'
        + '<div class="pr-cat elite"><div class="pr-cat-name">Elite</div><div class="pr-cat-level">pre výkonnostných hráčov</div><div class="pr-cat-sub">Charakteristika hráčov</div><ul class="pr-list"><li>Prvá vlastnosť.</li><li>Druhá vlastnosť.</li></ul></div>'
        + '</div>',
    },
    {
      id: 'points',
      name: { sk: 'Body za výsledok', en: 'Points per result' },
      html: '<div class="pr-points">'
        + '<div class="pr-pt win"><strong>3</strong><span>Výhra 2:0</span></div>'
        + '<div class="pr-pt win"><strong>2</strong><span>Výhra 2:1</span></div>'
        + '<div class="pr-pt"><strong>1</strong><span>Prehra 1:2</span></div>'
        + '<div class="pr-pt"><strong>0</strong><span>Prehra 0:2</span></div>'
        + '<div class="pr-pt bad"><strong>−3</strong><span>Nenastúpenie</span></div>'
        + '</div>',
    },
    {
      id: 'coefficients',
      name: { sk: 'Koeficienty kategórií', en: 'Category coefficients' },
      html: '<div class="pr-coef"><div class="elite"><span>Elite</span><strong>×10</strong></div><div class="nextgen"><span>Next Gen</span><strong>×7</strong></div><div class="novice"><span>Novice</span><strong>×4</strong></div></div>',
    },
    {
      id: 'cycles',
      name: { sk: 'Cykly sezóny', en: 'Season cycles' },
      html: '<div class="pr-cycles">'
        + '<div class="pr-cycle"><strong>Winter Opening Series</strong><span>Január – Apríl</span></div>'
        + '<div class="pr-cycle"><strong>Summer Rally Series</strong><span>Máj – August</span></div>'
        + '<div class="pr-cycle"><strong>Autumn Finals Series</strong><span>September – December</span></div>'
        + '</div>',
    },
    {
      id: 'table',
      name: { sk: 'Tabuľka', en: 'Table' },
      html: '<table class="pr-table"><thead><tr><th>Body</th><th>Novice</th><th>Next Gen</th><th>Elite</th></tr></thead>'
        + '<tbody><tr><td>Víťaz</td><td>40</td><td>70</td><td>100</td></tr><tr><td>Finalista</td><td>20</td><td>40</td><td>70</td></tr></tbody></table>',
    },
    {
      id: 'grey-tile',
      name: { sk: 'Sivá dlaždica', en: 'Grey tile' },
      html: '<div class="pr-card grey-tile"><p><strong>Nadpis dlaždice</strong></p><p>Text v sivej dlaždici.</p></div>',
    },
    {
      id: 'black-tile',
      name: { sk: 'Čierna dlaždica', en: 'Black tile' },
      html: '<div class="pr-card black-tile"><p><strong>Nadpis dlaždice</strong></p><p>Text v čiernej dlaždici.</p></div>',
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = TEMPLATES;
  else root.TEXT_TEMPLATES = TEMPLATES;
}(typeof window !== 'undefined' ? window : globalThis));
