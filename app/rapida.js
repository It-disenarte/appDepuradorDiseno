'use strict';
// Revisión rápida sin IA: lee el texto (OCR en capturas, texto real en PDF) y revisa ortografía
// con diccionario es-MX, palabras repetidas, teléfonos/correos/webs y datos del cliente.
// Todo corre en el navegador: no se envía nada ni tiene costo.

const MAX_PAGINAS_PDF = 10;
const PERMITIDAS_BASE = [
  'diseñarte', 'disenarte', 'disenartemx', 'querétaro', 'whatsapp', 'facebook', 'instagram', 'tiktok',
  'youtube', 'linkedin', 'twitter', 'google', 'maps', 'email', 'online', 'web', 'mr', 'cp', 'col', 'av', 'tel',
  'cel', 'ext', 'qro', 'cdmx', 'edomex', 'www', 'com', 'mx', 'sa', 'cv', 'rfc', 'iva', 'pdf', 'led', 'ok',
  // materiales y procesos del oficio
  'vinil', 'viniles', 'microperforado', 'coroplast', 'trovicel', 'sintra', 'estireno', 'banner', 'banners', 'backlight',
  'rollup', 'roll-up', 'flyer', 'flyers', 'sticker', 'stickers', 'plotter', 'suaje', 'suajado', 'rotulación', 'rótulo',
  'rótulos', 'ojillos', 'termoformado', 'sublimación', 'serigrafía', 'tampografía', 'offset', 'couché', 'opalina',
  'polipropileno', 'mdf', 'pvc', 'dtf', 'uv', 'cnc', 'router', 'display', 'displays', 'stand', 'popup', 'mesh',
];

// ---------- Lectura del texto (solo navegador) ----------
async function revisionRapida(archivos, opciones, progreso = () => {}) {
  const sp = await cargarOrtografia();
  const bloques = [];
  for (const [i, a] of archivos.entries()) {
    const n = i + 1;
    if (a.file.type === 'application/pdf') {
      progreso(`Leyendo el texto del PDF ${n}…`);
      bloques.push(...await leerPdf(a.file, n, progreso));
    } else {
      progreso(`Leyendo el texto de la captura ${n} (OCR)…`);
      bloques.push(await leerImagen(a.file, n, progreso));
    }
  }
  progreso('Revisando ortografía…');
  return analizarTexto(bloques, opciones, sp);
}

async function ocrCanvas(canvas, archivo, pagina, progreso) {
  const worker = await cargarOcr((m) => {
    if (m.status === 'recognizing text') progreso(`Leyendo texto… ${Math.round(m.progress * 100)}%`);
    else if (/loading|initializ/.test(m.status)) progreso('Preparando el lector de texto (solo la primera vez tarda)…');
  });
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const lineas = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) {
    lineas.push(l.words.map((w) => ({
      t: w.text, conf: w.confidence,
      x: (w.bbox.x0 + w.bbox.x1) / 2 / canvas.width, y: (w.bbox.y0 + w.bbox.y1) / 2 / canvas.height,
    })));
  }
  return { archivo, pagina, ocr: true, lineas };
}

// El OCR lee mejor con imágenes grandes: se amplían las chicas y se limitan las enormes.
async function leerImagen(file, archivo, progreso) {
  const bmp = await createImageBitmap(file);
  const lado = Math.max(bmp.width, bmp.height);
  const escala = lado < 1600 ? Math.min(2, 3200 / lado) : Math.min(1, 4000 / lado);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return ocrCanvas(canvas, archivo, null, progreso);
}

// PDF: usa el texto real si lo tiene; si está en curvas, dibuja la página y le aplica OCR.
async function leerPdf(file, archivo, progreso) {
  const pdfjsLib = await cargarPdfJs();
  const tarea = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const pdf = await tarea.promise;
  const bloques = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGINAS_PDF); p++) {
      const pag = await pdf.getPage(p);
      const [x0, y0, x1, y1] = pag.view;
      const { items } = await pag.getTextContent();
      const lineas = items.filter((it) => it.str?.trim()).map((it) => {
        const x = (it.transform[4] + it.width / 2 - x0) / (x1 - x0);
        const y = 1 - (it.transform[5] - y0) / (y1 - y0);
        return it.str.split(/\s+/).filter(Boolean).map((t) => ({ t, conf: 100, x, y }));
      });
      if (lineas.flat().length >= 2) { bloques.push({ archivo, pagina: p, ocr: false, lineas }); continue; }
      progreso(`La página ${p} está en curvas: leyendo con OCR…`);
      const vp = pag.getViewport({ scale: Math.min(4, 3000 / Math.max(x1 - x0, y1 - y0)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
      await pag.render({ canvasContext: c, canvas, viewport: vp }).promise;
      bloques.push(await ocrCanvas(canvas, archivo, p, progreso));
    }
  } finally {
    await tarea.destroy();
  }
  return bloques;
}

// ---------- Análisis del texto (sin DOM, se puede probar en Node) ----------
function analizarTexto(bloques, opciones, sp) {
  const hallazgos = [];
  const permitidas = new Set([...PERMITIDAS_BASE, ...(opciones.permitidas || [])].map((p) => p.toLowerCase().trim()).filter(Boolean));
  const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const donde = (b, w) => {
    const v = w.y < 0.33 ? 'arriba' : w.y < 0.66 ? 'en medio' : 'abajo';
    const h = w.x < 0.33 ? 'a la izquierda' : w.x < 0.66 ? '' : 'a la derecha';
    const lugar = v === 'en medio' && !h ? 'al centro' : `${v}${h ? ` ${h}` : ''}`;
    return b.pagina ? `pág. ${b.pagina}, ${lugar}` : lugar;
  };
  const agregar = (b, w, h) => hallazgos.push({ archivo: b.archivo, ubicacion: w ? donde(b, w) : '', ...h });

  // 1. Ortografía
  const vistas = new Set();
  for (const b of bloques) for (const linea of b.lineas) for (const w of linea) {
    const limpia = w.t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    const baja = limpia.toLowerCase();
    if (limpia.length < 3 || /[\d@/_.:]/.test(w.t.replace(/[.,;:!?)]+$/, '')) || /[^\p{L}'-]/u.test(limpia)) continue;
    if (permitidas.has(baja) || permitidas.has(sinAcentos(baja)) || vistas.has(baja)) continue;
    if (limpia === limpia.toUpperCase() && limpia.length <= 4) continue; // siglas
    if (b.ocr && w.conf < 55) continue; // lectura dudosa: mejor no alarmar
    if (sp.correct(limpia) || sp.correct(baja) || sp.correct(capital(baja))) continue;
    vistas.add(baja);

    const sugerencias = sp.suggest(baja)
      .sort((a, c) => (sinAcentos(c) === sinAcentos(baja)) - (sinAcentos(a) === sinAcentos(baja)))
      .slice(0, 3);
    const acento = sugerencias[0] && sinAcentos(sugerencias[0]) === sinAcentos(baja);
    const conCaso = (s) => (limpia === limpia.toUpperCase() ? s.toUpperCase() : limpia[0] === limpia[0].toUpperCase() ? capital(s) : s);
    const seguro = (!b.ocr || w.conf >= 85) && sugerencias.length > 0;
    agregar(b, w, {
      severidad: seguro ? 'error' : 'revisar',
      tipo: 'ortografia',
      texto_actual: limpia,
      correccion: sugerencias.length ? sugerencias.map(conCaso).join(' / ') : '',
      explicacion: acento ? 'Falta o sobra un acento.'
        : sugerencias.length ? 'No está en el diccionario. ¿Quisiste decir alguna de estas?'
          : 'No está en el diccionario. Si es un nombre o marca, agrégalo a "Palabras permitidas" en Ajustes.',
    });
  }

  // 2. Palabras repetidas seguidas ("de de")
  for (const b of bloques) for (const linea of b.lineas) {
    for (let i = 1; i < linea.length; i++) {
      const a = linea[i - 1].t.toLowerCase().replace(/[^\p{L}]/gu, ''), c = linea[i].t.toLowerCase().replace(/[^\p{L}]/gu, '');
      if (a && a === c && a.length > 1) {
        agregar(b, linea[i], { severidad: 'error', tipo: 'repeticion', texto_actual: `${linea[i - 1].t} ${linea[i].t}`, correccion: linea[i].t, explicacion: 'Palabra repetida.' });
      }
    }
  }

  // 3. Teléfonos, correos y páginas web
  const textoDe = (b) => b.lineas.map((l) => l.map((w) => w.t).join(' ')).join('\n');
  for (const b of bloques) {
    const texto = textoDe(b);
    for (const m of texto.matchAll(/\+?\(?\d[\d\s().-]{5,}\d/g)) {
      const s = m[0].trim(), d = s.replace(/\D/g, '');
      if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s) || d.length < 7 || d.length > 13) continue;
      const valido = d.length === 10 || (d.length === 12 && d.startsWith('52')) || (d.length === 13 && d.startsWith('521'));
      if (!valido) agregar(b, null, { severidad: 'revisar', tipo: 'formato_dato', texto_actual: s, correccion: '', explicacion: `Parece teléfono pero tiene ${d.length} dígitos; en México son 10.` });
    }
    const typos = /(gmial|gmai|gamil|hotmial|hotmal|homail|outlok|yahho)\./i;
    for (const m of texto.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g)) {
      const s = m[0].replace(/\.$/, '');
      const dom = s.split('@')[1].toLowerCase();
      const malo = typos.test(dom + '.') || /\.(con|cmo|comm|cm|vom)$/.test(dom) || !/\.[a-z]{2,}$/.test(dom)
        || (/^(gmail|hotmail|outlook|yahoo|live|icloud)\.co$/.test(dom));
      if (malo) agregar(b, null, { severidad: 'error', tipo: 'formato_dato', texto_actual: s, correccion: '', explicacion: 'El correo parece mal escrito (dominio o terminación).' });
    }
    for (const m of texto.matchAll(/\b(?:https?:\/\/)?w+\.[\w-]+(?:\.[\w-]+)+/gi)) {
      const s = m[0];
      const ws = s.replace(/^https?:\/\//i, '').match(/^w+(?=\.)/i)?.[0].length;
      if ((ws && ws !== 3 && ws > 1) || /\.(con|cmo|comm|vom)$/i.test(s)) {
        const bien = s.replace(/^(https?:\/\/)?w+\./i, '$1www.').replace(/\.(con|cmo|comm|vom)$/i, '.com');
        agregar(b, null, { severidad: 'error', tipo: 'formato_dato', texto_actual: s, correccion: bien, explicacion: 'Dirección web mal escrita.' });
      }
    }
  }

  // 4. Datos del cliente
  const verificacion = compararCliente(opciones.textoCliente || '', bloques.map(textoDe).join('\n'));

  const errores = hallazgos.filter((h) => h.severidad === 'error').length + verificacion.filter((v) => v.estado !== 'correcto').length;
  const dudas = hallazgos.filter((h) => h.severidad !== 'error').length;
  const hayOcr = bloques.some((b) => b.ocr);
  return {
    estado_general: errores ? 'con_errores' : dudas ? 'revisar' : 'aprobado',
    resumen: errores || dudas
      ? `${errores} posible(s) error(es) y ${dudas} palabra(s) por revisar.${hayOcr ? ' Algunas pueden ser letras mal leídas por el OCR.' : ''}`
      : 'No se encontraron faltas de ortografía en el texto leído.',
    hallazgos: hallazgos.slice(0, 60),
    verificacion_cliente: verificacion,
    texto_detectado: bloques.map((b) => `Archivo ${b.archivo}${b.pagina ? `, pág. ${b.pagina}` : ''}${b.ocr ? ' (OCR)' : ''}:\n${textoDe(b)}`).join('\n\n'),
  };
}

function compararCliente(textoCliente, textoDiseno) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const diseno = norm(textoDiseno);
  const tokens = textoDiseno.split(/\s+/).filter(Boolean);
  const numeros = [...textoDiseno.matchAll(/\+?\(?\d[\d\s().-]{5,}\d/g)].map((m) => ({ s: m[0].trim(), d: m[0].replace(/\D/g, '') }));
  const salida = [];
  for (const linea of textoCliente.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = linea.match(/^([^:]{1,30}):\s*(.+)$/);
    const dato = m ? m[1].trim() : 'Texto';
    const esperado = (m ? m[2] : linea).trim();
    const digitos = esperado.replace(/\D/g, '');
    let estado = 'faltante', encontrado = '';
    if (digitos.length >= 6 && esperado.replace(/[^\p{L}]/gu, '').length < 3) {
      const exacto = numeros.find((n) => n.d === digitos || n.d.endsWith(digitos));
      const parecido = exacto || numeros.map((n) => ({ ...n, sim: similitud(n.d, digitos) })).sort((a, b) => b.sim - a.sim).find((n) => n.sim >= 0.7);
      if (exacto) { estado = 'correcto'; encontrado = exacto.s; } else if (parecido) { estado = 'diferente'; encontrado = parecido.s; }
    } else if (diseno.includes(norm(esperado))) {
      estado = 'correcto'; encontrado = esperado;
    } else {
      const n = esperado.split(/\s+/).length;
      let mejor = { sim: 0, s: '' };
      for (let i = 0; i + n <= tokens.length; i++) {
        const s = tokens.slice(i, i + n).join(' ');
        const sim = similitud(norm(s), norm(esperado));
        if (sim > mejor.sim) mejor = { sim, s };
      }
      if (mejor.sim >= 0.75) { estado = 'diferente'; encontrado = mejor.s; }
    }
    salida.push({ dato, esperado, encontrado, estado });
  }
  return salida;
}

// 1 = iguales, 0 = nada en común (distancia de Levenshtein normalizada)
function similitud(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

if (typeof module === 'object') module.exports = { analizarTexto, compararCliente };
