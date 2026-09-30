'use strict';
// Revisión técnica de preimpresión de un PDF, sin IA: tamaño, rebase, fuentes, color,
// resolución de imágenes, línea de corte y texto cerca de la orilla.
// pdf-lib lee la estructura (cajas, fuentes, espacios de color, capas) y pdf.js las posiciones reales
// de imágenes y textos en la página.

const MM_POR_PT = 25.4 / 72;
const RE_CORTE = /cut|corte|contour|suaje|troquel|thru|kiss|plotter/i;

// opciones: { ancho, alto, unidad: 'mm'|'cm'|'m', escala: 1|10|…, corte: bool }
async function revisionTecnica(file, opciones = {}) {
  const [pdfjsLib, PDFLib] = await Promise.all([cargarPdfJs(), cargarPdfLib()]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return analizarPdf(bytes, opciones, { pdfjsLib, PDFLib });
}

async function analizarPdf(bytes, opciones, { pdfjsLib, PDFLib }) {
  const { PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } = PDFLib;
  const escala = Number(opciones.escala) > 0 ? Number(opciones.escala) : 1;
  const doc = await PDFLib.PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
  const tarea = pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const pdf = await tarea.promise;
  const ctx = doc.context;
  const v = []; // verificaciones: { nombre, estado: ok|revisar|error|info, detalle }
  const agregar = (nombre, estado, detalle) => v.push({ nombre, estado, detalle });

  // ---------- Recorrido de recursos (página y formularios anidados) ----------
  const fuentes = new Map(); // nombre -> incrustada
  const color = { rgb: 0, cmyk: 0, gris: 0, imgRgb: 0, imgCmyk: 0, directas: new Set() };
  const vistos = new Set();

  const nombreDe = (obj) => (obj instanceof PDFName ? obj.decodeText() : null);
  const tinta = (n) => n.replace(/#20/g, ' ');

  function claseColor(cs, recursos) {
    cs = ctx.lookup(cs);
    const n = nombreDe(cs);
    if (n) {
      if (/^(DeviceRGB|CalRGB|RGB)$/.test(n)) return 'rgb';
      if (/^(DeviceCMYK|CMYK)$/.test(n)) return 'cmyk';
      if (/^(DeviceGray|CalGray|G)$/.test(n)) return 'gris';
      if (n === 'Pattern') return 'otro';
      // nombre de un espacio de color definido en los recursos
      const def = recursos?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict)?.get(PDFName.of(n));
      return def ? claseColor(def, recursos) : 'otro';
    }
    if (cs instanceof PDFArray) {
      const tipo = nombreDe(cs.get(0));
      if (tipo === 'ICCBased') {
        const icc = ctx.lookup(cs.get(1));
        const comps = icc?.dict?.get(PDFName.of('N'))?.asNumber?.();
        return comps === 4 ? 'cmyk' : comps === 1 ? 'gris' : 'rgb';
      }
      if (tipo === 'Indexed') return claseColor(cs.get(1), recursos);
      if (tipo === 'Separation') { color.directas.add(tinta(nombreDe(ctx.lookup(cs.get(1))) || '?')); return 'directa'; }
      if (tipo === 'DeviceN') {
        const nombres = ctx.lookup(cs.get(1));
        for (let i = 0; i < (nombres?.size?.() || 0); i++) color.directas.add(tinta(nombreDe(nombres.get(i)) || '?'));
        return 'directa';
      }
      if (tipo === 'CalRGB' || tipo === 'Lab') return 'rgb';
      if (tipo === 'CalGray') return 'gris';
    }
    return 'otro';
  }

  function incrustada(fuente) {
    const subtipo = nombreDe(fuente.get(PDFName.of('Subtype')));
    if (subtipo === 'Type3') return true;
    let desc = fuente.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    if (subtipo === 'Type0') {
      const hija = fuente.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0, PDFDict);
      desc = hija?.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    }
    return !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(PDFName.of(k)));
  }

  function textoDeStream(stream) {
    try {
      const datos = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents?.();
      return datos ? new TextDecoder('latin1').decode(datos) : '';
    } catch { return ''; }
  }

  function escanearContenido(texto, recursos) {
    color.rgb += (texto.match(/(?:-?[\d.]+\s+){3}(?:rg|RG)(?=\s)/g) || []).length;
    color.cmyk += (texto.match(/(?:-?[\d.]+\s+){4}(?:k|K)(?=\s)/g) || []).length;
    color.gris += (texto.match(/(?:-?[\d.]+\s+)(?:g|G)(?=\s)/g) || []).length;
    for (const m of texto.matchAll(/\/([^\s/\[\]()<>]+)\s+(?:cs|CS)(?=\s)/g)) {
      const c = claseColor(PDFName.of(m[1]), recursos);
      if (c === 'rgb') color.rgb++; else if (c === 'cmyk') color.cmyk++;
    }
  }

  function recorrerRecursos(recursos) {
    if (!recursos || vistos.has(recursos)) return;
    vistos.add(recursos);
    const dictFuentes = recursos.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of dictFuentes?.entries() || []) {
      const f = ctx.lookup(ref, PDFDict);
      const nombre = (nombreDe(f.get(PDFName.of('BaseFont'))) || 'Sin nombre').replace(/^[A-Z]{6}\+/, '');
      fuentes.set(nombre, (fuentes.get(nombre) ?? true) && incrustada(f));
    }
    const dictCs = recursos.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
    for (const [, cs] of dictCs?.entries() || []) claseColor(cs, recursos);
    const xobjs = recursos.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const [, ref] of xobjs?.entries() || []) {
      const x = ctx.lookup(ref);
      if (!x?.dict || vistos.has(x)) continue;
      vistos.add(x);
      const sub = nombreDe(x.dict.get(PDFName.of('Subtype')));
      if (sub === 'Image') {
        if (x.dict.get(PDFName.of('ImageMask'))) continue;
        const c = x.dict.has(PDFName.of('ColorSpace')) ? claseColor(x.dict.get(PDFName.of('ColorSpace')), recursos) : 'otro';
        if (c === 'rgb') color.imgRgb++; else if (c === 'cmyk') color.imgCmyk++;
      } else if (sub === 'Form') {
        const r = x.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
        escanearContenido(textoDeStream(x), r || recursos);
        recorrerRecursos(r);
      }
    }
  }

  // ---------- Página por página ----------
  const paginas = doc.getPages();
  const tamanos = [];
  const problemasRebase = [], cercaOrilla = [], cortados = [], imagenes = [];

  for (let i = 0; i < paginas.length; i++) {
    const pag = paginas[i];
    const pref = paginas.length > 1 ? `Pág. ${i + 1}: ` : '';
    const media = pag.getMediaBox();
    const tieneTrim = pag.node.has(PDFName.of('TrimBox'));
    const trim = tieneTrim ? pag.getTrimBox() : media;
    const sangre = pag.node.has(PDFName.of('BleedBox')) ? pag.getBleedBox() : media;
    tamanos.push({ ancho: trim.width * MM_POR_PT, alto: trim.height * MM_POR_PT, pref });

    // Rebase: lo mínimo que sobra entre el corte final y la caja de sangrado (o la hoja).
    if (!tieneTrim) {
      problemasRebase.push(`${pref}no tiene caja de corte (TrimBox)`);
    } else {
      const reb = Math.min(trim.x - sangre.x, trim.y - sangre.y,
        (sangre.x + sangre.width) - (trim.x + trim.width), (sangre.y + sangre.height) - (trim.y + trim.height)) * MM_POR_PT * escala;
      if (reb < 2) problemasRebase.push(`${pref}rebase de ${reb.toFixed(1)} mm`);
      else tamanos[i].rebase = reb;
    }

    // Recursos y contenido
    const recursos = pag.node.Resources();
    recorrerRecursos(recursos);
    const cont = pag.node.Contents();
    const streams = cont instanceof PDFArray ? cont.asArray().map((r) => ctx.lookup(r)) : cont ? [cont] : [];
    for (const s of streams) escanearContenido(textoDeStream(s), recursos);

    // Imágenes: tamaño en pantalla según la matriz de transformación vigente al dibujarlas
    const pagJs = await pdf.getPage(i + 1);
    const ops = await pagJs.getOperatorList();
    const O = pdfjsLib.OPS;
    let ctm = [1, 0, 0, 1, 0, 0];
    const pila = [];
    const mult = (m, n) => [
      n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
      n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
      n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5],
    ];
    ops.fnArray.forEach((fn, k) => {
      const a = ops.argsArray[k];
      if (fn === O.save) pila.push(ctm);
      else if (fn === O.restore) ctm = pila.pop() || ctm;
      else if (fn === O.transform) ctm = mult(ctm, a);
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) {
        const pxAncho = fn === O.paintImageXObject ? a[1] : a[0]?.width;
        const pxAlto = fn === O.paintImageXObject ? a[2] : a[0]?.height;
        const anchoMm = Math.hypot(ctm[0], ctm[1]) * MM_POR_PT * escala;
        const altoMm = Math.hypot(ctm[2], ctm[3]) * MM_POR_PT * escala;
        if (pxAncho && anchoMm > 5 && altoMm > 5) {
          const ppi = Math.min(pxAncho / (anchoMm / 25.4), pxAlto / (altoMm / 25.4));
          imagenes.push({ pref, ppi, anchoMm, altoMm, px: `${pxAncho}×${pxAlto}` });
        }
      }
    });

    // Texto vivo cerca de la orilla del corte final (o que se sale)
    const margenMm = (trim.width * MM_POR_PT * escala > 600 ? 30 : 3);
    const margen = margenMm / MM_POR_PT / escala;
    const txt = await pagJs.getTextContent();
    for (const it of txt.items) {
      if (!it.str?.trim()) continue;
      const x0 = it.transform[4], y0 = it.transform[5];
      const x1 = x0 + it.width, y1 = y0 + (it.height || Math.hypot(it.transform[2], it.transform[3]));
      const fuera = x0 < trim.x || y0 < trim.y || x1 > trim.x + trim.width || y1 > trim.y + trim.height;
      const cerca = x0 < trim.x + margen || y0 < trim.y + margen || x1 > trim.x + trim.width - margen || y1 > trim.y + trim.height - margen;
      const muestra = `${pref}"${it.str.trim().slice(0, 40)}"`;
      if (fuera) cortados.push(muestra); else if (cerca) cercaOrilla.push({ muestra, margenMm });
    }
  }

  // ---------- Resultados ----------
  const fmt = (mm, ref = mm) => (ref >= 100 ? `${+(mm / 10).toFixed(1)} cm` : `${+mm.toFixed(1)} mm`);
  const fmtPar = (a, b) => `${fmt(a, Math.max(a, b))} × ${fmt(b, Math.max(a, b))}`;
  const real = (t) => ({ ancho: t.ancho * escala, alto: t.alto * escala });

  // 1. Tamaño
  const t0 = real(tamanos[0]);
  const textoTam = `${fmtPar(t0.ancho, t0.alto)}${escala !== 1 ? ` (diseñado a escala 1:${escala})` : ''}`;
  const pedido = Number(opciones.ancho) > 0 && Number(opciones.alto) > 0;
  if (pedido) {
    const f = { mm: 1, cm: 10, m: 1000 }[opciones.unidad] || 10;
    const pa = Number(opciones.ancho) * f, pb = Number(opciones.alto) * f;
    const tol = (x) => Math.max(1, x * 0.005);
    const coincide = (t) => {
      const r = real(t);
      return (Math.abs(r.ancho - pa) <= tol(pa) && Math.abs(r.alto - pb) <= tol(pb))
        || (Math.abs(r.ancho - pb) <= tol(pb) && Math.abs(r.alto - pa) <= tol(pa));
    };
    const malas = tamanos.filter((t) => !coincide(t));
    if (malas.length) {
      agregar('Tamaño final', 'error', `${malas.map((t) => `${t.pref}${fmtPar(real(t).ancho, real(t).alto)}`).join('; ')}. `
        + `Se pidió ${fmtPar(pa, pb)}.`);
    } else agregar('Tamaño final', 'ok', `${textoTam}, coincide con lo pedido.`);
  } else {
    agregar('Tamaño final', 'info', `${textoTam}. Escribe la medida pedida en "Datos técnicos" para compararla.`);
  }

  // 2. Rebase
  if (problemasRebase.length) {
    agregar('Rebase (sangrado)', 'revisar', `${problemasRebase.join('; ')}. Si el trabajo se imprime a sangre, exporta con al menos 3 mm de rebase.`);
  } else {
    agregar('Rebase (sangrado)', 'ok', `${Math.min(...tamanos.map((t) => t.rebase)).toFixed(1)} mm de rebase.`);
  }

  // 3. Fuentes
  const sinIncrustar = [...fuentes].filter(([, ok]) => !ok).map(([n]) => n);
  if (!fuentes.size) agregar('Fuentes', 'ok', 'No hay texto vivo: todo está convertido a curvas.');
  else if (sinIncrustar.length) agregar('Fuentes', 'error', `Fuentes sin incrustar: ${sinIncrustar.join(', ')}. En otra computadora se reemplazarán por otra letra. Conviértelas a curvas.`);
  else agregar('Fuentes', 'ok', `${fuentes.size} fuente(s) incrustada(s): ${[...fuentes.keys()].join(', ')}. Si producción lo pide, conviértelas a curvas.`);

  // 4. Color
  const partesRgb = [];
  if (color.imgRgb) partesRgb.push(`${color.imgRgb} imagen(es)`);
  if (color.rgb) partesRgb.push('colores de vectores o texto');
  if (partesRgb.length) agregar('Modo de color', 'revisar', `Hay color RGB en ${partesRgb.join(' y ')}. Para impresión conviene convertir a CMYK; los colores pueden variar al imprimir.`);
  else if (color.cmyk || color.imgCmyk) agregar('Modo de color', 'ok', 'Todo en CMYK.');
  else agregar('Modo de color', 'info', 'No se detectaron colores RGB ni CMYK (solo escala de grises o tintas directas).');

  // 5. Línea de corte (tinta directa o capa con nombre de corte)
  const capas = [];
  const ocp = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const ocgs = ocp?.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  for (let i = 0; i < (ocgs?.size() || 0); i++) {
    const n = ocgs.lookup(i, PDFDict)?.lookup(PDFName.of('Name'));
    if (n) capas.push(n.decodeText());
  }
  const lineas = [...[...color.directas].filter((n) => RE_CORTE.test(n)).map((n) => `tinta "${n}"`),
    ...capas.filter((n) => RE_CORTE.test(n)).map((n) => `capa "${n}"`)];
  if (lineas.length) agregar('Línea de corte', 'ok', `Encontrada: ${lineas.join(', ')}.`);
  else if (opciones.corte) agregar('Línea de corte', 'error', 'El trabajo lleva corte pero no se encontró una tinta directa (ej. CutContour) ni una capa llamada "Corte".');
  else agregar('Línea de corte', 'info', 'No se encontró línea de corte. Si el trabajo va a corte o suaje, márcalo en "Datos técnicos".');
  const otrasDirectas = [...color.directas].filter((n) => !RE_CORTE.test(n) && !/^(All|None)$/.test(n));
  if (otrasDirectas.length) agregar('Tintas directas', 'info', otrasDirectas.join(', '));

  // 6. Resolución de imágenes (a tamaño real). Gran formato se ve de lejos y necesita menos.
  if (!imagenes.length) {
    agregar('Resolución de imágenes', 'ok', 'No hay imágenes (mapas de bits) en el diseño.');
  } else {
    const granFormato = t0.ancho > 600 || t0.alto > 600;
    const [minOk, minRev] = granFormato ? [100, 60] : [250, 150];
    const bajas = imagenes.filter((im) => im.ppi < minOk).sort((a, b) => a.ppi - b.ppi);
    const peor = bajas.some((im) => im.ppi < minRev) ? 'error' : 'revisar';
    const lista = (ims) => ims.slice(0, 5).map((im) => `${im.pref}${Math.round(im.ppi)} ppi (${im.px} px a ${fmtPar(im.anchoMm, im.altoMm)})`).join('; ');
    if (bajas.length) agregar('Resolución de imágenes', peor, `${bajas.length} de ${imagenes.length} imagen(es) por debajo de ${minOk} ppi${granFormato ? ' (gran formato)' : ''}: ${lista(bajas)}.`);
    else agregar('Resolución de imágenes', 'ok', `${imagenes.length} imagen(es), todas con ${minOk} ppi o más a tamaño real.`);
  }

  // 7. Texto vivo en la orilla
  if (cortados.length) agregar('Texto fuera del corte', 'error', `Se sale del tamaño final: ${cortados.slice(0, 6).join(', ')}.`);
  if (cercaOrilla.length) {
    agregar('Margen de seguridad', 'revisar', `Texto a menos de ${cercaOrilla[0].margenMm} mm de la orilla: ${cercaOrilla.slice(0, 6).map((c) => c.muestra).join(', ')}.`);
  } else if (!cortados.length && fuentes.size) {
    agregar('Margen de seguridad', 'ok', 'Ningún texto está pegado a la orilla.');
  }

  if (paginas.length > 1) agregar('Páginas', 'info', `${paginas.length} páginas.`);
  await tarea.destroy();

  const errores = v.filter((x) => x.estado === 'error').length;
  const revisar = v.filter((x) => x.estado === 'revisar').length;
  return {
    estado_general: errores ? 'con_errores' : revisar ? 'revisar' : 'aprobado',
    resumen: errores || revisar
      ? `${errores} problema(s) y ${revisar} punto(s) por revisar en la parte técnica.`
      : 'La parte técnica del PDF está lista para producción.',
    verificaciones: v,
    hallazgos: [],
    verificacion_cliente: [],
    texto_detectado: '',
  };
}

if (typeof module === 'object') module.exports = { analizarPdf };
