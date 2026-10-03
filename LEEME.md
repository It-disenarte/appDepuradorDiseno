# Depurador de Diseños

Revisa un diseño antes de mandarlo a producción: ortografía, letras faltantes, texto cortado, datos mal escritos, comparación contra el texto que aprobó el cliente y la parte técnica del PDF (tamaño, rebase, color, resolución, fuentes y línea de corte).

## Uso
Al abrirla por primera vez pide el **código del equipo** (se valida contra el servidor y queda guardado en ese equipo). **Salir**, en el menú, lo borra.

1. Toma una captura con `Win + Shift + S` y pégala con `Ctrl + V`, o arrastra un PNG, JPG o PDF.
2. (Opcional) Pega el texto que aprobó el cliente y, para el PDF, la medida final en **Datos técnicos**.
3. Elige el tipo de revisión:

| Revisión | Qué revisa | Costo | Se envía algo |
|---|---|---|---|
| 🔍 **Con IA** (Gemini) | Ortografía, texto cortado o encimado, legibilidad, formatos y datos del cliente | Centavos por revisión | Sí, a Gemini (vía el servidor del equipo) |
| ⚡ **Rápida** | Ortografía con diccionario es-MX, palabras repetidas, teléfonos, correos, webs y datos del cliente | Gratis | No, todo en el navegador |
| 📐 **Técnica** (solo PDF) | Tamaño, rebase, fuentes incrustadas, RGB/CMYK, resolución real de imágenes, línea de corte y margen de seguridad | Gratis | No, todo en el navegador |

La primera vez que se usa la revisión rápida, el navegador descarga ~7 MB (lector de texto + idioma) y los guarda; después tarda 1–2 s.
Nombres de clientes o marcas que no estén en el diccionario se agregan en ⚙ Ajustes → **Palabras permitidas**.

## Despliegue en la VPS (Easypanel)
Igual que Levantamientos y el Cotizador: Easypanel construye el `Dockerfile` desde GitHub. `server.js` sirve la app y la API en el puerto 3000, sin dependencias.

1. Proyecto `hub_disenarte` › **+ Service › App**: nombre `depurador`.
2. **Source › GitHub**: este repo, rama `main`. **Build › Dockerfile** (ruta `Dockerfile`).
3. **Environment**:
   ```
   GEMINI_API_KEY=<key de Google AI Studio>
   CODIGO_EQUIPO=<clave que se comparte solo con las diseñadoras>
   ```
4. **Domains**: `depurador.disenartemx.com` → puerto **3000**, HTTPS activado.
   En el DNS, un registro A de `depurador` a la IP de la VPS.
5. **Deploy**. Comprueba `https://depurador.disenartemx.com/api/salud` → `{"ok":true,"gemini":true,"codigo":true}`.
6. Activa **Auto Deploy** para que cada push a `main` publique la versión nueva.

Si usas otro dominio, cámbialo en `app/shell.js` (`URL_PRODUCCION`) y en `app/manifest.json` (`host_permissions`): la extensión lo necesita.

La API key vive solo en el servidor; nunca llega al navegador. Sin el código del equipo, nadie puede usar la API.

### Al publicar una versión nueva
Sube el número de caché en `app/sw.js` (`depurador-v6`) para que las apps instaladas tomen la versión nueva.

### Mientras conviva con Vercel
`.vercelignore` deja fuera `server.js` y el `Dockerfile`, así que la versión de Vercel sigue funcionando igual. Cuando la VPS esté lista, desconecta el proyecto en Vercel y borra `vercel.json` y `.vercelignore`.

## Instalar como app de escritorio (PWA)
Abre `https://depurador.disenartemx.com` en Chrome o Edge y en el menú elige **Instalar como app** (o el ícono de instalar en la barra de direcciones). Queda con ícono propio en el escritorio y en el menú Inicio.

## Instalar como extensión de Chrome o Edge (panel lateral)
1. Abre `chrome://extensions` (o `edge://extensions`) y activa **Modo de desarrollador**.
2. Clic en **Cargar descomprimida** y selecciona la carpeta `app/`.
3. Fija el ícono. Al hacer clic se abre el Depurador en el panel lateral y usa el servidor de la VPS.

## Probar en tu equipo
1. Copia `.env.example` como `.env.local` y llena las dos variables.
2. Doble clic en `iniciar.bat` (requiere Node.js 22.9 o más nuevo). Se abre `http://localhost:3000` con el mismo servidor de producción.

## Diseño
Sigue la guía de diseño unificado de las apps de Diseñarte (estándar: Cotizador): morado #7C07A6, Poppins incluida, fondo con textura al 7 %, menú lateral morado (cajón en celular), acceso de dos columnas, asistente de uso que señala cada sección, pantalla de carga e ícono propio (hoja morada con lupa).

## Estructura
- `app/`: la app. Funciona como PWA y como extensión.
  - `shell.js`: acceso, menú, navegación entre pantallas, pantalla de carga e instalación.
  - `asistente.js`: asistente de uso y los textos de cada pantalla.
  - `app.js`: archivos, revisiones, reporte y ajustes.
  - `rapida.js`: revisión rápida (OCR con Tesseract.js o texto del PDF + diccionario con nspell).
  - `tecnica.js`: revisión técnica del PDF (pdf.js + pdf-lib).
  - `librerias.js`: carga esas librerías solo cuando se usan.
  - `vendor/`: librerías locales (~18 MB; la extensión no permite cargar código de internet).
- `api/revisar.mjs`: API que agrega la API key y reenvía la petición a Gemini.
- `server.js`: servidor de la app y la API (VPS y local). `GET /api/salud` para el chequeo de salud.
- `Dockerfile`: imagen para Easypanel. `iniciar.bat`: arranque local.

## Límites actuales
- Máximo **18 MB por revisión** con IA (límite de Gemini para archivos en línea). Las capturas de más de 1 MB se comprimen solas.
- La revisión técnica solo ve texto vivo para el margen de seguridad; el texto en curvas no se puede medir.
- La revisión rápida depende de que el OCR lea bien: tipografías decorativas o texto sobre fotos pueden dar falsas alarmas.
- La IA puede equivocarse: el reporte es una ayuda, no reemplaza la revisión humana.
