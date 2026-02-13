FROM ghcr.io/puppeteer/puppeteer:latest

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia arquivos de dependência com permissão correta para o usuário do puppeteer
COPY --chown=pptruser:pptruser package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código com as permissões corretas
COPY --chown=pptruser:pptruser . .

# Expõe a porta que o Express e o Railway utilizam
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["node", "index.js"]