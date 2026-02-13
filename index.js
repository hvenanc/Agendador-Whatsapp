require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let qrStatus = { base64: null, conectado: false, pairingCode: null };

const getExecutablePath = () => {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    const paths = ['/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
    for (const path of paths) {
        if (fs.existsSync(path)) return path;
    }
    return null;
};

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: getExecutablePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// Eventos de Autenticação
client.on('qr', async (qr) => {
    qrStatus.conectado = false;
    qrcodeTerminal.generate(qr, { small: true });
    try {
        qrStatus.base64 = await QRCode.toDataURL(qr);
    } catch (err) { console.error('Erro ao gerar QR Base64:', err); }
});

client.on('ready', () => {
    console.log('✅ WhatsApp Conectado!');
    qrStatus.conectado = true;
    qrStatus.base64 = null;
    qrStatus.pairingCode = null;
});

// Rota para Status e QR Code
app.get('/status-auth', (req, res) => {
    res.json(qrStatus);
});

// Rota para solicitar Código de Pareamento (Telefone)
app.post('/solicitar-codigo', async (req, res) => {
    const { numero } = req.body; // Ex: 5511999999999
    if (!numero) return res.status(400).json({ erro: "Número necessário" });
    
    try {
        const code = await client.requestPairingCode(numero);
        qrStatus.pairingCode = code;
        res.json({ code });
    } catch (err) {
        console.error("Erro no Pareamento:", err);
        res.status(500).json({ erro: "Erro ao gerar código" });
    }
});

// --- API DE GRUPOS E AGENDAMENTOS ---
app.get('/grupos', async (req, res) => {
    if (!qrStatus.conectado) return res.status(503).json({ erro: "Bot offline" });
    try {
        const chats = await client.getChats();
        res.json(chats.filter(c => c.isGroup).map(g => ({ id: g.id._serialized, name: g.name })));
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/agendar-link', async (req, res) => {
    try {
        const { chatId, link, descricao, data } = req.body;
        const { error } = await supabase.from('agendamentos').insert([{
            chatid: chatId, link, descricao, data_postagem: new Date(data).toISOString() 
        }]);
        if (error) throw error;
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

// --- MOTOR DE AGENDAMENTOS (CRON) ---
cron.schedule('* * * * *', async () => {
    if (!qrStatus.conectado) return;
    const agora = new Date().toISOString();
    const { data: links } = await supabase.from('agendamentos').select('*').lte('data_postagem', agora).eq('enviado', false);
    
    for (const link of (links || [])) {
        try {
            const texto = link.descricao ? `*${link.descricao}*\n\n${link.link}` : link.link;
            await client.sendMessage(link.chatid, texto);
            await supabase.from('agendamentos').update({ enviado: true }).eq('id', link.id);
        } catch (e) { console.error("Falha no envio:", e.message); }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    client.initialize();
});