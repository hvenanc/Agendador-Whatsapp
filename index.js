const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public')); // Serve o HTML da pasta public

let db;

// Inicialização do Banco de Dados
(async () => {
    try {
        db = await open({
            filename: path.resolve(__dirname, 'database.db'), // Caminho absoluto
            driver: sqlite3.Database
        });

        console.log("sqlite: Conectado ao banco de dados.");

        await db.exec(`
            CREATE TABLE IF NOT EXISTS agendamentos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chatId TEXT,
                link TEXT,
                descricao TEXT,
                data_postagem DATETIME,
                enviado INTEGER DEFAULT 0
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS agendamentos_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chatId TEXT,
                acao TEXT,
                mensagem TEXT,
                data_execucao DATETIME,
                executado INTEGER DEFAULT 0
            );
        `);
        console.log("sqlite: Tabelas verificadas/criadas.");
    } catch (error) {
        console.error("sqlite: Erro ao abrir banco:", error);
    }
})();

// Inicialização do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox'] }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Bot do WhatsApp Pronto!'));
client.initialize();

// --- ROTAS DA API ---

app.get('/grupos', async (req, res) => {
    try {
        if (!client.info) return res.status(503).json({ erro: "Bot não pronto" });
        const chats = await client.getChats();
        const grupos = chats.filter(c => c.isGroup).map(g => ({ id: g.id._serialized, name: g.name }));
        res.json(grupos);
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/agendar-link', async (req, res) => {
    const { chatId, link, descricao, data } = req.body;
    await db.run('INSERT INTO agendamentos (chatId, link, descricao, data_postagem) VALUES (?, ?, ?, ?)', [chatId, link, descricao, data]);
    res.json({ status: 'Link agendado' });
});

app.post('/agendar-status', async (req, res) => {
    const { chatId, acao, mensagem, data } = req.body;
    await db.run('INSERT INTO agendamentos_status (chatId, acao, mensagem, data_execucao) VALUES (?, ?, ?, ?)', [chatId, acao, mensagem, data]);
    res.json({ status: 'Status agendado' });
});

app.get('/listagem-geral', async (req, res) => {
    const links = await db.all('SELECT *, "link" as tipo FROM agendamentos');
    const status = await db.all('SELECT *, "status" as tipo FROM agendamentos_status');
    res.json([...links, ...status]);
});

app.delete('/remover/:tipo/:id', async (req, res) => {
    const tabela = req.params.tipo === 'link' ? 'agendamentos' : 'agendamentos_status';
    await db.run(`DELETE FROM ${tabela} WHERE id = ?`, [req.params.id]);
    res.json({ status: 'Removido' });
});

// --- CRON JOB (O VIGILANTE) ---
cron.schedule('* * * * *', async () => {
    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false }).replace(',', '');
    // Simplificação de data para comparação: YYYY-MM-DD HH:mm
    const dataFormatada = new Date().toISOString().replace('T', ' ').substring(0, 16);

    // Enviar Links
    const links = await db.all('SELECT * FROM agendamentos WHERE data_postagem <= ? AND enviado = 0', [dataFormatada]);
    for (const item of links) {
        try {
            const msg = item.descricao ? `*${item.descricao}*\n\n${item.link}` : item.link;
            await client.sendMessage(item.chatId, msg);
            await db.run('UPDATE agendamentos SET enviado = 1 WHERE id = ?', [item.id]);
        } catch (e) { console.error("Erro link:", e); }
    }

    // Mudar Status
    const status = await db.all('SELECT * FROM agendamentos_status WHERE data_execucao <= ? AND executado = 0', [dataFormatada]);
    for (const item of status) {
        try {
            const chat = await client.getChatById(item.chatId);
            await chat.setMessagesAdminsOnly(item.acao === 'fechar');
            if (item.mensagem) await client.sendMessage(item.chatId, item.mensagem);
            await db.run('UPDATE agendamentos_status SET executado = 1 WHERE id = ?', [item.id]);
        } catch (e) { console.error("Erro status:", e); }
    }
});

app.listen(3000, () => console.log('🚀 Painel rodando em http://localhost:3000'));