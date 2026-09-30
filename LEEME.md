# Depurador de Diseños

Revisa un diseño antes de mandarlo a producción: ortografía, letras faltantes, texto cortado, datos mal escritos, comparación contra el texto que aprobó el cliente y la parte técnica del PDF (tamaño, rebase, color, resolución, fuentes y línea de corte).

## Uso
1. Toma una captura con `Win + Shift + S` y pégala con `Ctrl + V`, o arrastra un PNG, JPG o PDF.
2. (Opcional) Pega el texto que aprobó el cliente y, para el PDF, la medida final en **Datos técnicos**.
3. Elige el tipo de revisión:

| Revisión | Qué revisa | Costo | Se envía algo |
|---|---|---|---|
| 🔍 **Con IA** (Gemini) | Ortografía, texto cortado o encimado, legibilidad, formatos y datos del cliente | Centavos por revisión | Sí, a Gemini (vía Vercel) |
| ⚡ **Rápida** | Ortografía con diccionario es-MX, palabras repetidas, teléfonos, correos, webs y datos del cliente | Gratis | No, todo en el navegador |
| 📐 **Técnica** (solo PDF) | Tamaño, rebase, fuentes incrustadas, RGB/CMYK, resolución real de imágenes, línea de corte y margen de seguridad | Gratis | No, todo en el navegador |

La primera vez que se usa la revisión rápida, el navegador descarga ~7 MB (lector de texto + idioma) y los guarda; después tarda 1–2 s.
Nombres de clientes o marcas que no estén en el diccionario se agregan en ⚙ Ajustes → **Palabras permitidas**.

## Despliegue en Vercel
1. Sube esta carpeta a un repositorio de GitHub e impórtalo en Vercel. `vercel.json` ya indica que los archivos de la app están en `app/` y que la función está en `api/`.
2. En Vercel, entra a **Settings → Environment Variables** y agrega:
   - `GEMINI_API_KEY`: la key de [Google AI Studio](https://aistudio.google.com/apikey).
   - `CODIGO_EQUIPO`: una clave inventada que se comparte solo con las diseñadoras.
3. Vuelve a desplegar para que tome las variables.
4. Si la URL final no es `https://app-dep-dis.vercel.app`, cámbiala en:
   - `app/app.js`, en la constante `URL_PRODUCCION`.
   - `app/manifest.json`, en `host_permissions`.

La API key vive solo en Vercel; nunca llega al navegador. Sin el código del equipo, nadie puede usar la función.

## Instalar como app de escritorio (PWA)
Abre la URL de Vercel en Chrome o Edge, ve al menú ⋮ y elige **Instalar Depurador de Diseños**. Queda con ícono propio en el escritorio y en el menú Inicio.

## Instalar como extensión de Chrome o Edge (panel lateral)
1. Abre `chrome://extensions` (o `edge://extensions`) y activa **Modo de desarrollador**.
2. Clic en **Cargar descomprimida** y selecciona la carpeta `app/`.
3. Fija el ícono de la lupa. Al hacer clic se abre el Depurador en el panel lateral y usa el servidor de Vercel.

## Probar en tu equipo
1. Copia `.env.example` como `.env.local` y llena las dos variables.
2. Doble clic en `iniciar.bat` (requiere Node.js 24). Se abre `http://localhost:5173` con la misma función del servidor.

## Estructura
- `app/`: la app. Funciona como PWA y como extensión.
  - `rapida.js`: revisión rápida (OCR con Tesseract.js o texto del PDF + diccionario con nspell).
  - `tecnica.js`: revisión técnica del PDF (pdf.js + pdf-lib).
  - `librerias.js`: carga esas librerías solo cuando se usan.
  - `vendor/`: librerías locales (~18 MB; la extensión no permite cargar código de internet).
- `api/revisar.mjs`: función de Vercel que agrega la API key y reenvía la petición a Gemini.
- `servidor.js` / `iniciar.bat`: servidor local para pruebas.

## Límites actuales
- Por el servidor, el máximo es **3 MB por revisión** (Vercel acepta hasta 4.5 MB por petición). Las capturas de más de 1 MB se comprimen solas. Para PDF pesados, en Ajustes → Avanzado se puede usar una API key propia, que llama a Gemini directo y admite hasta 18 MB.
- La revisión técnica solo ve texto vivo para el margen de seguridad; el texto en curvas no se puede medir.
- La revisión rápida depende de que el OCR lea bien: tipografías decorativas o texto sobre fotos pueden dar falsas alarmas.
- La IA puede equivocarse: el reporte es una ayuda, no reemplaza la revisión humana.
