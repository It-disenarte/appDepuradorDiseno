'use strict';
// Carga bajo demanda de las librerías locales (vendor/). Nada se descarga hasta que se usa
// y todo corre en el navegador: sirve igual en Vercel y en la extensión (que no permite código remoto).

const rutaLocal = (ruta) => new URL(ruta, location.href).href;
const cacheLibs = {};

function cargarScript(ruta) {
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = rutaLocal(ruta);
    s.onload = ok;
    s.onerror = () => mal(new Error(`no se pudo cargar ${ruta}`));
    document.head.append(s);
  });
}

function cargarPdfJs() {
  cacheLibs.pdfjs ??= import(rutaLocal('vendor/pdfjs/pdf.min.mjs')).then((pdfjsLib) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = rutaLocal('vendor/pdfjs/pdf.worker.min.mjs');
    return pdfjsLib;
  });
  return cacheLibs.pdfjs;
}

function cargarPdfLib() {
  cacheLibs.pdflib ??= cargarScript('vendor/pdf-lib.min.js').then(() => window.PDFLib);
  return cacheLibs.pdflib;
}

function cargarOrtografia() {
  cacheLibs.nspell ??= (async () => {
    const [, aff, dic] = await Promise.all([
      cargarScript('vendor/nspell.min.js'),
      fetch(rutaLocal('vendor/diccionario/es-MX.aff')).then((r) => r.text()),
      fetch(rutaLocal('vendor/diccionario/es-MX.dic')).then((r) => r.text()),
    ]);
    return window.nspell(aff, dic);
  })();
  return cacheLibs.nspell;
}

// Un solo worker de OCR para toda la sesión: la primera vez descarga ~6 MB (motor + español) y el navegador los guarda.
function cargarOcr(alProgresar) {
  cacheLibs.ocr ??= (async () => {
    await cargarScript('vendor/tesseract/tesseract.min.js');
    const worker = await window.Tesseract.createWorker('spa', 1, {
      workerPath: rutaLocal('vendor/tesseract/worker.min.js'),
      corePath: rutaLocal('vendor/tesseract/core'),
      langPath: rutaLocal('vendor/tesseract/lang'),
      workerBlobURL: false,
      gzip: false, // el idioma va sin comprimir: así ningún servidor lo descomprime por su cuenta
      logger: (m) => cacheLibs.alProgresarOcr?.(m),
    });
    // Segmentación automática: un diseño tiene bloques de texto sueltos (el modo por defecto asume uno solo
    // y se salta, por ejemplo, texto oscuro dentro de una caja clara).
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    return worker;
  })();
  cacheLibs.alProgresarOcr = alProgresar;
  return cacheLibs.ocr;
}
