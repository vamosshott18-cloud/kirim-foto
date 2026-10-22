// Tujuan export: Google Drive, Google Photos (login Google langsung dari browser), dan folder/ZIP di perangkat.
"use strict";
class GalatSementara extends Error {}        // diulang otomatis
class GalatIzin extends Error {}             // sesi Google habis → minta pengguna klik "Sambung lagi"

const Google = (() => {
  const SCOPES = ["https://www.googleapis.com/auth/drive.file",
                  "https://www.googleapis.com/auth/photoslibrary.appendonly",
                  "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata"];
  const API = "https://www.googleapis.com/drive/v3", UP = "https://www.googleapis.com/upload/drive/v3";
  const PH = "https://photoslibrary.googleapis.com/v1";
  let token = null, habis = 0, izin = new Set(), klien = null, gis = null, akun = null, segarJalan = null;
  const LAYANAN = (window.KIRIM_CONFIG || {}).layanan || "";      // server izin (Apps Script) → login cukup sekali
  const sesi = () => localStorage.getItem("kf_sesi");
  try {   // sesi tersimpan (1 jam) supaya reload halaman tidak perlu login lagi
    const t = JSON.parse(localStorage.getItem("kf_token") || "null");
    if (t && t.habis > Date.now() + 60000) { token = t.token; habis = t.habis; izin = new Set(t.izin); }
  } catch (e) {}

  function muatGIS() {
    gis = gis || new Promise((ok, gagal) => {
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client";
      s.onload = ok; s.onerror = () => gagal(new Error("Tidak bisa memuat login Google (cek internet)")); document.head.appendChild(s);
    });
    return gis;
  }
  function simpanToken(t, detik, scope) {
    token = t; habis = Date.now() + (detik - 60) * 1000; izin = new Set((scope || "").split(" "));
    localStorage.setItem("kf_token", JSON.stringify({ token, habis, izin: [...izin] })); akun = null;
  }
  // login dengan pindah halaman (untuk aplikasi di layar utama iPhone / bila popup diblokir)
  function masukRedirect(pilihAkun = false, diam = false) {
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem("kf_state", state); sessionStorage.setItem("kf_diam", diam ? "1" : "");
    const email = localStorage.getItem("kf_email");
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({ client_id: KIRIM_CONFIG.clientId, redirect_uri: location.origin + location.pathname.replace(/index\.html$/, ""),
      response_type: "token", scope: SCOPES.join(" "), include_granted_scopes: "true", state,
      ...(pilihAkun ? { prompt: "select_account consent" } : diam ? { prompt: "none" } : {}),
      ...(email && !pilihAkun ? { login_hint: email } : {}) });
    location.assign(u.toString());
    return new Promise(() => {});
  }
  // dipanggil saat halaman dibuka: ambil token dari alamat setelah kembali dari Google
  async function tangkapRedirect() {
    const q = new URLSearchParams(location.search);
    if (q.get("code") || (q.get("error") && q.get("state"))) {         // kembali dari login kode
      history.replaceState(null, "", location.pathname);
      if (q.get("state") !== sessionStorage.getItem("kf_state")) return "Login Google tidak valid, coba lagi";
      if (q.get("error")) return q.get("error") === "access_denied" ? "Login Google dibatalkan" : "Login Google gagal: " + q.get("error");
      const j = await layanan({ aksi: "tukar", code: q.get("code"), redirect_uri: alamatBalik(), verifier: sessionStorage.getItem("kf_ver") });
      if (j.galat) return "Login Google gagal: " + j.galat;
      simpanToken(j.access_token, j.expires_in, j.scope);
      if (j.sesi) localStorage.setItem("kf_sesi", j.sesi);
      return "ok";
    }
    if (!location.hash.includes("access_token") && !location.hash.includes("error=")) return null;
    const p = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("state") !== sessionStorage.getItem("kf_state")) return "Login Google tidak valid, coba lagi";
    if (p.get("error") && sessionStorage.getItem("kf_diam")) return null;   // login otomatis tidak bisa → tampilkan tombol Masuk saja
    if (p.get("error")) return p.get("error") === "access_denied" ? "Login Google dibatalkan" : "Login Google gagal: " + p.get("error");
    simpanToken(p.get("access_token"), +p.get("expires_in") || 3599, p.get("scope"));
    return "ok";
  }
  const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const alamatBalik = () => location.origin + location.pathname.replace(/index\.html$/, "");
  // login dengan kode + PKCE → server menukar & menyimpan izin jangka panjang
  async function masukKode(pilihAkun = false) {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const state = Math.random().toString(36).slice(2);
    sessionStorage.setItem("kf_state", state); sessionStorage.setItem("kf_ver", verifier);
    const email = localStorage.getItem("kf_email");
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({ client_id: KIRIM_CONFIG.clientId, redirect_uri: alamatBalik(), response_type: "code",
      scope: SCOPES.join(" "), include_granted_scopes: "true", access_type: "offline", state,
      code_challenge: challenge, code_challenge_method: "S256",
      prompt: pilihAkun ? "select_account consent" : "consent", ...(email && !pilihAkun ? { login_hint: email } : {}) });
    location.assign(u.toString());
    return new Promise(() => {});
  }
  async function layanan(isi) {
    let galat = null;
    for (let coba = 0; coba < 4; coba++) {                   // Apps Script kadang 404/5xx sesaat (baru "bangun") → ulangi
      if (coba) await new Promise(t => setTimeout(t, 1200 * coba));
      try {
        const r = await fetch(LAYANAN, { method: "POST", body: JSON.stringify(isi) });   // tanpa header khusus → tanpa preflight
        if (r.ok) return await r.json();
        galat = new GalatSementara(`Layanan login sibuk (${r.status})`);
      } catch (e) { galat = new GalatSementara("Koneksi internet putus"); }
    }
    throw galat;
  }
  // perpanjang izin akses diam-diam (tiap ±1 jam) — tanpa layar Google
  function segar() {
    if (!sesi()) return Promise.reject(new GalatIzin("Belum login"));
    segarJalan = segarJalan || (async () => {
      try {
        const j = await layanan({ aksi: "segar", sesi: sesi() });
        if (j.galat) {
          if (["sesi_hilang", "invalid_grant"].includes(j.galat)) { localStorage.removeItem("kf_sesi"); throw new GalatIzin("Izin Google dicabut / kedaluwarsa, login lagi"); }
          throw new GalatSementara("Gagal memperpanjang izin: " + j.galat);
        }
        simpanToken(j.access_token, j.expires_in, j.scope);
      } finally { segarJalan = null; }
    })();
    return segarJalan;
  }
  // HARUS dipanggil dari klik pengguna. Popup Google; di aplikasi layar utama / bila popup gagal → pindah halaman.
  async function masuk(pilihAkun = false) {
    if (LAYANAN) return masukKode(pilihAkun);
    if (STANDALONE) return masukRedirect(pilihAkun);
    try { await muatGIS(); } catch (e) { return masukRedirect(pilihAkun); }
    return new Promise((ok, gagal) => {
      klien = google.accounts.oauth2.initTokenClient({
        client_id: KIRIM_CONFIG.clientId, scope: SCOPES.join(" "), include_granted_scopes: true,
        callback: r => {
          if (r.error) return gagal(new Error(r.error_description || r.error));
          simpanToken(r.access_token, r.expires_in, r.scope); ok();
        },
        error_callback: e => {
          if (e.type === "popup_failed_to_open") { masukRedirect(pilihAkun); return; }   // popup diblokir → pindah halaman
          gagal(new Error(e.type === "popup_closed" ? "Login Google dibatalkan" : (e.message || "Login Google gagal")));
        },
      });
      const email = localStorage.getItem("kf_email");
      klien.requestAccessToken({ prompt: pilihAkun ? "select_account consent" : "", ...(email && !pilihAkun ? { login_hint: email } : {}) });
    });
  }
  function keluar() {
    if (sesi() && LAYANAN) layanan({ aksi: "keluar", sesi: sesi() }).catch(() => {});
    localStorage.removeItem("kf_sesi");
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
    token = null; habis = 0; izin = new Set(); akun = null; localStorage.removeItem("kf_token"); localStorage.removeItem("kf_email");
  }
  const aktif = () => !!token && Date.now() < habis;
  const bisaDrive = () => aktif() && izin.has(SCOPES[0]);
  const bisaPhotos = () => aktif() && izin.has(SCOPES[1]);

  async function req(url, opt = {}, ulang = true) {
    if (!aktif()) { if (sesi()) await segar(); else throw new GalatIzin("Sesi Google habis"); }
    let r;
    try { r = await fetch(url, { ...opt, headers: { Authorization: "Bearer " + token, ...(opt.headers || {}) } }); }
    catch (e) { throw new GalatSementara("Koneksi internet putus"); }
    if (r.status === 401) {
      token = null; habis = 0;
      if (sesi() && ulang && !(opt.body instanceof ReadableStream)) { await segar(); return req(url, opt, false); }
      throw new GalatIzin("Sesi Google habis");
    }
    if (r.status === 429 || r.status >= 500) throw new GalatSementara(`Google sedang sibuk (${r.status})`);
    if (r.status === 403) {
      const t = await r.text();
      if (/storageQuotaExceeded|quota/i.test(t)) throw new GalatSementara("Ruang Google penuh / kuota habis");
      if (/rateLimit/i.test(t)) throw new GalatSementara("Terlalu cepat, diulang");
      throw new Error("Ditolak Google: " + t.slice(0, 140));
    }
    if (!r.ok && r.status !== 308) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 140)}`);
    return r;
  }

  async function infoAkun() {
    if (akun || !bisaDrive()) return akun;
    const j = await (await req(`${API}/about?fields=user(emailAddress,displayName),storageQuota`)).json();
    akun = { email: j.user.emailAddress, pakai: +j.storageQuota.usage || 0, batas: +j.storageQuota.limit || 0 };
    localStorage.setItem("kf_email", akun.email);   // diingat untuk login otomatis berikutnya
    return akun;
  }

  /* ---- Drive ---- */
  const cacheFolder = new Map();
  const kutip = s => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  async function folderDrive(nama, induk) {
    const k = induk + "/" + nama;
    if (cacheFolder.has(k)) return cacheFolder.get(k);
    const p = (async () => {
      const q = `name='${kutip(nama)}' and '${induk}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const j = await (await req(`${API}/files?fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&q=${encodeURIComponent(q)}`)).json();
      if (j.files.length) return j.files[0].id;
      const r = await req(`${API}/files?fields=id&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nama, mimeType: "application/vnd.google-apps.folder", parents: [induk] }) });
      return (await r.json()).id;
    })();
    cacheFolder.set(k, p);
    try { return await p; } catch (e) { cacheFolder.delete(k); throw e; }
  }
  async function jalurDrive(bagian, akar = "root") {   // ["Kirim Foto", "Nama folder", "Sesi 1"] → id folder terakhir
    let id = akar;
    for (const b of bagian.filter(Boolean)) id = await folderDrive(b, id);
    return id;
  }
  async function unggahDrive(blob, nama, mime, induk, maju) {
    if (blob.size <= 5 * 1048576) {
      const fd = new FormData();
      fd.append("metadata", new Blob([JSON.stringify({ name: nama, parents: [induk] })], { type: "application/json" }));
      fd.append("file", blob.type ? blob : new Blob([blob], { type: mime }));
      const r = await req(`${UP}/files?uploadType=multipart&fields=id&supportsAllDrives=true`, { method: "POST", body: fd });
      maju(blob.size); return (await r.json()).id;
    }
    const r0 = await req(`${UP}/files?uploadType=resumable&fields=id&supportsAllDrives=true`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(blob.size) },
      body: JSON.stringify({ name: nama, parents: [induk] }) });
    const sesi = r0.headers.get("Location"), POTONG = 8 * 1048576;
    let mulai = 0;
    while (true) {
      const akhir = Math.min(mulai + POTONG, blob.size);
      let r;
      try { r = await fetch(sesi, { method: "PUT", headers: { "Content-Range": `bytes ${mulai}-${akhir - 1}/${blob.size}` }, body: blob.slice(mulai, akhir) }); }
      catch (e) {                                                      // putus → tanya posisi terakhir lalu lanjut
        await new Promise(t => setTimeout(t, 3000));
        try {
          const q = await fetch(sesi, { method: "PUT", headers: { "Content-Range": `bytes */${blob.size}` } });
          if (q.status === 200 || q.status === 201) return (await q.json()).id;
          const rg = q.headers.get("Range"); mulai = rg ? +rg.split("-")[1] + 1 : 0; continue;
        } catch (e2) { throw new GalatSementara("Koneksi internet putus"); }
      }
      if (r.status === 200 || r.status === 201) { maju(akhir - mulai); return (await r.json()).id; }
      if (r.status !== 308) throw new GalatSementara(`Upload Drive gagal (${r.status})`);
      const rg = r.headers.get("Range"), baru = rg ? +rg.split("-")[1] + 1 : 0;
      maju(baru - mulai); mulai = baru;
    }
  }
  async function bagikanDrive(id) {
    await req(`${API}/files/${id}/permissions?supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }) });
    return `https://drive.google.com/drive/folders/${id}?usp=sharing`;
  }

  /* ---- pilih folder Drive yang sudah ada (Google Picker): memberi izin ke folder itu saja ---- */
  let gapiSiap = null;
  const idDariLink = t => { t = (t || "").trim(); const m = t.match(/folders\/([\w-]{10,})/) || t.match(/[?&]id=([\w-]{10,})/) || t.match(/^([\w-]{20,})$/); return m ? m[1] : null; };
  async function pilihFolder(link = "") {
    if (!aktif()) { if (sesi()) await segar(); else throw new GalatIzin("Masuk Google dulu"); }
    gapiSiap = gapiSiap || new Promise((ok, gagal) => { const s = document.createElement("script"); s.src = "https://apis.google.com/js/api.js";
      s.onload = () => gapi.load("picker", { callback: ok, onerror: gagal }); s.onerror = () => gagal(new Error("Tidak bisa memuat pemilih Google Drive")); document.head.appendChild(s); });
    await gapiSiap;
    const fileId = idDariLink(link);
    if (link && !fileId) throw new Error("Link folder tidak dikenali. Salin link dari Drive: klik kanan folder → Bagikan → Salin link.");
    return new Promise((ok, batal) => {
      const P = google.picker;
      const lihat = new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes("application/vnd.google-apps.folder");
      if (fileId) lihat.setFileIds(fileId);                       // dari link: tampilkan folder itu saja → tinggal Select
      const b = new P.PickerBuilder().setDeveloperKey(KIRIM_CONFIG.apiKey).setAppId(KIRIM_CONFIG.appId).setOAuthToken(token)
        .addView(lihat).enableFeature(P.Feature.SUPPORT_DRIVES).setTitle(fileId ? "Ketuk folder lalu Select" : "Pilih folder tujuan export")
        .setCallback(d => {
          if (d.action === P.Action.PICKED) { const x = d.docs[0]; ok({ id: x.id, nama: x.name }); }
          else if (d.action === P.Action.CANCEL) ok(null);
        });
      if (!fileId) b.addView(new P.DocsView(P.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setEnableDrives(true));
      b.build().setVisible(true);
    });
  }

  /* ---- Google Photos (album dibuat otomatis) ---- */
  const cacheAlbum = new Map();
  async function album(judul) {
    if (cacheAlbum.has(judul)) return cacheAlbum.get(judul);
    const p = (async () => {
      const r = await req(`${PH}/albums`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ album: { title: judul.slice(0, 500) } }) });
      const j = await r.json(); return { id: j.id, url: j.productUrl };
    })();
    cacheAlbum.set(judul, p);
    try { return await p; } catch (e) { cacheAlbum.delete(judul); throw e; }
  }
  async function unggahPhotos(blob, nama, mime, albumId, maju) {
    const r = await req(`${PH}/uploads`, { method: "POST", body: blob, headers: { "Content-Type": "application/octet-stream",
      "X-Goog-Upload-Content-Type": mime, "X-Goog-Upload-Protocol": "raw", "X-Goog-Upload-File-Name": encodeURIComponent(nama) } });
    const tokenUnggah = await r.text(); maju(blob.size);
    const j = await (await req(`${PH}/mediaItems:batchCreate`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId, newMediaItems: [{ simpleMediaItem: { fileName: nama, uploadToken: tokenUnggah } }] }) })).json();
    const h = j.newMediaItemResults[0];
    if (!h.mediaItem) throw new Error(`Google Photos menolak ${nama}: ${h.status?.message || "?"}`);
    return h.mediaItem.id;
  }

  const ingatAkun = () => localStorage.getItem("kf_email");
  return { pilihFolder, idDariLink, segar, punyaSesi: () => !!(LAYANAN && sesi()), LAYANAN, ingatAkun, masuk, masukRedirect, tangkapRedirect, STANDALONE, keluar, aktif, bisaDrive, bisaPhotos, infoAkun, jalurDrive, unggahDrive, bagikanDrive, album, unggahPhotos };
})();

/* ---- Folder di perangkat: tulis langsung (Chrome/Edge di komputer) atau ZIP (lainnya) ---- */
const Lokal = (() => {
  const bisaFolder = () => "showDirectoryPicker" in window && !/Android|iPhone|iPad/.test(navigator.userAgent);
  let akar = null;
  async function pilihFolder() { akar = await window.showDirectoryPicker({ id: "kirimfoto", mode: "readwrite", startIn: "pictures" }); return akar.name; }
  async function tulis(bagian, nama, blob) {
    let d = akar;
    for (const b of bagian.filter(Boolean)) d = await d.getDirectoryHandle(b.replace(/[\\/:*?"<>|]/g, "_"), { create: true });
    const f = await d.getFileHandle(nama, { create: true }), w = await f.createWritable();
    await w.write(blob); await w.close();
  }
  // ZIP: kumpulkan per folder, diunduh di akhir
  const zip = new Map();
  let jszip = null;
  async function tambahZip(grupId, jalur, blob) {
    jszip = jszip || new Promise((ok, gagal) => { const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; s.onload = ok; s.onerror = gagal; document.head.appendChild(s); });
    await jszip;
    if (!zip.has(grupId)) zip.set(grupId, new JSZip());
    zip.get(grupId).file(jalur, blob, { binary: true, compression: "STORE" });
  }
  async function unduhZip(grupId, nama) {
    const z = zip.get(grupId); if (!z) return null;
    const blob = await z.generateAsync({ type: "blob", compression: "STORE" });
    zip.delete(grupId);
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = nama + ".zip"; document.body.appendChild(a); a.click(); a.remove();
    return { url, ukuran: blob.size };
  }
  return { bisaFolder, pilihFolder, tulis, tambahZip, unduhZip, get adaFolder() { return !!akar; } };
})();
