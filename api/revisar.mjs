// API del depurador (la sirve server.js): recibe la petición armada por la app y la reenvía a Gemini con la API key del servidor.
// Variables de entorno: GEMINI_API_KEY (key de Google AI Studio) y CODIGO_EQUIPO (clave que escriben las diseñadoras).
const MODELOS = ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite'];

const error = (status, message) => Response.json({ error: { message } }, { status, headers: CORS });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-codigo-equipo',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  const { GEMINI_API_KEY, CODIGO_EQUIPO } = process.env;
  if (!GEMINI_API_KEY || !CODIGO_EQUIPO) return error(500, 'Falta configurar GEMINI_API_KEY o CODIGO_EQUIPO en el servidor.');
  if (request.headers.get('x-codigo-equipo') !== CODIGO_EQUIPO) return error(401, 'Código del equipo incorrecto.');

  let datos;
  try { datos = await request.json(); } catch { return error(400, 'Petición inválida.'); }
  // La pantalla de acceso solo comprueba el código: no se llama a Gemini.
  if (datos?.verificar) return Response.json({ ok: true }, { headers: CORS });
  if (!MODELOS.includes(datos?.modelo)) return error(400, `Modelo no permitido. Usa uno de: ${MODELOS.join(', ')}.`);
  if (!Array.isArray(datos.peticion?.contents)) return error(400, 'Petición inválida.');

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${datos.modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify(datos.peticion),
  });
  return new Response(resp.body, { status: resp.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
