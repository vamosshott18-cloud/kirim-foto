// Mesin olah foto di browser: buka (termasuk HEIC) → ubah ukuran → preset (LUT, GPU) → watermark → teks custom
// → JPEG (mutu / target MB) → salin EXIF (tanggal jepret dll.). Semua terjadi di perangkat, foto tidak dikirim ke server lain.
"use strict";
const Mesin = (() => {
  const UA = navigator.userAgent;
  const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const MAKS_PIKSEL = IOS ? 16_000_000 : 100_000_000;   // batas kanvas Safari iPhone ±16,7 MP

  /* ---------------- EXIF: ambil segmen APP1 (orientasi dinormalkan) + tanggal jepret ---------------- */
  function exifDari(buf) {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return { app1: null, tanggal: null };
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {         // "Exif"
        const app1 = new Uint8Array(buf.slice(o, o + 2 + len));
        const t = 10, dv = new DataView(app1.buffer);                     // awal TIFF di dalam segmen
        const le = dv.getUint16(t) === 0x4949;
        const u16 = p => dv.getUint16(p, le), u32 = p => dv.getUint32(p, le);
        let tanggal = null;
        const bacaIFD = (ifd, cb) => { const n = u16(t + ifd); for (let i = 0; i < n; i++) cb(t + ifd + 2 + i * 12); };
        try {
          let exifIFD = 0;
          bacaIFD(u32(t + 4), p => {
            const tag = u16(p);
            if (tag === 0x0112) dv.setUint16(p + 8, 1, le);              // orientasi sudah diterapkan → 1
            if (tag === 0x8769) exifIFD = u32(p + 8);
          });
          if (exifIFD) bacaIFD(exifIFD, p => {
            if (u16(p) === 0x9003) {
              const s = new TextDecoder().decode(app1.subarray(t + u32(p + 8), t + u32(p + 8) + 19));
              const m2 = s.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
              if (m2) tanggal = new Date(+m2[1], m2[2] - 1, +m2[3], +m2[4], +m2[5], +m2[6]);
            }
          });
        } catch (e) { /* EXIF rusak → abaikan */ }
        return { app1, tanggal };
      }
      if (m === 0xFFDA) break;
      o += 2 + len;
    }
    return { app1: null, tanggal: null };
  }
  async function sisipExif(blob, app1) {
    if (!app1) return blob;
    const b = new Uint8Array(await blob.arrayBuffer());
    return new Blob([b.subarray(0, 2), app1, b.subarray(2)], { type: "image/jpeg" });
  }

  /* ---------------- buka gambar ---------------- */
  let heicSiap = null;
  function muatSkrip(src) {
    return new Promise((ok, gagal) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = gagal; document.head.appendChild(s); });
  }
  const adalahHeic = f => /\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type);
  async function bukaGambar(file) {
    let blob = file;
    const img = new Image();
    const coba = async b => { const url = URL.createObjectURL(b); try { img.src = url; await img.decode(); return true; } catch (e) { return false; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); } };
    if (await coba(blob)) return img;                                   // <img> menerapkan orientasi EXIF otomatis
    if (adalahHeic(file)) {                                              // Chrome/Windows/Android belum bisa HEIC
      heicSiap = heicSiap || muatSkrip("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js");
      await heicSiap;
      blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 });
      if (await coba(blob)) return img;
    }
    throw new Error("Foto rusak / format tidak didukung");
  }

  /* ---------------- ukuran ---------------- */
  function targetUkuran(W, H, a) {
    let tw = W, th = H, isi = "regang";
    if (a.ukuran === "sisi") { let s = a.sisi / Math.max(W, H); if (s > 1 && !a.perbesar) s = 1; tw = W * s; th = H * s; }
    else if (a.ukuran === "persen") { const s = Math.max(10, Math.min(400, a.persen)) / 100; tw = W * s; th = H * s; }
    else if (a.ukuran === "piksel") {
      let pw = Math.max(1, a.piksel_w), ph = Math.max(1, a.piksel_h);
      if (a.piksel_putar !== false && (W < H) !== (pw < ph) && pw !== ph) [pw, ph] = [ph, pw];
      isi = a.piksel_isi || "pas";
      if (isi === "pas") { let s = Math.min(pw / W, ph / H); if (s > 1 && !a.perbesar) s = 1; tw = W * s; th = H * s; }
      else { tw = pw; th = ph; }
    }
    let dibatasi = false;
    if (tw * th > MAKS_PIKSEL) { const s = Math.sqrt(MAKS_PIKSEL / (tw * th)); tw *= s; th *= s; dibatasi = true; }
    return { tw: Math.max(1, Math.round(tw)), th: Math.max(1, Math.round(th)), isi, dibatasi };
  }

  function kanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function gambarUlang(src, W, H, tw, th, isi) {
    let sx = 0, sy = 0, sw = W, sh = H;
    if (isi === "penuhi") {                                              // potong tengah supaya pas
      const s = Math.max(tw / W, th / H); sw = tw / s; sh = th / s; sx = (W - sw) / 2; sy = (H - sh) / 2;
    }
    let sumber = src, cw = sw, ch = sh, ox = sx, oy = sy;
    while (cw / 2 >= tw * 1.05 && ch / 2 >= th * 1.05) {               // turun bertahap supaya halus
      const c = kanvas(Math.round(cw / 2), Math.round(ch / 2)), x = c.getContext("2d");
      x.imageSmoothingQuality = "high"; x.drawImage(sumber, ox, oy, cw, ch, 0, 0, c.width, c.height);
      if (sumber !== src) sumber.width = 0;
      sumber = c; cw = c.width; ch = c.height; ox = 0; oy = 0;
    }
    const out = kanvas(tw, th), ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high"; ctx.drawImage(sumber, ox, oy, cw, ch, 0, 0, tw, th);
    if (sumber !== src) sumber.width = 0;
    return out;
  }

  /* ---------------- preset (LUT 3D) lewat WebGL2, cadangan CPU ---------------- */
  let gl = null, glKanvas = null, prog = null, lutAktif = null, texLut = null, texImg = null, MAKS_TEX = 4096;
  function siapGL() {
    if (gl !== null) return gl;
    glKanvas = kanvas(1, 1);
    gl = glKanvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false }) || false;
    if (!gl) return gl;
    MAKS_TEX = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const vs = `#version 300 es
      in vec2 p; out vec2 uv; void main(){ uv = vec2((p.x+1.0)/2.0, (1.0-p.y)/2.0); gl_Position = vec4(p,0.,1.); }`;
    const fs = `#version 300 es
      precision highp float; precision highp sampler3D;
      uniform sampler2D img; uniform sampler3D lut; uniform float k; uniform float n;
      in vec2 uv; out vec4 o;
      void main(){ vec4 c = texture(img, uv); vec3 p = c.rgb*((n-1.0)/n) + 0.5/n;
        o = vec4(mix(c.rgb, texture(lut, p).rgb, k), 1.0); }`;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = false; return gl; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    texImg = gl.createTexture(); texLut = gl.createTexture();
    return gl;
  }
  function pasangLUT(lut) {
    if (lutAktif === lut) return;
    const n = lut.ukuran, rgba = new Float32Array(n * n * n * 4);
    for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4) { rgba[j] = lut.data[i]; rgba[j + 1] = lut.data[i + 1]; rgba[j + 2] = lut.data[i + 2]; rgba[j + 3] = 1; }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, texLut);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, "lut"), 1); gl.uniform1f(gl.getUniformLocation(prog, "n"), n);
    lutAktif = lut;
  }
  function terapkanLUT(c, lut, kekuatan) {
    if (siapGL()) {
      pasangLUT(lut);
      gl.uniform1f(gl.getUniformLocation(prog, "k"), kekuatan);
      const ctx = c.getContext("2d"), T = MAKS_TEX;
      for (let y = 0; y < c.height; y += T) for (let x = 0; x < c.width; x += T) {   // per petak (batas tekstur GPU)
        const w = Math.min(T, c.width - x), h = Math.min(T, c.height - y);
        const petak = kanvas(w, h); petak.getContext("2d").drawImage(c, x, y, w, h, 0, 0, w, h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, petak);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(gl.getUniformLocation(prog, "img"), 0);
        glKanvas.width = w; glKanvas.height = h; gl.viewport(0, 0, w, h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        ctx.drawImage(glKanvas, x, y); petak.width = 0;
      }
    } else {                                                             // tanpa GPU: hitung di CPU (lebih lambat)
      const ctx = c.getContext("2d"), d = ctx.getImageData(0, 0, c.width, c.height), p = d.data, n = lut.ukuran, L = lut.data;
      const ambil = (r, g, b, ch) => L[((b * n + g) * n + r) * 3 + ch];
      for (let i = 0; i < p.length; i += 4) {
        const f = [p[i], p[i + 1], p[i + 2]].map(v => v / 255 * (n - 1)), a = f.map(Math.floor).map(v => Math.min(v, n - 2)), t = f.map((v, j) => v - a[j]);
        for (let ch = 0; ch < 3; ch++) {
          let s = 0;
          for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
            s += ambil(a[0] + dx, a[1] + dy, a[2] + dz, ch) * (dx ? t[0] : 1 - t[0]) * (dy ? t[1] : 1 - t[1]) * (dz ? t[2] : 1 - t[2]);
          p[i + ch] = p[i + ch] + (s * 255 - p[i + ch]) * kekuatan;
        }
      }
      ctx.putImageData(d, 0, 0);
    }
    if (lut.vignette) {
      const ctx = c.getContext("2d"), r = Math.hypot(c.width, c.height) / 2;
      const g = ctx.createRadialGradient(c.width / 2, c.height / 2, r * 0.35, c.width / 2, c.height / 2, r);
      const kuat = Math.min(1, Math.abs(lut.vignette) * 0.8 * kekuatan);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, lut.vignette < 0 ? `rgba(0,0,0,${kuat})` : `rgba(255,255,255,${kuat})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    }
  }

  /* ---------------- watermark logo + teks ---------------- */
  const FONT = "Arial, Helvetica, 'Liberation Sans', Arimo, Roboto, sans-serif";   // font umum di semua perangkat, mudah dibaca
  function posisiXY(pos, W, H, w, h, m) {
    const [a, b] = pos === "tengah" ? ["tengah", "tengah"] : pos.split("-");
    const x = { kiri: m, kanan: W - w - m }[a] ?? (W - w) / 2;
    const y = { atas: m, bawah: H - h - m }[b] ?? (H - h) / 2;
    return [Math.max(0, x), Math.max(0, y)];
  }
  const _trim = new WeakMap();   // logo yang sudah dipotong pinggiran transparannya (sekali per logo)
  function potongTransparan(img) {
    if (_trim.has(img)) return _trim.get(img);
    const hasil = potongTransparan0(img); _trim.set(img, hasil); return hasil;
  }
  function potongTransparan0(img) {
    const c = kanvas(img.naturalWidth || img.width, img.naturalHeight || img.height), x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 8) {
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return c;
    const o = kanvas(x1 - x0 + 1, y1 - y0 + 1); o.getContext("2d").drawImage(c, -x0, -y0); c.width = 0; return o;
  }
  function blokWm(wm, lebar, info, logo) {
    const bagian = [];
    if (logo) { const h = Math.max(1, Math.round(logo.height * lebar / logo.width)); bagian.push({ gambar: logo, w: lebar, h }); }
    const tulis = (teks, maksH) => {
      const c0 = kanvas(1, 1).getContext("2d"); let uk = Math.max(8, Math.floor(maksH));
      c0.font = `700 ${uk}px ${FONT}`; const w0 = c0.measureText(teks).width;
      if (w0 > lebar) uk = Math.max(8, Math.floor(uk * lebar / w0));
      c0.font = `700 ${uk}px ${FONT}`;
      return { teks, uk, w: Math.ceil(c0.measureText(teks).width) + uk * 0.2, h: Math.ceil(uk * 1.25) };
    };
    if (wm.teks) bagian.push(tulis(wm.teks, lebar * 0.28));
    if (info) bagian.push(tulis(info, lebar * 0.09));
    if (!bagian.length) return null;
    const jarak = Math.max(2, Math.round(lebar / 30));
    const W = Math.max(...bagian.map(b => b.w)), H = bagian.reduce((s, b) => s + b.h, 0) + jarak * (bagian.length - 1);
    const c = kanvas(Math.ceil(W), Math.ceil(H)), x = c.getContext("2d");
    x.globalAlpha = (wm.opasitas ?? 70) / 100; let y = 0;
    for (const b of bagian) {
      if (b.gambar) x.drawImage(b.gambar, (W - b.w) / 2, y, b.w, b.h);
      else {
        x.font = `700 ${b.uk}px ${FONT}`; x.textBaseline = "top"; x.textAlign = "center";
        x.shadowColor = "rgba(0,0,0,0.55)"; x.shadowBlur = b.uk / 8; x.shadowOffsetY = b.uk / 25;
        x.fillStyle = "#fff"; x.fillText(b.teks, W / 2, y + b.uk * 0.1); x.shadowColor = "transparent";
      }
      y += b.h + jarak;
    }
    return c;
  }
  function pasangWm(c, wm, logoAsli, logoPortrait, info) {
    const W = c.width, H = c.height, ctx = c.getContext("2d"), pos = wm.posisi || "kanan-bawah";
    if (pos === "penuh") {
      const lg = (H > W && logoPortrait) ? logoPortrait : logoAsli;
      if (lg) {
        const lw = lg.naturalWidth || lg.width, lh = lg.naturalHeight || lg.height, isi = wm.isi || "regang";
        let dw = W, dh = H;
        if (isi === "pas") { const s = Math.min(W / lw, H / lh); dw = lw * s; dh = lh * s; }
        else if (isi === "penuhi") { const s = Math.max(W / lw, H / lh); dw = lw * s; dh = lh * s; }
        ctx.globalAlpha = (wm.opasitas ?? 70) / 100; ctx.drawImage(lg, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.globalAlpha = 1;
      }
      if (wm.teks || info) pasangWm(c, { ...wm, posisi: "kanan-bawah" }, null, null, info);
      return;
    }
    const logo = logoAsli ? potongTransparan(logoAsli) : null;
    const blok = blokWm(wm, Math.max(20, Math.round(W * (wm.ukuran ?? 20) / 100)), info, logo);
    if (!blok) return;
    const m = Math.round(Math.min(W, H) * 0.03);
    if (pos === "ulang") {
      const sx = blok.width * 1.6, sy = blok.height * 2.2;
      ctx.save();
      for (let j = 0, y = -blok.height; y < H + blok.height; y += sy, j++)
        for (let x = -(j % 2) * sx / 2; x < W + blok.width; x += sx) {
          ctx.save(); ctx.translate(x + blok.width / 2, y + blok.height / 2); ctx.rotate(-Math.PI / 6);
          ctx.drawImage(blok, -blok.width / 2, -blok.height / 2); ctx.restore();
        }
      ctx.restore();
    } else ctx.drawImage(blok, ...posisiXY(pos, W, H, blok.width, blok.height, m));
  }

  const KODE = ["nama_baru", "nama_file", "no", "total", "folder", "subfolder", "tanggal", "jam"];
  function isiLabel(t, k) { for (const n of KODE) t = t.split("{" + n + "}").join(k[n] ?? ""); return t; }
  function pasangLabel(c, lb, ktx) {
    const teks = isiLabel(lb.teks || "", ktx).replace(/^\n+|\n+$/g, "");
    if (!teks.trim()) return;
    const W = c.width, H = c.height, ctx = c.getContext("2d");
    const uk = Math.max(8, Math.round(Math.min(W, H) * (lb.ukuran ?? 3) / 100)), tebal = lb.tebal !== false ? 700 : 400;
    ctx.font = `${tebal} ${uk}px ${FONT}`;
    const baris = teks.split("\n"), jarak = uk * 1.28, pos = lb.posisi || "kiri-bawah";
    const lebar = Math.max(...baris.map(b => ctx.measureText(b).width));
    const pad = lb.latar === "kotak" ? uk * 0.5 : uk * 0.15;
    const bw = lebar + pad * 2, bh = jarak * baris.length - (jarak - uk) + pad * 2 + uk * 0.15;
    const [x, y] = posisiXY(pos, W, H, bw, bh, Math.round(Math.min(W, H) * 0.03));
    const warna = lb.warna || "#ffffff";
    const gelap = (parseInt(warna.slice(1, 3), 16) + parseInt(warna.slice(3, 5), 16) + parseInt(warna.slice(5, 7), 16)) / 3 < 128;
    ctx.save(); ctx.globalAlpha = (lb.opasitas ?? 90) / 100;
    if (lb.latar === "kotak") {
      ctx.fillStyle = gelap ? "rgba(255,255,255,0.67)" : "rgba(0,0,0,0.47)";
      const r = uk / 3; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, bh, r) : ctx.rect(x, y, bw, bh); ctx.fill();
    } else if (lb.latar === "bayangan") {
      ctx.shadowColor = gelap ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.65)"; ctx.shadowBlur = uk / 7; ctx.shadowOffsetY = uk / 20;
    }
    const rata = pos.startsWith("kiri") ? "left" : pos.startsWith("kanan") ? "right" : "center";
    ctx.textAlign = rata; ctx.textBaseline = "top"; ctx.fillStyle = warna;
    const tx = rata === "left" ? x + pad : rata === "right" ? x + bw - pad : x + bw / 2;
    baris.forEach((b, i) => ctx.fillText(b, tx, y + pad + i * jarak));
    ctx.restore();
  }

  /* ---------------- JPEG ---------------- */
  const keBlob = (c, q) => new Promise(ok => c.toBlob(ok, "image/jpeg", q));
  async function keJpeg(c, a, pratinjau) {
    if (a.kompres === "mb" && !pratinjau) {
      const target = Math.max(0.05, a.mb) * 1048576;
      for (let ulang = 0; ulang < 5; ulang++) {
        let b = await keBlob(c, 0.95); if (b.size <= target) return b;
        let lo = 0.3, hi = 0.94, terbaik = null;
        for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; b = await keBlob(c, mid); if (b.size <= target) { terbaik = b; lo = mid; } else hi = mid; }
        if (terbaik) return terbaik;
        const kecil = await keBlob(c, 0.3), s = Math.sqrt(target / kecil.size) * 0.92;
        const c2 = gambarUlang(c, c.width, c.height, Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)), "regang");
        c.width = 0; c = c2;
      }
      return keBlob(c, 0.3);
    }
    const q = (a.kompres === "mutu" ? a.jpeg : 95) / 100;
    return keBlob(c, pratinjau && a.kompres === "mb" ? 0.85 : q);
  }

  /* ---------------- alur lengkap ---------------- */
  // aset = {lut, logo, logoPortrait} sudah dimuat; ktx = isian teks custom
  async function olah(file, a, aset, ktx, pratinjauSisi = 0) {
    const buf = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name) ? await file.arrayBuffer() : null;
    const ex = buf ? exifDari(buf) : { app1: null, tanggal: null };
    const img = await bukaGambar(file);
    const W = img.naturalWidth, H = img.naturalHeight;
    let { tw, th, isi, dibatasi } = targetUkuran(W, H, a);
    if (pratinjauSisi) { const s = Math.min(1, pratinjauSisi / Math.max(tw, th)); tw = Math.max(1, Math.round(tw * s)); th = Math.max(1, Math.round(th * s)); }
    const c = gambarUlang(img, W, H, tw, th, isi);
    img.src = "";
    if (aset.lut && a.lut.kekuatan > 0) terapkanLUT(c, aset.lut, a.lut.kekuatan / 100);
    const tgl = ex.tanggal || new Date(file.lastModified || Date.now());
    const dua = n => String(n).padStart(2, "0");
    const tanggal = `${dua(tgl.getDate())}/${dua(tgl.getMonth() + 1)}/${tgl.getFullYear()}`, jam = `${dua(tgl.getHours())}:${dua(tgl.getMinutes())}`;
    if (a.wm.aktif) {
      const info = [a.wm.nama_file ? file.name : "", a.wm.jam ? `${tanggal} ${jam}` : ""].filter(Boolean).join(" · ");
      pasangWm(c, a.wm, aset.logo, aset.logoPortrait, info);
    }
    if (a.label && a.label.aktif) pasangLabel(c, a.label, { ...ktx, tanggal, jam });
    const ukuranHasil = [c.width, c.height];
    let blob = await keJpeg(c, a, !!pratinjauSisi);
    c.width = 0;
    if (!pratinjauSisi) blob = await sisipExif(blob, ex.app1);
    return { blob, asli: [W, H], hasil: ukuranHasil, dibatasi };
  }

  // perlu diolah? (kalau tidak, file asli dikirim apa adanya)
  function perluOlah(a, file) {
    if (a.wm.aktif || a.lut.file || a.ukuran !== "asli" || (a.label && a.label.aktif)) return true;
    if (a.kompres === "asli") return false;
    if (a.kompres === "mb" && /jpe?g$/i.test(file.type)) return file.size > a.mb * 1048576;
    return true;
  }

  return { olah, perluOlah, targetUkuran, IOS, MAKS_PIKSEL, adalahHeic, bukaGambar };
})();
