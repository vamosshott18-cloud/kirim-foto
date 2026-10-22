// Preset Lightroom (.xmp / DNG preset) → LUT 3D (33³) — PENDEKATAN, port dari lrpreset.py versi Mac.
// Ikut: exposure, kontras, highlight/shadow/white/black, WB relatif, tone curve, HSL, vibrance/saturasi,
// split toning / color grading, dehaze, hitam-putih, vignette. Tidak ikut: profil kamera, masking, clarity, sharpening.
"use strict";
const LR = (() => {
  const UKURAN = 33;

  function cariBytes(u8, pola, dari = 0) {
    const p = new TextEncoder().encode(pola);
    outer: for (let i = dari; i <= u8.length - p.length; i++) {
      for (let j = 0; j < p.length; j++) if (u8[i + j] !== p[j]) continue outer;
      return i;
    }
    return -1;
  }

  function xmpDari(buffer) {
    const u8 = new Uint8Array(buffer);
    const a = cariBytes(u8, "<x:xmpmeta");
    const b = a < 0 ? -1 : cariBytes(u8, "</x:xmpmeta>", a);
    if (a < 0 || b < 0) throw new Error("Tidak ada pengaturan Lightroom di file ini");
    return new TextDecoder("utf-8").decode(u8.subarray(a, b + 12));
  }

  function baca(teks) {
    const s = {};
    for (const m of teks.matchAll(/crs:(\w+)="([^"]*)"/g)) if (!(m[1] in s)) s[m[1]] = m[2];
    for (const m of teks.matchAll(/<crs:(\w+)>([^<]*)<\/crs:\1>/g)) if (!(m[1] in s)) s[m[1]] = m[2].trim();
    for (const m of teks.matchAll(/<crs:(ToneCurvePV2012\w*)>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>/g))
      s[m[1]] = [...m[2].matchAll(/<rdf:li>([^<]+)<\/rdf:li>/g)].map(x => x[1].split(",").map(Number));
    const kunci = Object.keys(s).filter(k => !["PresetType", "Cluster", "UUID", "Version"].includes(k));
    if (!kunci.length) throw new Error("Pengaturan Lightroom kosong");
    return s;
  }

  const angka = (s, k, d = 0) => { const v = parseFloat(String(s[k] ?? d).replace("+", "")); return isNaN(v) ? d : v; };
  const kl = v => Math.min(1, Math.max(0, v));
  const keLinear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const keSrgb = c => { c = Math.max(0, c); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  const luma = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;

  function kurvaMonoton(titik) {
    const t = [...new Map(titik.map(p => [p[0], p])).values()].sort((a, b) => a[0] - b[0]);
    const x = t.map(p => p[0] / 255), y = t.map(p => p[1] / 255), n = x.length;
    if (n < 2) return v => v;
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(x[i + 1] - x[i]); m.push((y[i + 1] - y[i]) / Math.max(dx[i], 1e-9)); }
    const tg = [m[0]];
    for (let i = 1; i < n - 1; i++) tg.push((m[i - 1] + m[i]) / 2);
    tg.push(m[n - 2]);
    for (let k = 0; k < n - 1; k++) {
      if (m[k] === 0) { tg[k] = tg[k + 1] = 0; continue; }
      const a = tg[k] / m[k], b = tg[k + 1] / m[k], r = a * a + b * b;
      if (r > 9) { const tt = 3 / Math.sqrt(r); tg[k] = tt * a * m[k]; tg[k + 1] = tt * b * m[k]; }
    }
    const tabel = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      let v = Math.min(x[n - 1], Math.max(x[0], i / 1023));
      let k = 0; while (k < n - 2 && v > x[k + 1]) k++;
      const h = dx[k], u = (v - x[k]) / h;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
      tabel[i] = h00 * y[k] + h10 * h * tg[k] + h01 * y[k + 1] + h11 * h * tg[k + 1];
    }
    return v => tabel[Math.round(kl(v) * 1023)];
  }

  function rgbKeHsv(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 1e-6) {
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx > 1e-6 ? d / mx : 0, mx];
  }
  function hsvKeRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60; const i = Math.floor(h) % 6, f = h - Math.floor(h);
    const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  }
  const HUE8 = [["Red", 0], ["Orange", 30], ["Yellow", 60], ["Green", 120], ["Aqua", 180], ["Blue", 240], ["Purple", 270], ["Magenta", 300]];
  function bobotHue(h) {
    const pusat = [...HUE8.map(x => x[1]), 360], w = new Array(8).fill(0);
    for (let k = 0; k < 8; k++) {
      const a = pusat[k], b = pusat[k + 1];
      if (h >= a && h < b) { const u = (h - a) / (b - a); w[k] += 1 - u; w[(k + 1) % 8] += u; }
    }
    return w;
  }
  const warnaHue = hue => hsvKeRgb(hue, 1, 1);

  function siapkan(s) {
    // nilai-nilai yang sama untuk semua titik grid
    let tmp = 0, tnt = 0;
    if ("IncrementalTemperature" in s || "IncrementalTint" in s) { tmp = angka(s, "IncrementalTemperature"); tnt = angka(s, "IncrementalTint"); }
    else if (!["As Shot", "Auto"].includes(s.WhiteBalance || "As Shot") && "Temperature" in s) {
      tmp = Math.max(-100, Math.min(100, (angka(s, "Temperature", 5500) - 5500) / 40)); tnt = angka(s, "Tint");
    }
    const P = {
      kali: [1 + 0.25 * tmp / 100, 1 - 0.2 * tnt / 100, 1 - 0.25 * tmp / 100],
      ev: Math.pow(2, angka(s, "Exposure2012", angka(s, "Exposure"))),
      k: angka(s, "Contrast2012") / 100, dh: angka(s, "Dehaze") / 100,
      hl: angka(s, "Highlights2012") / 100, sh: angka(s, "Shadows2012") / 100,
      wh: angka(s, "Whites2012") / 100, bl: angka(s, "Blacks2012") / 100,
      kurva: Array.isArray(s.ToneCurvePV2012) ? kurvaMonoton(s.ToneCurvePV2012) : null,
      kurvaK: ["Red", "Green", "Blue"].map(c => Array.isArray(s["ToneCurvePV2012" + c]) ? kurvaMonoton(s["ToneCurvePV2012" + c]) : null),
      hue: HUE8.map(([n]) => angka(s, "HueAdjustment" + n) / 100 * 30),
      sat: HUE8.map(([n]) => angka(s, "SaturationAdjustment" + n) / 100),
      lum: HUE8.map(([n]) => angka(s, "LuminanceAdjustment" + n) / 100),
      saturasi: angka(s, "Saturation") / 100, vibrance: angka(s, "Vibrance") / 100,
      bal: angka(s, "SplitToningBalance") / 100 * 0.25,
      abu: String(s.ConvertToGrayscale || "").toLowerCase() === "true",
    };
    const sp = [angka(s, "ParametricShadowSplit", 25) / 100, angka(s, "ParametricMidtoneSplit", 50) / 100, angka(s, "ParametricHighlightSplit", 75) / 100];
    P.param = [["ParametricShadows", sp[0] / 2], ["ParametricDarks", (sp[0] + sp[1]) / 2], ["ParametricLights", (sp[1] + sp[2]) / 2], ["ParametricHighlights", (sp[2] + 1) / 2]]
      .map(([k, c]) => [angka(s, k) / 100, c]).filter(([v]) => v);
    P.zona = [["SplitToningShadow", L => (1 - kl(L + P.bal)) ** 2], ["SplitToningHighlight", L => kl(L + P.bal) ** 2],
              ["ColorGradeMidtone", L => 4 * L * (1 - L)], ["ColorGradeGlobal", () => 1]]
      .map(([k, f]) => [angka(s, k + "Saturation", angka(s, k + "Sat")) / 100, warnaHue(angka(s, k + "Hue")), f]).filter(z => z[0]);
    P.lumZona = [["ColorGradeShadowLum", L => (1 - L) ** 2], ["ColorGradeHighlightLum", L => L ** 2],
                 ["ColorGradeMidtoneLum", L => 4 * L * (1 - L)], ["ColorGradeGlobalLum", () => 1]]
      .map(([k, f]) => [angka(s, k) / 100, f]).filter(z => z[0]);
    return P;
  }

  function titik(r, g, b, P) {
    let x = [r, g, b].map((c, i) => kl(keSrgb(keLinear(c) * P.kali[i] * P.ev)));
    x = x.map(c => c + 0.15 * P.k * Math.sin(2 * Math.PI * c - Math.PI));
    if (P.dh) x = x.map(c => kl((c - 0.06 * P.dh) / (1 - 0.06 * P.dh)));
    let L = kl(luma(...x));
    const dL = P.hl * 0.3 * 4 * L * L * (1 - L) + P.sh * 0.3 * 4 * L * (1 - L) ** 2 + P.wh * 0.15 * L ** 3 + P.bl * 0.15 * (1 - L) ** 3;
    x = x.map(c => c + dL);
    for (const [v, c] of P.param)
      x = x.map(q => q + v * 0.12 * Math.exp(-((kl(q) - c) ** 2) / (2 * 0.16 ** 2)) * kl(q * (1 - q) * 6));
    x = x.map(kl);
    if (P.kurva) x = x.map(P.kurva);
    x = x.map((c, i) => P.kurvaK[i] ? P.kurvaK[i](c) : c);
    let [h, sat, v] = rgbKeHsv(...x.map(kl));
    const w = bobotHue(h);
    let geser = 0, kali = 1, terang = 0;
    for (let k = 0; k < 8; k++) { geser += w[k] * P.hue[k]; kali += w[k] * P.sat[k]; terang += w[k] * P.lum[k]; }
    h += geser; sat *= kali;
    sat = sat * (1 + P.saturasi) * (1 + P.vibrance * (1 - kl(sat)) * 0.8) * (1 + 0.2 * Math.max(P.dh, 0));
    v = v * (1 + terang * 0.35 * kl(sat));
    x = hsvKeRgb(h, kl(sat), kl(v));
    L = luma(...x);
    for (const [st, warna, f] of P.zona) { const m = f(L); x = x.map((c, i) => c + (warna[i] - 0.5) * st * 0.25 * m); }
    for (const [v2, f] of P.lumZona) { const m = f(L); x = x.map(c => c + v2 * 0.12 * m); }
    if (P.abu) { const y = luma(...x); x = [y, y, y]; }
    return x.map(kl);
  }

  // hasil: {ukuran, data: Float32Array (r cepat, lalu g, lalu b — sama dengan urutan .cube), vignette}
  function keLUT(s) {
    const P = siapkan(s), n = UKURAN, data = new Float32Array(n * n * n * 3);
    let i = 0;
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const o = titik(r / (n - 1), g / (n - 1), b / (n - 1), P);
      data[i++] = o[0]; data[i++] = o[1]; data[i++] = o[2];
    }
    return { ukuran: n, data, vignette: angka(s, "PostCropVignetteAmount") / 100 };
  }

  function bacaCube(teks) {
    let ukuran = 0, lo = [0, 0, 0], hi = [1, 1, 1];
    const isi = [];
    for (const baris of teks.split(/\r?\n/)) {
      const b = baris.trim(); if (!b || b[0] === "#") continue;
      const k = b.split(/\s+/);
      if (k[0] === "LUT_3D_SIZE") ukuran = parseInt(k[1]);
      else if (k[0] === "LUT_1D_SIZE") throw new Error("LUT 1D belum didukung, pakai LUT 3D");
      else if (k[0] === "DOMAIN_MIN") lo = k.slice(1, 4).map(Number);
      else if (k[0] === "DOMAIN_MAX") hi = k.slice(1, 4).map(Number);
      else if (/^[-.\d]/.test(k[0]) && k.length >= 3) for (let i = 0; i < 3; i++) isi.push((parseFloat(k[i]) - lo[i]) / ((hi[i] - lo[i]) || 1));
    }
    if (!ukuran || isi.length !== ukuran ** 3 * 3) throw new Error("File .cube tidak valid");
    return { ukuran, data: Float32Array.from(isi), vignette: 0 };
  }

  return { xmpDari, baca, keLUT, bacaCube };
})();
