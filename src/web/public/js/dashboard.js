// Pindahkan footer ke dalam dash-main agar selalu berada di bawah konten,
// bukan di luar dash-layout yang punya min-height: 100vh.
(function () {
    const footer   = document.querySelector('.dash-footer');
    const dashMain = document.querySelector('.dash-main');
    if (footer && dashMain) dashMain.appendChild(footer);
})();
