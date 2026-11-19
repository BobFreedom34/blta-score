// The shared text editor of the Backend (Rules, Info, Blog): a toolbar (bold, italic, lists, link, HTML code) and "Template", which opens the cards of
// the text templates (text-templates.js). A card shows a live preview next to the HTML of the template; the HTML can be changed there (a colour, a
// word) and "Insert" puts what is in the card into the text. An inserted block is plain HTML in the text.
//
//   RichEditor.toolbarHtml()                      the toolbar, to be put above a contenteditable editor (and its hidden HTML textarea)
//   RichEditor.handleToolbarClick(e, cfg)         call it from the click handler of the page; true when the click was on the toolbar.
//                                                 cfg = { pane, editor, source } - selectors of the block that holds one editor, the editor and its textarea
//   RichEditor.tidy(html) / paragraphs(text)      the cleaning of the HTML view / of pasted text
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // text pasted into the editor keeps no formatting: its lines become paragraphs
  function paragraphs(text) {
    return String(text).split(/\r?\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
  }

  // code typed in the HTML view is cleaned of scripts and event handlers before it goes into the editor (the server keeps only
  // the page's own tags, classes and colours when it is saved)
  function tidy(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    t.content.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }));
    return t.innerHTML;
  }

  // the colours of the text colour menu: the colours of the site (the server keeps colours in a style, see src/templateStyle.js)
  const COLOURS = [['', 'Colour'], ['#ffffff', 'White'], ['#b2fa06', 'Green'], ['#ff5500', 'Orange'], ['#c3c7cf', 'Grey'], ['#ff5c5c', 'Red'], ['#5cc8ff', 'Blue'], ['#0a0a0a', 'Black']];
  const CHARS = ['Ω', '–', '—', '…', '×', '°', '½', '≥', '≤', '€', '•', '→'];

  // like the toolbar of WordPress: B I U S, lists, quote, line, alignment, link, paragraph format, colour, special characters, undo / redo, clear,
  // the templates and the HTML view
  function toolbarHtml() {
    const b = (cmd, label, title, extra = '') => `<button type="button" data-cmd="${cmd}" title="${title}"${extra}>${label}</button>`;
    return `
      <div class="rte-toolbar">
        ${b('bold', '<b>B</b>', 'Bold')}${b('italic', '<i>I</i>', 'Italic')}${b('underline', '<u>U</u>', 'Underline')}${b('strikeThrough', '<s>S</s>', 'Strikethrough')}
        ${b('insertUnorderedList', '• List', 'Bulleted list')}${b('insertOrderedList', '1. List', 'Numbered list')}${b('quote', '“ Quote', 'Quote')}${b('insertHorizontalRule', '—', 'Horizontal line')}
        ${b('justifyLeft', '⯇', 'Align left')}${b('justifyCenter', '≡', 'Align centre')}${b('justifyRight', '⯈', 'Align right')}${b('justifyFull', '☰', 'Justify')}
        ${b('link', 'Link', 'Insert a link')}${b('unlink', 'Unlink', 'Remove the link')}
        <select data-sel="format" title="Paragraph format"><option value="p">Paragraph</option><option value="h3">Heading</option><option value="h4">Sub-heading</option></select>
        <select data-sel="colour" title="Text colour">${COLOURS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        <select data-sel="char" title="Special character">${CHARS.map((c) => `<option value="${c === 'Ω' ? '' : c}">${c}</option>`).join('')}</select>
        ${b('undo', '↶', 'Undo')}${b('redo', '↷', 'Redo')}${b('removeFormat', 'Clear', 'Remove formatting')}
        ${b('template', '▦ Template', 'Insert a template (note, list, tiles, table...)')}
        ${b('source', '&lt;/&gt; HTML', 'Show the HTML code', ' style="margin-left:auto"')}
      </div>`;
  }

  // the cursor of the editor, kept while a menu of the toolbar has the focus
  let lastRange = null;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.anchorNode) {
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      if (el && el.closest && el.closest('[contenteditable="true"]')) lastRange = sel.getRangeAt(0).cloneRange();
    }
  });

  // a menu of the toolbar changed (paragraph format, colour, special character); cfg as in handleToolbarClick. true when it was a menu of the toolbar
  function handleToolbarChange(e, cfg) {
    const sel = e.target.closest && e.target.closest('.rte-toolbar [data-sel]');
    if (!sel) return false;
    const pane = sel.closest(cfg.pane);
    const rte = pane.querySelector(cfg.editor);
    const src = pane.querySelector(cfg.source);
    const value = sel.value;
    const kind = sel.dataset.sel;
    if (src.style.display !== 'none' || (kind !== 'format' && !value)) { if (kind !== 'format') sel.selectedIndex = 0; return true; }
    rte.focus();
    if (lastRange && rte.contains(lastRange.commonAncestorContainer)) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(lastRange); }
    if (kind === 'format') document.execCommand('formatBlock', false, value);
    else if (kind === 'colour') { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, value); document.execCommand('styleWithCSS', false, false); }
    else if (kind === 'char') document.execCommand('insertText', false, value);
    if (kind !== 'format') sel.selectedIndex = 0;
    return true;
  }

  // the window with the cards of the templates; onInsert(html) gets the HTML that is in the chosen card
  function openTemplatePicker(onInsert) {
    const templates = root.TEXT_TEMPLATES || [];
    const wrap = document.createElement('div');
    wrap.className = 'tpl-overlay';
    wrap.innerHTML = `
      <div class="tpl-dialog" role="dialog" aria-label="Templates">
        <div class="tpl-head"><strong>Templates</strong><span>Change the HTML of a card if you want (a colour, a word), then press Insert.</span><button type="button" class="tpl-close" aria-label="Close">×</button></div>
        <div class="tpl-grid">${templates.map((t, i) => `
          <div class="tpl-card" data-i="${i}">
            <div class="tpl-name">${esc(t.name.sk)} <span>${esc(t.name.en)}</span></div>
            <div class="tpl-body">
              <div class="tpl-preview pr-card pr-edit"></div>
              <textarea class="tpl-html" rows="6" spellcheck="false">${esc(t.html)}</textarea>
            </div>
            <button type="button" class="btn btn-primary btn-sm tpl-insert">Insert</button>
          </div>`).join('')}
        </div>
      </div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const preview = (card) => { card.querySelector('.tpl-preview').innerHTML = tidy(card.querySelector('.tpl-html').value); };
    wrap.querySelectorAll('.tpl-card').forEach(preview);
    wrap.addEventListener('input', (e) => { const card = e.target.closest('.tpl-card'); if (card && e.target.classList.contains('tpl-html')) preview(card); });
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('.tpl-close')) { close(); return; }
      const ins = e.target.closest('.tpl-insert');
      if (!ins) return;
      const html = ins.closest('.tpl-card').querySelector('.tpl-html').value;
      close();
      onInsert(html);
    });
    document.body.appendChild(wrap);
  }

  // puts a block at the cursor of the formatted editor (a saved range), at its end when the cursor was elsewhere, or into the HTML view at its cursor
  function insertBlock(rte, src, html, range) {
    if (src.style.display !== 'none') {
      const at = src.selectionStart == null ? src.value.length : src.selectionStart;
      src.value = `${src.value.slice(0, at)}\n${html}\n${src.value.slice(at)}`;
      return;
    }
    rte.focus();
    if (range && rte.contains(range.commonAncestorContainer)) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertHTML', false, tidy(html));
    } else {
      rte.insertAdjacentHTML('beforeend', tidy(html));
    }
  }

  function handleToolbarClick(e, cfg) {
    const tb = e.target.closest('.rte-toolbar [data-cmd]');
    if (!tb) return false;
    const pane = tb.closest(cfg.pane);
    const rte = pane.querySelector(cfg.editor);
    const src = pane.querySelector(cfg.source);
    const cmd = tb.dataset.cmd;
    if (cmd === 'source') {
      if (src.style.display === 'none') { src.value = rte.innerHTML; src.style.display = 'block'; rte.style.display = 'none'; tb.style.borderColor = 'var(--orange)'; }
      else { rte.innerHTML = tidy(src.value); src.style.display = 'none'; rte.style.display = ''; tb.style.borderColor = ''; }
      return true;
    }
    if (cmd === 'template') {
      const sel = window.getSelection();
      const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      openTemplatePicker((html) => insertBlock(rte, src, html, range));
      return true;
    }
    if (src.style.display !== 'none') return true; // the other buttons act on the formatted view
    rte.focus();
    if (cmd === 'link') {
      const url = window.prompt('Link address (https://…, mailto:… or /page)');
      if (url) document.execCommand('createLink', false, url);
    } else if (cmd === 'heading') {
      const inHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h3';
      document.execCommand('formatBlock', false, inHeading ? 'p' : 'h3');
    } else if (cmd === 'quote') {
      const inQuote = document.queryCommandValue('formatBlock').toLowerCase() === 'blockquote';
      document.execCommand('formatBlock', false, inQuote ? 'p' : 'blockquote');
    } else if (cmd.startsWith('justify')) { // the alignment as a style (text-align), not as the old align attribute
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, null);
      document.execCommand('styleWithCSS', false, false);
    } else {
      document.execCommand(cmd, false, null);
    }
    return true;
  }

  root.RichEditor = { toolbarHtml, handleToolbarClick, handleToolbarChange, openTemplatePicker, tidy, paragraphs };
}(window));
