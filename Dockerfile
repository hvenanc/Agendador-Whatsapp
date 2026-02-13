FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia arquivos de dependência com permissão correta
COPY --chown=pptruser:pptruser package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código
COPY --chown=pptruser:pptruser . .

# Expõe a porta
EXPOSE 3000

# Comando para iniciar
CMD ["node", "index.js"]