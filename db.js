const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDb() {
    try {
        // Membros
        await pool.query(`
            CREATE TABLE IF NOT EXISTS membros (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(255),
                email VARCHAR(255),
                telefone VARCHAR(30),
                telefone_formatado VARCHAR(30),
                subscription_id VARCHAR(100) UNIQUE,
                order_id VARCHAR(100),
                payment_method VARCHAR(20),
                status VARCHAR(30) DEFAULT 'ativo',
                grupos_adicionado BOOLEAN DEFAULT FALSE,
                next_payment TIMESTAMP,
                remocao_agendada TIMESTAMP,
                criado_em TIMESTAMP DEFAULT NOW(),
                atualizado_em TIMESTAMP DEFAULT NOW()
            )
        `);

        // Exceções — números que nunca são removidos automaticamente
        await pool.query(`
            CREATE TABLE IF NOT EXISTS excecoes (
                id SERIAL PRIMARY KEY,
                telefone VARCHAR(30) UNIQUE NOT NULL,
                nome VARCHAR(255),
                motivo TEXT,
                criado_em TIMESTAMP DEFAULT NOW()
            )
        `);

        // Mensagens editáveis
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensagens_config (
                chave VARCHAR(50) PRIMARY KEY,
                titulo VARCHAR(100),
                texto TEXT,
                atualizado_em TIMESTAMP DEFAULT NOW()
            )
        `);

        // Log de eventos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS eventos (
                id SERIAL PRIMARY KEY,
                subscription_id VARCHAR(100),
                order_id VARCHAR(100),
                telefone VARCHAR(30),
                nome VARCHAR(255),
                evento VARCHAR(50),
                acao VARCHAR(50),
                sucesso BOOLEAN,
                detalhes TEXT,
                criado_em TIMESTAMP DEFAULT NOW()
            )
        `);

        // Log de mensagens enviadas (para não duplicar)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mensagens_enviadas (
                id SERIAL PRIMARY KEY,
                subscription_id VARCHAR(100),
                chave VARCHAR(50),
                enviado_em TIMESTAMP DEFAULT NOW()
            )
        `);

        // Inserir mensagens padrão se não existirem
        const mensagensPadrao = [
            {
                chave: 'd_menos_3',
                titulo: 'D-3 — Aviso antecipado',
                texto: 'Olá, {nome}! 😊\n\nPassando para te lembrar que em 3 dias acontece a renovação da sua assinatura da comunidade.\n\nSe quiser, você já pode fazer a renovação agora pelo link que enviamos no seu e-mail (pix ou cartão).\n\nLeva menos de 1 minuto.\n\nQualquer dúvida, estou por aqui. 💛\n\n— Suellen Seragi'
            },
            {
                chave: 'd_menos_2',
                titulo: 'D-2 — Lembrete',
                texto: 'Oi, {nome}! 👋\n\nSó um lembrete rápido: sua assinatura da comunidade renova em 2 dias.\n\nSe preferir, já pode fazer a renovação agora pelo link enviado no seu e-mail.\n\nAssim seu acesso continua normalmente.\n\n— Suellen Seragi'
            },
            {
                chave: 'd_menos_1',
                titulo: 'D-1 — Vence amanhã',
                texto: '{nome}, passando para lembrar que sua assinatura renova amanhã. ⏳\n\nPara continuar com acesso à comunidade sem interrupção, você pode renovar agora pelo link enviado no seu e-mail.\n\nÉ rapidinho — leva menos de 1 minuto.\n\n— Suellen Seragi'
            },
            {
                chave: 'd_mais_1',
                titulo: 'D+1 — Pagamento não processado',
                texto: 'Olá, {nome}!\n\nIdentificamos que o pagamento da sua assinatura ainda não foi processado. ⚠️\n\nÀs vezes é algo simples, como limite do cartão ou algum dado que precisa ser atualizado.\n\nVocê pode regularizar rapidamente pelo link enviado no seu e-mail.\n\nSe já realizou o pagamento, pode desconsiderar esta mensagem. 💛\n\n— Suellen Seragi'
            },
            {
                chave: 'd_mais_3',
                titulo: 'D+3 — Aviso importante',
                texto: '{nome}, sua assinatura ainda está com pagamento pendente. ⚠️\n\nPara não perder o acesso à comunidade, é importante regularizar pelo link que enviamos no seu e-mail.\n\nSeu lugar aqui é muito bem-vindo e espero que você continue com a gente.\n\n— Suellen Seragi'
            },
            {
                chave: 'd_mais_5',
                titulo: 'D+5 — Último aviso',
                texto: '{nome}, passando para avisar que este é o último lembrete. ⛔\n\nSe o pagamento não for regularizado hoje, seu acesso à comunidade será encerrado automaticamente.\n\nSe quiser continuar participando, basta atualizar o pagamento pelo link enviado no seu e-mail.\n\nLeva menos de 1 minuto.\n\n— Suellen Seragi'
            }
        ];

        for (const m of mensagensPadrao) {
            await pool.query(`
                INSERT INTO mensagens_config (chave, titulo, texto)
                VALUES ($1, $2, $3)
                ON CONFLICT (chave) DO NOTHING
            `, [m.chave, m.titulo, m.texto]);
        }

        console.log('✅ Banco comunidade iniciado');
    } catch (error) {
        console.error('❌ Erro ao iniciar banco:', error.message);
    }
}

// ── MEMBROS ──

async function upsertMembro({ nome, email, telefone, telefone_formatado, subscription_id, order_id, payment_method, status, next_payment }) {
    const result = await pool.query(`
        INSERT INTO membros (nome, email, telefone, telefone_formatado, subscription_id, order_id, payment_method, status, next_payment, atualizado_em)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (subscription_id) DO UPDATE SET
            nome = EXCLUDED.nome,
            email = EXCLUDED.email,
            telefone = EXCLUDED.telefone,
            telefone_formatado = EXCLUDED.telefone_formatado,
            payment_method = COALESCE(EXCLUDED.payment_method, membros.payment_method),
            status = EXCLUDED.status,
            next_payment = EXCLUDED.next_payment,
            atualizado_em = NOW()
        RETURNING *
    `, [nome, email, telefone, telefone_formatado, subscription_id, order_id, payment_method, status, next_payment]);
    return result.rows[0];
}

async function buscarPorSubscription(subscription_id) {
    const result = await pool.query(`SELECT * FROM membros WHERE subscription_id = $1`, [subscription_id]);
    return result.rows[0] || null;
}

async function marcarGruposAdicionado(subscription_id) {
    await pool.query(`UPDATE membros SET grupos_adicionado = TRUE, status = 'ativo', atualizado_em = NOW() WHERE subscription_id = $1`, [subscription_id]);
}

async function atualizarStatus(subscription_id, status) {
    await pool.query(`UPDATE membros SET status = $1, atualizado_em = NOW() WHERE subscription_id = $2`, [status, subscription_id]);
}

async function atualizarNextPayment(subscription_id, next_payment) {
    await pool.query(`UPDATE membros SET next_payment = $1, atualizado_em = NOW() WHERE subscription_id = $2`, [next_payment, subscription_id]);
}

async function agendarRemocao(subscription_id, remocao_agendada) {
    await pool.query(`UPDATE membros SET remocao_agendada = $1, atualizado_em = NOW() WHERE subscription_id = $2`, [remocao_agendada, subscription_id]);
}

async function cancelarRemocao(subscription_id) {
    await pool.query(`UPDATE membros SET remocao_agendada = NULL, atualizado_em = NOW() WHERE subscription_id = $1`, [subscription_id]);
}

async function listarMembros() {
    const result = await pool.query(`SELECT * FROM membros ORDER BY criado_em DESC`);
    return result.rows;
}

async function buscarParaRemocao() {
    // Membros com remoção agendada para hoje ou antes
    const result = await pool.query(`
        SELECT * FROM membros
        WHERE remocao_agendada IS NOT NULL
        AND remocao_agendada <= NOW()
        AND status != 'removido'
        AND grupos_adicionado = TRUE
    `);
    return result.rows;
}

async function buscarAtivosParaScheduler() {
    // Membros ativos com next_payment definido e não removidos
    const result = await pool.query(`
        SELECT * FROM membros
        WHERE next_payment IS NOT NULL
        AND status NOT IN ('removido', 'chargeback')
        AND grupos_adicionado = TRUE
    `);
    return result.rows;
}

async function estatisticas() {
    const result = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE status = 'ativo') as ativos,
            COUNT(*) FILTER (WHERE status = 'cancelado') as cancelados,
            COUNT(*) FILTER (WHERE status = 'atrasado') as atrasados,
            COUNT(*) FILTER (WHERE status = 'reembolsado') as reembolsados,
            COUNT(*) FILTER (WHERE status = 'chargeback') as chargebacks,
            COUNT(*) as total
        FROM membros
    `);
    return result.rows[0];
}

// ── EXCEÇÕES ──

async function listarExcecoes() {
    const result = await pool.query(`SELECT * FROM excecoes ORDER BY criado_em DESC`);
    return result.rows;
}

async function adicionarExcecao(telefone, nome, motivo) {
    await pool.query(`
        INSERT INTO excecoes (telefone, nome, motivo)
        VALUES ($1, $2, $3)
        ON CONFLICT (telefone) DO UPDATE SET nome = EXCLUDED.nome, motivo = EXCLUDED.motivo
    `, [telefone, nome, motivo]);
}

async function removerExcecao(id) {
    await pool.query(`DELETE FROM excecoes WHERE id = $1`, [id]);
}

async function isExcecao(telefone) {
    const result = await pool.query(`SELECT 1 FROM excecoes WHERE telefone = $1`, [telefone]);
    return result.rows.length > 0;
}

// ── MENSAGENS CONFIG ──

async function listarMensagensConfig() {
    const result = await pool.query(`SELECT * FROM mensagens_config ORDER BY chave`);
    return result.rows;
}

async function atualizarMensagemConfig(chave, texto) {
    await pool.query(`UPDATE mensagens_config SET texto = $1, atualizado_em = NOW() WHERE chave = $2`, [texto, chave]);
}

async function getMensagem(chave) {
    const result = await pool.query(`SELECT texto FROM mensagens_config WHERE chave = $1`, [chave]);
    return result.rows[0]?.texto || '';
}

// ── MENSAGENS ENVIADAS (evitar duplicatas) ──

async function jaEnviouMensagem(subscription_id, chave) {
    // Verifica se já enviou essa mensagem neste ciclo (após o último next_payment)
    const membro = await buscarPorSubscription(subscription_id);
    if (!membro) return false;
    const result = await pool.query(`
        SELECT 1 FROM mensagens_enviadas
        WHERE subscription_id = $1 AND chave = $2
        AND enviado_em >= (NOW() - INTERVAL '35 days')
    `, [subscription_id, chave]);
    return result.rows.length > 0;
}

async function registrarMensagemEnviada(subscription_id, chave) {
    await pool.query(`
        INSERT INTO mensagens_enviadas (subscription_id, chave) VALUES ($1, $2)
    `, [subscription_id, chave]);
}

async function limparMensagensEnviadas(subscription_id) {
    // Limpa quando o pagamento é confirmado — permite novo ciclo de mensagens
    await pool.query(`DELETE FROM mensagens_enviadas WHERE subscription_id = $1`, [subscription_id]);
}

// ── EVENTOS ──

async function registrarEvento({ subscription_id, order_id, telefone, nome, evento, acao, sucesso, detalhes }) {
    await pool.query(`
        INSERT INTO eventos (subscription_id, order_id, telefone, nome, evento, acao, sucesso, detalhes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [subscription_id, order_id, telefone, nome, evento, acao, sucesso, detalhes]);
}

async function listarEventos(limit = 100) {
    const result = await pool.query(`SELECT * FROM eventos ORDER BY criado_em DESC LIMIT $1`, [limit]);
    return result.rows;
}

module.exports = {
    initDb,
    upsertMembro, buscarPorSubscription, marcarGruposAdicionado,
    atualizarStatus, atualizarNextPayment, agendarRemocao, cancelarRemocao,
    listarMembros, buscarParaRemocao, buscarAtivosParaScheduler, estatisticas,
    listarExcecoes, adicionarExcecao, removerExcecao, isExcecao,
    listarMensagensConfig, atualizarMensagemConfig, getMensagem,
    jaEnviouMensagem, registrarMensagemEnviada, limparMensagensEnviadas,
    registrarEvento, listarEventos
};
