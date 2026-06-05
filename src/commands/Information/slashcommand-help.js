const {
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const DiscordBot = require("../../client/DiscordBot");
const ApplicationCommand = require("../../structure/ApplicationCommand");
const { isDeveloper } = require("../../utils/dmGuildProxy");

// ═════════════════════════════════════════════════════════════════════════════
// HELPER — deteksi level akses user
// ═════════════════════════════════════════════════════════════════════════════
function getUserLevel(interaction) {
    const userId = interaction.user.id;
    const isDM   = !interaction.guild;

    if (isDeveloper(userId))                                                             return 'dev';
    if (!isDM && interaction.member?.id === interaction.guild?.ownerId)                  return 'guild_owner';
    if (!isDM && interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) return 'admin';
    if (!isDM && interaction.member?.permissions.has(PermissionFlagsBits.ManageGuild))   return 'manager';
    if (!isDM && (
        interaction.member?.permissions.has(PermissionFlagsBits.KickMembers)    ||
        interaction.member?.permissions.has(PermissionFlagsBits.BanMembers)     ||
        interaction.member?.permissions.has(PermissionFlagsBits.ModerateMembers)||
        interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages)
    )) return 'moderator';
    return 'member';
}

// ═════════════════════════════════════════════════════════════════════════════
// DATA COMMAND
// ═════════════════════════════════════════════════════════════════════════════
const COMMANDS = {
    dev: [
        // ── Server DM ──────────────────────────────────────────────────────
        { name: '/server list',      desc: 'Tampilkan semua server yang diikuti bot.',                                             example: '/server list' },
        { name: '/server pilih',     desc: 'Pilih server aktif dari DM. Wajib sebelum command lain via DM.',                      example: '/server pilih id:123456789' },
        { name: '/server info',      desc: 'Lihat server yang sedang aktif dan status izin bot.',                                  example: '/server info' },
        { name: '/server channels',  desc: 'Lihat semua channel + ID di server aktif. Berguna untuk isi ID di command lain.',     example: '/server channels tipe:Teks' },
        { name: '/server roles',     desc: 'Lihat semua role + ID di server aktif. Berguna untuk isi ID role di command lain.',   example: '/server roles filter:Manual' },
        { name: '/server commands',  desc: 'Tampilkan semua command beserta status konfigurasinya di server aktif.',              example: '/server commands kategori:Utility' },
        { name: '/server batalkan',  desc: 'Batalkan pilihan server aktif.',                                                      example: '/server batalkan' },
        // ── Kontrol Bot ────────────────────────────────────────────────────
        { name: '/eval',             desc: 'Jalankan kode JavaScript langsung di bot. Untuk debugging.',                          example: '/eval code:client.guilds.cache.size' },
        { name: '/reload',           desc: 'Muat ulang semua command tanpa restart bot.',                                         example: '/reload' },
        { name: '/offline',          desc: 'Matikan bot dengan aman (database di-close dahulu).',                                 example: '/offline' },
        { name: '/restart',          desc: 'Restart bot dengan aman (database di-close dahulu).',                                 example: '/restart' },
    ],
    admin: [
        // ── Welcome ────────────────────────────────────────────────────────
        { name: '/welcome status',          desc: 'Lihat konfigurasi pesan sambutan saat ini.',                                          example: '/welcome status' },
        { name: '/welcome toggle',          desc: 'Nyalakan/matikan pesan sambutan member baru.',                                        example: '/welcome toggle aktif:true' },
        { name: '/welcome channel',         desc: 'Atur channel tempat pesan sambutan dikirim.',                                         example: '/welcome channel channel:#sambutan' },
        { name: '/welcome teks',            desc: 'Ubah judul & deskripsi embed sambutan via modal. Placeholder: `{server}` `{member}` `{count}` `{tag}`', example: '/welcome teks' },
        { name: '/welcome color',           desc: 'Ubah warna garis embed sambutan (hex).',                                              example: '/welcome color hex:#5865F2' },
        { name: '/welcome footer',          desc: 'Ubah teks footer embed sambutan.',                                                    example: '/welcome footer teks:Selamat bergabung!' },
        { name: '/welcome thumbnail',       desc: 'Tampilkan/sembunyikan foto profil member di embed sambutan.',                         example: '/welcome thumbnail tampil:true' },
        { name: '/welcome fields',          desc: 'Tampilkan/sembunyikan field info (member baru, akun dibuat, total member, diundang oleh, kode invite, total undangan).', example: '/welcome fields field:diundang_oleh tampil:true' },
        { name: '/welcome reset',           desc: 'Reset semua konfigurasi welcome ke default.',                                         example: '/welcome reset' },
        { name: '/welcome preview',         desc: 'Pratinjau tampilan embed sambutan.',                                                  example: '/welcome preview' },
        // ── Goodbye ────────────────────────────────────────────────────────
        { name: '/goodbye status',    desc: 'Lihat konfigurasi pesan perpisahan.',                                              example: '/goodbye status' },
        { name: '/goodbye toggle',    desc: 'Nyalakan/matikan pesan perpisahan.',                                               example: '/goodbye toggle aktif:true' },
        { name: '/goodbye channel',   desc: 'Atur channel pesan perpisahan.',                                                   example: '/goodbye channel channel:#log-keluar' },
        { name: '/goodbye tipe',      desc: 'Pilih tipe pesan: embed atau teks biasa.',                                         example: '/goodbye tipe tipe:embed' },
        { name: '/goodbye teks',      desc: 'Ubah judul & deskripsi (embed) atau isi teks biasa (plain) via modal.',            example: '/goodbye teks' },
        { name: '/goodbye color',     desc: 'Ubah warna garis embed perpisahan (hex).',                                         example: '/goodbye color hex:#ED4245' },
        { name: '/goodbye footer',    desc: 'Ubah teks footer embed perpisahan.',                                               example: '/goodbye footer teks:Selamat tinggal!' },
        { name: '/goodbye thumbnail', desc: 'Tampilkan/sembunyikan foto profil di embed perpisahan.',                           example: '/goodbye thumbnail tampil:false' },
        { name: '/goodbye fields',    desc: 'Tampilkan/sembunyikan field info (member, bergabung, akun dibuat, total member).', example: '/goodbye fields field:bergabung tampil:true' },
        { name: '/goodbye card',      desc: 'Konfigurasi goodbye card: toggle on/off, ubah teks, ubah warna.',                 example: '/goodbye card aksi:toggle' },
        { name: '/goodbye reset',     desc: 'Reset semua konfigurasi goodbye ke default.',                                      example: '/goodbye reset' },
        { name: '/goodbye preview',   desc: 'Pratinjau tampilan pesan perpisahan dengan pengaturan saat ini.',                  example: '/goodbye preview' },
        // ── Autorole (Otomatis) ────────────────────────────────────────────
        { name: '/autorole status',         desc: 'Lihat role otomatis aktif untuk manusia dan bot.',                             example: '/autorole status' },
        { name: '/autorole human set',      desc: 'Role otomatis untuk member manusia yang baru bergabung.',                      example: '/autorole human set role:@Member' },
        { name: '/autorole human toggle',   desc: 'Nyalakan/matikan autorole manusia.',                                           example: '/autorole human toggle aktif:true' },
        { name: '/autorole bot set',        desc: 'Role otomatis untuk bot yang ditambahkan.',                                    example: '/autorole bot set role:@Bot' },
        // ── Autorole Button ────────────────────────────────────────────────
        { name: '/autorole-button list',         desc: 'Lihat semua panel autorole button yang ada.',                            example: '/autorole-button list' },
        { name: '/autorole-button buat',         desc: 'Buat panel baru atau ubah template/mode panel. Mode: Multi atau Single.',  example: '/autorole-button buat nama:gaming mode:multi' },
        { name: '/autorole-button tambah-button',desc: 'Tambah tombol role ke sebuah panel.',                                    example: '/autorole-button tambah-button panel:gaming role:@Gaming label:🎮 Gaming warna:primary' },
        { name: '/autorole-button tambah-bulk',  desc: 'Tambah banyak tombol sekaligus. Format: `@Role | Label | warna`',        example: '/autorole-button tambah-bulk panel:gaming' },
        { name: '/autorole-button edit-button',  desc: 'Edit label atau warna tombol yang sudah ada di panel.',                  example: '/autorole-button edit-button panel:gaming role:@Gaming label:🎮 Gamer' },
        { name: '/autorole-button edit-bulk',    desc: 'Edit banyak tombol sekaligus dalam satu panel.',                         example: '/autorole-button edit-bulk panel:gaming' },
        { name: '/autorole-button hapus-button', desc: 'Hapus satu tombol role dari panel.',                                     example: '/autorole-button hapus-button panel:gaming role:@Gaming' },
        { name: '/autorole-button hapus-bulk',   desc: 'Hapus banyak tombol sekaligus dari panel.',                              example: '/autorole-button hapus-bulk panel:gaming' },
        { name: '/autorole-button kirim',        desc: 'Kirim panel tombol role ke channel agar bisa diklik member.',            example: '/autorole-button kirim panel:gaming channel:#roles' },
        // ── Autorole Reaction ──────────────────────────────────────────────
        { name: '/autorole-reaction list',           desc: 'Lihat semua panel autorole reaction yang ada.',                          example: '/autorole-reaction list' },
        { name: '/autorole-reaction buat',           desc: 'Buat panel baru atau edit tampilan embed. Mode: Multi atau Single.',     example: '/autorole-reaction buat nama:color mode:multi' },
        { name: '/autorole-reaction tambah-reaction',desc: 'Tambah emoji reaction + role ke panel.',                                example: '/autorole-reaction tambah-reaction panel:color emoji:🔴 role:@Red' },
        { name: '/autorole-reaction hapus-reaction', desc: 'Hapus sebuah reaction dari panel berdasarkan role.',                    example: '/autorole-reaction hapus-reaction panel:color role:@Red' },
        { name: '/autorole-reaction hapus-panel',    desc: 'Hapus seluruh panel dari database.',                                    example: '/autorole-reaction hapus-panel panel:color' },
        { name: '/autorole-reaction set-warna',      desc: 'Ubah warna garis kiri embed panel (hex).',                              example: '/autorole-reaction set-warna panel:color hex:#5865F2' },
        { name: '/autorole-reaction preview',        desc: 'Pratinjau tampilan panel (hanya terlihat olehmu).',                     example: '/autorole-reaction preview panel:color' },
        { name: '/autorole-reaction kirim',          desc: 'Kirim panel ke channel (hanya bisa dikirim 1 kali).',                   example: '/autorole-reaction kirim panel:color channel:#roles' },
        // ── Booster ────────────────────────────────────────────────────────
        { name: '/booster status',               desc: 'Lihat semua konfigurasi fitur booster.',                                  example: '/booster status' },
        { name: '/booster list',                 desc: 'Daftar semua member yang sedang boost server.',                           example: '/booster list' },
        { name: '/booster notif boost-toggle',   desc: 'Nyalakan/matikan notifikasi saat ada yang boost.',                       example: '/booster notif boost-toggle aktif:true' },
        { name: '/booster notif boost-channel',  desc: 'Atur channel notifikasi saat ada yang boost.',                           example: '/booster notif boost-channel channel:#boost' },
        { name: '/booster notif boost-title',    desc: 'Ubah judul embed notifikasi boost.',                                     example: '/booster notif boost-title teks:Terima kasih, {member}!' },
        { name: '/booster notif boost-description', desc: 'Ubah deskripsi embed notifikasi boost.',                              example: '/booster notif boost-description teks:Kamu telah boost server!' },
        { name: '/booster notif boost-color',    desc: 'Ubah warna embed notifikasi boost (hex).',                               example: '/booster notif boost-color hex:#FF73FA' },
        { name: '/booster notif unboost-toggle', desc: 'Nyalakan/matikan notifikasi saat boost berakhir.',                       example: '/booster notif unboost-toggle aktif:true' },
        { name: '/booster notif unboost-channel',desc: 'Atur channel notifikasi saat boost berakhir.',                           example: '/booster notif unboost-channel channel:#boost' },
        { name: '/booster notif unboost-title',  desc: 'Ubah judul embed notifikasi unboost.',                                   example: '/booster notif unboost-title teks:Sampai jumpa, {member}!' },
        { name: '/booster notif unboost-description', desc: 'Ubah deskripsi embed notifikasi unboost.',                          example: '/booster notif unboost-description teks:Boost kamu telah berakhir.' },
        { name: '/booster notif unboost-color',  desc: 'Ubah warna embed notifikasi unboost (hex).',                             example: '/booster notif unboost-color hex:#ED4245' },
        { name: '/booster notif preview-boost',  desc: 'Pratinjau tampilan embed notifikasi boost.',                             example: '/booster notif preview-boost' },
        { name: '/booster notif preview-unboost',desc: 'Pratinjau tampilan embed notifikasi unboost.',                           example: '/booster notif preview-unboost' },
        { name: '/booster autorole set',         desc: 'Beri role otomatis ke member yang boost.',                               example: '/booster autorole set role:@Booster' },
        { name: '/booster autorole toggle',      desc: 'Nyalakan/matikan pemberian role otomatis booster.',                      example: '/booster autorole toggle aktif:true' },
        { name: '/booster autorole autoremove',  desc: 'Cabut role booster otomatis saat berhenti boost.',                       example: '/booster autorole autoremove aktif:true' },
        { name: '/booster autorole remove',      desc: 'Hapus konfigurasi role booster.',                                        example: '/booster autorole remove' },
        { name: '/booster reset',                desc: 'Reset sebagian atau semua konfigurasi booster.',                         example: '/booster reset' },
        // ── Server Stats ───────────────────────────────────────────────────
        { name: '/serverstats setup',       desc: 'Buat category & channel voice statistik otomatis (total member, user, bot).',  example: '/serverstats setup nama_kategori:📊 Stats' },
        { name: '/serverstats status',      desc: 'Aktifkan atau nonaktifkan fitur server stats.',                                example: '/serverstats status aktif:true' },
        { name: '/serverstats label',       desc: 'Ubah format teks channel statistik. Gunakan `{count}` sebagai angka.',         example: '/serverstats label tipe:total format:👥 Member: {count}' },
        { name: '/serverstats info',        desc: 'Lihat konfigurasi server stats saat ini.',                                     example: '/serverstats info' },
        { name: '/serverstats reset',       desc: 'Hapus semua konfigurasi server stats (channel tidak ikut dihapus).',           example: '/serverstats reset' },
        // ── Pesan / Embed ──────────────────────────────────────────────────
        { name: '/pesan buat',              desc: 'Buat template pesan embed bernama yang bisa dipakai berulang.',                example: '/pesan buat nama:sambutan' },
        { name: '/pesan set-warna',         desc: 'Ubah warna embed template pesan (hex).',                                      example: '/pesan set-warna' },
        { name: '/pesan set-gambar',        desc: 'Atur gambar (image) pada template pesan.',                                    example: '/pesan set-gambar' },
        { name: '/pesan set-thumbnail',     desc: 'Atur thumbnail pada template pesan.',                                         example: '/pesan set-thumbnail' },
        { name: '/pesan set-author',        desc: 'Atur nama dan ikon author pada template pesan.',                              example: '/pesan set-author' },
        { name: '/pesan preview',           desc: 'Pratinjau template pesan yang sedang diedit.',                                example: '/pesan preview' },
        { name: '/pesan info',              desc: 'Lihat detail konfigurasi sebuah template pesan.',                             example: '/pesan info' },
        { name: '/pesan list',              desc: 'Lihat semua template pesan yang sudah dibuat.',                               example: '/pesan list' },
        { name: '/pesan kirim',             desc: 'Kirim template pesan ke channel tertentu.',                                   example: '/pesan kirim nama:sambutan channel:#umum' },
        { name: '/pesan edit',              desc: 'Edit isi template pesan yang sudah ada.',                                     example: '/pesan edit' },
        { name: '/pesan salin',             desc: 'Duplikat template pesan dengan nama baru.',                                   example: '/pesan salin' },
        { name: '/pesan hapus',             desc: 'Hapus template pesan.',                                                       example: '/pesan hapus nama:sambutan' },
        // ── Invite Links ───────────────────────────────────────────────────
        { name: '/invites',                 desc: 'Tampilkan semua invite link server, diurutkan dari penggunaan terbanyak. Mendukung pagination.',  example: '/invites halaman:2' },
        // ── Automod ────────────────────────────────────────────────────────
        { name: '/automod config',             desc: 'Lihat semua konfigurasi automod saat ini.',                                     example: '/automod config' },
        { name: '/automod guide',              desc: 'Panduan lengkap cara setup sistem automod.',                                    example: '/automod guide' },
        { name: '/automod muteperms',          desc: 'Panduan setup izin role mute agar fitur mute berfungsi.',                       example: '/automod muteperms' },
        { name: '/automod action',             desc: 'Pilih tindakan saat pelanggaran: delete / warn / mute / kick / ban.',           example: '/automod action tipe:warn' },
        { name: '/automod antilink',           desc: 'Aktifkan/nonaktifkan pemblokiran semua URL dalam pesan.',                       example: '/automod antilink aktif:true' },
        { name: '/automod antiinvite',         desc: 'Aktifkan/nonaktifkan pemblokiran link invite Discord.',                         example: '/automod antiinvite aktif:true' },
        { name: '/automod spam',               desc: 'Konfigurasi proteksi anti-spam (batas pesan per interval).',                   example: '/automod spam aktif:true limit:5 interval:5' },
        { name: '/automod massmention',        desc: 'Konfigurasi batas maksimal mention dalam satu pesan.',                          example: '/automod massmention aktif:true limit:5' },
        { name: '/automod attachments',        desc: 'Aktifkan/nonaktifkan filter file/attachment dalam pesan.',                      example: '/automod attachments aktif:true' },
        { name: '/automod mute',               desc: 'Atur role mute yang digunakan saat tindakan mute aktif.',                       example: '/automod mute role:@Muted' },
        { name: '/automod auditlog',           desc: 'Atur channel log untuk semua aktivitas automod.',                               example: '/automod auditlog channel:#mod-log' },
        { name: '/automod antiraid',           desc: 'Konfigurasi anti-raid: blokir join massal dalam waktu singkat.',                example: '/automod antiraid aktif:true join_limit:10 interval:10' },
        { name: '/automod words add',          desc: 'Tambahkan kata terlarang ke daftar filter.',                                    example: '/automod words add kata:badword' },
        { name: '/automod words list',         desc: 'Lihat semua kata yang ada di daftar terlarang.',                               example: '/automod words list' },
        { name: '/automod words delete',       desc: 'Hapus kata dari daftar terlarang.',                                            example: '/automod words delete kata:badword' },
        { name: '/automod whitelist add',      desc: 'Tambah channel atau role ke whitelist (bebas dari automod).',                   example: '/automod whitelist add channel:#bot-spam' },
        { name: '/automod whitelist remove',   desc: 'Hapus channel atau role dari whitelist.',                                       example: '/automod whitelist remove role:@Staff' },
        { name: '/automod whitelist list',     desc: 'Lihat semua channel dan role yang di-whitelist.',                               example: '/automod whitelist list' },
        // ── Ticket ─────────────────────────────────────────────────────────
        { name: '/ticket kirim-panel',  desc: 'Kirim panel tiket ke channel tertentu.',                                     example: '/ticket kirim-panel channel:#tiket' },
        { name: '/ticket list',         desc: 'Lihat semua tiket yang sedang terbuka di server.',                           example: '/ticket list' },
        { name: '/ticket tutup',        desc: 'Tutup tiket di channel tiket ini.',                                          example: '/ticket tutup' },
        { name: '/ticket tambah',       desc: 'Tambahkan user ke tiket yang sedang aktif.',                                 example: '/ticket tambah user:@user' },
        { name: '/ticket hapus',        desc: 'Hapus akses user dari tiket yang sedang aktif.',                             example: '/ticket hapus user:@user' },
        // ── Giveaway ───────────────────────────────────────────────────────
        { name: '/giveaway start',  desc: 'Mulai giveaway baru dengan hadiah, durasi, dan jumlah pemenang.',               example: '/giveaway start hadiah:Nitro durasi:1d channel:#giveaway pemenang:3' },
        { name: '/giveaway end',    desc: 'Akhiri giveaway aktif sekarang dan pilih pemenang.',                            example: '/giveaway end giveaway:id' },
        { name: '/giveaway reroll', desc: 'Pilih ulang pemenang giveaway yang sudah selesai.',                             example: '/giveaway reroll giveaway:id' },
        { name: '/giveaway list',   desc: 'Lihat semua giveaway aktif di server.',                                         example: '/giveaway list' },
        // ── Modlog ─────────────────────────────────────────────────────────
        { name: '/modlog set',      desc: 'Atur channel untuk mencatat aksi moderasi (ban, kick, timeout, warn).',         example: '/modlog set channel:#mod-log' },
        { name: '/modlog disable',  desc: 'Matikan dan hapus konfigurasi mod log.',                                        example: '/modlog disable' },
        { name: '/modlog events',   desc: 'Pilih event yang dicatat: ban, unban, kick, timeout, warn.',                    example: '/modlog events' },
        // ── Warning ────────────────────────────────────────────────────────
        { name: '/warn add',    desc: 'Tambahkan peringatan ke member dengan alasan opsional.',                            example: '/warn add member:@user alasan:spam' },
        { name: '/warn remove', desc: 'Hapus satu peringatan berdasarkan ID (lihat ID dari /warn list).',                  example: '/warn remove member:@user id:abc123' },
        { name: '/warn clear',  desc: 'Hapus semua peringatan dari member.',                                               example: '/warn clear member:@user' },
        { name: '/warn list',   desc: 'Lihat daftar semua peringatan member beserta ID dan alasan.',                       example: '/warn list member:@user' },
        // ── Ban / Kick / Mute ──────────────────────────────────────────────
        { name: '/ban member',   desc: 'Ban member dari server. Opsional: alasan dan hapus riwayat pesan (0–7 hari).',    example: '/ban member user:@user alasan:pelanggaran' },
        { name: '/ban unban',    desc: 'Unban user dari server berdasarkan ID.',                                           example: '/ban unban user:123456789' },
        { name: '/kick',         desc: 'Kick member dari server dengan alasan opsional.',                                  example: '/kick user:@user alasan:spam' },
        { name: '/mute member',  desc: 'Beri timeout pada member (contoh: 10m, 1h, 2d — maks 28d).',                     example: '/mute member user:@user durasi:1h' },
        { name: '/mute unmute',  desc: 'Cabut timeout dari member.',                                                       example: '/mute unmute user:@user' },
        // ── Purge / Lock / Slowmode ────────────────────────────────────────
        { name: '/purge all',    desc: 'Hapus sejumlah pesan terakhir di channel (1–100).',                               example: '/purge all jumlah:50' },
        { name: '/purge user',   desc: 'Hapus pesan dari user tertentu di channel (1–100 pesan dicari).',                 example: '/purge user user:@user jumlah:20' },
        { name: '/lock channel', desc: 'Kunci channel agar member tidak bisa mengirim pesan. Mendukung strict mode.',     example: '/lock channel alasan:maintenance' },
        { name: '/lock unlock',  desc: 'Buka kunci channel yang sebelumnya dikunci.',                                     example: '/lock unlock' },
        { name: '/slowmode',     desc: 'Atur atau hapus slowmode di channel (contoh: 30s, 5m, 1h — 0 untuk matikan).',   example: '/slowmode durasi:30s' },
        // ── Lainnya ────────────────────────────────────────────────────────
        { name: '/set-nickname',            desc: 'Ganti atau reset nickname bot di server ini.',                                 example: '/set-nickname nama:OCTA' },
    ],
    manager: [
        { name: '/welcome status',       desc: 'Lihat konfigurasi pesan sambutan.',                    example: '/welcome status' },
        { name: '/welcome toggle',       desc: 'Nyalakan/matikan pesan sambutan.',                     example: '/welcome toggle aktif:true' },
        { name: '/welcome channel',      desc: 'Atur channel pesan sambutan.',                         example: '/welcome channel channel:#sambutan' },
        { name: '/goodbye status',       desc: 'Lihat konfigurasi pesan perpisahan.',                  example: '/goodbye status' },
        { name: '/goodbye toggle',       desc: 'Nyalakan/matikan pesan perpisahan.',                   example: '/goodbye toggle aktif:true' },
        { name: '/goodbye channel',      desc: 'Atur channel pesan perpisahan.',                       example: '/goodbye channel channel:#log' },
        { name: '/booster list',         desc: 'Daftar member yang sedang boost server.',              example: '/booster list' },
        { name: '/booster notif boost-toggle',   desc: 'Nyalakan/matikan notifikasi boost.',           example: '/booster notif boost-toggle aktif:true' },
        { name: '/booster notif unboost-toggle', desc: 'Nyalakan/matikan notifikasi unboost.',         example: '/booster notif unboost-toggle aktif:true' },
        { name: '/serverstats info',     desc: 'Lihat konfigurasi server stats saat ini.',             example: '/serverstats info' },
        { name: '/pesan buat',           desc: 'Buat template pesan embed.',                           example: '/pesan buat nama:info' },
        { name: '/pesan list',           desc: 'Lihat semua template pesan.',                          example: '/pesan list' },
        { name: '/pesan kirim',          desc: 'Kirim template pesan ke channel.',                     example: '/pesan kirim nama:info channel:#umum' },
        { name: '/invites',              desc: 'Tampilkan semua invite link server beserta detail pengundang, channel, dan total penggunaan.',  example: '/invites' },
        { name: '/automod config',       desc: 'Lihat konfigurasi automod saat ini.',                         example: '/automod config' },
        { name: '/automod antilink',     desc: 'Aktifkan/nonaktifkan filter link.',                           example: '/automod antilink aktif:true' },
        { name: '/automod spam',         desc: 'Konfigurasi anti-spam.',                                      example: '/automod spam aktif:true' },
        { name: '/automod words add',    desc: 'Tambah kata terlarang.',                                      example: '/automod words add kata:badword' },
        { name: '/automod whitelist add',desc: 'Whitelist channel/role dari automod.',                        example: '/automod whitelist add channel:#bot-spam' },
    ],
    moderator: [
        { name: '/booster list',  desc: 'Lihat daftar member yang sedang boost server.',               example: '/booster list' },
        // ── Warning ────────────────────────────────────────────────────────
        { name: '/warn add',    desc: 'Tambahkan peringatan ke member dengan alasan opsional.',        example: '/warn add member:@user alasan:spam' },
        { name: '/warn remove', desc: 'Hapus satu peringatan berdasarkan ID.',                         example: '/warn remove member:@user id:abc123' },
        { name: '/warn clear',  desc: 'Hapus semua peringatan dari member.',                           example: '/warn clear member:@user' },
        { name: '/warn list',   desc: 'Lihat daftar peringatan member beserta ID dan alasan.',         example: '/warn list member:@user' },
        // ── Ban / Kick / Mute ──────────────────────────────────────────────
        { name: '/ban member',   desc: 'Ban member dari server dengan alasan opsional.',               example: '/ban member user:@user alasan:pelanggaran' },
        { name: '/ban unban',    desc: 'Unban user dari server.',                                      example: '/ban unban user:123456789' },
        { name: '/kick',         desc: 'Kick member dari server dengan alasan opsional.',              example: '/kick user:@user alasan:spam' },
        { name: '/mute member',  desc: 'Beri timeout pada member (contoh: 10m, 1h, 2d — maks 28d).',  example: '/mute member user:@user durasi:1h' },
        { name: '/mute unmute',  desc: 'Cabut timeout dari member.',                                   example: '/mute unmute user:@user' },
        // ── Purge ──────────────────────────────────────────────────────────
        { name: '/purge all',    desc: 'Hapus sejumlah pesan terakhir di channel (1–100).',            example: '/purge all jumlah:50' },
        { name: '/purge user',   desc: 'Hapus pesan dari user tertentu di channel.',                   example: '/purge user user:@user jumlah:20' },
        // ── Info ───────────────────────────────────────────────────────────
        { name: '/userinfo',     desc: 'Tampilkan informasi detail tentang member.',                   example: '/userinfo user:@user' },
    ],
    member: [
        { name: '/help',      desc: 'Tampilkan menu bantuan ini.',                                     example: '/help' },
        { name: '/ping',      desc: 'Cek latensi koneksi bot.',                                        example: '/ping' },
        { name: '/userinfo',  desc: 'Tampilkan informasi detail tentang dirimu atau member lain.',     example: '/userinfo' },
    ],
};

// ═════════════════════════════════════════════════════════════════════════════
// PAGINATION HELPER
// Max ~12 commands per page to stay safely under 6000 char embed limit
// ═════════════════════════════════════════════════════════════════════════════
const CMDS_PER_PAGE = 5;

/**
 * Split commands into pages and build a single embed for one page.
 */
function buildPagedEmbed(category, isDM, guildName, userLevel, page = 0) {
    const COLOR = { dev:'#FF73FA', guild_owner:'#FEE75C', admin:'#FEE75C', manager:'#57F287', moderator:'#5865F2', member:'#EB459E', overview:'#99AAB5' };
    const TITLE = { dev:'🛠️ Developer / Owner Bot', guild_owner:'👑 Owner & Admin Server', admin:'👑 Owner & Admin Server', manager:'⚙️ Manajer Server', moderator:'🛡️ Moderator Server', member:'👤 Member' };

    if (category === 'overview') {
        const ORDER = ['dev', 'guild_owner', 'admin', 'manager', 'moderator', 'member'];
        const idx   = ORDER.indexOf(userLevel);

        const lines = [];
        if (idx <= ORDER.indexOf('dev'))       lines.push('🛠️ **Developer** — Kontrol bot, eval, reload, offline, restart, server DM');
        if (idx <= ORDER.indexOf('admin'))     lines.push('👑 **Admin** — Welcome, goodbye, autorole, booster, serverstats, pesan, ticket, giveaway, modlog, warn, ban, kick, mute, purge, lock, slowmode');
        if (idx <= ORDER.indexOf('manager'))   lines.push('⚙️ **Manajer** — Pengaturan server tanpa administrator, invites');
        if (idx <= ORDER.indexOf('moderator')) lines.push('🛡️ **Moderator** — Warn, ban, kick, mute, purge, userinfo, booster list');
        lines.push('👤 **Member** — /help, /ping, /userinfo');

        if (isDM && userLevel === 'member') {
            return new EmbedBuilder()
                .setColor(COLOR.member)
                .setTitle('📖 Menu Bantuan — DM Bot')
                .setDescription([
                    '> Kamu mengakses help dari **DM Bot**.',
                    '',
                    '**📂 Command yang tersedia:**',
                    '👤 **Member** — /help dan /ping',
                ].join('\n'))
                .setFooter({ text: 'Menu aktif selama 3 menit · Pilih kategori dari menu di bawah.' })
                .setTimestamp();
        }

        return new EmbedBuilder()
            .setColor(COLOR.overview)
            .setTitle(`📖 Menu Bantuan${guildName ? ` — ${guildName}` : ' — DM Bot'}`)
            .setDescription([
                isDM
                    ? '> Kamu mengakses help dari **DM Bot**. Gunakan menu di bawah untuk melihat command.'
                    : '> Pilih kategori dari menu di bawah untuk melihat command dan contohnya.',
                '',
                '**📂 Kategori yang tersedia:**',
                ...lines,
            ].join('\n'))
            .setFooter({ text: 'Menu aktif selama 3 menit · Pilih kategori dari menu di bawah.' })
            .setTimestamp();
    }

    // Kategori guild_owner pakai data admin
    const dataKey = category === 'guild_owner' ? 'admin' : category;
    const allCmds = COMMANDS[dataKey] ?? [];
    const totalPages = Math.ceil(allCmds.length / CMDS_PER_PAGE);
    const safePage   = Math.max(0, Math.min(page, totalPages - 1));

    const pageCmds = allCmds.slice(safePage * CMDS_PER_PAGE, (safePage + 1) * CMDS_PER_PAGE);

    const NOTE = {
        dev:         isDM
            ? '> 💡 Dari DM: gunakan `/server pilih` dulu, lalu command lain akan berjalan di server tersebut.'
            : '> 💡 Command ini juga bisa digunakan dari **DM bot** setelah `/server pilih`.',
        guild_owner: '> 💡 Memerlukan permission **Administrator** atau **Owner Server**.',
        admin:       '> 💡 Memerlukan permission **Administrator** atau **Owner Server**.',
        manager:     '> 💡 Memerlukan permission **Manage Server** (tanpa Administrator).',
        moderator:   '> 💡 Memerlukan salah satu: Kick, Ban, Timeout, atau Manage Messages.',
        member:      '> ℹ️ Command yang bisa digunakan oleh semua member.',
    };

    const fieldValue = pageCmds.map(c =>
        `**${c.name}**\n> ${c.desc}\n> 📌 \`${c.example}\``
    ).join('\n\n');

    return new EmbedBuilder()
        .setColor(COLOR[category] ?? '#99AAB5')
        .setTitle(TITLE[category] ?? '📋 Command')
        .setDescription(NOTE[category] ?? null)
        .addFields({
            name: `📋 Command (${allCmds.length} total) — Halaman ${safePage + 1}/${totalPages}`,
            value: fieldValue,
            inline: false
        })
        .setFooter({ text: `${guildName ?? 'DM Bot'} · Halaman ${safePage + 1}/${totalPages} · Pilih kategori lain dari menu.` })
        .setTimestamp();
}

function getTotalPages(category) {
    const dataKey = (category === 'guild_owner') ? 'admin' : category;
    const cmds = COMMANDS[dataKey] ?? [];
    return Math.max(1, Math.ceil(cmds.length / CMDS_PER_PAGE));
}

// ═════════════════════════════════════════════════════════════════════════════
// SELECT MENU
// ═════════════════════════════════════════════════════════════════════════════
function buildMenu(userLevel, isDM) {
    const ORDER  = ['dev', 'guild_owner', 'admin', 'manager', 'moderator', 'member'];
    const idx    = ORDER.indexOf(userLevel);
    const options = [];

    if (isDM && userLevel === 'member') {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel('👤 Member').setDescription('/help dan /ping untuk semua orang.').setValue('member').setEmoji('👤'));

        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('help-menu')
                .setPlaceholder('Pilih kategori command…')
                .addOptions(options)
        );
    }

    options.push(new StringSelectMenuOptionBuilder()
        .setLabel('📋 Ringkasan Kategori').setDescription('Lihat semua kategori tersedia.').setValue('overview').setEmoji('📋'));

    if (idx <= ORDER.indexOf('dev')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('🛠️ Developer / Owner Bot').setDescription('Eval, reload, offline, restart, kontrol server lewat DM.').setValue('dev').setEmoji('🛠️'));

    if (idx <= ORDER.indexOf('admin')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('👑 Owner & Admin Server').setDescription('Welcome, autorole, booster, ticket, giveaway, modlog, warn, dan lebih.').setValue('admin').setEmoji('👑'));

    if (idx <= ORDER.indexOf('manager')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('⚙️ Manajer Server').setDescription('Pengaturan server tanpa administrator.').setValue('manager').setEmoji('⚙️'));

    if (idx <= ORDER.indexOf('moderator')) options.push(new StringSelectMenuOptionBuilder()
        .setLabel('🛡️ Moderator Server').setDescription('Warn, ban, kick, mute, purge, userinfo, dan lebih.').setValue('moderator').setEmoji('🛡️'));

    options.push(new StringSelectMenuOptionBuilder()
        .setLabel('👤 Member').setDescription('/help dan /ping untuk semua orang.').setValue('member').setEmoji('👤'));

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help-menu')
            .setPlaceholder('Pilih kategori command…')
            .addOptions(options)
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGINATION BUTTONS
// ═════════════════════════════════════════════════════════════════════════════
function buildNavRow(page, totalPages, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('help-prev')
            .setLabel('◀ Sebelumnya')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page <= 0),
        new ButtonBuilder()
            .setCustomId('help-next')
            .setLabel('Selanjutnya ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page >= totalPages - 1),
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND
// ═════════════════════════════════════════════════════════════════════════════
module.exports = new ApplicationCommand({
    command: {
        name: 'help',
        description: 'Tampilkan menu bantuan command bot.',
        type: 1,
        options: []
    },
    options: { cooldown: 5000 },

    /**
     * @param {DiscordBot} client
     * @param {ChatInputCommandInteraction} interaction
     */
    run: async (client, interaction) => {
        const isDM      = !interaction.guild;
        const guildName = interaction.guild?.name ?? null;
        const userLevel = getUserLevel(interaction);

        await interaction.deferReply();

        // State untuk sesi ini
        let currentCategory = 'overview';
        let currentPage     = 0;

        const overviewEmbed = buildPagedEmbed('overview', isDM, guildName, userLevel, 0);
        const menu          = buildMenu(userLevel, isDM);
        const totalPages    = getTotalPages(currentCategory);
        const navRow        = buildNavRow(0, totalPages);

        // Tampilkan nav buttons hanya jika bukan overview dan ada >1 halaman
        const components = currentCategory === 'overview' || totalPages <= 1
            ? [menu]
            : [menu, navRow];

        const reply = await interaction.editReply({
            embeds: [overviewEmbed],
            components: [menu]  // overview tidak perlu nav
        });

        // ── Collector untuk select menu DAN tombol navigasi ────────────
        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id &&
                (i.customId === 'help-menu' || i.customId === 'help-prev' || i.customId === 'help-next'),
            time: 3 * 60 * 1000
        });

        collector.on('collect', async i => {
            if (i.customId === 'help-menu') {
                // Ganti kategori, reset page
                currentCategory = i.values[0];
                currentPage     = 0;
            } else if (i.customId === 'help-prev') {
                currentPage = Math.max(0, currentPage - 1);
            } else if (i.customId === 'help-next') {
                const tp = getTotalPages(currentCategory);
                currentPage = Math.min(tp - 1, currentPage + 1);
            }

            const embed      = buildPagedEmbed(currentCategory, isDM, guildName, userLevel, currentPage);
            const tp         = getTotalPages(currentCategory);
            const newNavRow  = buildNavRow(currentPage, tp);

            // Tampilkan nav hanya jika ada lebih dari 1 halaman dan bukan overview
            const newComponents = (currentCategory === 'overview' || tp <= 1)
                ? [menu]
                : [menu, newNavRow];

            await i.update({ embeds: [embed], components: newComponents });
        });

        collector.on('end', async () => {
            const disabledMenu = new ActionRowBuilder().addComponents(
                StringSelectMenuBuilder.from(menu.components[0])
                    .setDisabled(true)
                    .setPlaceholder('Menu tidak aktif lagi.')
            );
            await reply.edit({ components: [disabledMenu] }).catch(() => null);
        });
    }
}).toJSON();
