/* ──────────────────────────────────────────────────────────────
   EmojiPicker — reusable emoji picker popup
   Usage:
     EmojiPicker.init(guildEmojis)  // call once with guild emoji array
     EmojiPicker.open(anchorEl, callback)   // open near element
     EmojiPicker.close()
   Callback receives: unicode char (e.g. "😀") or "name:id" for custom
────────────────────────────────────────────────────────────── */
window.EmojiPicker = (function () {
    'use strict';

    const RECENT_KEY = '_epRecent';
    const MAX_RECENT = 30;

    let _guild    = [];
    let _data     = null;
    let _recent   = [];
    let _cb       = null;
    let _el       = null;
    let _tab      = 'server';
    let _query    = '';
    let _initialized = false;

    /* ── Recent ─────────────────────────────────────── */
    function _loadRecent() {
        try { _recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
        catch { _recent = []; }
        if (!Array.isArray(_recent)) _recent = [];
    }
    function _pushRecent(value, label, isCustom, url) {
        _loadRecent();
        const entry = { value, label, isCustom, url: url || null };
        _recent = [entry, ..._recent.filter(e => e.value !== value)].slice(0, MAX_RECENT);
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(_recent)); } catch {}
    }

    /* ── Lazy load emoji data ───────────────────────── */
    function _loadData() {
        if (_data) return Promise.resolve(_data);
        return fetch('/js/emoji-data.json').then(r => r.json()).then(d => { _data = d; return d; });
    }

    /* ── Render helpers ─────────────────────────────── */
    function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function _unicodeBtn(char, name) {
        return `<button class="ep-cell" title="${_esc(name)}" data-v="${_esc(char)}" data-l="${_esc(name)}" data-c="0">${char}</button>`;
    }
    function _customBtn(id, name, url, animated) {
        const ext = animated ? 'gif' : 'webp';
        const src = url || `https://cdn.discordapp.com/emojis/${id}.${ext}?size=32`;
        return `<button class="ep-cell ep-custom" title=":${_esc(name)}:" data-v="${_esc(name+':'+id)}" data-l="${_esc(name)}" data-c="1" data-u="${_esc(src)}"><img src="${_esc(src)}" alt=":${_esc(name)}:" loading="lazy"></button>`;
    }

    /* ── Build grid HTML ────────────────────────────── */
    function _gridFor(items) {
        return items.length
            ? `<div class="ep-grid">${items.join('')}</div>`
            : `<div class="ep-empty">No emoji found</div>`;
    }

    function _renderContent() {
        const q = _query.toLowerCase().trim();

        /* search mode */
        if (q) {
            const btns = [];
            (_guild || []).forEach(e => { if (e.name.toLowerCase().includes(q)) btns.push(_customBtn(e.id, e.name, e.url, e.animated)); });
            if (_data) {
                Object.values(_data).forEach(cat => {
                    (cat.emojis || []).forEach(([char, name]) => {
                        if (name.toLowerCase().includes(q) || char === q) btns.push(_unicodeBtn(char, name));
                    });
                });
            }
            return `<div class="ep-section-label">Search: "${_esc(q)}"</div>` + _gridFor(btns);
        }

        if (_tab === 'recent') {
            if (!_recent.length) return `<div class="ep-empty">No recent emoji yet</div>`;
            const btns = _recent.map(e => e.isCustom ? _customBtn(e.value.split(':')[1], e.value.split(':')[0], e.url, false) : _unicodeBtn(e.label, e.label));
            return `<div class="ep-section-label">Recently Used</div>` + _gridFor(btns);
        }

        if (_tab === 'server') {
            if (!_guild.length) return `<div class="ep-empty">No custom emoji in this server</div>`;
            const btns = _guild.map(e => _customBtn(e.id, e.name, e.url, e.animated));
            return `<div class="ep-section-label">Server Emoji</div>` + _gridFor(btns);
        }

        /* unicode category */
        if (_data && _data[_tab]) {
            const cat = _data[_tab];
            const btns = (cat.emojis || []).map(([char, name]) => _unicodeBtn(char, name));
            return `<div class="ep-section-label">${_esc(cat.label)}</div>` + _gridFor(btns);
        }

        return `<div class="ep-empty">Loading…</div>`;
    }

    function _tabs() {
        const cats = [
            { id: 'server', icon: '🖥️', label: 'Server' },
            { id: 'recent', icon: '🕐', label: 'Recent' },
        ];
        if (_data) {
            Object.entries(_data).forEach(([id, cat]) => {
                cats.push({ id, icon: cat.icon, label: cat.label });
            });
        }
        return cats.map(c => `<button class="ep-tab${_tab === c.id ? ' active' : ''}" data-tab="${c.id}" title="${_esc(c.label)}">${c.icon}</button>`).join('');
    }

    function _build() {
        _el.innerHTML = `
<div class="ep-search-row">
    <span class="ep-search-icon">🔍</span>
    <input class="ep-search" type="text" placeholder="Search emoji…" value="${_esc(_query)}" autocomplete="off" spellcheck="false">
</div>
<div class="ep-body">
    <div class="ep-tabs">${_tabs()}</div>
    <div class="ep-content">${_renderContent()}</div>
</div>`;
        _el.querySelector('.ep-search').addEventListener('input', e => {
            _query = e.target.value;
            _refresh();
        });
        _el.querySelector('.ep-tabs').addEventListener('click', e => {
            const btn = e.target.closest('[data-tab]');
            if (!btn) return;
            _tab = btn.dataset.tab;
            _query = '';
            _el.querySelector('.ep-search').value = '';
            _refresh();
        });
        _el.querySelector('.ep-content').addEventListener('click', e => {
            const btn = e.target.closest('[data-v]');
            if (!btn) return;
            const value   = btn.dataset.v;
            const label   = btn.dataset.l;
            const isCustom = btn.dataset.c === '1';
            const url     = btn.dataset.u || null;
            _pushRecent(value, label, isCustom, url);
            _cb && _cb(value, isCustom, url);
            close();
        });
    }

    function _refresh() {
        if (!_el) return;
        _el.querySelector('.ep-tabs').innerHTML   = _tabs();
        _el.querySelector('.ep-content').innerHTML = _renderContent();
        /* re-attach tab listener */
        _el.querySelector('.ep-tabs').addEventListener('click', e => {
            const btn = e.target.closest('[data-tab]');
            if (!btn) return;
            _tab = btn.dataset.tab;
            _query = '';
            _el.querySelector('.ep-search').value = '';
            _refresh();
        });
        _el.querySelector('.ep-content').addEventListener('click', e => {
            const btn = e.target.closest('[data-v]');
            if (!btn) return;
            const value   = btn.dataset.v;
            const label   = btn.dataset.l;
            const isCustom = btn.dataset.c === '1';
            const url     = btn.dataset.u || null;
            _pushRecent(value, label, isCustom, url);
            _cb && _cb(value, isCustom, url);
            close();
        });
    }

    /* ── Position popup ─────────────────────────────── */
    function _position(anchor) {
        const rect = anchor.getBoundingClientRect();
        const pw = 320, ph = 380;
        let left = rect.left + window.scrollX;
        let top  = rect.bottom + window.scrollY + 6;
        if (left + pw > window.innerWidth - 8)  left = window.innerWidth - pw - 8;
        if (top  + ph > window.innerHeight + window.scrollY - 8) top = rect.top + window.scrollY - ph - 6;
        _el.style.left = Math.max(8, left) + 'px';
        _el.style.top  = Math.max(8, top)  + 'px';
    }

    /* ── Public API ─────────────────────────────────── */
    function init(guildEmojis) {
        _guild = Array.isArray(guildEmojis) ? guildEmojis : [];
        _loadRecent();
        if (!_initialized) {
            _initialized = true;
            _injectStyles();
            /* close on outside click */
            document.addEventListener('click', e => {
                if (_el && _el.style.display !== 'none' && !_el.contains(e.target)) close();
            }, true);
            document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
        }
    }

    function open(anchor, callback) {
        _cb = callback;
        _query = '';
        _loadRecent();
        if (!_el) {
            _el = document.createElement('div');
            _el.id = 'ep-popup';
            _el.className = 'ep-popup';
            document.body.appendChild(_el);
        }
        _el.style.display = 'flex';
        _el.style.flexDirection = 'column';
        _el.innerHTML = `<div class="ep-loading">Loading…</div>`;
        _position(anchor);

        _loadData().then(() => {
            if (_el.style.display === 'none') return;
            _tab = _guild.length ? 'server' : 'people';
            _build();
            _position(anchor);
            _el.querySelector('.ep-search')?.focus();
        });
    }

    function close() {
        if (_el) _el.style.display = 'none';
        _cb = null;
    }

    /* ── Styles ─────────────────────────────────────── */
    function _injectStyles() {
        if (document.getElementById('ep-styles')) return;
        const s = document.createElement('style');
        s.id = 'ep-styles';
        s.textContent = `
.ep-popup {
    position: absolute; z-index: 9999;
    width: min(320px, calc(100vw - 16px));
    background: var(--bg2, #2b2d31); border: 1px solid var(--border, #3f4248);
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.35);
    display: none; flex-direction: column; overflow: hidden;
    font-family: inherit;
}
.ep-search-row {
    display: flex; align-items: center; gap: .4rem;
    padding: .5rem .6rem; border-bottom: 1px solid var(--border, #3f4248);
    background: var(--bg3, #232428);
}
.ep-search-icon { font-size: .85rem; opacity: .5; flex-shrink: 0; }
.ep-search {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--text, #e0e1e5); font-size: .84rem;
    caret-color: var(--accent, #5865f2);
}
.ep-search::placeholder { color: var(--text-muted, #8e9297); }
.ep-body { display: flex; height: min(310px, 55vh); overflow: hidden; }
.ep-tabs {
    display: flex; flex-direction: column; gap: 2px;
    padding: .4rem .25rem; background: var(--bg3, #232428);
    border-right: 1px solid var(--border, #3f4248);
    overflow-y: auto; flex-shrink: 0; width: 38px;
}
.ep-tabs::-webkit-scrollbar { width: 3px; }
.ep-tabs::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.ep-tab {
    width: 30px; height: 30px; border-radius: 7px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.1rem; line-height: 1;
    background: none; border: none; cursor: pointer;
    transition: background .12s;
    flex-shrink: 0;
}
.ep-tab:hover { background: var(--bg2, #2b2d31); }
.ep-tab.active { background: rgba(88,101,242,.25); }
.ep-content {
    flex: 1; overflow-y: auto; padding: .4rem;
    min-width: 0;
}
.ep-content::-webkit-scrollbar { width: 4px; }
.ep-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.ep-section-label {
    font-size: .68rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--text-muted, #8e9297);
    padding: .2rem .2rem .4rem; margin-bottom: .2rem;
}
.ep-grid {
    display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
}
.ep-cell {
    width: 34px; height: 34px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem; line-height: 1;
    background: none; border: none; cursor: pointer;
    transition: background .1s; flex-shrink: 0;
    padding: 0;
}
.ep-cell:hover { background: var(--bg3, #232428); }
.ep-custom img {
    width: 22px; height: 22px; object-fit: contain; border-radius: 3px;
    display: block;
}
.ep-empty {
    color: var(--text-muted, #8e9297); font-size: .82rem;
    padding: 1.5rem .5rem; text-align: center;
}
.ep-loading {
    color: var(--text-muted, #8e9297); font-size: .82rem;
    padding: 2rem; text-align: center;
}
@media (max-width: 380px) {
    .ep-grid { grid-template-columns: repeat(6, 1fr); }
    .ep-cell { width: 30px; height: 30px; font-size: 1.05rem; }
}`;
        document.head.appendChild(s);
    }

    return { init, open, close };
})();
