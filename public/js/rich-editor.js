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

  function toolbarHtml() {
    return `
      <div class="rte-toolbar">
        <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
        <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
        <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
        <button type="button" data-cmd="heading" title="Sub-heading">H</button>
        <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
        <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
        <button type="button" data-cmd="link" title="Link">Link</button>
        <button type="button" data-cmd="template" title="Insert a template (note, list, tiles, table...)">▦ Template</button>
        <button type="button" data-cmd="removeFormat" title="Remove formatting">Clear</button>
        <button type="button" data-cmd="source" title="Show the HTML code" style="margin-left:auto">&lt;/&gt; HTML</button>
      </div>`;
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
    } else {
      document.execCommand(cmd, false, null);
    }
    return true;
  }

  root.RichEditor = { toolbarHtml, handleToolbarClick, openTemplatePicker, tidy, paragraphs };
}(window));
