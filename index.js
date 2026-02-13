require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode'); // npm i qrcode
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public')); // serve public/index.html automaticamente [file:2]

// Configuração Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/**
 * Função aprimorada para localizar o executável do navegador.
 * Em ambientes Docker/Railway, a variável PUPPETEER_EXECUTABLE_PATH
 * definida pela imagem oficial ou pelo painel é o caminho mais seguro.
 */
const getExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const commonPaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ];

  for (const path of commonPaths) {
    if (fs.existsSync(path)) return path;
  }

  return null;
};

// Inicialização do Cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(), // no Railway a sessão pode ser perdida no restart sem volumes [file:2]
  puppeteer: {
    headless: true,
    executablePath: getExecutablePath(),
    protocolTimeout: 240000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
});

// QR em memória para o frontend
let lastQrDataUrl = null;

client.on('qr', async (qr) => {
  try {
    lastQrDataUrl = await QRCode.toDataURL(qr); // data:image/png;base64,... [web:14]
    console.log('📲 QR atualizado (disponível em /qr)');
  } catch (e) {
    console.error('Falha ao gerar QR DataURL:', e.message);
  }
});

client.on('ready', () => {
  lastQrDataUrl = null;
  console.log('✅ WhatsApp Conectado!');
});

client.initialize();

// --- ROTAS AUXILIARES (QR) ---
app.get('/qr', (req, res) => {
  if (!lastQrDataUrl) return res.status(204).end();
  res.json({ qr: lastQrDataUrl });
});

// --- ROTAS DA API ---
app.post('/agendar-link', async (req, res) => {
  try {
    const { chatId, link, descricao, data } = req.body;

    if (!chatId || !link || !data) {
      return res.status(400).json({ erro: "Dados incompletos" });
    }

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

app.post('/agendar-status', async (req, res) => {
  try {
    const { chatId, acao, mensagem, data } = req.body;

    if (!chatId || !acao || !data) {
      return res.status(400).json({ erro: "Dados incompletos" });
    }

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
  try {
    const { data: links } = await supabase.from('agendamentos').select('*');
    const { data: status } = await supabase.from('agendamentos_status').select('*');

    res.json([
      ...(links || []).map(i => ({ ...i, tipo: 'link', data_ref: i.data_postagem, concluido: i.enviado })),
      ...(status || []).map(i => ({ ...i, tipo: 'status', data_ref: i.data_execucao, concluido: i.executado }))
    ]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get('/grupos', async (req, res) => {
  if (!client.info) return res.status(503).json({ erro: "Bot offline" });

  try {
    const chats = await client.getChats();
    res.json(chats.filter(c => c.isGroup).map(g => ({ id: g.id._serialized, name: g.name })));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// --- CRON JOB (O Motor) ---
cron.schedule('* * * * *', async () => {
  const agora = new Date().toISOString();

  // Processar Links
  const { data: links } = await supabase.from('agendamentos')
    .select('*')
    .lte('data_postagem', agora)
    .eq('enviado', false);

  for (const link of (links || [])) {
    try {
      const texto = link.descricao ? `*${link.descricao}*\n\n${link.link}` : link.link;
      await client.sendMessage(link.chatid, texto);
      await supabase.from('agendamentos').update({ enviado: true }).eq('id', link.id);
    } catch (e) {
      console.error("Falha ao enviar link:", e.message);
    }
  }

  // Processar Status (Abrir/Fechar Grupo)
  const { data: status } = await supabase.from('agendamentos_status')
    .select('*')
    .lte('data_execucao', agora)
    .eq('executado', false);

  for (const st of (status || [])) {
    try {
      const chat = await client.getChatById(st.chatid);
      await chat.setMessagesAdminsOnly(st.acao === 'fechar');
      if (st.mensagem) await client.sendMessage(st.chatid, st.mensagem);
      await supabase.from('agendamentos_status').update({ executado: true }).eq('id', st.id);
    } catch (e) {
      console.error("Falha ao mudar status:", e.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));