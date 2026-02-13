require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let qrStatus = { base64: null, conectado: false };

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

client.on('qr', async (qr) => {
    qrStatus.conectado = false;
    qrcodeTerminal.generate(qr, { small: true });
    try {
        qrStatus.base64 = await QRCode.toDataURL(qr);
    } catch (err) { console.error('Erro QR:', err); }
});

client.on('ready', () => {
    qrStatus.conectado = true;
    qrStatus.base64 = null;
    console.log('✅ WhatsApp Pronto');
});

// Rota para o Frontend verificar o status e pegar o QR
app.get('/status-auth', (req, res) => {
    res.json(qrStatus);
});


// --- RESTANTE DAS ROTAS (API) ---
app.post('/agendar-link', async (req, res) => {
    const { chatId, link, descricao, data } = req.body;
    const { error } = await supabase.from('agendamentos').insert([{ chatid: chatId, link, descricao, data_postagem: new Date(data).toISOString() }]);
    res.json({ success: !error, error });
});

app.get('/grupos', async (req, res) => {
    try {
        const chats = await client.getChats();
        res.json(chats.filter(c => c.isGroup).map(g => ({ id: g.id._serialized, name: g.name })));
    } catch (err) { res.status(500).send(err.message); }
});

// --- CRON JOB ---
cron.schedule('* * * * *', async () => {
    const agora = new Date().toISOString();
    const { data: links } = await supabase.from('agendamentos').select('*').lte('data_postagem', agora).eq('enviado', false);
    
    for (const link of (links || [])) {
        try {
            const texto = link.descricao ? `*${link.descricao}*\n\n${link.link}` : link.link;
            await client.sendMessage(link.chatid, texto);
            await supabase.from('agendamentos').update({ enviado: true }).eq('id', link.id);
        } catch (e) { console.error("Erro no envio:", e.message); }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`));