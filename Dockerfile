FROM ghcr.io/puppeteer/puppeteer:latest
WORKDIR /usr/src/app
COPY --chown=pptruser:pptruser package*.json ./
# O comando abaixo garante que as bibliotecas extras sejam instaladas
RUN npm install qrcode qrcode-terminal
RUN npm install
COPY --chown=pptruser:pptruser . .
EXPOSE 3000
CMD ["node", "index.js"]