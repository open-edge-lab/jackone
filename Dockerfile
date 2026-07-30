# Immagine di JackOne: un solo processo Node, nessun build step.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Le dipendenze prima del codice: finché il lock non cambia, questo strato
# resta in cache e il rebuild si limita a copiare i sorgenti.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public/ ./public/
COPY server/ ./server/
COPY shared/ ./shared/

# L'immagine node porta già un utente non privilegiato: il gioco non scrive
# nulla su disco, quindi non serve altro.
USER node

EXPOSE 3000

# Il server non ha una rotta di stato dedicata: la pagina di ingresso basta a
# dire se il processo risponde ancora.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "server/index.js"]
