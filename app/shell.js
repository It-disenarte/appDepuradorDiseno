'use strict';
// Estructura común de las apps de Diseñarte: acceso, menú lateral (cajón en celular), navegación
// entre pantallas, pantalla de carga e instalación como app. La lógica del depurador va en app.js.

// La app llama a su función de Vercel (/api/revisar), donde vive la API key.
// La extensión no corre en ese dominio, así que necesita la URL completa del despliegue.
const URL_PRODUCCION = 'https://app-dep-dis.vercel.app';
const ES_EXTENSION = location.protocol === 'chrome-extension:';
const API_URL = (ES_EXTENSION ? URL_PRODUCCION : '') + '/api/revisar';

const $ = (id) => document.getElementById(id);

function leerCfg(clave, porDefecto = '') {
  try { return localStorage.getItem(clave) ?? porDefecto; } catch { return porDefecto; }
}
function guardarCfg(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}
function borrarCfg(clave) {
  try { localStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
}

// Ícono de línea del sprite de index.html
function icono(nombre, clase = 'ic') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', clase);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${nombre}`);
  svg.append(use);
  return svg;
}

// Pantalla de carga: bloquea clics desde el primer instante y aparece con retraso para no parpadear.
const Carga = {
  mostrar(texto) { $('cargaTexto').textContent = texto; $('carga').hidden = false; },
  texto(texto) { $('cargaTexto').textContent = texto; },
  ocultar() { $('carga').hidden = true; },
};

const Shell = (() => {
  const PANTALLAS = ['revisar', 'ajustes'];
  let actual = null;
  let promptInstalar = null;
  const movil = window.matchMedia('(max-width: 767px)');

  // ---------- Acceso con el código del equipo ----------
  function mostrarAcceso() {
    $('app').hidden = true;
    $('acceso').hidden = false;
    $('accCodigo').value = '';
    $('accError').hidden = true;
    setTimeout(() => $('accCodigo').focus(), 50);
  }

  $('formAcceso').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = $('accCodigo').value.trim();
    const error = (msg) => { $('accError').textContent = msg; $('accError').hidden = false; };
    if (!codigo) { error('Escribe el código del equipo.'); return; }
    $('accError').hidden = true;
    Carga.mostrar('Entrando…');
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-codigo-equipo': codigo },
        body: JSON.stringify({ verificar: true }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.status === 401) { error('Código incorrecto. Revísalo con el administrador.'); return; }
      if (!resp.ok) { error(json.error?.message || `El servidor respondió con un error (${resp.status}).`); return; }
      guardarCfg('codigo_equipo', codigo);
      mostrarApp();
    } catch {
      error('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
    } finally {
      Carga.ocultar();
    }
  });

  function salir() {
    Asistente.terminar();
    cerrarMenu();
    Carga.mostrar('Cerrando sesión…');
    borrarCfg('codigo_equipo');
    borrarCfg('gemini_key');
    mostrarAcceso();
    Carga.ocultar();
  }
  $('btnSalir').addEventListener('click', salir);

  // ---------- Navegación ----------
  function mostrarApp() {
    $('acceso').hidden = true;
    $('app').hidden = false;
    irA(location.hash.slice(1));
  }

  function irA(nombre) {
    if (!PANTALLAS.includes(nombre)) nombre = 'revisar';
    if (location.hash !== `#${nombre}`) history.replaceState(null, '', `#${nombre}`);
    document.querySelectorAll('.pantalla').forEach((s) => { s.hidden = s.dataset.pantalla !== nombre; });
    document.querySelectorAll('.menu-item[data-ir]').forEach((a) => {
      const activo = a.dataset.ir === nombre;
      a.classList.toggle('activo', activo);
      if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    cerrarMenu();
    const cambio = actual !== nombre;
    actual = nombre;
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('pantalla', { detail: nombre }));
    if (cambio) Asistente.alEntrar(nombre);
  }

  document.querySelectorAll('.menu-item[data-ir]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    irA(a.dataset.ir);
  }));
  window.addEventListener('hashchange', () => { if (!$('app').hidden) irA(location.hash.slice(1)); });

  // ---------- Menú en celular (cajón) ----------
  function abrirMenu() {
    if (!movil.matches) return;
    $('menu').classList.add('abierto');
    $('fondoMenu').hidden = false;
    $('btnMenu').setAttribute('aria-expanded', 'true');
  }
  function cerrarMenu() {
    $('menu').classList.remove('abierto');
    $('fondoMenu').hidden = true;
    $('btnMenu').setAttribute('aria-expanded', 'false');
  }
  $('btnMenu').addEventListener('click', abrirMenu);
  $('btnCerrarMenu').addEventListener('click', cerrarMenu);
  $('fondoMenu').addEventListener('click', cerrarMenu);
  movil.addEventListener('change', cerrarMenu);

  // ---------- Opciones de cuenta ----------
  function pintarInterruptor() {
    $('btnAsistente').setAttribute('aria-checked', String(Asistente.activo()));
  }
  $('btnAsistente').addEventListener('click', () => {
    guardarCfg('asistente_activo', Asistente.activo() ? '0' : '1');
    pintarInterruptor();
  });
  const verGuia = () => { cerrarMenu(); Asistente.iniciar(actual); };
  $('btnVerGuia').addEventListener('click', verGuia);
  $('btnAyuda').addEventListener('click', verGuia);

  // "Instalar como app": solo si el navegador lo ofrece y aún no está instalada (no aplica a la extensión)
  window.addEventListener('beforeinstallprompt', (e) => {
    if (ES_EXTENSION) return;
    e.preventDefault();
    promptInstalar = e;
    $('btnInstalar').hidden = false;
  });
  window.addEventListener('appinstalled', () => { $('btnInstalar').hidden = true; promptInstalar = null; });
  $('btnInstalar').addEventListener('click', async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    await promptInstalar.userChoice.catch(() => {});
    promptInstalar = null;
    $('btnInstalar').hidden = true;
  });

  if ('serviceWorker' in navigator && !ES_EXTENSION) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  function iniciar() {
    pintarInterruptor();
    if (leerCfg('codigo_equipo') || leerCfg('gemini_key')) mostrarApp(); else mostrarAcceso();
  }

  return {
    iniciar, irA, salir, mostrarAcceso, abrirMenu, cerrarMenu, pintarInterruptor,
    esMovil: () => movil.matches,
    menuAbierto: () => $('menu').classList.contains('abierto'),
    actual: () => actual,
  };
})();
