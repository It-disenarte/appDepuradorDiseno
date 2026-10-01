'use strict';
// Asistente de uso: recorre la pantalla paso a paso y señala cada sección marcada con data-guide.
// Paso: { t?: data-guide, m?: true si está en el menú, titulo, texto, lista?: [[etiqueta, texto]], nota? }
// Los pasos cuyo elemento no está en pantalla (solo celular, reporte vacío, etc.) se descartan al iniciar.

const PASOS = {
  revisar: [
    {
      titulo: 'Te damos la bienvenida al Depurador',
      texto: 'Con esta app revisas un diseño antes de mandarlo a impresión o corte: faltas de ortografía, texto cortado, datos del cliente mal escritos y la parte técnica del PDF. Este asistente te explica cada sección.',
      nota: 'Avanza con "Siguiente" o con las flechas del teclado. "Saltar" cierra la guía de esta pantalla. Si ya no la necesitas, marca "No volver a mostrar el asistente" abajo.',
    },
    {
      t: 'menu-boton', titulo: 'Botón de menú',
      texto: 'Toca este botón para abrir el menú. Desde ahí cambias de pantalla y llegas a las opciones de la app. Se cierra al elegir una opción, tocando fuera o con la ×.',
    },
    {
      t: 'menu-nav', m: true, titulo: 'Secciones',
      texto: 'Las pantallas de la app:',
      lista: [
        ['Revisar diseño', 'aquí pegas tu diseño y eliges el tipo de revisión.'],
        ['Ajustes', 'el modelo de IA, las palabras permitidas y opciones avanzadas.'],
      ],
    },
    {
      t: 'menu-cuenta', m: true, titulo: 'Opciones de la app',
      texto: 'Opciones que aplican en cualquier pantalla:',
      lista: [
        ['Asistente de uso', 'el interruptor enciende o apaga esta guía. Encendido (turquesa), cada pantalla te explica sus secciones al abrirla.'],
        ['Ver guía de esta pantalla', 'vuelve a mostrar la guía de donde estés, aunque el asistente esté apagado.'],
        ['Instalar como app', 'aparece solo si tu navegador lo permite y la app aún no está instalada. La agrega a tu escritorio con su propio ícono.'],
      ],
    },
    {
      t: 'menu-pie', m: true, titulo: 'Tu acceso',
      texto: 'Entraste con el código del equipo. "Salir" lo borra de esta computadora y te regresa a la pantalla de entrada; úsalo si la computadora es compartida o si cambió el código.',
    },
    {
      t: 'ayuda', titulo: 'Botón de ayuda',
      texto: 'Toca ? para ver otra vez la guía de la pantalla en la que estés.',
    },
    {
      t: 'entrada', titulo: 'Diseño a revisar',
      texto: 'Agrega aquí lo que quieres revisar:',
      lista: [
        ['Pegar', 'toma una captura con Win + Shift + S y pégala con Ctrl + V en cualquier parte de la pantalla, o con el botón "Pegar".'],
        ['Elegir archivo', 'sube un PNG, JPG o el PDF final. También puedes arrastrarlo a este recuadro.'],
        ['Varias partes', 'agrega varias capturas del mismo trabajo y se revisan juntas. Quita una con la × de su miniatura.'],
      ],
      nota: 'En diseños grandes, captura por partes con zoom: el texto chico se lee mejor.',
    },
    {
      t: 'cliente', titulo: 'Texto aprobado por el cliente',
      texto: 'Opcional. Pega los datos que aprobó el cliente, uno por renglón (por ejemplo "Teléfono: 427 211 05 28"). La revisión compara cada uno con el diseño y te dice si está bien, si es diferente o si falta.',
    },
    {
      t: 'notas', titulo: 'Notas para la revisión',
      texto: 'Opcional. Dile a la IA algo que deba saber, por ejemplo que una palabra se escribe así a propósito.',
    },
    {
      t: 'tecnicos', titulo: 'Datos técnicos',
      texto: 'Solo para la revisión técnica del PDF. Tócalo para abrirlo y llena:',
      lista: [
        ['Ancho y alto', 'la medida final que pidió el cliente; se compara con la del PDF.'],
        ['Escala', 'si el archivo está a 1:10 u otra escala, para calcular el tamaño y la resolución reales.'],
        ['Corte o suaje', 'márcalo si el trabajo lleva línea de corte; la revisión exige que el PDF la tenga.'],
      ],
    },
    {
      t: 'revisiones', titulo: 'Tipos de revisión',
      texto: 'Se activan cuando agregas un diseño. Al tocar uno aparece el reporte:',
      lista: [
        ['Revisar con IA', 'la más completa: ortografía, texto cortado o encimado, legibilidad y datos del cliente. Cuesta centavos por revisión.'],
        ['Revisión rápida', 'ortografía con diccionario, palabras repetidas, teléfonos y correos. Gratis y sin enviar nada; puede confundir letras.'],
        ['Revisión técnica', 'solo con PDF: tamaño, rebase, CMYK, resolución, fuentes y línea de corte.'],
      ],
    },
    {
      t: 'reporte', titulo: 'Reporte',
      texto: 'Aquí aparece el resultado: en rojo lo que hay que corregir, en amarillo lo que conviene confirmar y en verde lo que está bien. Con "Copiar reporte" lo pegas en WhatsApp o en un correo.',
    },
  ],
  ajustes: [
    {
      t: 'cfg-modelo', titulo: 'Modelo de IA',
      texto: 'El modelo de Gemini que usa "Revisar con IA". El recomendado es rápido y preciso; el de máxima precisión tarda más y el económico cuesta menos.',
    },
    {
      t: 'cfg-avanzado', titulo: 'Avanzado',
      texto: 'Solo si necesitas revisar con IA un PDF de más de 3 MB: con una API key propia de Gemini, la revisión se hace directo desde esta computadora y acepta hasta 18 MB.',
    },
    {
      t: 'cfg-permitidas', titulo: 'Palabras permitidas',
      texto: 'Nombres de clientes, marcas o productos que no están en el diccionario. La revisión rápida no los marcará como faltas. Escribe uno por renglón.',
    },
    {
      t: 'cfg-guardar', titulo: 'Guardar',
      texto: 'Guarda los ajustes en esta computadora. No se comparten con las demás.',
    },
  ],
};

const Asistente = (() => {
  const PAD = 6, GAP = 12;
  const raiz = $('asistente');
  let st = null; // { pantalla, pasos, i, abrioMenu, noMostrar, rect }

  const activo = () => leerCfg('asistente_activo', '1') !== '0';
  const buscar = (t) => (t ? document.querySelector(`[data-guide="${t}"]`) : null);
  const visible = (el) => { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const marcarVisto = (p) => { try { sessionStorage.setItem(`asistente_visto_${p}`, '1'); } catch { /* */ } };
  const yaVisto = (p) => { try { return sessionStorage.getItem(`asistente_visto_${p}`) === '1'; } catch { return false; } };

  // Al entrar a una pantalla, mientras el asistente esté activo y no se haya cerrado en esta sesión.
  function alEntrar(pantalla) {
    if (activo() && !yaVisto(pantalla) && !st) setTimeout(() => { if (Shell.actual() === pantalla && !st) iniciar(pantalla); }, 350);
  }

  function iniciar(pantalla) {
    if (st) terminar(false);
    const pasos = (PASOS[pantalla] || []).filter((p) => {
      if (!p.t) return true;
      const el = buscar(p.t);
      if (!el) return false;
      return p.m ? true : !!visible(el); // los del menú existen aunque el cajón esté cerrado
    });
    if (!pasos.length) return;
    st = { pantalla, pasos, i: 0, abrioMenu: false, noMostrar: false, rect: null };
    raiz.hidden = false;
    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', posicionar, true);
    window.addEventListener('keydown', teclas);
    mostrar(0);
  }

  async function mostrar(i) {
    st.i = i;
    const paso = st.pasos[i];
    // En celular, los pasos del menú abren el cajón y esperan a que termine la animación.
    if (paso.m && Shell.esMovil() && !Shell.menuAbierto()) { Shell.abrirMenu(); st.abrioMenu = true; await espera(260); }
    if (!paso.m && st.abrioMenu) { Shell.cerrarMenu(); st.abrioMenu = false; await espera(240); }
    if (!st) return;
    const el = buscar(paso.t);
    if (el && !paso.m) {
      const r = el.getBoundingClientRect();
      if (r.top < 72 || r.bottom > window.innerHeight - 24) { el.scrollIntoView({ block: 'center' }); await espera(40); }
    }
    pintar();
  }

  function pintar() {
    const { pasos, i } = st;
    const paso = pasos[i];
    const ultimo = i === pasos.length - 1;
    raiz.innerHTML = `
      <div class="asistente-velo"></div>
      <div class="asistente-foco" hidden></div>
      <div class="asistente-tarjeta">
        <div class="asistente-filete"></div>
        <div class="asistente-cuerpo">
          <div class="asistente-cabeza">
            <span class="asistente-paso">Asistente · ${i + 1} de ${pasos.length}</span>
            <button class="asistente-cerrar" type="button" data-accion="cerrar" aria-label="Cerrar asistente"><svg class="ic"><use href="#i-x"/></svg></button>
          </div>
          <div class="asistente-titulo" id="asistenteTitulo">${esc(paso.titulo)}</div>
          ${paso.texto ? `<div class="asistente-texto">${esc(paso.texto)}</div>` : ''}
          ${paso.lista ? `<ul class="asistente-lista">${paso.lista.map(([e, t]) => `<li><b>${esc(e)}:</b> ${esc(t)}</li>`).join('')}</ul>` : ''}
          ${paso.nota ? `<div class="asistente-nota">${esc(paso.nota)}</div>` : ''}
          <div class="asistente-avance">${pasos.map((_, n) => `<span class="${n <= i ? 'visto' : ''}"></span>`).join('')}</div>
          <div class="asistente-botones">
            ${ultimo ? '<span></span>' : '<button class="asistente-saltar" type="button" data-accion="cerrar">Saltar</button>'}
            <div>
              ${i > 0 ? '<button class="btn btn-contorno btn-chico" type="button" data-accion="anterior">Anterior</button>' : ''}
              <button class="btn btn-primario btn-chico" type="button" data-accion="siguiente">${ultimo ? 'Entendido' : 'Siguiente'}</button>
            </div>
          </div>
          <label class="asistente-nomostrar"><input type="checkbox" ${st.noMostrar ? 'checked' : ''}>
            <span>No volver a mostrar el asistente. <span class="tenue">Puedes reactivarlo desde el menú.</span></span></label>
        </div>
      </div>`;
    raiz.querySelector('input[type=checkbox]').addEventListener('change', (e) => { st.noMostrar = e.target.checked; });
    raiz.querySelectorAll('[data-accion]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.accion;
      if (a === 'cerrar') terminar(true); else if (a === 'anterior') anterior(); else siguiente();
    }));
    posicionar();
    raiz.querySelector('[data-accion="siguiente"]').focus({ preventScroll: true });
  }

  // Tarjeta debajo del elemento si cabe; si no, arriba; si no, pegada abajo.
  // En escritorio, los pasos del menú lateral ponen la tarjeta a su derecha.
  function posicionar() {
    if (!st) return;
    const paso = st.pasos[st.i];
    const foco = raiz.querySelector('.asistente-foco');
    const velo = raiz.querySelector('.asistente-velo');
    const tarjeta = raiz.querySelector('.asistente-tarjeta');
    if (!tarjeta) return;
    const r = visible(buscar(paso.t));
    const vw = window.innerWidth, vh = window.innerHeight;
    tarjeta.style.top = tarjeta.style.bottom = tarjeta.style.left = '';
    if (!r) {
      foco.hidden = true; velo.hidden = false;
      tarjeta.classList.add('centrada');
      return;
    }
    foco.hidden = false; velo.hidden = true;
    tarjeta.classList.remove('centrada');
    Object.assign(foco.style, { top: `${r.top - PAD}px`, left: `${r.left - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px` });
    const W = tarjeta.offsetWidth, H = tarjeta.offsetHeight;
    if (paso.m && !Shell.esMovil() && vw - (r.right + PAD + GAP) >= W + 16) {
      tarjeta.style.top = `${Math.max(16, Math.min(r.top - PAD, vh - H - 16))}px`;
      tarjeta.style.left = `${r.right + PAD + GAP}px`;
      return;
    }
    tarjeta.style.left = `${Math.max(16, Math.min(r.left + r.width / 2 - W / 2, vw - W - 16))}px`;
    // Con el alto real de la tarjeta: una tarjeta larga nunca se sale de la pantalla.
    const abajo = vh - (r.bottom + PAD + GAP) - 16, arriba = r.top - PAD - GAP - 16;
    if (abajo >= H) tarjeta.style.top = `${r.bottom + PAD + GAP}px`;
    else if (arriba >= H) tarjeta.style.bottom = `${vh - (r.top - PAD - GAP)}px`;
    else tarjeta.style.bottom = '16px';
  }

  function siguiente() { if (st.i === st.pasos.length - 1) terminar(true); else mostrar(st.i + 1); }
  function anterior() { if (st.i > 0) mostrar(st.i - 1); }
  function teclas(e) {
    if (e.key === 'Escape') terminar(true);
    else if (e.key === 'ArrowRight') siguiente();
    else if (e.key === 'ArrowLeft') anterior();
  }

  function terminar(marcar) {
    if (!st) return;
    if (st.abrioMenu) Shell.cerrarMenu();
    if (st.noMostrar) { guardarCfg('asistente_activo', '0'); Shell.pintarInterruptor(); }
    if (marcar) marcarVisto(st.pantalla);
    window.removeEventListener('resize', posicionar);
    window.removeEventListener('scroll', posicionar, true);
    window.removeEventListener('keydown', teclas);
    raiz.replaceChildren();
    raiz.hidden = true;
    st = null;
  }

  return { activo, alEntrar, iniciar, terminar: () => terminar(true) };
})();
