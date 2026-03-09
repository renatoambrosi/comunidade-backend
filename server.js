const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/webhook/kiwify', (req, res) => {
    const evento = req.body.webhook_event_type || 'desconhecido';
    const nome = req.body.Customer?.full_name || 'sem nome';
    const telefone = req.body.Customer?.mobile || 'sem telefone';

    console.log('📦 Webhook Kiwify recebido');
    console.log(`🎯 Evento: ${evento}`);
    console.log(`👤 Nome: ${nome}`);
    console.log(`📱 Telefone: ${telefone}`);
    console.log('📋 Payload completo:', JSON.stringify(req.body, null, 2));

    res.status(200).json({ received: true });
});

app.listen(PORT, () => {
    console.log(`🚀 comunidade-backend rodando na porta ${PORT}`);
});
