const express = require('express');
const router = express.Router();
const {
    upsertMembro, buscarPorSubscription, marcarGruposAdicionado,
    atualizarStatus, atualizarNextPayment, agendarRemocao, cancelarRemocao,
    isExcecao, registrarEvento, limparMensagensEnviadas
} = require('../db');
const { adicionarNosGrupos, removerDosGrupos, verificarNosGrupos, formatarTelefone } = require('../whatsapp');

// ── PRODUCT ID DA COMUNIDADE MENTE DE OURO ──
// Apenas webhooks deste produto são processados. Todos os outros são ignorados.
const PRODUCT_ID_COMUNIDADE = '36159bc0-1b77-11f1-8ed2-99854c89cb83';

// ── HELPERS ──

function extrairDados(body) {
    const order = body.order || body.Order || body;
    const customer = order.Customer || order.customer || body.Customer || body.customer || {};
    const sub = order.Subscription || order.subscription || body.Subscription || body.subscription || {};

    const nome = customer.full_name || customer.name || customer.nome || '';
    const email = customer.email || '';
    const telefone = customer.mobile || customer.mobile_phone_number || customer.phone || '';
    const subscription_id = order.subscription_id || sub.id || body.subscription_id || '';
    const order_id = order.order_id || order.id || body.order_id || '';
    const payment_method = order.payment_method || sub.payment_method || '';

    const next_payment_raw = sub.next_payment || sub.next_payment_date || null;
    const next_payment = next_payment_raw ? new Date(next_payment_raw) : null;

    return { nome, email, telefone, subscription_id, order_id, payment_method, next_payment };
}

function extrairProductId(body) {
    const order = body.order || body.Order || body;
    const product = order.Product || order.product || body.Product || body.product || {};
    return product.product_id || '';
}

async function log(dados) {
    try {
        await registrarEvento(dados);
    } catch (e) {
        console.error('Erro ao registrar evento:', e.message);
    }
}

// ── WEBHOOK PRINCIPAL ──

router.post('/kiwify', async (req, res) => {
    res.status(200).json({ received: true });

    const order = req.body.order || req.body.Order || req.body;
    const evento = order.webhook_event_type || req.body.webhook_event_type || req.body.event || '';

    console.log(`\n🔔 WEBHOOK: ${evento}`, JSON.stringify(req.body).substring(0, 400));

    // ── FILTRO DE PRODUTO ──
    const product_id = extrairProductId(req.body);
    if (product_id !== PRODUCT_ID_COMUNIDADE) {
        console.log(`⚪ Produto ignorado: ${product_id} — não é a Comunidade Mente de Ouro`);
        return;
    }

    try {
        const dados = extrairDados(req.body);

        if (!dados.subscription_id && !dados.order_id) {
            console.log('⚠️ Webhook sem subscription_id nem order_id, ignorando');
            return;
        }

        switch (evento) {
            case 'order_approved':
                await handleOrderApproved(dados, req.body);
                break;
            case 'subscription_renewed':
                await handleSubscriptionRenewed(dados, req.body);
                break;
            case 'subscription_late':
                await handleSubscriptionLate(dados, req.body);
                break;
            case 'order_refunded':
                await handleOrderRefunded(dados, req.body);
                break;
            case 'chargeback':
                await handleChargeback(dados, req.body);
                break;
            case 'subscription_canceled':
                await handleSubscriptionCanceled(dados, req.body);
                break;
            default:
                console.log(`⚪ Evento não mapeado: ${evento}`);
                await log({
                    subscription_id: dados.subscription_id,
                    order_id: dados.order_id,
                    telefone: dados.telefone,
                    nome: dados.nome,
                    evento: evento || 'desconhecido',
                    acao: 'ignorado',
                    sucesso: true,
                    detalhes: 'Evento não mapeado'
                });
        }
    } catch (err) {
        console.error('❌ Erro no webhook:', err.message);
    }
});

// ── HANDLERS ──

async function handleOrderApproved(dados, body) {
    const { nome, email, telefone, subscription_id, order_id, payment_method, next_payment } = dados;

    if (!telefone) {
        console.log('⚠️ order_approved sem telefone, ignorando');
        return;
    }

    const telefone_formatado = formatarTelefone(telefone);

    await upsertMembro({
        nome, email, telefone, telefone_formatado,
        subscription_id, order_id, payment_method,
        status: 'ativo',
        next_payment
    });

    await cancelarRemocao(subscription_id);
    await limparMensagensEnviadas(subscription_id);

    if (await isExcecao(telefone_formatado)) {
        console.log(`🛡️ ${nome} é exceção, pulando grupos`);
        await log({ subscription_id, order_id, telefone, nome, evento: 'order_approved', acao: 'excecao', sucesso: true, detalhes: 'Número na lista de exceções' });
        return;
    }

    const resultados = await adicionarNosGrupos(telefone_formatado, nome);
    const sucesso = resultados.some(r => r.sucesso);

    if (sucesso) await marcarGruposAdicionado(subscription_id);

    await log({
        subscription_id, order_id, telefone, nome,
        evento: 'order_approved', acao: 'adicionar_grupos',
        sucesso, detalhes: JSON.stringify(resultados)
    });

    console.log(`✅ order_approved | ${nome} | ${telefone_formatado} | next_payment: ${next_payment}`);
}

async function handleSubscriptionRenewed(dados, body) {
    const { nome, email, telefone, subscription_id, order_id, next_payment } = dados;

    const membroAtual = await buscarPorSubscription(subscription_id);

    if (next_payment) await atualizarNextPayment(subscription_id, next_payment);
    await atualizarStatus(subscription_id, 'ativo');
    await cancelarRemocao(subscription_id);
    await limparMensagensEnviadas(subscription_id);

    const telefone_formatado = membroAtual?.telefone_formatado || (telefone ? formatarTelefone(telefone) : null);

    if (telefone_formatado && !await isExcecao(telefone_formatado)) {
        const estaNoGrupo = await verificarNosGrupos(telefone_formatado);
        if (!estaNoGrupo) {
            const resultados = await adicionarNosGrupos(telefone_formatado, nome || membroAtual?.nome);
            await log({ subscription_id, order_id, telefone, nome, evento: 'subscription_renewed', acao: 'readicionar_grupos', sucesso: resultados.some(r => r.sucesso), detalhes: JSON.stringify(resultados) });
        }
    }

    await log({ subscription_id, order_id, telefone, nome, evento: 'subscription_renewed', acao: 'renovado', sucesso: true, detalhes: `next_payment: ${next_payment}` });
    console.log(`✅ subscription_renewed | ${nome} | next_payment: ${next_payment}`);
}

async function handleSubscriptionLate(dados, body) {
    const { nome, telefone, subscription_id, order_id } = dados;
    await atualizarStatus(subscription_id, 'atrasado');
    await log({ subscription_id, order_id, telefone, nome, evento: 'subscription_late', acao: 'status_atrasado', sucesso: true, detalhes: 'Scheduler enviará D+1, D+3, D+5' });
    console.log(`⚠️ subscription_late | ${nome}`);
}

async function handleOrderRefunded(dados, body) {
    const { nome, telefone, subscription_id, order_id } = dados;
    const membro = await buscarPorSubscription(subscription_id);
    const remocao = membro?.next_payment || new Date();
    await atualizarStatus(subscription_id, 'reembolsado');
    await agendarRemocao(subscription_id, remocao);
    await log({ subscription_id, order_id, telefone, nome, evento: 'order_refunded', acao: 'remocao_agendada', sucesso: true, detalhes: `Remoção agendada para: ${remocao}` });
    console.log(`💸 order_refunded | ${nome} | remoção em: ${remocao}`);
}

async function handleChargeback(dados, body) {
    const { nome, telefone, subscription_id, order_id } = dados;
    const membro = await buscarPorSubscription(subscription_id);
    const telefone_formatado = membro?.telefone_formatado || (telefone ? formatarTelefone(telefone) : null);
    await atualizarStatus(subscription_id, 'chargeback');
    if (telefone_formatado && !await isExcecao(telefone_formatado)) {
        const resultados = await removerDosGrupos(telefone_formatado);
        await log({ subscription_id, order_id, telefone, nome, evento: 'chargeback', acao: 'remocao_imediata', sucesso: resultados.some(r => r.sucesso), detalhes: JSON.stringify(resultados) });
        console.log(`🚨 chargeback | ${nome} | REMOVIDO IMEDIATAMENTE`);
    }
}

async function handleSubscriptionCanceled(dados, body) {
    const { nome, telefone, subscription_id, order_id } = dados;
    const membro = await buscarPorSubscription(subscription_id);
    if (!membro) {
        console.log(`⚠️ subscription_canceled para membro não encontrado: ${subscription_id}`);
        return;
    }
    await atualizarStatus(subscription_id, 'cancelado');
    const agora = new Date();
    const nextPaymentBanco = membro.next_payment ? new Date(membro.next_payment) : null;
    if (!nextPaymentBanco || nextPaymentBanco <= agora) {
        if (!await isExcecao(membro.telefone_formatado)) {
            const resultados = await removerDosGrupos(membro.telefone_formatado);
            await log({ subscription_id, order_id, telefone: membro.telefone, nome, evento: 'subscription_canceled', acao: 'remocao_imediata', sucesso: resultados.some(r => r.sucesso), detalhes: `next_payment já passou: ${nextPaymentBanco}` });
            console.log(`❌ subscription_canceled | ${nome} | removido imediatamente`);
        }
    } else {
        await agendarRemocao(subscription_id, nextPaymentBanco);
        await log({ subscription_id, order_id, telefone: membro.telefone, nome, evento: 'subscription_canceled', acao: 'remocao_agendada', sucesso: true, detalhes: `Remoção agendada para: ${nextPaymentBanco}` });
        console.log(`❌ subscription_canceled | ${nome} | remoção agendada para: ${nextPaymentBanco}`);
    }
}

module.exports = router;
