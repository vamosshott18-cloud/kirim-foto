// Kirim Foto — layanan izin login (Google Apps Script).
// Menukar kode login Google menjadi izin jangka panjang (refresh token) dan memperpanjang izin akses tiap ±1 jam,
// supaya pengguna cukup login SEKALI. Foto tidak lewat sini. Kunci rahasia disimpan di Script Properties: CLIENT_SECRET.
const CLIENT_ID = "167379561610-td4da0r3beisi3s0c7jpkvb4vqns0jga.apps.googleusercontent.com";
const ASAL_BOLEH = ["https://vamosshott18-cloud.github.io/kirim-foto/", "http://localhost:8080/"];

function doGet() { return ContentService.createTextOutput("Kirim Foto: layanan login aktif"); }

function doPost(e) {
  let out;
  try {
    const q = JSON.parse(e.postData.contents);
    if (q.aksi === "tukar") out = tukar(q.code, q.redirect_uri, q.verifier);
    else if (q.aksi === "segar") out = segar(q.sesi);
    else if (q.aksi === "keluar") out = keluar(q.sesi);
    else out = { galat: "aksi tidak dikenal" };
  } catch (err) { out = { galat: String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const prop = () => PropertiesService.getScriptProperties();
function tokenGoogle(isi) {
  isi.client_id = CLIENT_ID; isi.client_secret = prop().getProperty("CLIENT_SECRET");
  const r = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", { method: "post", payload: isi, muteHttpExceptions: true });
  return JSON.parse(r.getContentText());
}
function tukar(code, redirect_uri, verifier) {
  if (ASAL_BOLEH.indexOf(redirect_uri) < 0) return { galat: "alamat tidak diizinkan" };
  const j = tokenGoogle({ code: code, redirect_uri: redirect_uri, code_verifier: verifier, grant_type: "authorization_code" });
  if (j.error) return { galat: j.error_description || j.error };
  let sesi = null;
  if (j.refresh_token) {                                     // simpan izin jangka panjang, pengguna hanya pegang nomor sesi acak
    sesi = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    prop().setProperty("s_" + sesi, j.refresh_token);
  }
  return { access_token: j.access_token, expires_in: j.expires_in, scope: j.scope, sesi: sesi };
}
function segar(sesi) {
  const rt = sesi && prop().getProperty("s_" + sesi);
  if (!rt) return { galat: "sesi_hilang" };
  const j = tokenGoogle({ refresh_token: rt, grant_type: "refresh_token" });
  if (j.error) { if (j.error === "invalid_grant") prop().deleteProperty("s_" + sesi); return { galat: j.error }; }
  return { access_token: j.access_token, expires_in: j.expires_in, scope: j.scope };
}
function keluar(sesi) {
  const rt = sesi && prop().getProperty("s_" + sesi);
  if (rt) {
    UrlFetchApp.fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(rt), { method: "post", muteHttpExceptions: true });
    prop().deleteProperty("s_" + sesi);
  }
  return { ok: true };
}
