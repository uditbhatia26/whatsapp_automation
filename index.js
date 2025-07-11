const express = require('express');
const qrcode = require('qrcode-terminal');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    DisconnectReason,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const app = express();
app.use(express.json());

const store = {};
const getMessage = key => {
    const { id } = key;
    if (store[id]) return store[id].message;
};

let Sock; // Global socket

// ✅ sendMessage with optional timeout (for stability)
const sendMessage = async (jid, content, ...args) => {
    try {
        const sent = await Sock.sendMessage(jid, content, ...args);
        store[sent.key.id] = sent;
    } catch (err) {
        console.error("❌ Error sending message:", err);
        throw err;
    }
};

const initWhatsappBot = async () => {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    Sock = makeWASocket({
        auth: state,
        getMessage
    });

    // Connection & QR handler
    Sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📱 Scan this QR code with WhatsApp:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log("✅ WhatsApp connected successfully!");
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("❌ Disconnected. Reconnect:", shouldReconnect);
            if (shouldReconnect) {
                await initWhatsappBot();
            }
        }
    });

    Sock.ev.on('creds.update', saveCreds);

    // Optional: Log incoming messages
    Sock.ev.on('messages.upsert', async ({ messages }) => {
        messages.forEach(msg => {
            if (!msg.message) return;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            console.log(`📩 ${msg.key.remoteJid}: ${text}`);
        });
    });
};

// Start WhatsApp connection
initWhatsappBot();

// ✅ REST endpoint to send message
app.post('/send_message', async (req, res) => {
    const { phone_number, content } = req.body;

    if (!phone_number || !content) {
        return res.status(400).json({ error: 'phone_number and content are required' });
    }

    if (!Sock?.user) {
        return res.status(503).json({ error: 'WhatsApp is not connected yet' });
    }

    const jid = phone_number.replace(/\D/g, '') + '@s.whatsapp.net';

    try {
        await sendMessage(jid, { text: content }, { timeoutMs: 30000 }); // 30s timeout
        return res.json({
            success: true,
            message: 'Message sent successfully',
            phone_number,
            content
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to send message',
            details: error.message
        });
    }
});

// ✅ Health-check route
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        whatsapp_connected: !!Sock?.user || false
    });
});

// ✅ Start server on 0.0.0.0 so it's externally reachable
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API server running at http://localhost:${PORT}`);
});
