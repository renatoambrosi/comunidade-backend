const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/webhook/production', (req, res) => {
    console.log('[PROD] Webhook recebido:', JSON.stringify(req.body));
    res.status(200).json({ received: true });
});

app.post('/webhook/test', (req, res) => {
    console.log('[TEST] Webhook recebido:', JSON.stringify(req.body));
    res.status(200).json({ received: true, mode: 'test' });
});

app.listen(PORT, () => {
    console.log(`🚀 comunidade-backend rodando na porta ${PORT}`);
});
