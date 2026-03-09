const express = require('express');
const router = express.Router();
const path = require('path');
const {
    listarMembros, listarExcecoes, adicionarExcecao, removerExcecao,
    listarMensagensConfig, atualizarMensagemConfig,
    listarEventos, estatisticas,
    upsertMembro, atualizarStatus, cancelarRemocao, agendarRemocao,
    buscarPorSubscription, registrarEvento, isExcecao
} = require('../db');
const { adicionarNosGrupos, removerDosGrupos, formatarTelefone } = require('../whatsapp');
const { processarMensagens, processarRemocoes } = require('./scheduler');

function autenticar(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
        res.set('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).send('Acesso negado');
    }
    const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Usuário ou senha incorretos');
}

// ── DASHBOARD ──
router.get('/admin', autenticar, (req, res) => {
    res.sendFile(path.join(__dirname, '../dashboard.html'));
});

// ── DADOS ──
router.get('/admin/dados', autenticar, async (req, res) => {
    try {
        const [membros, excecoes, mensagens, eventos, stats] = await Promise.all([
            listarMembros(), listarExcecoes(), listarMensagensConfig(),
            listarEventos(200), estatisticas()
        ]);
        res.json({ membros, excecoes, mensagens, eventos, stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── MEMBROS ──
router.post('/admin/membro/adicionar', autenticar, async (req, res) => {
    try {
        const { nome, telefone, email, subscription_id, payment_method, next_payment } = req.body;
        if (!nome || !telefone) return res.status(400).json({ error: 'Nome e telefone obrigatórios' });

        const tel_fmt = formatarTelefone(telefone);
        const sub_id = subscription_id || `manual-${Date.now()}`;

        await upsertMembro({
            nome, email, telefone, telefone_formatado: tel_fmt,
            subscription_id: sub_id, order_id: null,
            payment_method: payment_method || 'manual',
            status: 'ativo',
            next_payment: next_payment ? new Date(next_payment) : null
        });

        if (!await isExcecao(tel_fmt)) {
            const resultados = await adicionarNosGrupos(tel_fmt);
            await registrarEvento({
                subscription_id: sub_id, telefone, nome,
                evento: 'admin_adicionar', acao: 'adicionar_grupos',
                sucesso: resultados.some(r => r.sucesso),
                detalhes: JSON.stringify(resultados)
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/admin/membro/remover/:subscription_id', autenticar, async (req, res) => {
    try {
        const membro = await buscarPorSubscription(req.params.subscription_id);
        if (!membro) return res.status(404).json({ error: 'Membro não encontrado' });

        if (!await isExcecao(membro.telefone_formatado)) {
            const resultados = await removerDosGrupos(membro.telefone_formatado);
            await registrarEvento({
                subscription_id: membro.subscription_id,
                telefone: membro.telefone, nome: membro.nome,
                evento: 'admin_remover', acao: 'removido',
                sucesso: resultados.some(r => r.sucesso),
                detalhes: JSON.stringify(resultados)
            });
        }
        await atualizarStatus(membro.subscription_id, 'removido');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/admin/membro/cancelar-remocao/:subscription_id', autenticar, async (req, res) => {
    try {
        await cancelarRemocao(req.params.subscription_id);
        await atualizarStatus(req.params.subscription_id, 'ativo');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── EXCEÇÕES ──
router.get('/admin/excecoes', autenticar, async (req, res) => {
    try {
        res.json(await listarExcecoes());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/admin/excecao', autenticar, async (req, res) => {
    try {
        const { telefone, nome, motivo } = req.body;
        if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório' });
        await adicionarExcecao(formatarTelefone(telefone), nome, motivo);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/admin/excecao/:id', autenticar, async (req, res) => {
    try {
        await removerExcecao(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── MENSAGENS ──
router.put('/admin/mensagem/:chave', autenticar, async (req, res) => {
    try {
        const { texto } = req.body;
        if (!texto) return res.status(400).json({ error: 'Texto obrigatório' });
        await atualizarMensagemConfig(req.params.chave, texto);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── SCHEDULER MANUAL ──
router.post('/admin/scheduler/mensagens', autenticar, async (req, res) => {
    try {
        await processarMensagens();
        res.json({ success: true, msg: 'Ciclo de mensagens executado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/admin/scheduler/remocoes', autenticar, async (req, res) => {
    try {
        await processarRemocoes();
        res.json({ success: true, msg: 'Ciclo de remoções executado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
