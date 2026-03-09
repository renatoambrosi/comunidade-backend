const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
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

app.post('/assinar', async (req, res) => {
    try {
        const { nome, telefone, email } = req.body;

        if (!nome || !telefone || !email) {
            return res.status(400).json({ error: 'Nome, telefone e email são obrigatórios' });
        }

        const client = new MercadoPagoConfig({
            accessToken: process.env.MP_ACCESS_TOKEN
        });

        const preApproval = new PreApproval(client);

        const resultado = await preApproval.create({
            body: {
                reason: 'Comunidade Suellen Seragi — Assinatura Mensal',
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: 59.00,
                    currency_id: 'BRL'
                },
                payment_methods_allowed: {
                    payment_types: [
                        { id: 'credit_card' },
                        { id: 'pix' }
                    ]
                },
                back_url: 'https://www.suellenseragi.com.br',
                payer_email: email,
                external_reference: telefone,
                notification_url: `${process.env.BASE_URL}/webhook/production`
            }
        });

        console.log(`✅ Assinatura criada para ${nome}: ${resultado.id}`);

        res.json({
            success: true,
            init_point: resultado.init_point,
            preapproval_id: resultado.id
        });

    } catch (error) {
        console.error('❌ Erro ao criar assinatura:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 comunidade-backend rodando na porta ${PORT}`);
});
