const axios = require('axios');

const GRUPOS = [
    '120363407525402346@g.us',  // ouro
    '120363424750548764@g.us',  // geral
    '120363424105041817@g.us'   // avisos
];

function formatarTelefone(telefone) {
    const num = String(telefone).replace(/\D/g, '');
    if (num.startsWith('55')) return num;
    if (num.startsWith('0')) return `55${num.slice(1)}`;
    return `55${num}`;
}

async function gerenciarGrupos(telefone, acao) {
    const evolutionUrl = process.env.EVOLUTION_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE;
    const instanceEncoded = encodeURIComponent(instance);
    const numero = formatarTelefone(telefone);
    const resultados = [];

    for (const grupoId of GRUPOS) {
        try {
            const response = await axios.post(
                `${evolutionUrl}/group/updateParticipant/${instanceEncoded}`,
                {
                    groupJid: grupoId,
                    action: acao,
                    participants: [`${numero}@s.whatsapp.net`]
                },
                { headers: { 'apikey': apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
            );
            resultados.push({ grupo: grupoId, sucesso: true });
            console.log(`✅ ${acao} | ${numero} | ${grupoId}`);
        } catch (err) {
            const msg = err.response?.data || err.message;
            resultados.push({ grupo: grupoId, sucesso: false, erro: JSON.stringify(msg) });
            console.error(`❌ ${acao} falhou | ${numero} | ${grupoId}:`, msg);
        }
    }
    return resultados;
}

async function verificarNosGrupos(telefone) {
    // Verifica se o número está no primeiro grupo como referência
    const evolutionUrl = process.env.EVOLUTION_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE;
    const instanceEncoded = encodeURIComponent(instance);
    const numero = formatarTelefone(telefone);

    try {
        const response = await axios.get(
            `${evolutionUrl}/group/participants/${instanceEncoded}?groupJid=${GRUPOS[0]}`,
            { headers: { 'apikey': apiKey }, timeout: 10000 }
        );
        const participants = response.data?.participants || [];
        return participants.some(p => p.id?.includes(numero));
    } catch (err) {
        console.error('❌ Erro ao verificar participantes:', err.message);
        return false;
    }
}

async function enviarMensagemWhatsApp(telefone, mensagem) {
    const evolutionUrl = process.env.EVOLUTION_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE;
    const instanceEncoded = encodeURIComponent(instance);
    const numero = formatarTelefone(telefone);

    try {
        await axios.post(
            `${evolutionUrl}/message/sendText/${instanceEncoded}`,
            { number: numero, text: mensagem },
            { headers: { 'apikey': apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        console.log(`✅ Mensagem enviada para ${numero}`);
        return true;
    } catch (err) {
        console.error(`❌ Erro ao enviar mensagem para ${numero}:`, err.message);
        return false;
    }
}

async function adicionarNosGrupos(telefone) {
    return gerenciarGrupos(telefone, 'add');
}

async function removerDosGrupos(telefone) {
    return gerenciarGrupos(telefone, 'remove');
}

module.exports = { adicionarNosGrupos, removerDosGrupos, verificarNosGrupos, enviarMensagemWhatsApp, formatarTelefone };
