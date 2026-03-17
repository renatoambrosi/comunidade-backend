const axios = require('axios');

// ── GRUPOS ──
// Ordem importa: ouro primeiro (prestígio), avisos por último (informativo)
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

function config() {
    return {
        evolutionUrl: process.env.EVOLUTION_URL,
        apiKey:       process.env.EVOLUTION_API_KEY,
        instance:     encodeURIComponent(process.env.EVOLUTION_INSTANCE),
    };
}

// ── BUSCAR INVITE LINK DE UM GRUPO ──
// Evolution API v2: GET /group/inviteCode/{instance}?groupJid=...
// Retorna { inviteCode: "ABC123..." }
async function buscarInviteLink(jid) {
    const { evolutionUrl, apiKey, instance } = config();
    try {
        const resp = await axios.get(
            `${evolutionUrl}/group/inviteCode/${instance}`,
            {
                params: { groupJid: jid },
                headers: { apikey: apiKey },
                timeout: 10000,
            }
        );
        // A API retorna { inviteCode: "..." } ou { code: "..." } dependendo da versão
        const code = resp.data?.inviteCode || resp.data?.code;
        if (!code) throw new Error(`Sem inviteCode na resposta: ${JSON.stringify(resp.data)}`);
        return `https://chat.whatsapp.com/${code}`;
    } catch (err) {
        const detalhe = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`❌ Erro ao buscar invite de ${jid}: ${detalhe}`);
        return null;
    }
}

// ── ADICIONAR NOS GRUPOS (via link de convite) ──
// Estratégia: busca o link de cada grupo e envia por mensagem direta ao novo membro.
// Não usa updateParticipant (falha silenciosamente quando o grupo tem restrição de adição).
async function adicionarNosGrupos(telefone, nome) {
    const numero = formatarTelefone(telefone);
    const resultados = [];

    // Busca todos os links em paralelo
    const links = await Promise.all(GRUPOS.map(g => buscarInviteLink(g.jid)));

    // Monta mensagem única com os 3 links
    const linksValidos = links.filter(Boolean);
    if (linksValidos.length === 0) {
        console.error(`❌ Nenhum invite link obtido para ${numero}`);
        return GRUPOS.map((g, i) => ({ grupo: g.jid, nome: g.nome, sucesso: false, erro: 'Sem invite link' }));
    }

    const nomeExibir = nome || 'você';
    const linhasGrupos = GRUPOS.map((g, i) => links[i] ? `• *${g.nome}*: ${links[i]}` : `• *${g.nome}*: indisponível no momento`).join('\n');

    const mensagem =
        `Olá, ${nomeExibir}! 🎉\n\n` +
        `Seja bem-vindo(a) à *Comunidade Mente de Ouro*!\n\n` +
        `Clique nos links abaixo para entrar nos grupos:\n\n` +
        `${linhasGrupos}\n\n` +
        `Qualquer dúvida, estou aqui. 💛\n— Suellen Seragi`;

    const enviou = await enviarMensagemWhatsApp(numero, mensagem);

    // Registra resultado por grupo (sucesso = link obtido + mensagem enviada)
    for (let i = 0; i < GRUPOS.length; i++) {
        const sucesso = !!links[i] && enviou;
        resultados.push({ grupo: GRUPOS[i].jid, nome: GRUPOS[i].nome, sucesso, linkObtido: !!links[i] });
        if (sucesso) {
            console.log(`✅ Invite enviado | ${numero} | ${GRUPOS[i].nome}`);
        } else {
            console.warn(`⚠️ Invite não enviado | ${numero} | ${GRUPOS[i].nome} | link: ${!!links[i]} | msg: ${enviou}`);
        }
    }

    return resultados;
}

// ── REMOVER DOS GRUPOS (direto via API — funciona bem) ──
async function removerDosGrupos(telefone) {
    const { evolutionUrl, apiKey, instance } = config();
    const numero = formatarTelefone(telefone);
    const resultados = [];

    for (const grupo of GRUPOS) {
        try {
            const resp = await axios.post(
                `${evolutionUrl}/group/updateParticipant/${instance}`,
                {
                    groupJid: grupo.jid,
                    action: 'remove',
                    participants: [numero],
                },
                { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
            );

            // Verifica o conteúdo da resposta — a Evolution retorna 200 mesmo em falhas lógicas
            const data = resp.data;
            const itemResultado = Array.isArray(data) ? data[0] : data;
            const statusResposta = itemResultado?.status || itemResultado?.message || '';
            const sucesso = resp.status === 200 && !String(statusResposta).toLowerCase().includes('error');

            resultados.push({ grupo: grupo.jid, nome: grupo.nome, sucesso, resposta: statusResposta });

            if (sucesso) {
                console.log(`✅ remove | ${numero} | ${grupo.nome}`);
            } else {
                console.warn(`⚠️ remove retornou 200 mas com erro | ${numero} | ${grupo.nome} | ${statusResposta}`);
            }
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
    const { evolutionUrl, apiKey, instance } = config();
    const numero = formatarTelefone(telefone);

    try {
        const resp = await axios.get(
            `${evolutionUrl}/group/participants/${instance}`,
            {
                params: { groupJid: GRUPOS[0].jid },
                headers: { apikey: apiKey },
                timeout: 10000,
            }
        );
        const participants = resp.data?.participants || [];
        return participants.some(p => p.id?.includes(numero));
    } catch (err) {
        console.error('❌ Erro ao verificar participantes:', err.message);
        return false;
    }
}

// ── ENVIAR MENSAGEM DE TEXTO ──
async function enviarMensagemWhatsApp(telefone, mensagem) {
    const { evolutionUrl, apiKey, instance } = config();
    const numero = formatarTelefone(telefone);

    try {
        await axios.post(
            `${evolutionUrl}/message/sendText/${instance}`,
            { number: numero, text: mensagem },
            { headers: { apikey: apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        console.log(`✅ Mensagem enviada para ${numero}`);
        return true;
    } catch (err) {
        const detalhe = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`❌ Erro ao enviar mensagem para ${numero}: ${detalhe}`);
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
