const express = require('express');
const cors = require('cors');
require('dotenv').config();

const webhookRoutes = require('./routes/webhook');
const adminRoutes = require('./routes/admin');
const { initDb } = require('./db');
const { iniciarScheduler } = require('./routes/scheduler');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Log de requisições
app.use((req, res, next) => {
    console.log(`📡 ${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
});

// ── ROTAS ──
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use('/webhook', webhookRoutes);
app.use('/', adminRoutes);

app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// ── INICIALIZAÇÃO ──
app.listen(PORT, async () => {
    console.log(`\n🚀 Comunidade Backend rodando na porta ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
    console.log(`🔔 Webhook: http://localhost:${PORT}/webhook/kiwify`);
    console.log(`🖥️  Admin: http://localhost:${PORT}/admin\n`);

    await initDb();
    iniciarScheduler();
});

process.on('uncaughtException', (err) => {
    console.error('💥 UncaughtException:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 UnhandledRejection:', reason);
    process.exit(1);
});
