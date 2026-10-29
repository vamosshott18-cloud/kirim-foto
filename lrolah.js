// Mesin edit ala Lightroom (Basic + HSL + Detail) di browser — port dari lrolah.py versi Mac.
// Beda dengan lrpreset.js (preset → LUT warna saja), ini mengolah foto langsung sehingga efek lokal ikut:
// Texture, Clarity, Shadows/Highlights lokal, Sharpening, Noise Reduction.
// Konstanta KONST dikalibrasi terhadap export Lightroom Classic asli (lihat kalibrasi_lr.py di versi Mac).
"use strict";
const LRO = (() => {
  const S = (label, min, maks, langkah, bawaan, grup) => ({ label, min, maks, langkah, bawaan, grup });
  const SLIDER = {
    IncrementalTemperature: S("Temp", -100, 100, 1, 0, "wb"), IncrementalTint: S("Tint", -100, 100, 1, 0, "wb"),
    Exposure2012: S("Exposure", -5, 5, 0.05, 0, "nada"), Contrast2012: S("Contrast", -100, 100, 1, 0, "nada"),
    Highlights2012: S("Highlights", -100, 100, 1, 0, "nada"), Shadows2012: S("Shadows", -100, 100, 1, 0, "nada"),
    Whites2012: S("Whites", -100, 100, 1, 0, "nada"), Blacks2012: S("Blacks", -100, 100, 1, 0, "nada"),
    Texture: S("Texture", -100, 100, 1, 0, "presence"), Clarity2012: S("Clarity", -100, 100, 1, 0, "presence"),
    Dehaze: S("Dehaze", -100, 100, 1, 0, "presence"), Vibrance: S("Vibrance", -100, 100, 1, 0, "presence"),
    Saturation: S("Saturation", -100, 100, 1, 0, "presence"),
    Sharpness: S("Amount", 0, 150, 1, 0, "tajam"), SharpenRadius: S("Radius", 0.5, 3, 0.1, 1.0, "tajam"),
    SharpenDetail: S("Detail", 0, 100, 1, 25, "tajam"), SharpenEdgeMasking: S("Masking", 0, 100, 1, 0, "tajam"),
    LuminanceSmoothing: S("Luminance", 0, 100, 1, 0, "noise"), ColorNoiseReduction: S("Color", 0, 100, 1, 0, "noise"),
    PostCropVignetteAmount: S("Vignette", -100, 100, 1, 0, "efek"),
  };
  const WARNA8 = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];
  for (const w of WARNA8) {
    SLIDER["HueAdjustment" + w] = S(w, -100, 100, 1, 0, "hue");
    SLIDER["SaturationAdjustment" + w] = S(w, -100, 100, 1, 0, "sat");
    SLIDER["LuminanceAdjustment" + w] = S(w, -100, 100, 1, 0, "lum");
  }
  const KONST = { wb_temp: 0.25, wb_tint: 0.2, base_r: 0.1013, sh: 1.1294, hl: 0.2963, cl_r: 0.0506, cl: 0.8, tx_r: 0.0032, tx: 0.6222,
    ct: 0.18, wh: 0.495, bl: 0.0652, hue: 30.0, sat: 1.2, lum: 0.7875, vib: 0.3556, sh_amt: 1.0, sh_r: 1.0, nr_l: 1.0, nr_c: 1.0 };

  const bawaan = () => Object.fromEntries(Object.entries(SLIDER).map(([k, v]) => [k, v.bawaan]));
  const angka = v => { const n = parseFloat(String(v ?? "").replace("+", "")); return isNaN(n) ? null : n; };
  const g = (s, k, d = 0) => { const v = Number(s[k]); return isFinite(v) ? v : d; };

  // teks XMP (preset / foto hasil export Lightroom) → nilai slider + kurva
  function dariTeks(teks) {
    const m = LR.baca(teks), s = bawaan();
    for (const k in SLIDER) if (k in m && angka(m[k]) !== null) s[k] = angka(m[k]);
    if (!("IncrementalTemperature" in m) && m.Temperature && !["As Shot", "Auto", undefined].includes(m.WhiteBalance)) {
      s.IncrementalTemperature = Math.max(-100, Math.min(100, (angka(m.Temperature) - 5500) / 40));
      s.IncrementalTint = angka(m.Tint) || 0;
    }
    for (const k of ["ParametricShadows", "ParametricDarks", "ParametricLights", "ParametricHighlights", "ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit"])
      if (k in m && angka(m[k]) !== null) s[k] = angka(m[k]);
    for (const k of ["ToneCurvePV2012", "ToneCurvePV2012Red", "ToneCurvePV2012Green", "ToneCurvePV2012Blue"]) if (Array.isArray(m[k])) s[k] = m[k];
    return s;
  }

  /* ---------------- bantuan ---------------- */
  const LIN8 = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN8[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const keSrgb = c => c <= 0 ? 0 : c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  function kernel(sigma) {
    const r = Math.max(1, Math.ceil(sigma * 4)), k = new Float32Array(2 * r + 1); let t = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); t += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= t;
    return { k, r };
  }
  const refl = (i, n) => i < 0 ? -i - 1 : i >= n ? 2 * n - i - 1 : i;   // tepi dipantulkan (BORDER_REFLECT)
  function gaussExact(src, W, H, sigma) {
    const { k, r } = kernel(sigma), tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { const o = y * W;
      for (let x = 0; x < W; x++) { let s = 0; for (let j = -r; j <= r; j++) s += src[o + refl(x + j, W)] * k[j + r]; tmp[o + x] = s; } }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let s = 0; for (let j = -r; j <= r; j++) s += tmp[refl(y + j, H) * W + x] * k[j + r]; out[y * W + x] = s; }
    return out;
  }
  function boxPass(src, dst, W, H, r, horiz) {   // rata-rata geser O(n), tepi dipantulkan
    const n = horiz ? W : H, m = horiz ? H : W, st = horiz ? 1 : W, ln = horiz ? W : 1, d = 2 * r + 1;
    for (let j = 0; j < m; j++) {
      const b = j * ln; let s = 0;
      for (let i = -r - 1; i < r; i++) s += src[b + refl(i, n) * st];
      for (let i = 0; i < n; i++) { s += src[b + refl(i + r, n) * st] - src[b + refl(i - r - 1, n) * st]; dst[b + i * st] = s / d; }
    }
  }
  function gauss(src, W, H, sigma) {
    if (sigma < 0.3) return src;
    if (sigma <= 3) return gaussExact(src, W, H, sigma);
    const wIdeal = Math.sqrt(12 * sigma * sigma / 3 + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;   // 3 kali box ≈ gauss
    const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4), m = Math.round(mIdeal);
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    for (let i = 0; i < 3; i++) { const r = ((i < m ? wl : wl + 2) - 1) / 2;
      boxPass(a, b, W, H, r, true); boxPass(b, a, W, H, r, false); }
    return a;
  }
  function boxR(p, W, H, r) { const t = new Float32Array(p.length), o = new Float32Array(p.length); boxPass(p, t, W, H, r, true); boxPass(t, o, W, H, r, false); return o; }
  function guided(p, W, H, r, eps) {
    const pp = p.map(v => v * v), m = boxR(p, W, H, r), mm = boxR(pp, W, H, r), a = new Float32Array(p.length), b = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) { const v = mm[i] - m[i] * m[i]; a[i] = v / (v + eps); b[i] = m[i] - a[i] * m[i]; }
    const ma = boxR(a, W, H, r), mb = boxR(b, W, H, r), o = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) o[i] = ma[i] * p[i] + mb[i];
    return o;
  }

  function kurvaMonoton(titik) {
    const t = [...new Map(titik.map(p => [p[0], p])).values()].sort((a, b) => a[0] - b[0]);
    const x = t.map(p => p[0] / 255), y = t.map(p => p[1] / 255), n = x.length;
    if (n < 2) return v => v;
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx.push(x[i + 1] - x[i]); m.push((y[i + 1] - y[i]) / Math.max(dx[i], 1e-9)); }
    const tg = [m[0]]; for (let i = 1; i < n - 1; i++) tg.push((m[i - 1] + m[i]) / 2); tg.push(m[n - 2]);
    for (let k = 0; k < n - 1; k++) {
      if (m[k] === 0) { tg[k] = tg[k + 1] = 0; continue; }
      const a = tg[k] / m[k], b = tg[k + 1] / m[k];
      if (a * a + b * b > 9) { const tt = 3 / Math.sqrt(a * a + b * b); tg[k] = tt * a * m[k]; tg[k + 1] = tt * b * m[k]; }
    }
    return v => {
      v = Math.min(x[n - 1], Math.max(x[0], v)); let k = 0; while (k < n - 2 && v > x[k + 1]) k++;
      const h = dx[k], u = (v - x[k]) / h;
      return (2 * u ** 3 - 3 * u ** 2 + 1) * y[k] + (u ** 3 - 2 * u ** 2 + u) * h * tg[k] + (-2 * u ** 3 + 3 * u ** 2) * y[k + 1] + (u ** 3 - u ** 2) * h * tg[k + 1];
    };
  }

  // Contrast, Whites, Blacks, kurva parametrik & titik → 3 tabel 4096 (sRGB)
  function kurvaGlobal(s, K) {
    const ct = g(s, "Contrast2012") / 100, wh = g(s, "Whites2012") / 100, bl = g(s, "Blacks2012") / 100;
    const sp = [g(s, "ParametricShadowSplit", 25) / 100, g(s, "ParametricMidtoneSplit", 50) / 100, g(s, "ParametricHighlightSplit", 75) / 100];
    const param = [["ParametricShadows", sp[0] / 2], ["ParametricDarks", (sp[0] + sp[1]) / 2], ["ParametricLights", (sp[1] + sp[2]) / 2], ["ParametricHighlights", (sp[2] + 1) / 2]]
      .map(([k, c]) => [g(s, k) / 100, c]).filter(([v]) => v);
    const kurva = Array.isArray(s.ToneCurvePV2012) ? kurvaMonoton(s.ToneCurvePV2012) : null;
    const kk = ["Red", "Green", "Blue"].map(c => Array.isArray(s["ToneCurvePV2012" + c]) ? kurvaMonoton(s["ToneCurvePV2012" + c]) : null);
    const T = [new Float32Array(4096), new Float32Array(4096), new Float32Array(4096)];
    for (let i = 0; i < 4096; i++) {
      let x = i / 4095;
      if (wh) x = x + wh * K.wh * x ** 3 * (1 - 0.5 * x);
      if (bl) x = x + bl * K.bl * (1 - x) ** 3 * (1 - 0.5 * (1 - x));
      if (ct) x = x + ct * K.ct * Math.sin(2 * Math.PI * Math.min(1, Math.max(0, x)) - Math.PI);
      for (const [v, c] of param) { const xc = Math.min(1, Math.max(0, x)); x = x + v * 0.12 * Math.exp(-((xc - c) ** 2) / (2 * 0.16 ** 2)) * Math.min(1, Math.max(0, xc * (1 - xc) * 6)); }
      x = Math.min(1, Math.max(0, x));
      if (kurva) x = kurva(x);
      for (let c = 0; c < 3; c++) T[c][i] = kk[c] ? kk[c](x) : x;
    }
    return T;
  }

  // HSL 8 warna + Vibrance + Saturation → LUT 3D {ukuran, data} (urutan .cube: r tercepat)
  function lutWarna(s, K, n = 33) {
    const HUE = [0, 30, 60, 120, 180, 240, 270, 300, 360];
    const geser = WARNA8.map(w => g(s, "HueAdjustment" + w) / 100 * K.hue), kali = WARNA8.map(w => g(s, "SaturationAdjustment" + w) / 100 * K.sat);
    const terang = WARNA8.map(w => g(s, "LuminanceAdjustment" + w) / 100);
    const sat0 = g(s, "Saturation") / 100, vib = g(s, "Vibrance") / 100, dh = Math.max(0, g(s, "Dehaze") / 100);
    const data = new Float32Array(n * n * n * 3); let o = 0;
    for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
      const r = ri / (n - 1), gg = gi / (n - 1), b = bi / (n - 1);
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
      let h = 0;
      if (d > 1e-6) { if (mx === r) h = ((gg - b) / d) % 6; else if (mx === gg) h = (b - r) / d + 2; else h = (r - gg) / d + 4; h *= 60; if (h < 0) h += 360; }
      let sat = mx > 1e-6 ? d / mx : 0, v = mx;
      let gs = 0, kl = 1, tr = 0;
      for (let k = 0; k < 8; k++) if (h >= HUE[k] && h < HUE[k + 1]) { const u = (h - HUE[k]) / (HUE[k + 1] - HUE[k]);
        const k2 = (k + 1) % 8; gs = geser[k] * (1 - u) + geser[k2] * u; kl = 1 + kali[k] * (1 - u) + kali[k2] * u; tr = terang[k] * (1 - u) + terang[k2] * u; break; }
      const j0 = Math.min(1, Math.max(0, sat));
      sat = sat * kl * (1 + sat0) * (1 + vib * (1 - j0) * K.vib) * (1 + 0.2 * dh);
      v = v * (1 + tr * K.lum * j0);
      sat = Math.min(1, Math.max(0, sat)); v = Math.min(1, Math.max(0, v));
      let hh = (((h + gs) % 360) + 360) % 360 / 60; const i = Math.floor(hh) % 6, f = hh - Math.floor(hh);
      const p = v * (1 - sat), q = v * (1 - sat * f), t = v * (1 - sat * (1 - f));
      const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
      data[o++] = rgb[0]; data[o++] = rgb[1]; data[o++] = rgb[2];
    }
    return { ukuran: n, data, vignette: 0 };
  }

  /* ---------------- utama: olah kanvas di tempat, kembalikan LUT warna (diterapkan engine lewat GPU) ---------------- */
  function olah(c, s, skala = 1, K0 = null) {
    const K = Object.assign({}, KONST, K0 || {});
    const W = c.width, H = c.height, N = W * H, ctx = c.getContext("2d", { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, W, H), p = im.data;

    // 1. noise reduction: luminance (bilateral pada Y) + color (blur kroma)
    const lu = g(s, "LuminanceSmoothing") / 100, wa = g(s, "ColorNoiseReduction") / 100;
    if (lu > 0 || wa > 0) {
      const Y = new Float32Array(N), Cr = new Float32Array(N), Cb = new Float32Array(N);
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        const r = p[j] / 255, gg = p[j + 1] / 255, b = p[j + 2] / 255, y = 0.299 * r + 0.587 * gg + 0.114 * b;
        Y[i] = y; Cr[i] = (r - y) * 0.713 + 0.5; Cb[i] = (b - y) * 0.564 + 0.5;
      }
      let Yn = Y;
      if (lu > 0) {
        const d = Math.max(3, Math.round(5 * Math.max(skala, 0.3)) | 1), rr = d >> 1, sc = 0.02 + 0.10 * lu * K.nr_l, ss = d;
        const wsp = []; for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx + dy * dy <= rr * rr) wsp.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss))]);
        const a = Math.min(1, lu * 2.5 * K.nr_l), inv = -1 / (2 * sc * sc);
        Yn = new Float32Array(N);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, v = Y[i]; let t = 0, wt = 0;
          for (const [dx, dy, w0] of wsp) { const q = Y[refl(y + dy, H) * W + refl(x + dx, W)], dd = q - v, w = w0 * Math.exp(dd * dd * inv); t += w * q; wt += w; }
          Yn[i] = v + (t / wt - v) * a;
        }
      }
      let Crn = Cr, Cbn = Cb;
      if (wa > 0) { const sg = Math.max(0.5, 6 * wa * K.nr_c * Math.max(skala, 0.25)); Crn = gauss(Cr, W, H, sg); Cbn = gauss(Cb, W, H, sg); }
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        const y = Yn[i], cr = Crn[i] - 0.5, cb = Cbn[i] - 0.5;
        p[j] = Math.round(Math.min(1, Math.max(0, y + 1.403 * cr)) * 255);
        p[j + 1] = Math.round(Math.min(1, Math.max(0, y - 0.714 * cr - 0.344 * cb)) * 255);
        p[j + 2] = Math.round(Math.min(1, Math.max(0, y + 1.773 * cb)) * 255);
      }
    }

    // 2. white balance + exposure (linear)
    const tmp = g(s, "IncrementalTemperature") / 100, tnt = g(s, "IncrementalTint") / 100, ev = Math.pow(2, g(s, "Exposure2012"));
    const kal = [(1 + K.wb_temp * tmp) * ev, (1 - K.wb_tint * tnt) * ev, (1 - K.wb_temp * tmp) * ev];

    // 3. nada lokal: Shadows/Highlights + Clarity + Texture + Dehaze pada log-luminans
    const sh = g(s, "Shadows2012") / 100, hl = g(s, "Highlights2012") / 100, cl = g(s, "Clarity2012") / 100, tx = g(s, "Texture") / 100, dh = g(s, "Dehaze") / 100;
    let rasio = null;
    if (sh || hl || cl || tx || dh) {
      const l = new Float32Array(N), pendek = Math.min(W, H);
      for (let i = 0, j = 0; i < N; i++, j += 4)
        l[i] = Math.log2(Math.max(1e-5, LIN8[p[j]] * kal[0] * 0.2126 + LIN8[p[j + 1]] * kal[1] * 0.7152 + LIN8[p[j + 2]] * kal[2] * 0.0722));
      // lapisan dasar halus di resolusi kecil
      const f = Math.min(1, 640 / Math.max(W, H)), w2 = Math.max(1, Math.round(W * f)), h2 = Math.max(1, Math.round(H * f));
      const kecil = new Float32Array(w2 * h2), hit = new Float32Array(w2 * h2);
      for (let y = 0; y < H; y++) { const yy = Math.min(h2 - 1, Math.floor(y * h2 / H));
        for (let x = 0; x < W; x++) { const k = yy * w2 + Math.min(w2 - 1, Math.floor(x * w2 / W)); kecil[k] += l[y * W + x]; hit[k]++; } }
      for (let k = 0; k < kecil.length; k++) kecil[k] /= hit[k] || 1;
      const dasarK = guided(kecil, w2, h2, Math.max(2, Math.floor(K.base_r * Math.min(w2, h2))), 0.25);
      const dl = new Float32Array(N);
      const blBesar = cl ? gauss(l, W, H, Math.max(1, K.cl_r * pendek)) : null;
      const rt = Math.max(0.8, K.tx_r * pendek), tA = tx ? gauss(l, W, H, rt * 0.25) : null, tB = tx ? gauss(l, W, H, rt) : null;
      for (let y = 0; y < H; y++) {
        const fy = Math.min(h2 - 1, Math.max(0, (y + 0.5) * h2 / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h2 - 1, y0 + 1), vy = fy - y0;
        for (let x = 0; x < W; x++) {
          const fx = Math.min(w2 - 1, Math.max(0, (x + 0.5) * w2 / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w2 - 1, x0 + 1), vx = fx - x0;
          const dasar = (dasarK[y0 * w2 + x0] * (1 - vx) + dasarK[y0 * w2 + x1] * vx) * (1 - vy) + (dasarK[y1 * w2 + x0] * (1 - vx) + dasarK[y1 * w2 + x1] * vx) * vy;
          let bL = Math.min(1, Math.max(0, (dasar + 10) / 10)); bL = bL * bL;
          const i = y * W + x; let v = 0;
          if (sh) v += sh * K.sh * Math.pow(1 - bL, 2.5);
          if (hl) v += hl * K.hl * Math.pow(bL, 2.5);
          if (dh) v -= dh * 0.6 * (1 - bL) ** 3;
          if (cl) v += cl * K.cl * (l[i] - blBesar[i]) * (0.4 + 0.6 * 4 * bL * (1 - bL));
          if (tx) v += tx * K.tx * (tA[i] - tB[i]);
          dl[i] = v;
        }
      }
      rasio = dl; for (let i = 0; i < N; i++) rasio[i] = Math.pow(2, dl[i]);
    }

    // 4. kembali ke sRGB + kurva global
    const T = kurvaGlobal(s, K);
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      const r = rasio ? rasio[i] : 1;
      for (let ch = 0; ch < 3; ch++) {
        const v = Math.min(1, keSrgb(LIN8[p[j + ch]] * kal[ch] * r));
        p[j + ch] = Math.round(Math.min(1, Math.max(0, T[ch][Math.min(4095, Math.max(0, (v * 4095) | 0))])) * 255);
      }
    }

    // 5. sharpening pada luminans
    const amt = g(s, "Sharpness") / 150 * K.sh_amt;
    if (amt > 0) {
      const rad = Math.max(0.35, g(s, "SharpenRadius", 1) * skala * K.sh_r), det = g(s, "SharpenDetail", 25) / 100, msk = g(s, "SharpenEdgeMasking") / 100;
      const Y = new Float32Array(N);
      for (let i = 0, j = 0; i < N; i++, j += 4) Y[i] = (p[j] * 0.2126 + p[j + 1] * 0.7152 + p[j + 2] * 0.0722) / 255;
      const bY = gauss(Y, W, H, rad), batas = 0.02 + 0.25 * (1 - det), kuat = amt * 2.2 * (0.6 + 0.8 * det) * 255;
      let tepi = null;
      if (msk > 0) { const y1 = gauss(Y, W, H, 1.0); tepi = new Float32Array(N);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const gx = y1[y * W + refl(x + 1, W)] - y1[y * W + refl(x - 1, W)], gy = y1[refl(y + 1, H) * W + x] - y1[refl(y - 1, H) * W + x];
          tepi[y * W + x] = Math.min(1, Math.max(0, (Math.hypot(gx, gy) * 4 - msk * 0.15) / 0.1)); } }
      for (let i = 0, j = 0; i < N; i++, j += 4) {
        let hp = Math.min(batas, Math.max(-batas, Y[i] - bY[i])) * kuat; if (tepi) hp *= tepi[i];
        p[j] = Math.min(255, Math.max(0, p[j] + hp)); p[j + 1] = Math.min(255, Math.max(0, p[j + 1] + hp)); p[j + 2] = Math.min(255, Math.max(0, p[j + 2] + hp));
      }
    }

    // 6. vignette
    const vg = g(s, "PostCropVignetteAmount") / 100;
    if (vg) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / Math.SQRT2, m = Math.min(1, Math.max(0, (d - 0.35) / 0.65)) ** 2, j = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) p[j + ch] = vg < 0 ? p[j + ch] * (1 + vg * 0.8 * m) : p[j + ch] + (255 - p[j + ch]) * (vg * 0.8 * m);
    }
    ctx.putImageData(im, 0, 0);
    return lutWarna(s, K);
  }

  return { SLIDER, WARNA8, KONST, bawaan, dariTeks, olah };
})();
