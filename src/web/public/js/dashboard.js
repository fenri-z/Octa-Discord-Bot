// ── Toast notification global ─────────────────────────────────────────────
// Override showMsg yang didefinisikan inline di setiap view.
// dashboard.js di-load terakhir (dari footer.ejs) sehingga definisi ini
// menggantikan semua definisi showMsg inline di halaman.
window.showMsg = function (el, text, type) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = {
        success: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error:   '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    };

    // Render **bold** dan newline
    const html = String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.error}</span>
        <span class="toast-text">${html}</span>
        <button class="toast-close" onclick="this.closest('.toast').remove()" aria-label="Tutup">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Auto-dismiss
    const timer = setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 350);
    }, 3500);

    // Klik close langsung dismiss
    toast.querySelector('.toast-close').addEventListener('click', () => {
        clearTimeout(timer);
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 350);
    });
};

// Queue toast untuk ditampilkan setelah location.reload()
window.queueToast = function(text, type) {
    try { sessionStorage.setItem('_pendingToast', JSON.stringify({ text: String(text), type: type || 'success' })); } catch(e) {}
};

// Tampilkan pending toast dari reload sebelumnya
(function() {
    try {
        const qt = sessionStorage.getItem('_pendingToast');
        if (!qt) return;
        sessionStorage.removeItem('_pendingToast');
        const { text, type } = JSON.parse(qt);
        if (text) setTimeout(() => showMsg(null, text, type || 'success'), 80);
    } catch(e) {}
})();

// ── Custom select ────────────────────────────────────────────────────────
// Popup native <select> di sebagian browser/OS mobile (mis. Brave/Chrome
// Android) dirender pakai widget OS dan mengabaikan tema halaman. Di sini
// tiap <select class="select"> dibungkus dengan dropdown custom (HTML/CSS
// sendiri) yang selalu ikut tema web. <select> aslinya tetap ada di DOM
// (disembunyikan) sebagai value store, jadi semua onchange="" / .value yang
// sudah ada di tiap halaman tetap berfungsi tanpa diubah.
(function () {
    function syncTrigger(trigger, select) {
        const opt = select.options[select.selectedIndex];
        trigger.textContent = opt ? opt.textContent : '';
    }

    function closeAll() {
        document.querySelectorAll('.csel.open').forEach(c => c.classList.remove('open'));
    }

    function positionPopup(csel, popup) {
        popup.style.top = ''; popup.style.bottom = '';
        const rect = csel.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow < 220 && spaceAbove > spaceBelow) {
            popup.style.top = 'auto';
            popup.style.bottom = 'calc(100% + 6px)';
        }
    }

    function enhance(select) {
        if (select.dataset.cselEnhanced) return;
        select.dataset.cselEnhanced = '1';

        const csel = document.createElement('div');
        csel.className = 'csel' + (select.disabled ? ' disabled' : '');
        if (select.style.fontSize) csel.style.fontSize = select.style.fontSize;

        const trigger = document.createElement('div');
        trigger.className = 'csel-trigger';
        trigger.tabIndex = select.disabled ? -1 : 0;

        select.parentNode.insertBefore(csel, select);
        csel.appendChild(trigger);
        csel.appendChild(select);
        select.classList.add('csel-native');

        const popup = document.createElement('div');
        popup.className = 'csel-popup';
        Array.from(select.options).forEach(opt => {
            const item = document.createElement('div');
            item.className = 'csel-option' + (opt.disabled ? ' is-disabled' : '') + (opt.selected ? ' active' : '');
            item.textContent = opt.textContent;
            item.dataset.value = opt.value;
            if (!opt.disabled) {
                item.addEventListener('click', () => {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    closeAll();
                });
            }
            popup.appendChild(item);
        });
        csel.appendChild(popup);
        syncTrigger(trigger, select);

        if (!select.disabled) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = csel.classList.contains('open');
                closeAll();
                if (!isOpen) {
                    csel.classList.add('open');
                    positionPopup(csel, popup);
                }
            });
            trigger.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    trigger.click();
                } else if (e.key === 'Escape') {
                    closeAll();
                }
            });
        }

        // Sinkronkan tampilan custom kalau select.value diubah dari kode lain
        select.addEventListener('change', () => {
            syncTrigger(trigger, select);
            popup.querySelectorAll('.csel-option').forEach(o => {
                o.classList.toggle('active', o.dataset.value === select.value);
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('select.select').forEach(enhance);
    });
    document.addEventListener('click', closeAll);
    window.addEventListener('resize', closeAll);
})();
