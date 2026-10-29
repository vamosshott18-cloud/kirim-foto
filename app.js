// Kirim Foto (web): pilih foto/folder → atur preset, watermark, ukuran, nama → Export ke Drive / Google Photos / perangkat.
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MOBILE = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || Mesin.IOS;
const FOTO = /\.(jpe?g|png|heic|heif|webp)$/i, VIDEO = /\.(mp4|mov|m4v)$/i;
const urutAlami = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1048576).toFixed(n >= 1e8 ? 0 : 1) + " MB";

/* ---------------- pengaturan ---------------- */
const BAWAAN = {
  ukuran: "sisi", kompres: "mutu", sisi: 2500, perbesar: false, piksel_w: 3000, piksel_h: 2000, piksel_isi: "pas", piksel_putar: true,
  persen: 50, mb: 1.0, jpeg: 85, tujuan: ["drive"],
  nama_folder: "{folder}",                      // nama folder/album tujuan, boleh pakai {folder} {tanggal} {bulan} {tahun} {no}
  drive_folder: null, drive_sub: true,          // folder Drive pilihan sendiri (null = otomatis Kirim Foto › nama folder)
  wm: { aktif: false, teks: "", logo: "", posisi: "kanan-bawah", ukuran: 20, opasitas: 70, nama_file: false, jam: false, isi: "regang", logo_portrait: "" },
  label: { aktif: false, teks: "{nama_baru}", posisi: "kiri-bawah", ukuran: 3.5, warna: "#ffffff", opasitas: 90, latar: "bayangan", tebal: true },
  lut: { file: "", kekuatan: 100 },
  edit: { ubah: {} },                             // slider ala Lightroom yang diubah dari nilai preset (.xmp) / dari nol
  nama: { mode: "asli", teks: "", urutan: false, format: "(x of y)" },
};
const salin = o => JSON.parse(JSON.stringify(o));
function gabung(a, b) { const o = salin(a); for (const k in b || {}) o[k] = (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && o[k] && typeof o[k] === "object") ? gabung(o[k], b[k]) : b[k]; return o; }
let ATUR;
try { ATUR = gabung(BAWAAN, JSON.parse(localStorage.getItem("kf_atur") || "{}")); } catch (e) { ATUR = salin(BAWAAN); }
const simpanAtur = () => { try { localStorage.setItem("kf_atur", JSON.stringify(ATUR)); } catch (e) {} };
function set(jalur, v) {
  const k = jalur.split("."); let o = ATUR;
  for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  o[k.at(-1)] = v; simpanAtur(); gambarAtur(); gambarTombol(); if (jalur === "nama_folder") gambarFolder(); pratinjau();
}

/* ---------------- penyimpanan pustaka (IndexedDB, di perangkat ini) ---------------- */
const DB = (() => {
  let db = null;
  const buka = () => db || (db = new Promise((ok, gagal) => {
    const r = indexedDB.open("kirimfoto", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pustaka", { keyPath: "id" });
    r.onsuccess = () => ok(r.result); r.onerror = () => gagal(r.error);
  }));
  const tx = async (mode, f) => { const d = await buka(); return new Promise((ok, gagal) => { const t = d.transaction("pustaka", mode); const s = t.objectStore("pustaka"); const r = f(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => gagal(t.error); }); };
  return { semua: () => tx("readonly", s => s.getAll()), simpan: x => tx("readwrite", s => s.put(x)), hapus: id => tx("readwrite", s => s.delete(id)) };
})();
let P = { preset: [], watermark: [] };
async function muatPustaka() {
  const semua = (await DB.semua()).sort((a, b) => b.t - a.t);
  P = { preset: semua.filter(x => x.jenis === "preset"), watermark: semua.filter(x => x.jenis === "watermark") };
}
const CACHE = new Map();
async function aset(id) {                        // LUT atau gambar logo dari pustaka
  if (!id) return null;
  if (CACHE.has(id)) return CACHE.get(id);
  const x = [...P.preset, ...P.watermark].find(i => i.id === id);
  if (!x) return null;
  let v;
  if (x.jenis === "preset") v = x.ext === "cube" ? LR.bacaCube(x.data) : { xmp: true, nilai: LRO.dariTeks(x.data) };
  else { v = new Image(); v.src = URL.createObjectURL(x.data); await v.decode(); }
  CACHE.set(id, v); return v;
}
async function muatAset(a) {
  const p = a.lut.file ? await aset(a.lut.file) : null, ubah = (a.edit || {}).ubah || {};
  const lr = p && p.xmp ? { ...p.nilai, ...ubah } : Object.keys(ubah).length ? { ...LRO.bawaan(), ...ubah } : null;
  return { lut: p && !p.xmp ? p : null, lr, logo: a.wm.aktif ? await aset(a.wm.logo) : null,
           logoPortrait: a.wm.aktif && a.wm.posisi === "penuh" ? await aset(a.wm.logo_portrait) : null };
}
function pilihBerkas(id) {
  return new Promise(ok => { const i = $(id); i.value = ""; i.onchange = () => ok([...i.files]); i.click(); });
}
async function tambahPustaka(jenis) {
  const files = await pilihBerkas(jenis === "preset" ? "#fPreset" : "#fWm");
  if (!files.length) return null;
  let putih = false;
  if (jenis === "watermark" && files.some(f => !/png$/i.test(f.name))) putih = confirm("Logo bukan PNG. Buang latar putihnya biar transparan?");
  let terakhir = null; const gagal = [];
  for (const f of files) {
    toast(`Menambahkan ${f.name}…`);
    try {
      const stem = f.name.replace(/\.[^.]+$/, ""), id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (jenis === "preset") {
        if (/\.cube$/i.test(f.name)) { const t = await f.text(); LR.bacaCube(t); await DB.simpan({ id, jenis, nama: stem, ext: "cube", data: t, t: Date.now() }); }
        else {   // .xmp / DNG preset / foto JPG hasil export Lightroom (pengaturan slider-nya diambil)
          let t; try { t = LR.xmpDari(await f.arrayBuffer()); LR.baca(t); }
          catch (e) { throw new Error(/\.jpe?g$/i.test(f.name) ? "foto ini tidak membawa pengaturan Lightroom (export dengan Metadata: All)" : e.message); }
          await DB.simpan({ id, jenis, nama: stem + (/\.jpe?g$/i.test(f.name) ? " (dari foto Lightroom)" : ""), ext: "xmp", data: t, t: Date.now() });
        }
      } else {
        const img = await Mesin.bukaGambar(f);
        let w = img.naturalWidth, h = img.naturalHeight; const s = Math.min(1, 6000 / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
        const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h);
        if (putih) { const d = x.getImageData(0, 0, w, h), p = d.data;
          for (let i = 0; i < p.length; i += 4) { const t = Math.min(p[i], p[i + 1], p[i + 2]); p[i + 3] = Math.min(p[i + 3], Math.max(0, Math.min(255, (255 - t) / 40 * 255))); }
          x.putImageData(d, 0, 0); }
        const blob = await new Promise(ok => c.toBlob(ok, "image/png"));
        await DB.simpan({ id, jenis, nama: stem, ext: "png", data: blob, t: Date.now() });
      }
      terakhir = id;
    } catch (e) { gagal.push(`${f.name}: ${e.message}`); }
  }
  await muatPustaka();
  toast(gagal.length ? "" : `${files.length - gagal.length} ${jenis} ditambahkan ✓`);
  if (gagal.length) alert("Sebagian gagal:\n" + gagal.join("\n"));
  return terakhir;
}
async function hapusPustaka(id, nama) {
  if (!confirm(`Hapus "${nama}" dari aplikasi?\nFile asli kamu tidak ikut terhapus.`)) return;
  await DB.hapus(id); CACHE.delete(id); await muatPustaka();
  if (ATUR.lut.file === id) ATUR.lut.file = "";
  if (ATUR.wm.logo === id) ATUR.wm.logo = "";
  if (ATUR.wm.logo_portrait === id) ATUR.wm.logo_portrait = "";
  simpanAtur(); MODE === "pustaka" ? gambarPustaka() : (gambarAtur(), pratinjau());
}
function kartuPk(x, { pilih = null, aktif = false, hapus = true } = {}) {
  const lab = x.jenis === "preset" ? (x.ext === "cube" ? "LUT" : "Lightroom") : "PNG";
  return `<div class="pk ${aktif ? "on" : ""}" ${pilih ? `onclick="${pilih}"` : ""}><div class="k"><span class="lab ${lab}">${lab}</span>
    <b>${esc(x.nama)}<small>.${x.ext}</small></b>${hapus ? `<button class="hapus" title="Hapus" onclick="event.stopPropagation();hapusPustaka('${x.id}','${esc(x.nama).replace(/'/g, "")}')">🗑</button>` : ""}</div></div>`;
}

/* ---------------- folder / foto ---------------- */
const GRUP = [];
let idGrup = 1;
function tambahKeGrup(nama, daftar) {
  const kunci = new Set(), file = [];
  let lewat = 0;
  for (const { f, rel } of daftar) {
    if (!FOTO.test(f.name) && !VIDEO.test(f.name)) { lewat++; continue; }
    const k = rel + "/" + f.name + ":" + f.size;
    if (kunci.has(k)) continue;
    kunci.add(k); file.push({ f, rel });
  }
  if (!file.length) { alert("Tidak ada foto/video yang didukung (JPG, PNG, HEIC, WEBP, MP4, MOV)."); return; }
  GRUP.push({ id: idGrup++, nama, file, pilih: true, status: "siap", ok: 0, gagal: 0, total: file.length, galat: "", link: {}, gagalTugas: [] });
  toast(`${file.length} file masuk ke "${nama}"` + (lewat ? ` · ${lewat} file lain dilewati` : ""));
  gambarFolder(); gambarTombol(); pratinjau();
}
const namaBawaan = () => "Foto " + new Date().toLocaleDateString("id-ID");
async function tambahFoto() {
  const files = await pilihBerkas("#fFoto");
  if (!files.length) return;
  tambahKeGrup(namaBawaan(), files.map(f => ({ f, rel: "" })));        // nama bisa diganti langsung di daftar
}
// seret folder/foto dari Finder/Explorer ke kotak Foto
async function isiFolder(dir, jalur = []) {
  const r = dir.createReader(), semua = [];
  for (;;) { const b = await new Promise((ok, no) => r.readEntries(ok, no)); if (!b.length) break; semua.push(...b); }
  const hasil = [];
  for (const e of semua) {
    if (/^[._]/.test(e.name)) continue;                                  // lewati file/folder tersembunyi & diawali "_"
    if (e.isDirectory) hasil.push(...await isiFolder(e, [...jalur, e.name]));
    else hasil.push({ f: await new Promise((ok, no) => e.file(ok, no)), rel: jalur.join("/") });
  }
  return hasil;
}
async function terimaSeret(ev) {
  ev.preventDefault(); $("#kolFoto")?.classList.remove("seret");
  const entri = [...(ev.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entri.length) { const fs = [...(ev.dataTransfer.files || [])]; if (fs.length) tambahKeGrup(namaBawaan(), fs.map(f => ({ f, rel: "" }))); return; }
  const lepas = [];
  for (const e of entri) {
    if (e.isDirectory) tambahKeGrup(e.name, await isiFolder(e));
    else lepas.push({ f: await new Promise((ok, no) => e.file(ok, no)), rel: "" });
  }
  if (lepas.length) tambahKeGrup(namaBawaan(), lepas);
}
async function tambahFolder() {
  const files = await pilihBerkas("#fFolder");
  if (!files.length) return;
  const per = new Map();
  for (const f of files) {
    const bag = (f.webkitRelativePath || f.name).split("/");
    if (bag.some(b => b.startsWith(".") || b.startsWith("_"))) continue;   // lewati file/folder tersembunyi & diawali "_"
    const atas = bag.length > 1 ? bag[0] : "Folder";
    if (!per.has(atas)) per.set(atas, []);
    per.get(atas).push({ f, rel: bag.slice(1, -1).join("/") });
  }
  for (const [nama, d] of per) tambahKeGrup(nama, d);
}
function buangGrup(id) {
  const i = GRUP.findIndex(g => g.id === id);
  if (i >= 0 && GRUP[i].status !== "jalan") { GRUP.splice(i, 1); gambarFolder(); gambarTombol(); gambarProses(); pratinjau(); }
}
const terpilih = () => GRUP.filter(g => g.pilih && g.status === "siap");

/* ---------------- notifikasi ---------------- */
let BELUM = 0; const RIWAYAT = [];
function kabari(jenis, judul, isi) {
  RIWAYAT.unshift({ jenis, judul, isi, t: Date.now() }); RIWAYAT.length = Math.min(RIWAYAT.length, 40); BELUM++;
  const el = document.createElement("div"); el.className = "kb " + jenis; el.innerHTML = `<b>${esc(judul)}</b>${esc(isi)}`;
  el.onclick = () => el.remove(); $("#kabarStack").prepend(el);
  setTimeout(() => el.remove(), jenis === "masalah" ? 20000 : 8000);
  if (navigator.vibrate) try { navigator.vibrate(jenis === "masalah" ? [200, 100, 200] : 120); } catch (e) {}
  if ("Notification" in window && Notification.permission === "granted" && document.hidden)
    try { navigator.serviceWorker?.ready.then(r => r.showNotification(judul, { body: isi, icon: "ikon-192.png" })).catch(() => new Notification(judul, { body: isi })); } catch (e) {}
  if (document.hidden) document.title = `(${BELUM}) Kirim Foto`;
  gambarLonceng();
}
function gambarLonceng() {
  const i = $("#jmlKabar"); i.hidden = !BELUM; i.textContent = BELUM;
  $("#panelKabar").innerHTML = RIWAYAT.length ? RIWAYAT.map(k => `<div class="it"><b>${esc(k.judul)}</b><br>${esc(k.isi)}<br><small>${new Date(k.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("")
    : `<div class="it" style="color:var(--mute)">Belum ada notifikasi.</div>`;
}
function bukaLonceng() { $("#panelKabar").classList.toggle("buka"); BELUM = 0; gambarLonceng(); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) { document.title = "Kirim Foto"; if (JALAN) kunciLayar(); } });
let _tt = null;
function toast(t) { const el = $("#toast"); el.textContent = t; el.style.opacity = t ? 1 : 0; clearTimeout(_tt); if (t) _tt = setTimeout(() => el.style.opacity = 0, 3500); }

/* ---------------- akun Google ---------------- */
async function gambarAkun() {
  const el = $("#akun");
  if (!KIRIM_CONFIG.clientId) { el.innerHTML = `<span>Google belum disiapkan</span>`; return; }
  if (!Google.aktif()) { const e = Google.ingatAkun();
    el.innerHTML = `<span>${e ? esc(e) : "Google"}</span><button onclick="masukGoogle(${e ? "false" : "true"})">${e ? "Sambung" : "Masuk"}</button>`; return; }
  let a = null; try { a = await Google.infoAkun(); } catch (e) {}
  el.innerHTML = `<span title="${esc(a?.email || "")}">${esc(a?.email || "Terhubung")}</span>${Google.bisaPhotos() ? "<span title='Google Photos diizinkan'>🖼✓</span>" : ""}
    <button class="polos kecil" onclick="Google.keluar();gambarAkun();gambarTombol()">Keluar</button>`;
}
async function masukGoogle(pilih = true) {
  if ((Google.STANDALONE || Google.LAYANAN) && GRUP.some(g => g.status === "siap" || g.status === "jalan") &&
      !confirm("Login Google akan memuat ulang halaman, foto yang sudah dipilih perlu dipilih lagi. Lanjut?")) return;
  try { await Google.masuk(pilih); toast("Terhubung ke Google ✓"); } catch (e) { alert(e.message); }
  gambarAkun(); gambarTombol(); if (TUNGGU_IZIN) lanjutSetelahIzin();
}

/* ---------------- halaman ---------------- */
let MODE = "ekspor";
function halaman(m) {
  MODE = m; ["Ekspor", "Pustaka", "Bantuan"].forEach(x => $("#nav" + x).classList.toggle("on", x.toLowerCase() === m));
  if (m === "ekspor") gambarEkspor(); else if (m === "pustaka") gambarPustaka(); else gambarBantuan();
  window.scrollTo(0, 0);
}
function gambarEkspor() {
  $("#utama").innerHTML = `
  <div class="tata2">
    <div id="kolFoto" ondragover="event.preventDefault();this.classList.add('seret')" ondragleave="if(!this.contains(event.relatedTarget))this.classList.remove('seret')" ondrop="terimaSeret(event)">
      <div class="judul">Foto <small id="exJml"></small></div><div id="exFolder"></div></div>
    <div id="kolP"><div class="pratinjau" id="prev"><div class="kosong">Pratinjau muncul setelah ada foto.</div></div></div>
    <div id="exProfil"></div>
    <div id="aturBlok"></div>
    <div id="exTujuan"></div>
  </div>
  <div class="bar" id="exBar"></div>`;
  gambarFolder(); gambarAtur(); gambarTombol(); PREV_KUNCI = null; pratinjau();
}
const thumbs = g => `<div class="exthumbs">${g.file.filter(x => FOTO.test(x.f.name)).slice(0, 3).map(x => Mesin.adalahHeic(x.f) ? "<span>🖼</span>" : `<img src="${urlKecil(x.f)}" alt="" loading="lazy">`).join("")}</div>`;
function gambarFolder() {
  if (MODE !== "ekspor" || !$("#exFolder")) return;
  const el = $("#exFolder"), fokus = document.activeElement;
  if (el.contains(fokus) && fokus.type === "text") { jadwalProses(); return; }   // jangan ganggu yang sedang mengetik nama
  const siap = GRUP.filter(g => g.status === "siap"), p = terpilih();
  const izin = TUNGGU_IZIN ? `<div class="pesan warn" style="margin-top:0">Sesi Google habis, export dijeda. <button class="kecil utama" onclick="masukGoogle(false)">Sambung Google lagi</button></div>` : "";
  const baris = GRUP.map(g => {
    if (g.status === "siap") {
      const nV = g.file.filter(x => VIDEO.test(x.f.name)).length, nSub = new Set(g.file.map(x => x.rel).filter(Boolean)).size;
      return `<div class="exrow ${g.pilih ? "" : "mati2"}">
        <input type="checkbox" ${g.pilih ? "checked" : ""} onchange="GRUP.find(x=>x.id===${g.id}).pilih=this.checked;gambarFolder();gambarTombol();pratinjau()">
        ${thumbs(g)}
        <div class="exinfo"><input type="text" value="${esc(g.nama)}" onchange="GRUP.find(x=>x.id===${g.id}).nama=this.value.trim()||'Foto';gambarAtur();gambarTombol()" title="Nama folder/album tujuan — ketuk untuk ganti">
          <div class="s">${g.file.length - nV} foto${nV ? ` · ${nV} video` : ""}${nSub ? ` · ${nSub} subfolder` : ""}${namaFolderTujuan(g.nama, p.indexOf(g) + 1 || 1) !== g.nama ? ` · <span class="jadi">→ ${esc(namaFolderTujuan(g.nama, p.indexOf(g) + 1 || 1))}</span>` : ""}</div></div>
        <button class="hapus" title="Keluarkan dari daftar" onclick="buangGrup(${g.id})">✕</button></div>`;
    }
    const pct = g.total ? (g.ok + g.gagal) / g.total * 100 : 0;
    const chip = g.status === "jalan" ? (g.ulang ? `<span class="chip ulang">Masalah, diulang</span>` : `<span class="chip jalan">Memproses</span>`)
      : g.gagal ? `<span class="chip gagal">Selesai, ${g.gagal} gagal</span>` : `<span class="chip ok">Selesai ✓</span>`;
    return `<div class="exrow proses">${thumbs(g)}
      <div class="exinfo"><div class="atas"><b>${esc(namaTj(g))}</b>${chip}<span class="s">${g.ok}/${g.total}</span></div>
        <div class="kemajuan"><b style="width:${pct}%;${g.gagal || g.ulang ? "background:var(--warn)" : ""}"></b></div>
        ${g.galat && (g.gagal || g.ulang) ? `<div style="font-size:12px;color:var(--bad);margin-top:4px">${esc(g.galat)}</div>` : ""}
        <div class="tb">
          ${g.link.drive ? `<a class="kecil" href="https://drive.google.com/drive/folders/${g.link.drive}" target="_blank" rel="noopener">📁 Buka Drive</a>
            <button class="kecil" onclick="bagikan(${g.id})">🔗 ${g.link.share ? "Salin link lagi" : "Bagikan link"}</button>` : ""}
          ${g.link.photos ? `<a class="kecil" href="${esc(g.link.photos)}" target="_blank" rel="noopener">🖼 Buka album</a>` : ""}
          ${g.link.zip ? `<a class="kecil" href="${g.link.zip}" download="${esc(namaTj(g))}.zip">⬇ Unduh ZIP lagi</a>` : ""}
          ${g.status === "selesai" && g.gagalTugas.length ? `<button class="kecil" onclick="ulangGagal(${g.id})">Ulangi yang gagal</button>` : ""}</div></div>
      ${g.status === "selesai" ? `<button class="hapus" title="Hapus dari daftar" onclick="buangGrup(${g.id})">✕</button>` : ""}</div>`;
  }).join("");
  const tombol = `<button class="${GRUP.length ? "kecil" : "utama"}" onclick="event.stopPropagation();tambahFoto()">＋ ${GRUP.length ? "Foto" : "Pilih foto"}</button>${MOBILE ? "" : `<button class="${GRUP.length ? "kecil" : ""}" onclick="event.stopPropagation();tambahFolder()">📁 ${GRUP.length ? "Folder" : "Pilih folder"}</button>`}`;
  el.innerHTML = izin + (GRUP.length ? baris + `<div class="zona kecil-z">${MOBILE ? "Tambah lagi:" : "Seret ke sini atau"} ${tombol}</div>`
    : `<div class="zona besar-z" onclick="tambahFoto()"><div class="zi">⇪</div>
        <b>${MOBILE ? "Pilih foto yang mau dikirim" : "Seret folder atau foto ke sini"}</b>
        <span>${MOBILE ? "dari galeri atau Files" : "tiap folder jadi satu folder tujuan · JPG, PNG, HEIC, WEBP, MP4, MOV"}</span>
        <div class="dua" style="justify-content:center;margin-top:14px;flex-wrap:wrap">${tombol}</div></div>`);
  $("#exJml").textContent = siap.length ? `${p.length} dari ${siap.length} folder siap dikirim` : "";
}
const _url = new WeakMap();
function urlKecil(f) { if (!_url.has(f)) _url.set(f, URL.createObjectURL(f)); return _url.get(f); }

/* ---------------- blok pengaturan ---------------- */
const POS = ["kiri-atas", "tengah-atas", "kanan-atas", "kiri-tengah", "tengah", "kanan-tengah", "kiri-bawah", "tengah-bawah", "kanan-bawah"];
const NPOS = { "kiri-atas": "↖ Kiri atas", "tengah-atas": "↑ Atas", "kanan-atas": "↗ Kanan atas", "kiri-tengah": "← Kiri", "tengah": "● Tengah", "kanan-tengah": "→ Kanan", "kiri-bawah": "↙ Kiri bawah", "tengah-bawah": "↓ Bawah", "kanan-bawah": "↘ Kanan bawah" };
const pilihan = (jalur, nilai, opsi) => `<div class="pilihan baris">${opsi.map(([k, t]) => `<button class="${nilai === k ? "on" : ""}" onclick="set('${jalur}','${k}')">${t}</button>`).join("")}</div>`;
const geser = (jalur, nilai, min, max, step = 1, lebarAngka = 76) => `<div class="dua"><input type="range" min="${min}" max="${max}" step="${step}" value="${nilai}" onchange="set('${jalur}',+this.value)">
  <input type="number" min="${min}" max="${max}" step="${step}" value="${nilai}" style="width:${lebarAngka}px" onchange="set('${jalur}',+this.value)"></div>`;
function contohNama(x) {
  const n = ATUR.nama, g = terpilih()[0] || { nama: "Nama Folder", total: 240 }, y = g.file ? g.file.length : 240;
  const pad = v => String(v).padStart(String(y).length, "0");
  let s = n.mode === "baru" ? ((n.teks || "").trim().split("{folder}").join(g.nama) || g.nama) : "IMG_0012";
  if (n.urutan) s += { "(x of y)": ` (${x} of ${y})`, "(00x of y)": ` (${pad(x)} of ${y})`, "- x of y": ` - ${x} of ${y}`, "_x": `_${pad(x)}` }[n.format];
  else if (n.mode === "baru") s += " " + x;
  return { s, y };
}
let BUKA = "";                                    // bagian "Atur hasil" yang sedang terbuka (satu saja)
function bukaBagian(k) { BUKA = BUKA === k ? "" : k; gambarAtur(); }
const namaPk = (jenis, id) => (P[jenis].find(x => x.id === id) || {}).nama;
const BAGIAN = [["ukuran", "📐", "Ukuran"], ["kualitas", "🗜", "Kualitas"], ["nama", "🏷", "Nama file"], ["wm", "💧", "Watermark logo"], ["label", "🔤", "Teks di foto"], ["lut", "🎨", "Preset warna"], ["edit", "🎛", "Edit ala Lightroom"]];
function ringkasAtur() {
  const a = ATUR, w = a.wm, lb = a.label;
  const posWm = w.posisi === "penuh" ? "pas ukuran foto" : w.posisi === "ulang" ? "berulang miring" : (NPOS[w.posisi] || "").replace(/^\S+ /, "").toLowerCase();
  return {
    ukuran: { asli: "Asli", sisi: `Sisi terpanjang ${a.sisi} px${a.perbesar ? " · perbesar" : ""}`, piksel: `${a.piksel_w}×${a.piksel_h} px`, persen: `${a.persen}%` }[a.ukuran],
    kualitas: { mutu: `JPEG ${a.jpeg}`, mb: `Maks ${a.mb} MB per foto`, asli: "Tanpa kompres ulang" }[a.kompres],
    nama: contohNama(1).s + ".jpg",
    wm: w.aktif ? `${namaPk("watermark", w.logo) || (w.teks ? "“" + w.teks + "”" : "Teks")} · ${posWm}` : "Mati",
    label: lb.aktif ? ((lb.teks || "").split("\n")[0] || "(kosong)") : "Mati",
    lut: a.lut.file ? `${namaPk("preset", a.lut.file) || "Preset"} · ${a.lut.kekuatan}%` : "Tanpa preset",
    edit: (() => { const n = Object.keys((a.edit || {}).ubah || {}).length; return n ? `${n} slider diubah` : (lrPreset() ? "Sesuai preset" : "Belum diedit"); })(),
  };
}
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function namaFolderTujuan(nama, no = 1, a = ATUR) {
  const d = new Date(), dd = String(d.getDate()).padStart(2, "0"), mm = String(d.getMonth() + 1).padStart(2, "0");
  const s = (a.nama_folder || "{folder}").replace(/\{(\w+)\}/g, (m, k) => ({ folder: nama, tanggal: `${dd}-${mm}-${d.getFullYear()}`,
    bulan: BULAN[d.getMonth()], tahun: String(d.getFullYear()), no: String(no) })[k] ?? m);
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || nama;
}
const namaTj = g => g.namaTujuan || g.nama;
function sisipFolder(k) {
  const el = $("#namaFolder"), t = el ? el.value : (ATUR.nama_folder || ""), a = el ? el.selectionStart : t.length, b = el ? el.selectionEnd : t.length;
  set("nama_folder", t.slice(0, a) + "{" + k + "}" + t.slice(b));
}
function gambarAtur() {
  if (MODE !== "ekspor" || !$("#aturBlok")) return;
  const a = ATUR, w = a.wm, lb = a.label, n = a.nama, r = ringkasAtur();
  const contohLb = () => (lb.teks || "").replace(/\{(\w+)\}/g, (m, k) => ({ nama_baru: contohNama(12).s, nama_file: "IMG_0012", no: "12", total: String(contohNama(12).y),
    folder: (terpilih()[0] || {}).nama || "Nama Folder", subfolder: "Sesi 1", tanggal: "19/10/2026", jam: "07:42" })[k] ?? m);
  const isi = {
    ukuran: () => `
      ${pilihan("ukuran", a.ukuran, [["asli", "Asli"], ["sisi", "Sisi px"], ["piksel", "Lebar×tinggi"], ["persen", "Persen %"]])}
      ${a.ukuran === "asli" ? `<div class="ket">Resolusi tidak diubah.</div>` : ""}
      ${a.ukuran === "sisi" ? `<div class="baris"><span>Sisi terpanjang jadi <b>${a.sisi}px</b></span>${geser("sisi", a.sisi, 600, 8000, 100, 92)}</div>
        <div class="cek"><label><input type="checkbox" ${a.perbesar ? "checked" : ""} onchange="set('perbesar',this.checked)"> perbesar juga foto yang lebih kecil</label></div>` : ""}
      ${a.ukuran === "piksel" ? `<div class="baris"><span>Ukuran hasil (pixel)</span><div class="dua">
          <input type="number" min="16" max="12000" value="${a.piksel_w}" style="width:100px" onchange="set('piksel_w',+this.value)"> ×
          <input type="number" min="16" max="12000" value="${a.piksel_h}" style="width:100px" onchange="set('piksel_h',+this.value)"> px</div>
          <div class="dua" style="flex-wrap:wrap;margin-top:6px">${[[1080, 1350, "IG 4:5"], [1080, 1080, "IG 1:1"], [1920, 1080, "Full HD"], [3840, 2160, "4K"], [2048, 2048, "2048²"], [3000, 2000, "3000×2000"]].map(([ww, hh, t]) =>
            `<button class="kecil ${a.piksel_w == ww && a.piksel_h == hh ? "on" : ""}" onclick="ATUR.piksel_w=${ww};set('piksel_h',${hh})">${t}</button>`).join("")}</div></div>
        <div class="baris"><span>Kalau perbandingan foto beda</span>${pilihan("piksel_isi", a.piksel_isi, [["pas", "Pas di dalam"], ["penuhi", "Penuhi & potong"], ["regang", "Regang"]])}</div>
        <div class="cek" style="flex-direction:column;gap:4px"><label><input type="checkbox" ${a.piksel_putar ? "checked" : ""} onchange="set('piksel_putar',this.checked)"> ikuti orientasi foto (portrait ↔ landscape)</label>
          ${a.piksel_isi === "pas" ? `<label><input type="checkbox" ${a.perbesar ? "checked" : ""} onchange="set('perbesar',this.checked)"> perbesar juga foto yang lebih kecil</label>` : ""}</div>` : ""}
      ${a.ukuran === "persen" ? `<div class="baris"><span>Skala <b>${a.persen}%</b> ${a.persen > 100 ? "(naikkan resolusi)" : a.persen < 100 ? "(turunkan resolusi)" : ""}</span>${geser("persen", a.persen, 10, 400, 5)}</div>
        <div class="dua" style="flex-wrap:wrap">${[25, 50, 75, 100, 150, 200].map(v => `<button class="kecil ${a.persen == v ? "on" : ""}" onclick="set('persen',${v})">${v}%</button>`).join("")}</div>` : ""}
      ${Mesin.IOS ? `<div class="ket" style="margin-top:8px">Di iPhone/iPad hasil maksimal ±16 MP per foto (batas Safari).</div>` : ""}`,
    kualitas: () => `
      ${pilihan("kompres", a.kompres, [["mutu", "Mutu JPEG"], ["mb", "Target MB"], ["asli", "Tanpa kompres ulang"]])}
      ${a.kompres === "mutu" ? `<div class="baris"><span>Mutu JPEG: <b>${a.jpeg}</b></span>${geser("jpeg", a.jpeg, 40, 100, 1, 70)}</div>` : ""}
      ${a.kompres === "mb" ? `<div class="baris"><span>Maksimal <b>${a.mb} MB</b> per foto</span>${geser("mb", a.mb, 0.1, 20, 0.1, 80)}</div>
        <div class="ket">Mutu dicari otomatis; kalau masih kebesaran, resolusi ikut turun. Foto yang sudah lebih kecil dikirim apa adanya.</div>` : ""}
      ${a.kompres === "asli" ? `<div class="ket">Kalau ukuran Asli & tanpa watermark/preset/teks, file dikirim persis aslinya.</div>` : ""}
      <div id="infoUkuran" style="font-size:12px;margin-top:8px;color:var(--teal2);font-weight:600"></div>`,
    nama: () => `
      ${pilihan("nama.mode", n.mode, [["asli", "Pakai nama asli"], ["baru", "Ganti nama baru"]])}
      ${n.mode === "baru" ? `<label class="baris"><span>Nama baru (kosong = nama folder; <code>{folder}</code> = nama folder)</span>
        <input type="text" value="${esc(n.teks)}" placeholder="${esc((terpilih()[0] || {}).nama || "Nama Folder")}" onchange="set('nama.teks',this.value)"></label>` : ""}
      <div class="cek baris"><label><input type="checkbox" ${n.urutan ? "checked" : ""} onchange="set('nama.urutan',this.checked)"> Tambahkan urutan <b>x of y</b></label></div>
      ${n.urutan ? `<div class="dua baris" style="flex-wrap:wrap">${["(x of y)", "(00x of y)", "- x of y", "_x"].map(k => `<button class="kecil ${n.format === k ? "on" : ""}" onclick="set('nama.format','${k}')">${k.replace("00x", "001").replace("x of y", "1 of y").replace("_x", "_001")}</button>`).join("")}</div>` : ""}
      <div class="ket">Contoh: <b style="color:var(--teal2)">${esc(contohNama(1).s)}.jpg</b>, ${esc(contohNama(2).s)}.jpg …</div>`,
    wm: () => `<div class="${w.aktif ? "" : "mati"}">
      <div class="baris"><span>Logo (dari pustaka)</span><div class="pk-grid">
        <div class="pk kosong2 ${!w.logo ? "on" : ""}" onclick="set('wm.logo','')"><div class="k"><b>Tanpa logo (teks saja)</b></div></div>
        ${P.watermark.map(x => kartuPk(x, { pilih: `set('wm.logo','${x.id}')`, aktif: w.logo === x.id, hapus: false })).join("")}
        <div class="pk tambah" onclick="tambahPustaka('watermark').then(id=>{ if(id){ATUR.wm.logo=id;ATUR.wm.aktif=true} set('wm.aktif',ATUR.wm.aktif) })">＋ Tambah logo</div></div></div>
      <label class="baris"><span>Teks di bawah logo (opsional)</span><input type="text" value="${esc(w.teks)}" placeholder="mis. @akunkamu" onchange="set('wm.teks',this.value)"></label>
      <div class="baris"><span>Posisi</span><div class="posisi">${POS.map(p => `<button class="${w.posisi === p ? "on" : ""}" onclick="set('wm.posisi','${p}')">${NPOS[p]}</button>`).join("")}</div>
        <div class="posisi" style="grid-template-columns:1fr 1fr;margin-top:5px"><button class="${w.posisi === "ulang" ? "on" : ""}" onclick="set('wm.posisi','ulang')">▦ Berulang miring</button>
          <button class="${w.posisi === "penuh" ? "on" : ""}" onclick="set('wm.posisi','penuh')">⛶ Pas ukuran foto</button></div></div>
      ${w.posisi === "penuh" ? `<div class="baris"><span>Logo/bingkai dibentangkan seukuran foto</span>${pilihan("wm.isi", w.isi || "regang", [["regang", "Regang"], ["pas", "Pas tanpa gepeng"], ["penuhi", "Penuhi"]])}</div>
        <div class="baris"><span>Logo khusus foto portrait (opsional)</span><div class="pk-grid">
          <div class="pk kosong2 ${!w.logo_portrait ? "on" : ""}" onclick="set('wm.logo_portrait','')"><div class="k"><b>Sama dengan logo di atas</b></div></div>
          ${P.watermark.map(x => kartuPk(x, { pilih: `set('wm.logo_portrait','${x.id}')`, aktif: w.logo_portrait === x.id, hapus: false })).join("")}</div></div>` : ""}
      ${w.posisi !== "penuh" ? `<div class="baris"><span>Ukuran: <b>${w.ukuran}%</b> lebar foto</span><input type="range" min="5" max="60" value="${w.ukuran}" onchange="set('wm.ukuran',+this.value)"></div>` : ""}
      <div class="baris"><span>Kepekatan: <b>${w.opasitas}%</b></span><input type="range" min="10" max="100" value="${w.opasitas}" onchange="set('wm.opasitas',+this.value)"></div>
      <div class="cek"><label><input type="checkbox" ${w.nama_file ? "checked" : ""} onchange="set('wm.nama_file',this.checked)"> nama file</label>
        <label><input type="checkbox" ${w.jam ? "checked" : ""} onchange="set('wm.jam',this.checked)"> jam jepret</label></div></div>`,
    label: () => `<div class="${lb.aktif ? "" : "mati"}">
      <label class="baris"><span>Tulis teks (boleh beberapa baris). Ketuk kode untuk menyisipkan isian otomatis.</span>
        <textarea id="teksLabel" rows="2" onchange="set('label.teks',this.value)">${esc(lb.teks)}</textarea></label>
      <div class="dua baris" style="flex-wrap:wrap;gap:5px">${["nama_baru", "nama_file", "no", "total", "folder", "subfolder", "tanggal", "jam"].map(k => `<button class="kecil" onmousedown="event.preventDefault()" onclick="sisipKode('${k}')">{${k}}</button>`).join("")}</div>
      <div class="ket" style="margin:-4px 0 10px">Contoh: <b style="color:var(--teal2);white-space:pre-line">${esc(contohLb()) || "—"}</b></div>
      <div class="baris"><span>Posisi</span><div class="posisi">${POS.map(p => `<button class="${lb.posisi === p ? "on" : ""}" onclick="set('label.posisi','${p}')">${NPOS[p].split(" ")[0]}</button>`).join("")}</div></div>
      <div class="baris"><span>Ukuran huruf: <b>${lb.ukuran}%</b></span><input type="range" min="1" max="12" step="0.5" value="${lb.ukuran}" onchange="set('label.ukuran',+this.value)"></div>
      <div class="baris"><span>Warna</span><div class="dua" style="flex-wrap:wrap">${[["#ffffff", "Putih"], ["#111111", "Hitam"], ["#facc15", "Kuning"], ["#14b8a6", "Tosca"]].map(([c, t]) =>
        `<button class="kecil ${lb.warna === c ? "on" : ""}" onclick="set('label.warna','${c}')"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};border:1px solid #9994;margin-right:4px"></span>${t}</button>`).join("")}
        <input type="color" value="${lb.warna}" onchange="set('label.warna',this.value)" style="width:38px;height:30px;border:1px solid var(--line);border-radius:6px;padding:1px"></div></div>
      <div class="baris"><span>Latar teks</span>${pilihan("label.latar", lb.latar, [["tanpa", "Tanpa"], ["bayangan", "Bayangan"], ["kotak", "Kotak"]])}</div>
      <div class="baris"><span>Kepekatan: <b>${lb.opasitas}%</b></span><input type="range" min="10" max="100" value="${lb.opasitas}" onchange="set('label.opasitas',+this.value)"></div>
      <div class="cek"><label><input type="checkbox" ${lb.tebal ? "checked" : ""} onchange="set('label.tebal',this.checked)"> huruf tebal</label></div></div>`,
    lut: () => `
      <div class="baris"><div class="pk-grid">
        <div class="pk kosong2 ${!a.lut.file ? "on" : ""}" onclick="set('lut.file','')"><div class="k"><b>Tanpa preset</b></div></div>
        ${P.preset.map(x => kartuPk(x, { pilih: `set('lut.file','${x.id}')`, aktif: a.lut.file === x.id, hapus: false })).join("")}
        <div class="pk tambah" onclick="tambahPustaka('preset').then(id=>{ if(id) ATUR.lut.file=id; set('lut.kekuatan',ATUR.lut.kekuatan) })">＋ Tambah preset (.cube / .xmp / DNG / foto JPG Lightroom)</div></div></div>
      <div class="baris ${a.lut.file ? "" : "mati"}" style="margin-bottom:0"><span>Kekuatan: <b>${a.lut.kekuatan}%</b></span><input type="range" min="0" max="100" value="${a.lut.kekuatan}" onchange="set('lut.kekuatan',+this.value)"></div>
      <div class="ket" style="margin-top:8px">Preset Lightroom (.xmp / DNG / foto JPG hasil Lightroom) diolah lengkap & bisa diatur lagi di <b>🎛 Edit ala Lightroom</b>.</div>`,
    edit: blokEdit,
  };
  const saklar = (k, on) => `<label class="saklar" onclick="event.stopPropagation()" title="Nyalakan / matikan"><input type="checkbox" ${on ? "checked" : ""} onchange="if(this.checked)BUKA='${k}';set('${k}.aktif',this.checked)"></label>`;
  $("#aturBlok").innerHTML = `<div class="judul">Atur hasil <small>berlaku untuk semua folder</small></div>
    <div class="akor">${BAGIAN.map(([k, ik, t]) => {
      const buka = BUKA === k, mati = (k === "wm" && !w.aktif) || (k === "label" && !lb.aktif);
      return `<div class="bag ${buka ? "buka" : ""}">
        <div class="kepala-bag" role="button" tabindex="0" aria-expanded="${buka}" onclick="bukaBagian('${k}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();bukaBagian('${k}')}">
          <span class="ik">${ik}</span><b>${t}</b><span class="rk ${mati ? "redup" : ""}">${esc(r[k])}</span>
          ${k === "wm" || k === "label" ? saklar(k, k === "wm" ? w.aktif : lb.aktif) : ""}<span class="pana">›</span></div>
        ${buka ? `<div class="isi-bag">${isi[k]()}</div>` : ""}</div>`;
    }).join("")}</div>`;
  gambarProfil();
}
/* ---------------- Edit ala Lightroom ---------------- */
const LRUI = { tab: "basic", hsl: "hue" }, LR_NILAI = new Map();
const LR_HUE = { Red: "#e5484d", Orange: "#f08c2c", Yellow: "#e9c81f", Green: "#3fa34d", Aqua: "#20b2b0", Blue: "#3b6fe0", Purple: "#8b5cf6", Magenta: "#d63ba8" };
const LR_GRAD = { IncrementalTemperature: "linear-gradient(90deg,#4d7bd6,#ddd,#e2b53a)", IncrementalTint: "linear-gradient(90deg,#3fae4f,#ddd,#c64fc0)" };
const LR_GRUP = { basic: [["wb", "White Balance"], ["nada", "Tone"], ["presence", "Presence"]], detail: [["tajam", "Sharpening"], ["noise", "Noise Reduction"], ["efek", "Efek"]] };
function lrPreset() {                                   // nilai preset .xmp terpilih (null kalau .cube / tanpa preset)
  const x = P.preset.find(i => i.id === ATUR.lut.file);
  if (!x || x.ext !== "xmp") return null;
  if (!LR_NILAI.has(x.id)) { try { LR_NILAI.set(x.id, LRO.dariTeks(x.data)); } catch (e) { LR_NILAI.set(x.id, null); } }
  return LR_NILAI.get(x.id);
}
const lrDasar = k => (lrPreset() || {})[k] ?? LRO.SLIDER[k].bawaan;
const lrNilai = k => { const u = (ATUR.edit || {}).ubah || {}; return k in u ? u[k] : lrDasar(k); };
function lrUbah() { ATUR.edit = ATUR.edit || { ubah: {} }; ATUR.edit.ubah = ATUR.edit.ubah || {}; return ATUR.edit.ubah; }
function lrSegar() { simpanAtur(); gambarAtur(); gambarTombol(); pratinjau(); }
function lrSet(k, v) { const u = lrUbah(); v = +v; if (Math.abs(v - lrDasar(k)) < 1e-9) delete u[k]; else u[k] = v; lrSegar(); }
function lrReset(k) { const u = lrUbah(); if (k) delete u[k]; else ATUR.edit.ubah = {}; lrSegar(); }
function lrBaris(k, label, titik) {
  const m = LRO.SLIDER[k], v = lrNilai(k), ubah = k in ((ATUR.edit || {}).ubah || {});
  const grad = LR_GRAD[k] || (titik ? `linear-gradient(90deg,#ddd,${titik})` : "");
  const tampil = m.langkah < 1 ? (+v).toFixed(m.langkah < 0.1 ? 2 : 1) : Math.round(v);
  return `<div class="lr-sl"><label class="${ubah ? "ubah" : ""}" title="Ketuk 2x = kembali ke nilai preset (${lrDasar(k)})" ondblclick="lrReset('${k}')">${titik ? `<span class="lr-titik" style="background:${titik}"></span>` : ""}${esc(label || m.label)}</label>
    <input type="range" ${grad ? `class="lr-warna" style="--lr-grad:${grad}"` : ""} min="${m.min}" max="${m.maks}" step="${m.langkah}" value="${v}"
      oninput="this.parentNode.querySelector('input[type=number]').value=this.value" onchange="lrSet('${k}',this.value)" ondblclick="lrReset('${k}')">
    <input type="number" inputmode="decimal" min="${m.min}" max="${m.maks}" step="${m.langkah}" value="${tampil}" onchange="lrSet('${k}',this.value)"></div>`;
}
function blokEdit() {
  const x = P.preset.find(i => i.id === ATUR.lut.file), xmp = !!lrPreset(), n = Object.keys(lrUbah()).length;
  const asal = xmp ? `preset <b>${esc(x.nama)}</b>` : x ? `LUT <b>${esc(x.nama)}</b> + slider dari nol` : "foto asli (nol)";
  let isiTab;
  if (LRUI.tab === "hsl") {
    const pre = { hue: "HueAdjustment", sat: "SaturationAdjustment", lum: "LuminanceAdjustment" }[LRUI.hsl];
    isiTab = `<div class="pilihan" style="margin:4px 0 8px">${[["hue", "Hue"], ["sat", "Saturation"], ["lum", "Luminance"]].map(([k, t]) =>
      `<button class="kecil ${LRUI.hsl === k ? "on" : ""}" onclick="LRUI.hsl='${k}';gambarAtur()">${t}</button>`).join("")}</div>` + LRO.WARNA8.map(w => lrBaris(pre + w, w, LR_HUE[w])).join("");
  } else {
    isiTab = LR_GRUP[LRUI.tab].map(([gr, t]) => `<div class="lr-grup">${t}</div>` + Object.keys(LRO.SLIDER).filter(k => LRO.SLIDER[k].grup === gr).map(k => lrBaris(k)).join("")).join("");
  }
  return `<div class="lr-kepala"><span>Mulai dari ${asal}${n ? ` · <b>${n} slider diubah</b>` : ""}</span>
      ${n ? `<button class="kecil" style="margin-left:auto" onclick="lrReset()">↺ Reset ke preset</button>` : ""}</div>
    <div class="pilihan">${[["basic", "Basic"], ["hsl", "HSL / Warna"], ["detail", "Detail"]].map(([k, t]) => `<button class="${LRUI.tab === k ? "on" : ""}" onclick="LRUI.tab='${k}';gambarAtur()">${t}</button>`).join("")}</div>
    ${isiTab}
    <div class="ket" style="margin-top:10px">Geser lalu lepas untuk melihat pratinjau. Ketuk 2x nama slider = kembali ke nilai preset.
      ${xmp ? "Preset Lightroom diolah lengkap: warna, kontras lokal (Texture/Clarity), shadows/highlights, sharpening & noise reduction." : ""}</div>`;
}
function sisipKode(k) {
  const ta = $("#teksLabel"), t = ATUR.label.teks || "", a = ta ? ta.selectionStart : t.length, b = ta ? ta.selectionEnd : t.length;
  set("label.teks", t.slice(0, a) + "{" + k + "}" + t.slice(b));
}

/* ---------------- profil export: semua pengaturan disimpan, dipakai lagi sekali ketuk ---------------- */
let PROFIL = []; try { PROFIL = JSON.parse(localStorage.getItem("kf_profil") || "[]"); } catch (e) {}
let PROFIL_AKTIF = localStorage.getItem("kf_profil_aktif") || "";
const simpanProfil = () => { try { localStorage.setItem("kf_profil", JSON.stringify(PROFIL)); localStorage.setItem("kf_profil_aktif", PROFIL_AKTIF); } catch (e) {} };
const samaAtur = (x, y) => JSON.stringify(gabung(BAWAAN, x)) === JSON.stringify(gabung(BAWAAN, y));
function gambarProfil() {
  if (MODE !== "ekspor" || !$("#exProfil")) return;
  const akt = PROFIL.find(x => x.id === PROFIL_AKTIF), ubah = akt && !samaAtur(akt.atur, ATUR);
  $("#exProfil").innerHTML = `<div class="judul">Profil <small>${PROFIL.length ? "ketuk untuk memakai semua pengaturannya" : "simpan pengaturan yang sering dipakai"}</small></div>
    <div class="profil">${PROFIL.map(x => `<button class="pchip ${x.id === PROFIL_AKTIF ? "on" : ""}" onclick="pakaiProfil('${x.id}')">${esc(x.nama)}${x.id === PROFIL_AKTIF && ubah ? " •" : ""}</button>`).join("")}
      ${ubah ? `<button class="pchip polos" onclick="perbaruiProfil()">Simpan perubahan</button>` : ""}
      <button class="pchip tambah" onclick="simpanSebagaiProfil()">＋ ${PROFIL.length ? "Profil baru" : "Simpan pengaturan ini sebagai profil"}</button>
      ${akt ? `<button class="pchip polos hapus-p" title="Hapus profil ${esc(akt.nama)}" onclick="hapusProfil('${akt.id}')">🗑</button>` : ""}</div>
    ${ubah ? `<div class="ket" style="margin-top:6px">“${esc(akt.nama)}” diubah. Simpan perubahan, atau ketuk profilnya untuk kembali.</div>` : ""}`;
}
function pakaiProfil(id) {
  const p = PROFIL.find(x => x.id === id); if (!p) return;
  ATUR = gabung(BAWAAN, p.atur); PROFIL_AKTIF = id; simpanAtur(); simpanProfil();
  gambarAtur(); gambarTombol(); gambarFolder(); pratinjau(); toast(`Profil “${p.nama}” dipakai`);
}
function simpanSebagaiProfil() {
  const n = prompt("Nama profil (mis. Klien Drive 2 MB, IG 1080):", ""); if (!n || !n.trim()) return;
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  PROFIL.push({ id, nama: n.trim(), atur: salin(ATUR) }); PROFIL_AKTIF = id; simpanProfil(); gambarProfil(); toast(`Profil “${n.trim()}” disimpan ✓`);
}
function perbaruiProfil() {
  const p = PROFIL.find(x => x.id === PROFIL_AKTIF); if (!p) return;
  p.atur = salin(ATUR); simpanProfil(); gambarProfil(); toast(`Profil “${p.nama}” diperbarui ✓`);
}
function hapusProfil(id) {
  const p = PROFIL.find(x => x.id === id); if (!p || !confirm(`Hapus profil “${p.nama}”? Pengaturan yang sedang dipakai tidak berubah.`)) return;
  PROFIL = PROFIL.filter(x => x.id !== id); if (PROFIL_AKTIF === id) PROFIL_AKTIF = ""; simpanProfil(); gambarProfil();
}

/* ---------------- tujuan + bar export ---------------- */
const NAMA_TJ = () => ({ drive: "Google Drive", photos: "Google Photos", lokal: Lokal.bisaFolder() ? "folder di komputer" : "unduhan ZIP" });
function gambarTombol() { gambarTujuan(); gambarBar(); gambarProfil(); }
function gambarTujuan() {
  if (MODE !== "ekspor" || !$("#exTujuan")) return;
  const tj = ATUR.tujuan, pakai = k => tj.includes(k), butuhG = pakai("drive") || pakai("photos");
  let peringatan = "";
  if (butuhG && !KIRIM_CONFIG.clientId) peringatan = `<div class="pesan bad">Login Google belum disiapkan di aplikasi ini.</div>`;
  else if (butuhG && !Google.aktif()) peringatan = `<div class="pesan warn">Masuk ke akun Google dulu. <button class="kecil" onclick="masukGoogle()">Masuk Google</button></div>`;
  else if (pakai("photos") && !Google.bisaPhotos()) peringatan = `<div class="pesan warn">Izin Google Photos belum diberikan. <button class="kecil" onclick="masukGoogle(true)">Izinkan</button> (centang semua izin)</div>`;
  $("#exTujuan").innerHTML = `<div class="judul">Tujuan <small>boleh lebih dari satu</small></div>
    <div class="blok" style="margin-bottom:0">
    <div class="pilihan">${[["drive", "📁 Google Drive"], ["photos", "🖼 Google Photos"], ["lokal", Lokal.bisaFolder() ? "📂 Folder di komputer" : "⬇ Unduh ke perangkat"]].map(([k, t]) =>
      `<button class="${pakai(k) ? "on" : ""}" style="flex:1 1 30%" onclick="pilihTujuan('${k}')">${pakai(k) ? "✓ " : ""}${t}</button>`).join("")}</div>
    <div class="nfolder"><span>Nama folder tujuan</span>
      <input type="text" id="namaFolder" value="${esc(ATUR.nama_folder || "{folder}")}" onchange="set('nama_folder',this.value.trim()||'{folder}')" placeholder="{folder}">
      <div class="dua" style="flex-wrap:wrap;gap:5px;margin-top:6px">${[["folder", "nama di daftar"], ["tanggal", "tgl export"], ["bulan", "nama bulan"], ["tahun", "tahun"], ["no", "urutan folder"]].map(([k, j]) =>
        `<button class="kecil" title="${j}" onmousedown="event.preventDefault()" onclick="sisipFolder('${k}')">{${k}}</button>`).join("")}
        ${(ATUR.nama_folder || "{folder}") !== "{folder}" ? `<button class="kecil" onclick="set('nama_folder','{folder}')">↺ Sama dengan daftar</button>` : ""}</div>
      <div class="ket" style="margin-top:6px">Contoh: <b style="color:var(--teal2)">${esc(namaFolderTujuan((terpilih()[0] || {}).nama || "Fun Run Sesi Pagi"))}</b>. Nama di daftar foto tetap bisa diganti satu per satu.</div></div>
    ${pakai("drive") ? blokFolderDrive() : ""}
    ${pakai("photos") ? `<div class="ket" style="margin-top:10px">Google Photos: satu album per folder, namanya sama dengan nama folder tujuan.</div>` : ""}
    ${pakai("lokal") ? `<div class="ket" style="margin-top:10px">${Lokal.bisaFolder() ? "Saat Export kamu memilih folder tujuan di komputer; subfolder ikut dibuat." : "Hasil tiap folder diunduh sebagai file ZIP (di iPhone masuk ke app Files). Untuk ratusan foto resolusi penuh, lebih aman pakai Google Drive."}</div>` : ""}
    ${peringatan}</div>`;
}
function gambarBar() {
  if (MODE !== "ekspor" || !$("#exBar")) return;
  const p = terpilih(), nf = p.reduce((s, g) => s + g.file.length, 0), jalan = GRUP.filter(g => g.status === "jalan");
  const f = ATUR.drive_folder, ke = ATUR.tujuan.map(k => k === "drive" && f ? `Drive › ${f.nama}` : NAMA_TJ()[k]).join(" + ");
  let atas, bawah;
  const ok = jalan.reduce((s, g) => s + g.ok + g.gagal, 0), tot = jalan.reduce((s, g) => s + g.total, 0);
  if (JALAN && p.length) { atas = `${p.length} folder · ${nf} file`; bawah = `→ ${ke} · ikut antre (sedang export ${ok}/${tot})`; }
  else if (JALAN) { atas = `Sedang export… ${ok}/${tot} file`; bawah = MOBILE ? "Biarkan layar menyala & aplikasi terbuka · boleh tambah folder lain" : "Boleh tambah folder lain, nanti ikut antre"; }
  else if (!GRUP.some(g => g.status === "siap")) { atas = "Belum ada foto"; bawah = `Tujuan: ${ke}`; }
  else { atas = `${p.length} folder · ${nf} file`; bawah = `→ ${ke}`; }
  $("#exBar").innerHTML = `<div class="rg"><b>${esc(atas)}</b><span>${esc(bawah)}</span></div>
    <button class="utama" onclick="mulaiEkspor()" ${!p.length ? "disabled" : ""}>${JALAN ? "➕ Export juga" : "📤 Export"}</button>`;
}
let UBAH_DF = false;
function blokFolderDrive() {
  const f = ATUR.drive_folder, g = terpilih()[0] || { nama: "Nama Folder" };
  const nf = namaFolderTujuan(g.nama), contoh = f ? (ATUR.drive_sub ? `${f.nama} › ${nf}` : f.nama) : `Kirim Foto › ${nf}`;
  return `<div class="dfolder">
    <div class="dua"><span style="flex:1;min-width:0">Masuk ke <b style="color:var(--teal2)">${esc(contoh)}</b>${f ? ` · <a href="https://drive.google.com/drive/folders/${f.id}" target="_blank" rel="noopener">buka</a>` : ""}</span>
      <button class="kecil" onclick="UBAH_DF=!UBAH_DF;gambarTujuan()">${UBAH_DF ? "Tutup" : "Ganti folder"}</button></div>
    ${UBAH_DF ? `<div style="margin-top:10px">
      <div class="pilihan" style="margin-bottom:8px">
        <button class="${!f ? "on" : ""}" onclick="ATUR.drive_folder=null;simpanAtur();gambarTombol()">Otomatis (Kirim Foto)</button>
        <button class="${f ? "on" : ""}" onclick="pilihFolderDrive()">📂 ${f ? esc(f.nama) : "Pilih folder…"}</button></div>
      <div class="dua"><input type="text" id="linkFolder" placeholder="atau tempel link folder Drive di sini" style="font-size:13px">
        <button class="kecil" onclick="pilihFolderDrive($('#linkFolder').value)">Pakai</button></div>
      ${f ? `<div class="cek" style="margin-top:8px"><label><input type="checkbox" ${ATUR.drive_sub ? "checked" : ""} onchange="ATUR.drive_sub=this.checked;simpanAtur();gambarTombol()"> buat subfolder per folder export</label></div>` : ""}</div>` : ""}
  </div>`;
}
async function pilihFolderDrive(link = "") {
  if (!Google.aktif() && !Google.punyaSesi()) return masukGoogle();
  try {
    const f = await Google.pilihFolder(link);
    if (f) { ATUR.drive_folder = f; UBAH_DF = false; simpanAtur(); toast(`Folder tujuan: ${f.nama} ✓`); }
  } catch (e) { alert(e.message); }
  gambarTombol();
}
function pilihTujuan(k) { const t = ATUR.tujuan, i = t.indexOf(k); if (i >= 0) { if (t.length > 1) t.splice(i, 1); } else t.push(k); simpanAtur(); gambarTombol(); }

/* ---------------- pratinjau ---------------- */
let tPrev = null, PREV_KUNCI = null, PREV_ASLI = null;
function pratinjau() {
  clearTimeout(tPrev);
  tPrev = setTimeout(async () => {
    if (MODE !== "ekspor" || !$("#prev")) return;
    const g = terpilih()[0] || GRUP.find(x => x.status === "siap");
    const item = g && g.file.find(x => FOTO.test(x.f.name));
    if (!item) { $("#prev").innerHTML = `<div class="kosong">Pratinjau muncul setelah ada foto.</div>`; return; }
    const a = salin(ATUR), kunci = JSON.stringify([a, g.id, item.f.name, P.preset.length, P.watermark.length]);
    if (kunci === PREV_KUNCI) return;
    PREV_KUNCI = kunci; $("#prev").style.opacity = .6;
    try {
      const as = await muatAset(a), ktx = ktxUntuk(g, 1, item);
      const r = await Mesin.olah(item.f, a, as, ktx, MOBILE ? 900 : 1300);
      if (kunci !== PREV_KUNCI) return;
      const t = Mesin.targetUkuran(r.asli[0], r.asli[1], a);
      if (PREV_ASLI) URL.revokeObjectURL(PREV_ASLI.hasil);
      PREV_ASLI = { hasil: URL.createObjectURL(r.blob), asli: urlKecil(item.f) };
      $("#prev").style.opacity = 1;
      $("#prev").innerHTML = `<img id="pImg" src="${PREV_ASLI.hasil}" alt="pratinjau">
        <div class="bawah"><span>${esc(item.f.name)}</span><span>${r.asli.join("×")} → <b>${t.tw}×${t.th}</b>${t.dibatasi ? " (batas perangkat)" : ""}</span>
        <button class="kecil" onpointerdown="pImg.src=PREV_ASLI.asli" onpointerup="pImg.src=PREV_ASLI.hasil" onpointerleave="pImg.src=PREV_ASLI.hasil" oncontextmenu="return false">Tahan: sebelum</button></div>`;
      const info = $("#infoUkuran"); if (info) info.textContent = `Contoh: ${r.asli.join("×")} px · ${mb(item.f.size)} → ${t.tw}×${t.th} px${a.kompres === "mb" ? ` · ≤ ${a.mb} MB` : ""}`;
    } catch (e) { $("#prev").style.opacity = 1; $("#prev").innerHTML = `<div class="kosong">Pratinjau gagal: ${esc(e.message)}</div>`; }
  }, 300);
}

/* ---------------- export ---------------- */
let JALAN = false, KUNCI_LAYAR = null, TUNGGU_IZIN = null;
async function kunciLayar() { try { if ("wakeLock" in navigator) KUNCI_LAYAR = await navigator.wakeLock.request("screen"); } catch (e) {} }
window.addEventListener("beforeunload", e => { if (JALAN) { e.preventDefault(); e.returnValue = ""; } });
function namaHasil(g, x, namaAsli, ext, a) {
  const n = a.nama; let stem = namaAsli.replace(/\.[^.]+$/, "");
  if (n.mode === "baru") stem = ((n.teks || "").trim().split("{folder}").join(g.nama) || g.nama).replace(/[\\/:*?"<>|]/g, "_");
  if (n.urutan) { const y = g.total, pad = v => String(v).padStart(String(y).length, "0");
    stem += { "(x of y)": ` (${x} of ${y})`, "(00x of y)": ` (${pad(x)} of ${y})`, "- x of y": ` - ${x} of ${y}`, "_x": `_${pad(x)}` }[n.format] || ` (${x} of ${y})`; }
  else if (n.mode === "baru") stem += " " + x;
  return stem + ext;
}
function ktxUntuk(g, x, item, a = ATUR) {
  const ext = ".jpg";
  return { nama_file: item.f.name.replace(/\.[^.]+$/, ""), nama_baru: namaHasil({ ...g, total: g.total || g.file.length }, x, item.f.name, ext, a).replace(/\.jpg$/, ""),
           no: x, total: g.total || g.file.length, folder: g.nama, subfolder: item.rel || "" };
}
function tungguIzin() {
  if (!TUNGGU_IZIN) {
    let ok; const p = new Promise(r => ok = r); TUNGGU_IZIN = { p, ok };
    kabari("masalah", "⚠️ Sesi Google habis", "Ketuk “Sambung Google lagi” untuk melanjutkan export.");
    gambarProses();
  }
  return TUNGGU_IZIN.p;
}
function lanjutSetelahIzin() { if (TUNGGU_IZIN && Google.aktif()) { const t = TUNGGU_IZIN; TUNGGU_IZIN = null; t.ok(); gambarProses(); } }
const tidur = ms => new Promise(r => setTimeout(r, ms));
async function tungguOnline() { while (!navigator.onLine) await tidur(2000); }

async function mulaiEkspor() {
  const p = terpilih(); if (!p.length) return;                  // boleh ditekan lagi saat export berjalan → ikut antre
  const tj = [...ATUR.tujuan];
  if ((tj.includes("drive") || tj.includes("photos")) && !Google.aktif()) return masukGoogle();      // klik ini dipakai untuk login dulu
  if (tj.includes("photos") && !Google.bisaPhotos()) return masukGoogle(true);
  if (tj.includes("lokal") && Lokal.bisaFolder() && !Lokal.adaFolder) {
    try { const n = await Lokal.pilihFolder(); toast(`Hasil disimpan ke folder "${n}". Tekan Export lagi untuk mulai.`); } catch (e) {}
    return;
  }
  if ("Notification" in window && Notification.permission === "default") try { Notification.requestPermission(); } catch (e) {}
  const a = salin(ATUR), as = await muatAset(a), tambahan = JALAN;   // tiap folder memakai pengaturan saat Export-nya ditekan
  const tugas = [];
  for (const [i, g] of p.entries()) {
    g.namaTujuan = namaFolderTujuan(g.nama, i + 1, a);
    g.file.sort((x, y) => urutAlami((x.rel || "") + "/" + x.f.name, (y.rel || "") + "/" + y.f.name));
    Object.assign(g, { status: "jalan", ok: 0, gagal: 0, total: g.file.length, galat: "", link: {}, gagalTugas: [], tujuan: tj, mulai: Date.now() });
    g.file.forEach((item, i) => tugas.push({ g, item, x: i + 1, a, as }));
  }
  kabari("info", tambahan ? `➕ Masuk antrean: ${p.length} folder` : `📤 Export dimulai: ${p.length} folder`,
    `${tugas.length} file ${tambahan ? "diproses setelah / bersamaan dengan export yang sedang jalan" : "diproses di perangkat ini"}`);
  gambarFolder(); gambarTombol(); gambarProses();
  await jalankan(tugas);
}
// antrean bersama: export baru tinggal ditambahkan, pekerja yang sedang jalan ikut mengambilnya
const ANTRE = []; let PEKERJA = 0;
async function jalankan(tugas) {
  ANTRE.push(...tugas);
  JALAN = true; kunciLayar(); gambarTombol();
  const baru = Math.max(0, (Mesin.IOS ? 1 : 2) - PEKERJA);
  if (!baru) return;
  PEKERJA += baru;
  await Promise.all(Array.from({ length: baru }, async () => { while (ANTRE.length) await kerjakan(ANTRE.shift()); }));
  PEKERJA -= baru;
  if (ANTRE.length) return jalankan([]);
  if (PEKERJA) return;                                             // pekerja lain masih menyelesaikan file terakhirnya
  JALAN = false;
  try { KUNCI_LAYAR?.release(); } catch (e) {}
  const selesai = GRUP.filter(g => g.status === "selesai" && g.baruSelesai);
  if (selesai.length > 1) {
    const ok = selesai.reduce((s, g) => s + g.ok, 0), gg = selesai.reduce((s, g) => s + g.gagal, 0);
    kabari(gg ? "masalah" : "ok", `🎉 Semua export selesai (${selesai.length} folder)`, `${ok} file terkirim${gg ? `, ${gg} gagal` : ""}`);
  }
  selesai.forEach(g => g.baruSelesai = false);
  gambarTombol(); gambarProses();
}
async function kerjakan(t) {
  const { g, item, x, a, as } = t, f = item.f, video = VIDEO.test(f.name);
  try {
    let blob = f, mime = f.type || (video ? "video/mp4" : "image/jpeg"), ext = (f.name.match(/\.[^.]+$/) || [".jpg"])[0].toLowerCase();
    if (!video && Mesin.perluOlah(a, f)) {
      try { blob = (await Mesin.olah(f, a, as, ktxUntuk(g, x, item, a))).blob; mime = "image/jpeg"; ext = ".jpg"; }
      catch (e) { throw new Error(`Foto rusak / tidak bisa dibuka (${f.name})`); }
    }
    const nama = namaHasil(g, x, f.name, ext, a), bagian = item.rel ? item.rel.split("/") : [];
    for (const tj of g.tujuan) {
      for (let coba = 1; ; coba++) {
        try {
          await tungguOnline();
          if (tj === "drive") {
            const df = a.drive_folder, akar = df ? df.id : "root";
            const dasar = df ? (a.drive_sub ? [namaTj(g)] : []) : ["Kirim Foto", namaTj(g)];
            const induk = await Google.jalurDrive([...dasar, ...bagian], akar);
            if (!g.link.drive) g.link.drive = dasar.length ? await Google.jalurDrive(dasar, akar) : akar;
            await Google.unggahDrive(blob, nama, mime, induk, () => {});
          } else if (tj === "photos") {
            const al = await Google.album(bagian.length ? [namaTj(g), ...bagian].join(" – ") : namaTj(g));
            if (!bagian.length) g.link.photos = al.url; else if (!g.link.photos) g.link.photos = (await Google.album(namaTj(g))).url;
            await Google.unggahPhotos(blob, nama, mime, al.id, () => {});
          } else if (Lokal.adaFolder) await Lokal.tulis([namaTj(g), ...bagian], nama, blob);
          else await Lokal.tambahZip(g.id, [...bagian, nama].join("/"), blob);
          break;
        } catch (e) {
          if (e instanceof GalatIzin) { await tungguIzin(); continue; }
          if (e instanceof GalatSementara && coba < 6) { g.galat = e.message; g.ulang = true; gambarProses(); await tidur(Math.min(60000, 3000 * 2 ** (coba - 1))); continue; }
          throw e;
        }
      }
    }
    g.ok++; g.ulang = false;
  } catch (e) {
    g.gagal++; g.galat = e.message; g.gagalTugas.push(t);
    if (g.gagal === 1 || g.gagal % 20 === 0) kabari("masalah", `⚠️ Masalah di ${namaTj(g)}`, e.message);
  }
  if (g.ok + g.gagal === g.total) await folderSelesai(g);
  jadwalProses();
}
async function folderSelesai(g) {
  g.status = "selesai"; g.baruSelesai = true;
  if (g.tujuan.includes("lokal") && !Lokal.adaFolder) {
    try { const z = await Lokal.unduhZip(g.id, namaTj(g)); if (z) g.link.zip = z.url; } catch (e) { g.galat = "ZIP gagal dibuat (memori perangkat penuh?)"; }
  }
  const ke = g.tujuan.map(t => ({ drive: "Google Drive", photos: "Google Photos", lokal: Lokal.adaFolder ? "folder" : "ZIP" })[t]).join(" + ");
  kabari(g.gagal ? "masalah" : "ok", `${g.gagal ? "⚠️" : "✅"} ${namaTj(g)} selesai`, `${g.ok} file masuk ${ke}${g.gagal ? `, ${g.gagal} gagal` : ""}`);
}
async function ulangGagal(id) {
  const g = GRUP.find(x => x.id === id); if (!g || !g.gagalTugas.length) return;
  if ((g.tujuan.includes("drive") || g.tujuan.includes("photos")) && !Google.aktif()) return masukGoogle();
  const tugas = g.gagalTugas; g.gagalTugas = []; g.gagal = 0; g.status = "jalan"; g.galat = "";   // diulang dengan pengaturan aslinya
  gambarProses();
  await jalankan(tugas);
}
async function bagikan(id) {
  const g = GRUP.find(x => x.id === id);
  try {
    if (!Google.aktif()) return masukGoogle();
    const link = g.link.share || (g.link.share = await Google.bagikanDrive(g.link.drive));
    if (navigator.share && MOBILE) await navigator.share({ title: namaTj(g), url: link }).catch(() => {});
    else { await navigator.clipboard.writeText(link); toast("Link folder disalin ✓ (siapa pun dengan link bisa melihat)"); }
    gambarProses();
  } catch (e) { alert(e.message); }
}
let _jp = null;
function jadwalProses() { if (!_jp) _jp = setTimeout(() => { _jp = null; gambarProses(); }, 400); }
function gambarProses() { gambarFolder(); gambarBar(); }

/* ---------------- halaman pustaka & bantuan ---------------- */
function gambarPustaka() {
  $("#utama").innerHTML = `<div class="kepala"><h2>🎨 Preset & Watermark</h2><div class="sub">Disimpan di perangkat ini. Tambah dari folder mana saja (di HP: dari Files / galeri).</div></div>
  <div class="blok" style="margin-top:14px"><h3>🎨 Preset warna <span style="font-weight:400;color:var(--mute);font-size:12px">${P.preset.length}</span>
    <button class="utama kecil" style="margin-left:auto" onclick="tambahPustaka('preset').then(gambarPustaka)">＋ Tambah preset</button></h3>
    <div class="pk-grid">${P.preset.map(x => kartuPk(x)).join("") || `<div style="color:var(--mute)">Belum ada preset.</div>`}</div>
    <div style="font-size:12px;color:var(--mute);margin-top:10px"><b>.cube</b> (LUT, hasil persis) · <b>.xmp</b> & <b>DNG preset</b> Lightroom (dikonversi otomatis — mirip, tidak 100% sama dengan Lightroom).</div></div>
  <div class="blok"><h3>🏷️ Watermark / logo <span style="font-weight:400;color:var(--mute);font-size:12px">${P.watermark.length}</span>
    <button class="utama kecil" style="margin-left:auto" onclick="tambahPustaka('watermark').then(gambarPustaka)">＋ Tambah watermark</button></h3>
    <div class="pk-grid">${P.watermark.map(x => kartuPk(x)).join("") || `<div style="color:var(--mute)">Belum ada watermark.</div>`}</div>
    <div style="font-size:12px;color:var(--mute);margin-top:10px">PNG transparan paling bagus. Logo JPG berlatar putih bisa dibuang latarnya otomatis.</div></div>`;
}
function gambarBantuan() {
  $("#utama").innerHTML = `<div class="kepala"><h2>❓ Cara pakai</h2></div>
  <div class="blok" style="margin-top:14px;font-size:14px;line-height:1.6">
    <b>1. Masuk Google</b> (kanan atas) kalau mau kirim ke Drive/Photos. Aplikasi hanya bisa melihat file & album yang ia buat sendiri.<br>
    <b>2. Pilih foto</b> — dari galeri/Files (HP) atau folder (komputer). Tiap pilihan jadi satu folder tujuan; namanya bisa diganti.<br>
    <b>3. Atur hasil</b> — ukuran, kualitas, nama file (x of y), watermark logo, teks custom, preset warna. Lihat pratinjau; tahan tombol "sebelum" untuk membandingkan.<br>
    <b>4. Pilih tujuan</b> — Google Drive, Google Photos (album otomatis), dan/atau simpan ke perangkat — lalu tekan <b>Export</b>.<br>
    <b>5. Notifikasi</b> muncul saat tiap folder selesai, semua selesai, atau ada masalah (🔔 untuk riwayat).</div>
  <div class="blok" style="font-size:14px;line-height:1.6"><b>Pasang di layar utama (seperti aplikasi)</b><br>
    iPhone/iPad (Safari): tombol Bagikan ⬆︎ → <i>Tambah ke Layar Utama</i>.<br>Android (Chrome): menu ⋮ → <i>Instal aplikasi / Tambahkan ke layar utama</i>.<br>
    Windows/Mac (Chrome/Edge): ikon instal di kolom alamat.</div>
  <div class="blok" style="font-size:14px;line-height:1.6"><b>Penting saat export di HP</b><br>
    Biarkan aplikasi terbuka & layar menyala sampai selesai (layar dijaga menyala otomatis bila didukung). Kalau aplikasi ditutup, export berhenti — tekan Export lagi untuk folder yang belum selesai.<br>
    iPhone/iPad: hasil maksimal ±16 MP per foto (batas Safari).</div>
  <div class="blok" style="font-size:13px;color:var(--mute);line-height:1.6"><b>Privasi</b>: foto diolah di perangkat kamu dan langsung dikirim ke akun Google kamu sendiri. Tidak ada server lain. Preset, logo & pengaturan tersimpan di browser perangkat ini. <a href="privasi.html">Kebijakan privasi</a></div>`;
}

/* ---------------- mulai ---------------- */
(async () => {
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  const balik = await Google.tangkapRedirect();
  if (balik === "ok") setTimeout(() => toast("Terhubung ke Google ✓"), 300); else if (balik) setTimeout(() => alert(balik), 300);
  // login cukup sekali: perpanjang izin diam-diam lewat server izin
  if (!Google.aktif() && Google.punyaSesi()) { try { await Google.segar(); } catch (e) {} }
  // cadangan (tanpa server izin): minta token baru diam-diam lewat Google, sekali per pembukaan
  else if (!balik && !Google.LAYANAN && KIRIM_CONFIG.clientId && Google.ingatAkun() && !Google.aktif() && navigator.onLine && !sessionStorage.getItem("kf_auto")) {
    sessionStorage.setItem("kf_auto", "1"); Google.masukRedirect(false, true); return;
  }
  try { await muatPustaka(); } catch (e) {}
  gambarLonceng(); gambarAkun(); halaman("ekspor");
  // seret file ke luar kotak Foto jangan sampai membuka file di tab
  ["dragover", "drop"].forEach(e => window.addEventListener(e, ev => { if (!ev.defaultPrevented) ev.preventDefault(); }));
})();
