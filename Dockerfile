# Imagen del Depurador para la VPS (Easypanel la construye desde GitHub).
# Sin dependencias: Node sirve la app (app/) y la API (api/). Las librerías de OCR y PDF ya vienen en app/vendor/.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --chown=node:node server.js package.json ./
COPY --chown=node:node api ./api
COPY --chown=node:node app ./app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/salud >/dev/null || exit 1
CMD ["node", "server.js"]
