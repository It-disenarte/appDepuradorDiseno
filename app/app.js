'use strict';
// Lógica del depurador: archivos, revisiones (con IA, rápida y técnica), reporte y ajustes.
// La estructura de la app (acceso, menú, carga, asistente) está en shell.js y asistente.js.

const MODELO_DEFAULT = 'gemini-3.8-flash';
const MAX_BYTES_DIRECTO = 18 * 1024 * 1024; // límite de datos en línea por petición a Gemini
const MAX_BYTES_SERVIDOR = 18 * 1024 * 1024; // el servidor del equipo acepta lo mismo que Gemini en línea
const TIPOS_OK = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

const archivos = []; // { file, url, nombre }
const modeloActual = () => leerCfg('gemini_modelo') || MODELO_DEFAULT;

// ---------- Ajustes ----------
document.addEventListener('pantalla', (e) => {
  if (e.detail !== 'ajustes') return;
  $('cfgModelo').value = modeloActual();
  $('cfgKey').value = leerCfg('gemini_key');
  $('cfgPermitidas').value = leerCfg('palabras_permitidas');
  $('ajustesAviso').hidden = true;
});
let temporizadorAviso;
$('formAjustes').addEventListener('submit', (e) => {
  e.preventDefault();
  guardarCfg('gemini_modelo', $('cfgModelo').value || MODELO_DEFAULT);
  guardarCfg('gemini_key', $('cfgKey').value.trim());
  guardarCfg('palabras_permitidas', $('cfgPermitidas').value.trim());
  $('ajustesAviso').hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { $('ajustesAviso').hidden = true; }, 3000);
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
      li.append(el('div', { class: 'pdf' }, icono('file'), a.nombre));
    }
    const quitar = el('button', { class: 'quitar', type: 'button', title: 'Quitar', 'aria-label': `Quitar ${a.nombre}` }, icono('x'));
    quitar.addEventListener('click', () => {
      if (a.url) URL.revokeObjectURL(a.url);
      archivos.splice(i, 1);
      pintarLista();
    });
    li.append(el('span', { class: 'num' }, String(i + 1)), quitar);
    ul.append(li);
  });
  habilitarBotones();
}

function habilitarBotones(ocupado = false) {
  $('btnRevisar').disabled = ocupado || archivos.length === 0;
  $('btnRapida').disabled = ocupado || archivos.length === 0;
  $('btnTecnica').disabled = ocupado || !archivos.some((a) => a.file.type === 'application/pdf');
  $('btnTecnica').title = $('btnTecnica').disabled && !ocupado ? 'Agrega el PDF final para la revisión técnica' : '';
}

// Ctrl+V en cualquier parte de la pantalla de revisión
document.addEventListener('paste', (e) => {
  if ($('app').hidden || Shell.actual() !== 'revisar') return;
  const items = [...(e.clipboardData?.items || [])];
  const imgs = items.filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
  if (imgs.length === 0) return; // texto normal: dejar que se pegue en el campo
  e.preventDefault();
  imgs.forEach((f) => agregarArchivo(f, f.name && f.name !== 'image.png' ? f.name : `captura-${archivos.length + 1}.png`));
});

// Botón "Pegar"
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
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('encima'); });
dz.addEventListener('dragleave', () => dz.classList.remove('encima'));
dz.addEventListener('drop', (e) => {
  e.preventDefault(); dz.classList.remove('encima');
  [...e.dataTransfer.files].forEach((f) => agregarArchivo(f));
});

// Medidas: solo números y un punto (la coma de miles se quita), como limpiarNumero del Cotizador.
['medAncho', 'medAlto'].forEach((id) => $(id).addEventListener('input', (e) => {
  const [entero, ...resto] = e.target.value.replace(/[^\d.]/g, '').split('.');
  const limpio = resto.length ? `${entero}.${resto.join('')}` : entero;
  if (limpio !== e.target.value) e.target.value = limpio;
}));

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
  if (!keyPropia && !codigo) { Shell.mostrarAcceso(); return; }
  const modelo = modeloActual();

  habilitarBotones(true);
  avisar('');
  Carga.mostrar('Preparando los archivos…');

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

    Carga.texto('Revisando con IA…');

    // Con API key propia se llama directo a Gemini; si no, por el servidor del equipo.
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
    if (resp.status === 401 && !keyPropia) throw new Error('el código del equipo ya no es válido. Usa "Salir" en el menú y vuelve a entrar con el nuevo.');
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.error?.message || `Error ${resp.status}`);
    const texto = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    if (!texto) throw new Error(`Gemini no devolvió respuesta (${json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'sin detalle'}).`);
    pintarReporte(JSON.parse(texto), {
      lector: 'la IA',
      pie: `Revisado con ${modelo}. La IA puede equivocarse: confirma los hallazgos antes de corregir.`,
    });
  } catch (err) {
    avisar(`No se pudo revisar: ${err.message}`, true);
  } finally {
    Carga.ocultar();
    habilitarBotones();
  }
}
$('btnRevisar').addEventListener('click', revisar);

// ---------- Revisiones sin IA (todo en el navegador) ----------
async function revisarRapida() {
  habilitarBotones(true);
  avisar('');
  Carga.mostrar('Preparando la revisión rápida…');
  try {
    const r = await revisionRapida(archivos, {
      textoCliente: $('textoCliente').value.trim(),
      permitidas: leerCfg('palabras_permitidas').split(/[\n,]/),
    }, Carga.texto);
    pintarReporte(r, {
      lector: 'el lector de texto',
      pie: 'Revisión rápida sin IA (lectura de texto + diccionario). No detecta texto cortado ni problemas visuales, '
        + 'y puede marcar letras mal leídas. Para una revisión completa usa "Revisar con IA".',
    });
  } catch (err) {
    avisar(`No se pudo hacer la revisión rápida: ${err.message}`, true);
  } finally {
    Carga.ocultar();
    habilitarBotones();
  }
}
$('btnRapida').addEventListener('click', revisarRapida);

async function revisarTecnica() {
  const pdfs = archivos.map((a, i) => ({ ...a, n: i + 1 })).filter((a) => a.file.type === 'application/pdf');
  habilitarBotones(true);
  avisar('');
  Carga.mostrar('Analizando el PDF…');
  try {
    const opciones = {
      ancho: $('medAncho').value, alto: $('medAlto').value, unidad: $('medUnidad').value,
      escala: $('medEscala').value, corte: $('medCorte').checked,
    };
    const verificaciones = [];
    for (const a of pdfs) {
      Carga.texto(`Analizando ${a.nombre}…`);
      const r = await revisionTecnica(a.file, opciones);
      verificaciones.push(...r.verificaciones.map((v) => (pdfs.length > 1 ? { ...v, nombre: `Archivo ${a.n} · ${v.nombre}` } : v)));
    }
    const errores = verificaciones.filter((v) => v.estado === 'error').length;
    const dudas = verificaciones.filter((v) => v.estado === 'revisar').length;
    pintarReporte({
      estado_general: errores ? 'con_errores' : dudas ? 'revisar' : 'aprobado',
      resumen: errores || dudas
        ? `${errores} problema(s) y ${dudas} punto(s) por revisar en la parte técnica.`
        : 'La parte técnica del PDF está lista para producción.',
      verificaciones, hallazgos: [], verificacion_cliente: [], texto_detectado: '',
    }, {
      pie: 'Revisión técnica automática del PDF, sin IA. No revisa ortografía: combínala con la revisión con IA o la rápida.',
    });
  } catch (err) {
    avisar(`No se pudo analizar el PDF: ${err.message}. Si está protegido o dañado, vuelve a exportarlo.`, true);
  } finally {
    Carga.ocultar();
    habilitarBotones();
  }
}
$('btnTecnica').addEventListener('click', revisarTecnica);

// ---------- Reporte ----------
const ESTADOS = {
  aprobado: ['circle-check', 'Listo para producción', 'No se encontraron errores.'],
  revisar: ['alert', 'Revisar antes de mandar', 'Hay puntos que conviene confirmar.'],
  con_errores: ['circle-x', 'No mandar todavía', 'Hay errores que corregir.'],
};
const ETIQUETAS_TIPO = {
  ortografia: 'Ortografía', texto_cortado: 'Texto cortado', legibilidad: 'Legibilidad',
  repeticion: 'Repetición', formato_dato: 'Formato de dato', inconsistencia: 'Inconsistencia',
  dato_cliente: 'Dato del cliente', otro: 'Otro',
};
const ICONOS_VERIF = { ok: 'circle-check', revisar: 'alert', error: 'circle-x', info: 'info' };

function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (n.className = v) : n.setAttribute(k, v)));
  hijos.flat().forEach((h) => h != null && n.append(h));
  return n;
}

const VACIO = $('reporte').innerHTML;
function mostrarVacio() { $('reporte').innerHTML = VACIO; }

function pintarReporte(r, { lector = '', pie = '' } = {}) {
  const errores = r.hallazgos.filter((h) => h.severidad === 'error');
  const dudas = r.hallazgos.filter((h) => h.severidad !== 'error');
  const [ic, titulo, textoDefault] = ESTADOS[r.estado_general] || ESTADOS.revisar;

  const cont = $('reporte');
  cont.replaceChildren(
    el('div', { class: `semaforo ${r.estado_general}` },
      icono(ic),
      el('div', {}, el('h2', {}, titulo), el('p', {}, r.resumen || textoDefault))),
  );

  if (r.verificaciones?.length) {
    cont.append(el('h3', { class: 'reporte-seccion' }, 'Revisión técnica'));
    cont.append(el('ul', { class: 'checklist' }, r.verificaciones.map((v) => el('li', { class: `v-${v.estado}` },
      icono(ICONOS_VERIF[v.estado] || 'info'),
      el('div', {}, el('strong', {}, v.nombre), el('p', {}, v.detalle))))));
  }

  if (r.hallazgos.length) {
    cont.append(el('h3', { class: 'reporte-seccion' }, `Hallazgos (${errores.length} errores, ${dudas.length} por revisar)`));
    [...errores, ...dudas].forEach((h) => cont.append(pintarHallazgo(h)));
  }

  if (r.verificacion_cliente?.length) {
    cont.append(el('h3', { class: 'reporte-seccion' }, 'Datos del cliente'));
    const etiquetas = { correcto: 'Correcto', diferente: 'Diferente', faltante: 'Falta' };
    cont.append(el('table', { class: 'tabla-cliente' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Dato'), el('th', {}, 'Aprobado'), el('th', {}, 'En el diseño'), el('th', {}, 'Estado'))),
      el('tbody', {}, r.verificacion_cliente.map((v) => el('tr', {},
        el('td', {}, v.dato), el('td', {}, v.esperado), el('td', {}, v.encontrado || '—'),
        el('td', { class: `est-${v.estado}` }, etiquetas[v.estado] || v.estado)))),
    ));
  }

  if (r.texto_detectado) {
    cont.append(el('details', { class: 'transcripcion' },
      el('summary', {}, `Ver todo el texto que leyó ${lector || 'la revisión'}`),
      el('pre', {}, r.texto_detectado)));
  }

  const copiar = el('button', { class: 'btn btn-contorno', type: 'button' }, icono('copy'), 'Copiar reporte');
  copiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(reporteTexto(r));
      copiar.replaceChildren(icono('check'), 'Copiado');
    } catch {
      copiar.replaceChildren(icono('x'), 'No se pudo copiar');
    }
    setTimeout(() => copiar.replaceChildren(icono('copy'), 'Copiar reporte'), 1600);
  });
  const nueva = el('button', { class: 'btn btn-fantasma', type: 'button' }, icono('rotate'), 'Nueva revisión');
  nueva.addEventListener('click', () => {
    archivos.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    archivos.length = 0;
    pintarLista();
    $('textoCliente').value = ''; $('notas').value = '';
    mostrarVacio();
    avisar('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  cont.append(el('div', { class: 'reporte-acciones' }, copiar, nueva), el('p', { class: 'reporte-pie' }, pie));
  if (window.innerWidth < 1180) $('salida').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pintarHallazgo(h) {
  const cambio = el('dl', { class: 'cambio' },
    el('dt', {}, 'Dice'), el('dd', { class: h.correccion ? 'mal' : '' }, h.texto_actual || '—'));
  if (h.correccion) cambio.append(el('dt', {}, 'Debe decir'), el('dd', { class: 'bien' }, h.correccion));
  return el('div', { class: `hallazgo ${h.severidad}` },
    el('div', { class: 'meta' },
      el('span', { class: `insignia ${h.severidad}` }, h.severidad === 'error' ? 'Error' : 'Revisar'),
      el('span', {}, ETIQUETAS_TIPO[h.tipo] || h.tipo),
      el('span', {}, `Archivo ${h.archivo}${h.ubicacion ? ` · ${h.ubicacion}` : ''}`)),
    cambio,
    h.explicacion ? el('p', { class: 'expl' }, h.explicacion) : null);
}

function reporteTexto(r) {
  const [, titulo] = ESTADOS[r.estado_general] || ESTADOS.revisar;
  const marca = { aprobado: '🟢', revisar: '🟡', con_errores: '🔴' }[r.estado_general] || '🟡';
  const lineas = [`${marca} ${titulo}`, r.resumen, ''];
  (r.verificaciones || []).forEach((v) => lineas.push(`[${v.estado.toUpperCase()}] ${v.nombre}: ${v.detalle}`));
  if (r.verificaciones?.length) lineas.push('');
  r.hallazgos.forEach((h, i) => {
    lineas.push(`${i + 1}. [${h.severidad === 'error' ? 'ERROR' : 'REVISAR'}] ${ETIQUETAS_TIPO[h.tipo] || h.tipo} · Archivo ${h.archivo}${h.ubicacion ? ` · ${h.ubicacion}` : ''}`);
    lineas.push(`   Dice: ${h.texto_actual}${h.correccion ? `  →  Debe decir: ${h.correccion}` : ''}`);
    if (h.explicacion) lineas.push(`   ${h.explicacion}`);
  });
  if (r.verificacion_cliente?.length) {
    lineas.push('', 'Datos del cliente:');
    r.verificacion_cliente.forEach((v) => lineas.push(`- ${v.dato}: ${v.estado.toUpperCase()} (aprobado: ${v.esperado} / diseño: ${v.encontrado || '—'})`));
  }
  return lineas.join('\n');
}

pintarLista();
Shell.iniciar();
