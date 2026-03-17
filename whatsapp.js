const axios = require('axios');

const GRUPOS = [
    { jid: '120363407525402346@g.us', nome: 'Ouro' },
    { jid: '120363424750548764@g.us', nome: 'Geral' },
    { jid: '120363424105041817@g.us', nome: 'Avisos' },
];

// ── HELPERS ──

function formatarTelefone(telefone) {
    const num = String(telefone).replace(/\D/g, '');
    if (num.startsWith('55')) return num;
    if (num.startsWith('0')) return `55${num.slice(1)}`;
    return `55${num}`;
}

function gatewayConfig() {
    return {
        url: process.env.GATEWAY_URL,
        token: process.env.GATEWAY_TOKEN,
    };
}

function evolutionConfig() {
    return {
        evolutionUrl: process.env.EVOLUTION_URL,
        apiKey: process.env.EVOLUTION_API_KEY,
        instance: encodeURIComponent(process.env.EVOLUTION_INSTANCE),
    };
}

// ── ENVIAR MENSAGEM VIA GATEWAY ──
// imediato=true  → pula a fila (pagamento acabou de ocorrer)
// imediato=false → entra na fila de 1/min
async function enviarMensagemWhatsApp(telefone, mensagem, nome = '', imediato = false) {
    const { url, token } = gatewayConfig();
    const numero = formatarTelefone(telefone);

    if (!url || !token) {
        console.error('❌ GATEWAY_URL ou GATEWAY_TOKEN não configurados');
        return false;
    }

    try {
        await axios.post(
            `${url}/enviar`,
            {
                telefone: numero,
                mensagem,
                nome: nome || numero,
                origem: 'comunidade',
                imediato,
            },
            {
                headers: { 'x-gateway-token': token, 'Content-Type': 'application/json' },
                timeout: 10000,
            }
        );
        console.log(`✅ ${imediato ? '⚡ Imediato' : '📥 Fila'} | Mensagem enviada ao gateway para ${numero}`);
        return true;
    } catch (err) {
        const detalhe = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`❌ Erro ao enviar para gateway (${numero}): ${detalhe}`);
        return false;
    }
}

// ── BUSCAR INVITE LINK DE UM GRUPO ──
async function buscarInviteLink(jid) {
    const { evolutionUrl, apiKey, instance } = evolutionConfig();
    try {
        const resp = await axios.get(
            `${evolutionUrl}/group/inviteCode/${instance}`,
            {
                params: { groupJid: jid },
                headers: { apikey: apiKey },
                timeout: 10000,
            }
        );
        const code = resp.data?.inviteCode || resp.data?.code;
        if (!code) throw new Error(`Sem inviteCode na resposta: ${JSON.stringify(resp.data)}`);
        return `https://chat.whatsapp.com/${code}`;
    } catch (err) {
        const detalhe = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`❌ Erro ao buscar invite de ${jid}: ${detalhe}`);
        return null;
    }
}

// ── ADICIONAR NOS GRUPOS (via link de convite — IMEDIATO) ──
// Pessoa acabou de pagar → não pode esperar fila
async function adicionarNosGrupos(telefone, nome) {
    const numero = formatarTelefone(telefone);

    // Busca todos os links em paralelo
    const links = await Promise.all(GRUPOS.map(g => buscarInviteLink(g.jid)));

    const linksValidos = links.filter(Boolean);
    if (linksValidos.length === 0) {
        console.error(`❌ Nenhum invite link obtido para ${numero}`);
        return GRUPOS.map(g => ({ grupo: g.jid, nome: g.nome, sucesso: false, erro: 'Sem invite link' }));
    }

    const nomeExibir = nome || 'você';
    const linhasGrupos = GRUPOS.map((g, i) =>
        links[i]
            ? `• *${g.nome}*: ${links[i]}`
            : `• *${g.nome}*: indisponível no momento`
    ).join('\n');

    const mensagem =
        `Olá, ${nomeExibir}! 🎉\n\n` +
        `Seja bem-vindo(a) à *Comunidade Mente de Ouro*!\n\n` +
        `Clique nos links abaixo para entrar nos grupos:\n\n` +
        `${linhasGrupos}\n\n` +
        `Qualquer dúvida, estou aqui. 💛\n— Suellen Seragi`;

    // IMEDIATO = true — pula a fila
    const enviou = await enviarMensagemWhatsApp(numero, mensagem, nomeExibir, true);

    return GRUPOS.map((g, i) => ({
        grupo: g.jid,
        nome: g.nome,
        sucesso: !!links[i] && enviou,
        linkObtido: !!links[i],
    }));
}

// ── REMOVER DOS GRUPOS (direto via Evolution — sem fila) ──
async function removerDosGrupos(telefone) {
    const { evolutionUrl, apiKey, instance } = evolutionConfig();
    const numero = formatarTelefone(telefone);
    const resultados = [];

    for (const grupo of GRUPOS) {
        try {
            const resp = await axios.post(
                `${evolutionUrl}/group/updateParticipant/${instance}`,
                { groupJid: grupo.jid, action: 'remove', participants: [numero] },
                { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
            );
            const data = resp.data;
            const item = Array.isArray(data) ? data[0] : data;
            const statusResposta = item?.status || item?.message || '';
            const sucesso = resp.status === 200 && !String(statusResposta).toLowerCase().includes('error');
            resultados.push({ grupo: grupo.jid, nome: grupo.nome, sucesso, resposta: statusResposta });
            if (sucesso) console.log(`✅ remove | ${numero} | ${grupo.nome}`);
            else console.warn(`⚠️ remove com erro | ${numero} | ${grupo.nome} | ${statusResposta}`);
        } catch (err) {
            const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
            resultados.push({ grupo: grupo.jid, nome: grupo.nome, sucesso: false, erro: msg });
            console.error(`❌ remove falhou | ${numero} | ${grupo.nome}: ${msg}`);
        }
    }
    return resultados;
}

// ── VERIFICAR SE ESTÁ NOS GRUPOS ──
async function verificarNosGrupos(telefone) {
    const { evolutionUrl, apiKey, instance } = evolutionConfig();
    const numero = formatarTelefone(telefone);
    try {
        const resp = await axios.get(
            `${evolutionUrl}/group/participants/${instance}`,
            { params: { groupJid: GRUPOS[0].jid }, headers: { apikey: apiKey }, timeout: 10000 }
        );
        const participants = resp.data?.participants || [];
        return participants.some(p => p.id?.includes(numero));
    } catch (err) {
        console.error('❌ Erro ao verificar participantes:', err.message);
        return false;
    }
}

module.exports = {
    adicionarNosGrupos,
    removerDosGrupos,
    verificarNosGrupos,
    enviarMensagemWhatsApp,
    formatarTelefone,
};
