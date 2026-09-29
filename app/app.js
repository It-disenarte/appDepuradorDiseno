'use strict';

const MODELO_DEFAULT = 'gemini-3.8-flash';
const MAX_BYTES_DIRECTO = 18 * 1024 * 1024; // límite de datos en línea por petición a Gemini
const MAX_BYTES_SERVIDOR = 3.2 * 1024 * 1024; // Vercel acepta 4.5 MB por petición; el base64 pesa ~33% más
const TIPOS_OK = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

// La app llama a su función de Vercel (/api/revisar), donde vive la API key.
// La extensión no corre en ese dominio, así que necesita la URL completa del despliegue.
const URL_PRODUCCION = 'https://depurador-disenarte.vercel.app';
const API_URL = (location.protocol === 'chrome-extension:' ? URL_PRODUCCION : '') + '/api/revisar';

const $ = (id) => document.getElementById(id);
const archivos = []; // { file, url, nombre }

// ---------- Ajustes ----------
function leerCfg(clave, porDefecto = '') {
  try { return localStorage.getItem(clave) || porDefecto; } catch { return porDefecto; }
}
function guardarCfg(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

$('btnAjustes').addEventListener('click', abrirAjustes);
function abrirAjustes() {
  $('cfgCodigo').value = leerCfg('codigo_equipo');
  $('cfgKey').value = leerCfg('gemini_key');
  $('cfgModelo').value = leerCfg('gemini_modelo', MODELO_DEFAULT);
  $('dlgAjustes').showModal();
}
$('btnGuardarCfg').addEventListener('click', () => {
  guardarCfg('codigo_equipo', $('cfgCodigo').value.trim());
  guardarCfg('gemini_key', $('cfgKey').value.trim());
  guardarCfg('gemini_modelo', $('cfgModelo').value.trim() || MODELO_DEFAULT);
});

// ---------- Entrada de archivos ----------
function agregarArchivo(file, nombre) {
  if (!TIPOS_OK.includes(file.type)) {
    avisar(`Formato no soportado: ${file.type || file.name}. Usa PNG, JPG o PDF.`, true);
    return;
  }
  const n = nombre || file.name || `captura-${archivos.length + 1}.png`;
  archivos.push({ file, nombre: n, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
  pintarLista();
  avisar('');
}

function pintarLista() {
  const ul = $('listaArchivos');
  ul.replaceChildren();
  archivos.forEach((a, i) => {
    const li = document.createElement('li');
    if (a.url) {
      const img = document.createElement('img');
      img.src = a.url; img.alt = a.nombre;
      li.append(img);
    } else {
      const d = document.createElement('div');
      d.className = 'pdf'; d.textContent = `📄 ${a.nombre}`;
      li.append(d);
    }
    const num = document.createElement('span');
    num.className = 'num'; num.textContent = i + 1;
    const x = document.createElement('button');
    x.className = 'quitar'; x.type = 'button'; x.textContent = '×'; x.title = 'Quitar';
    x.addEventListener('click', () => {
      if (a.url) URL.revokeObjectURL(a.url);
      archivos.splice(i, 1);
      pintarLista();
    });
    li.append(num, x);
    ul.append(li);
  });
  $('btnRevisar').disabled = archivos.length === 0;
}

// Ctrl+V en cualquier parte de la página
document.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const imgs = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
  if (imgs.length === 0) return; // texto normal: dejar que se pegue en el campo
  e.preventDefault();
  imgs.forEach((f) => agregarArchivo(f, f.name && f.name !== 'image.png' ? f.name : `captura-${archivos.length + 1}.png`));
});

// Botón "Pegar del portapapeles"
$('btnPegar').addEventListener('click', async () => {
  if (!navigator.clipboard?.read) {
    avisar('Tu navegador no permite leer el portapapeles con botón. Usa Ctrl + V.', true);
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    let n = 0;
    for (const it of items) {
      const tipo = it.types.find((t) => t.startsWith('image/'));
      if (!tipo) continue;
      const blob = await it.getType(tipo);
      agregarArchivo(new File([blob], `captura-${archivos.length + 1}.png`, { type: blob.type }));
      n++;
    }
    if (n === 0) avisar('No hay ninguna imagen en el portapapeles. Toma una captura con Win + Shift + S.', true);
  } catch {
    avisar('No se pudo leer el portapapeles. Da permiso al navegador o usa Ctrl + V.', true);
  }
});

$('btnArchivo').addEventListener('click', () => $('inputArchivo').click());
$('inputArchivo').addEventListener('change', (e) => {
  [...e.target.files].forEach((f) => agregarArchivo(f));
  e.target.value = '';
});

const dz = $('dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault(); dz.classList.remove('over');
  [...e.dataTransfer.files].forEach((f) => agregarArchivo(f));
});

function avisar(msg, esError = false) {
  const p = $('estadoEnvio');
  p.textContent = msg;
  p.classList.toggle('error', esError);
}

// ---------- Llamada a Gemini ----------
const INSTRUCCIONES = `Eres el revisor de preprensa de Diseñarte, un taller de diseño, impresión y corte en México.
Tu trabajo es detectar errores ANTES de que un diseño se mande a producción (impresión, lonas, vinil, corte, etc.).
Recibirás uno o varios archivos numerados (capturas de pantalla o PDF) de un mismo trabajo.

Qué revisar:
1. Ortografía en español de México: acentos, letras faltantes, sobrantes o invertidas, palabras mal escritas, mayúsculas incorrectas en nombres propios.
2. Texto cortado: letras o palabras que se salen del área de trabajo, quedan tapadas por otro elemento o se cortan por el borde de una caja de texto.
3. Texto encimado, ilegible o con muy poco contraste contra el fondo.
4. Palabras repetidas o frases incompletas.
5. Datos con formato incorrecto: teléfonos de México (10 dígitos), correos, páginas web, redes sociales, precios, fechas y horarios.
6. Inconsistencias: el mismo dato escrito distinto en dos lugares.

Reglas:
- Si la captura muestra la interfaz de CorelDRAW, Illustrator, Photoshop u otro programa (menús, reglas, paneles, capas, barras), IGNORA ese texto. Revisa solo el contenido del diseño (la mesa de trabajo o lienzo).
- NO marques como error nombres de marcas, logotipos, slogans o juegos de palabras que se ven intencionales. Si dudas, repórtalo con severidad "revisar", nunca "error".
- No inventes errores. Si todo está bien, devuelve la lista de hallazgos vacía. Es mejor un reporte corto y certero.
- "error" = seguro está mal y hay que corregirlo. "revisar" = probable problema que un humano debe confirmar.
- En "archivo" indica el número del archivo donde está el hallazgo. En "ubicacion" describe dónde está dentro del diseño (ej. "esquina inferior derecha, debajo del logo").
- Escribe todo en español, claro y breve.

Estado general:
- "con_errores" si hay al menos un hallazgo "error" o un dato del cliente "diferente" o "faltante".
- "revisar" si solo hay hallazgos "revisar".
- "aprobado" si no hay hallazgos.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    estado_general: { type: 'string', enum: ['aprobado', 'revisar', 'con_errores'] },
    resumen: { type: 'string', description: 'Una o dos frases con el resultado de la revisión.' },
    hallazgos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severidad: { type: 'string', enum: ['error', 'revisar'] },
          tipo: { type: 'string', enum: ['ortografia', 'texto_cortado', 'legibilidad', 'repeticion', 'formato_dato', 'inconsistencia', 'dato_cliente', 'otro'] },
          archivo: { type: 'integer' },
          ubicacion: { type: 'string' },
          texto_actual: { type: 'string', description: 'El texto tal como aparece en el diseño.' },
          correccion: { type: 'string', description: 'Cómo debería quedar. Vacío si no aplica.' },
          explicacion: { type: 'string' },
        },
        required: ['severidad', 'tipo', 'archivo', 'ubicacion', 'texto_actual', 'correccion', 'explicacion'],
      },
    },
    verificacion_cliente: {
      type: 'array',
      description: 'Solo si se proporcionó texto aprobado por el cliente: un renglón por cada dato.',
      items: {
        type: 'object',
        properties: {
          dato: { type: 'string', description: 'Qué dato es (ej. Teléfono, Dirección).' },
          esperado: { type: 'string' },
          encontrado: { type: 'string', description: 'Cómo aparece en el diseño, o vacío si no aparece.' },
          estado: { type: 'string', enum: ['correcto', 'diferente', 'faltante'] },
        },
        required: ['dato', 'esperado', 'encontrado', 'estado'],
      },
    },
    texto_detectado: { type: 'string', description: 'Transcripción de todo el texto del diseño, por archivo, en orden de lectura.' },
  },
  required: ['estado_general', 'resumen', 'hallazgos', 'verificacion_cliente', 'texto_detectado'],
};

function aBase64(file) {
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => mal(r.error);
    r.readAsDataURL(file);
  });
}

// Las capturas de pantallas grandes pesan mucho en PNG: si pasan de 1 MB se convierten a JPEG
// de alta calidad (máx. 3072 px por lado), suficiente para leer texto y dentro del límite de Vercel.
async function prepararImagen(file) {
  if (!file.type.startsWith('image/') || file.size <= 1024 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, 3072 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  return blob && blob.size < file.size ? blob : file;
}

async function revisar() {
  const keyPropia = leerCfg('gemini_key');
  const codigo = leerCfg('codigo_equipo');
  if (!keyPropia && !codigo) { abrirAjustes(); avisar('Primero guarda el código del equipo en Ajustes.', true); return; }
  const modelo = leerCfg('gemini_modelo', MODELO_DEFAULT);

  const btn = $('btnRevisar');
  btn.disabled = true;
  avisar('Preparando archivos…');

  try {
    const listos = await Promise.all(archivos.map((a) => prepararImagen(a.file)));
    const total = listos.reduce((s, f) => s + f.size, 0);
    const max = keyPropia ? MAX_BYTES_DIRECTO : MAX_BYTES_SERVIDOR;
    if (total > max) {
      throw new Error(`los archivos pesan ${(total / 1048576).toFixed(1)} MB y el máximo es ${(max / 1048576).toFixed(0)} MB. `
        + 'Quita algunos, exporta el PDF más ligero o revisa con capturas por partes.');
    }

    const partes = [];
    for (const [i, a] of archivos.entries()) {
      partes.push({ text: `Archivo ${i + 1}: ${a.nombre}` });
      partes.push({ inline_data: { mime_type: listos[i].type, data: await aBase64(listos[i]) } });
    }
    const textoCliente = $('textoCliente').value.trim();
    const notas = $('notas').value.trim();
    partes.push({
      text: textoCliente
        ? `TEXTO APROBADO POR EL CLIENTE (verifica cada dato contra el diseño y llena verificacion_cliente):\n"""\n${textoCliente}\n"""`
        : 'No se proporcionó texto del cliente: deja verificacion_cliente vacío.',
    });
    if (notas) partes.push({ text: `Notas del diseñador (tómalas en cuenta): ${notas}` });

    const peticion = {
      system_instruction: { parts: [{ text: INSTRUCCIONES }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: { response_mime_type: 'application/json', response_schema: ESQUEMA },
    };

    avisar('');
    mostrarCargando(modelo);

    // Con API key propia se llama directo a Gemini (hasta 18 MB); si no, por el servidor del equipo.
    const resp = keyPropia
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyPropia },
        body: JSON.stringify(peticion),
      })
      : await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-codigo-equipo': codigo },
        body: JSON.stringify({ modelo, peticion }),
      });
    if (resp.status === 413) throw new Error('los archivos son demasiado pesados para el servidor. Usa capturas por partes.');
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error?.message || `Error ${resp.status}`);
    const texto = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    if (!texto) throw new Error(`Gemini no devolvió respuesta (${json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'sin detalle'}).`);
    pintarReporte(JSON.parse(texto), modelo);
  } catch (err) {
    $('salida').hidden = true;
    avisar(`No se pudo revisar: ${err.message}`, true);
  } finally {
    btn.disabled = archivos.length === 0;
  }
}
$('btnRevisar').addEventListener('click', revisar);

// ---------- Reporte ----------
const ETIQUETAS_ESTADO = {
  aprobado: ['🟢', 'Listo para producción', 'No se encontraron errores.'],
  revisar: ['🟡', 'Revisar antes de mandar', 'Hay puntos que conviene confirmar.'],
  con_errores: ['🔴', 'No mandar todavía', 'Hay errores que corregir.'],
};
const ETIQUETAS_TIPO = {
  ortografia: 'Ortografía', texto_cortado: 'Texto cortado', legibilidad: 'Legibilidad',
  repeticion: 'Repetición', formato_dato: 'Formato de dato', inconsistencia: 'Inconsistencia',
  dato_cliente: 'Dato del cliente', otro: 'Otro',
};

function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (n.className = v) : n.setAttribute(k, v)));
  hijos.flat().forEach((h) => h != null && n.append(h));
  return n;
}

function mostrarCargando(modelo) {
  $('salida').hidden = false;
  $('reporte').replaceChildren(
    el('div', { class: 'cargando' }, el('div', { class: 'spinner' }), `Revisando con ${modelo}…`)
  );
  if (window.innerWidth < 900) $('salida').scrollIntoView({ behavior: 'smooth' });
}

function pintarReporte(r, modelo) {
  const errores = r.hallazgos.filter((h) => h.severidad === 'error');
  const dudas = r.hallazgos.filter((h) => h.severidad !== 'error');
  const [luz, titulo, textoDefault] = ETIQUETAS_ESTADO[r.estado_general] || ETIQUETAS_ESTADO.revisar;

  const cont = $('reporte');
  cont.replaceChildren(
    el('div', { class: `semaforo ${r.estado_general}` },
      el('span', { class: 'luz' }, luz),
      el('div', {}, el('h3', {}, titulo), el('p', {}, r.resumen || textoDefault))),
  );

  if (r.hallazgos.length) {
    cont.append(el('h2', {}, `Hallazgos (${errores.length} errores, ${dudas.length} por revisar)`));
    [...errores, ...dudas].forEach((h) => cont.append(pintarHallazgo(h)));
  }

  if (r.verificacion_cliente?.length) {
    cont.append(el('h2', {}, 'Datos del cliente'));
    const iconos = { correcto: '✔ Correcto', diferente: '✘ Diferente', faltante: '✘ Falta' };
    cont.append(el('table', { class: 'verif' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Dato'), el('th', {}, 'Aprobado'), el('th', {}, 'En el diseño'), el('th', {}, 'Estado'))),
      el('tbody', {}, r.verificacion_cliente.map((v) => el('tr', {},
        el('td', {}, v.dato), el('td', {}, v.esperado), el('td', {}, v.encontrado || '—'),
        el('td', { class: `est-${v.estado}` }, iconos[v.estado] || v.estado)))),
    ));
  }

  if (r.texto_detectado) {
    cont.append(el('details', { class: 'transcripcion' },
      el('summary', {}, 'Ver todo el texto que leyó la IA'),
      el('pre', {}, r.texto_detectado)));
  }

  const copiar = el('button', { class: 'btn secondary', type: 'button' }, '📋 Copiar reporte');
  copiar.addEventListener('click', async () => {
    await navigator.clipboard.writeText(reporteTexto(r));
    copiar.textContent = '✔ Copiado';
    setTimeout(() => (copiar.textContent = '📋 Copiar reporte'), 1500);
  });
  const nueva = el('button', { class: 'btn secondary', type: 'button' }, '↺ Nueva revisión');
  nueva.addEventListener('click', () => {
    archivos.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    archivos.length = 0;
    pintarLista();
    $('textoCliente').value = ''; $('notas').value = '';
    $('salida').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  cont.append(
    el('div', { class: 'reporte-acciones' }, copiar, nueva),
    el('p', { class: 'estado-envio' }, `Revisado con ${modelo}. La IA puede equivocarse: confirma los hallazgos antes de corregir.`),
  );
}

function pintarHallazgo(h) {
  const cambio = el('dl', { class: 'cambio' },
    el('dt', {}, 'Dice'), el('dd', { class: h.correccion ? 'mal' : '' }, h.texto_actual || '—'));
  if (h.correccion) cambio.append(el('dt', {}, 'Debe decir'), el('dd', { class: 'bien' }, h.correccion));
  return el('div', { class: `hallazgo ${h.severidad}` },
    el('div', { class: 'meta' },
      el('span', { class: `chip ${h.severidad}` }, h.severidad === 'error' ? 'Error' : 'Revisar'),
      el('span', {}, ETIQUETAS_TIPO[h.tipo] || h.tipo),
      el('span', {}, `Archivo ${h.archivo} · ${h.ubicacion}`)),
    cambio,
    h.explicacion ? el('p', { class: 'expl' }, h.explicacion) : null);
}

function reporteTexto(r) {
  const [luz, titulo] = ETIQUETAS_ESTADO[r.estado_general] || ETIQUETAS_ESTADO.revisar;
  const lineas = [`${luz} ${titulo}`, r.resumen, ''];
  r.hallazgos.forEach((h, i) => {
    lineas.push(`${i + 1}. [${h.severidad === 'error' ? 'ERROR' : 'REVISAR'}] ${ETIQUETAS_TIPO[h.tipo] || h.tipo} · Archivo ${h.archivo} · ${h.ubicacion}`);
    lineas.push(`   Dice: ${h.texto_actual}${h.correccion ? `  →  Debe decir: ${h.correccion}` : ''}`);
    if (h.explicacion) lineas.push(`   ${h.explicacion}`);
  });
  if (r.verificacion_cliente?.length) {
    lineas.push('', 'Datos del cliente:');
    r.verificacion_cliente.forEach((v) => lineas.push(`- ${v.dato}: ${v.estado.toUpperCase()} (aprobado: ${v.esperado} / diseño: ${v.encontrado || '—'})`));
  }
  return lineas.join('\n');
}

// ---------- Instalación como app (PWA) ----------
// En la extensión (chrome-extension://) no se registra el service worker de la PWA.
if ('serviceWorker' in navigator && location.protocol !== 'chrome-extension:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

pintarLista();
if (!leerCfg('codigo_equipo') && !leerCfg('gemini_key')) avisar('Antes de empezar, abre ⚙ Ajustes y escribe el código del equipo.');
