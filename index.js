require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // O caminho '/usr/bin/chromium' é o padrão no Railway com Nixpacks
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ WhatsApp Conectado!'));
client.initialize();

// Rota de Agendamento de Link
app.post('/agendar-link', async (req, res) => {
    try {
        const { chatId, link, descricao, data } = req.body;
        if (!chatId || !link || !data) return res.status(400).json({ erro: "Dados incompletos" });

        const { error } = await supabase.from('agendamentos').insert([{
            chatid: chatId, 
            link, 
            descricao, 
            data_postagem: new Date(data).toISOString() 
        }]);

        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        console.error("Erro no Link:", err.message);
        res.status(500).json({ erro: err.message });
    }
});

// Rota de Agendamento de Status
app.post('/agendar-status', async (req, res) => {
    try {
        const { chatId, acao, mensagem, data } = req.body;
        if (!chatId || !acao || !data) return res.status(400).json({ erro: "Dados incompletos" });

        const { error } = await supabase.from('agendamentos_status').insert([{
            chatid: chatId, 
            acao, 
            mensagem, 
            data_execucao: new Date(data).toISOString()
        }]);

        if (error) throw error;
        res.json({ ok: true });
    } catch (err) {
        console.error("Erro no Status:", err.message);
        res.status(500).json({ erro: err.message });
    }
});

app.get('/listagem-geral', async (req, res) => {
    const { data: links } = await supabase.from('agendamentos').select('*');
    const { data: status } = await supabase.from('agendamentos_status').select('*');
    res.json([
        ...(links || []).map(i => ({ ...i, tipo: 'link', data_ref: i.data_postagem, concluido: i.enviado })),
        ...(status || []).map(i => ({ ...i, tipo: 'status', data_ref: i.data_execucao, concluido: i.executado }))
    ]);
});

app.get('/grupos', async (req, res) => {
    if (!client.info) return res.status(503).json({ erro: "Bot offline" });
    const chats = await client.getChats();
    res.json(chats.filter(c => c.isGroup).map(g => ({ id: g.id._serialized, name: g.name })));
});

// CRON JOB - O "Motor" do Sistema
cron.schedule('* * * * *', async () => {
    const agora = new Date().toISOString();

    // Executar Links
    const { data: links } = await supabase.from('agendamentos').select('*').lte('data_postagem', agora).eq('enviado', false);
    for (const link of (links || [])) {
        try {
            const texto = link.descricao ? `*${link.descricao}*\n\n${link.link}` : link.link;
            await client.sendMessage(link.chatid, texto);
            await supabase.from('agendamentos').update({ enviado: true }).eq('id', link.id);
        } catch (e) { console.error("Falha ao enviar link:", e.message); }
    }

    // Executar Status
    const { data: status } = await supabase.from('agendamentos_status').select('*').lte('data_execucao', agora).eq('executado', false);
    for (const st of (status || [])) {
        try {
            const chat = await client.getChatById(st.chatid);
            await chat.setMessagesAdminsOnly(st.acao === 'fechar');
            if (st.mensagem) await client.sendMessage(st.chatid, st.mensagem);
            await supabase.from('agendamentos_status').update({ executado: true }).eq('id', st.id);
        } catch (e) { console.error("Falha ao mudar status:", e.message); }
    }
});

app.listen(3000, () => console.log('🚀 Servidor em http://localhost:3000'));