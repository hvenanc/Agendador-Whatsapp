require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode'); // Nova dependência para imagem
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Variável global para armazenar o estado do QR Code
let qrStatus = {
    base64: null,
    conectado: false
};

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

// Evento de geração de QR Code
client.on('qr', async (qr) => {
    qrStatus.conectado = false;
    // 1. Gera no terminal (caracteres)
    qrcodeTerminal.generate(qr, { small: true });
    
    // 2. Gera a imagem Base64 para a rota Web
    try {
        qrStatus.base64 = await QRCode.toDataURL(qr);
        console.log('✅ Nova imagem do QR Code gerada. Aceda a /ver-qr');
    } catch (err) {
        console.error('Erro ao gerar imagem do QR:', err);
    }
});

client.on('ready', () => {
    console.log('✅ WhatsApp Conectado!');
    qrStatus.conectado = true;
    qrStatus.base64 = null;
});

// --- ROTA PARA SCAN PELO NAVEGADOR ---
app.get('/ver-qr', (req, res) => {
    if (qrStatus.base64) {
        res.send(`
            <html>
                <head><title>WhatsApp QR Scan</title></head>
                <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#f0f2f5; font-family:sans-serif;">
                    <div style="background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1); text-align:center;">
                        <h2 style="color:#128c7e;">Escaneie o QR Code</h2>
                        <img src="${qrStatus.base64}" style="border: 2px solid #ddd; padding:10px; border-radius:5px;" />
                        <p style="color:#666; margin-top:15px;">A imagem será atualizada automaticamente quando o código expirar.</p>
                        <script>setTimeout(() => { location.reload(); }, 30000);</script>
                    </div>
                </body>
            </html>
        `);
    } else if (qrStatus.conectado) {
        res.send('<h2>Bot já está conectado! ✅</h2>');
    } else {
        res.send('<h2>Aguardando geração do QR Code... Atualize a página em instantes.</h2>');
    }
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