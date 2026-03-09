const cron = require('node-cron');
const {
    buscarAtivosParaScheduler, buscarParaRemocao,
    atualizarStatus, isExcecao,
    getMensagem, jaEnviouMensagem, registrarMensagemEnviada,
    registrarEvento
} = require('../db');
const { removerDosGrupos, enviarMensagemWhatsApp } = require('../whatsapp');

function diasDiff(data) {
    const agora = new Date();
    const alvo = new Date(data);
    const diff = (alvo - agora) / (1000 * 60 * 60 * 24);
    return diff; // positivo = futuro, negativo = passado
}

async function enviarSeMarcado(membro, chaveMsg, condicao) {
    if (!condicao) return;
    if (!membro.telefone_formatado) return;
    if (await isExcecao(membro.telefone_formatado)) return;
    if (await jaEnviouMensagem(membro.subscription_id, chaveMsg)) return;

    const texto = await getMensagem(chaveMsg);
    if (!texto) return;

    const mensagem = texto.replace(/\{nome\}/gi, membro.nome || 'você');
    const enviado = await enviarMensagemWhatsApp(membro.telefone_formatado, mensagem);

    if (enviado) {
        await registrarMensagemEnviada(membro.subscription_id, chaveMsg);
        await registrarEvento({
            subscription_id: membro.subscription_id,
            telefone: membro.telefone,
            nome: membro.nome,
            evento: 'scheduler_mensagem',
            acao: chaveMsg,
            sucesso: true,
            detalhes: `next_payment: ${membro.next_payment}`
        });
        console.log(`📨 ${chaveMsg} enviado para ${membro.nome}`);
    }
}

async function processarMensagens() {
    const membros = await buscarAtivosParaScheduler();
    console.log(`⏰ Scheduler mensagens — ${membros.length} membro(s) ativos`);

    for (const membro of membros) {
        if (!membro.next_payment) continue;
        const diff = diasDiff(membro.next_payment);
        const isPix = (membro.payment_method || '').toLowerCase().includes('pix');

        // Pré-vencimento — apenas PIX
        if (isPix) {
            await enviarSeMarcado(membro, 'd_menos_3', diff >= 2.5 && diff < 3.5);
            await enviarSeMarcado(membro, 'd_menos_2', diff >= 1.5 && diff < 2.5);
            await enviarSeMarcado(membro, 'd_menos_1', diff >= 0.5 && diff < 1.5);
        }

        // Pós-vencimento — todos os métodos
        await enviarSeMarcado(membro, 'd_mais_1', diff <= -0.5 && diff > -1.5);
        await enviarSeMarcado(membro, 'd_mais_3', diff <= -2.5 && diff > -3.5);
        await enviarSeMarcado(membro, 'd_mais_5', diff <= -4.5 && diff > -5.5);
    }
}

async function processarRemocoes() {
    const membrosParaRemover = await buscarParaRemocao();
    console.log(`⏰ Scheduler remoções — ${membrosParaRemover.length} para remover`);

    for (const membro of membrosParaRemover) {
        if (!membro.telefone_formatado) continue;
        if (await isExcecao(membro.telefone_formatado)) {
            console.log(`🛡️ ${membro.nome} é exceção, pulando remoção`);
            continue;
        }

        try {
            const resultados = await removerDosGrupos(membro.telefone_formatado);
            await atualizarStatus(membro.subscription_id, 'removido');
            await registrarEvento({
                subscription_id: membro.subscription_id,
                telefone: membro.telefone,
                nome: membro.nome,
                evento: 'scheduler_remocao',
                acao: 'removido',
                sucesso: resultados.some(r => r.sucesso),
                detalhes: JSON.stringify(resultados)
            });
            console.log(`🗑️ ${membro.nome} removido dos grupos`);
        } catch (err) {
            console.error(`❌ Erro ao remover ${membro.nome}:`, err.message);
        }
    }
}

function iniciarScheduler() {
    console.log('⏰ Scheduler iniciado');

    // Verifica mensagens a cada hora (às :00)
    cron.schedule('0 * * * *', async () => {
        try {
            await processarMensagens();
        } catch (err) {
            console.error('❌ Erro no scheduler de mensagens:', err.message);
        }
    });

    // Verifica remoções a cada 30 minutos
    cron.schedule('*/30 * * * *', async () => {
        try {
            await processarRemocoes();
        } catch (err) {
            console.error('❌ Erro no scheduler de remoções:', err.message);
        }
    });
}

module.exports = { iniciarScheduler, processarMensagens, processarRemocoes };
