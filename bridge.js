/**
 * Bridge de WhatsApp para Sr y Sra Burger 🍔
 * Conecta WhatsApp Web con el backend Flask usando whatsapp-web.js
 */

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

// ─── Configuración ────────────────────────────────────────
const FLASK_URL = process.env.FLASK_URL || "http://127.0.0.1:5000";
const PORT = process.env.BRIDGE_PORT || 3001;

// ─── Express server para recibir mensajes del Flask ────────
const app = express();
app.use(express.json());

// ─── Deduplicación de mensajes ────────────────────────────
const processedMessages = new Set();
const MESSAGE_CACHE_TTL = 60000; // 60 segundos

function wasAlreadyProcessed(msgId) {
  if (processedMessages.has(msgId)) {
    return true;
  }
  processedMessages.add(msgId);
  // Limpiar después de 60s para no acumular memoria
  setTimeout(() => processedMessages.delete(msgId), MESSAGE_CACHE_TTL);
  return false;
}

// ─── Cliente de WhatsApp ──────────────────────────────────
console.log("🍔 Sr y Sra Burger — WhatsApp Bridge");
console.log("━".repeat(45));
console.log("Inicializando cliente de WhatsApp...\n");

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
    ],
  },
});

let isReady = false;
let qrCodeData = null;

// ─── Eventos de WhatsApp ──────────────────────────────────

client.on("qr", (qr) => {
  qrCodeData = qr;
  console.log("\n📱 Escanea este código QR con WhatsApp:\n");
  qrcode.generate(qr, { small: true });
  console.log("\nAbre WhatsApp > Dispositivos vinculados > Vincular dispositivo\n");
});

client.on("ready", () => {
  isReady = true;
  qrCodeData = null;
  console.log("\n✅ ¡WhatsApp conectado exitosamente!");
  console.log(`🍔 Bot de Sr y Sra Burger listo para recibir mensajes`);
  console.log(`🔗 Enviando mensajes a Flask en: ${FLASK_URL}`);
  console.log("━".repeat(45) + "\n");
});

client.on("authenticated", () => {
  console.log("🔐 Autenticación exitosa");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Error de autenticación:", msg);
});

client.on("disconnected", (reason) => {
  isReady = false;
  console.log("⚠️ WhatsApp desconectado:", reason);
  console.log("Reinicia el bridge manualmente con: node bridge.js");
  // NO re-inicializar automáticamente para evitar listeners duplicados
});

// ─── Recibir mensajes de WhatsApp ─────────────────────────

client.on("message", async (msg) => {
  try {
    // DEDUPLICACIÓN: ignorar si ya procesamos este mensaje
    const msgId = msg.id._serialized || msg.id.id;
    if (wasAlreadyProcessed(msgId)) {
      return;
    }

    // Ignorar mensajes de grupos (solo responder DMs)
    if (msg.from.includes("@g.us")) {
      return;
    }

    // Ignorar broadcasts/status
    if (msg.from === "status@broadcast" || msg.from.includes("@broadcast")) {
      return;
    }

    // Ignorar mensajes propios
    if (msg.fromMe) {
      return;
    }

    // Ignorar mensajes que no son texto (imágenes, stickers, links, etc.)
    if (msg.type !== "chat") {
      return;
    }

    // Ignorar mensajes que son solo URLs (enlaces de redes sociales, videos, etc.)
    const urlPattern = /^https?:\/\/\S+$/i;
    if (urlPattern.test(msg.body.trim())) {
      return;
    }

    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.name || msg.from;

    console.log(`📩 ${senderName}: ${msg.body.substring(0, 80)}${msg.body.length > 80 ? "..." : ""}`);

    // Enviar al backend Flask
    const response = await axios.post(
      `${FLASK_URL}/webhook/message`,
      {
        chatId: msg.from,
        message: msg.body,
        sender: msg.from,
        senderName: senderName,
        timestamp: msg.timestamp,
      },
      { timeout: 30000 }
    );

    if (response.data && response.data.response && !response.data.auto_sent) {
      // Si auto_reply está desactivado en Flask, enviar desde aquí
    }
  } catch (error) {
    console.error("❌ Error procesando mensaje:", error.message);
    
    // Si Flask no está disponible, enviar respuesta de fallback
    if (error.code === "ECONNREFUSED") {
      try {
        await msg.reply(
          "🍔 ¡Hola! Gracias por escribirnos a *Sr y Sra Burger*.\n\n" +
          "En este momento estamos teniendo problemas técnicos. " +
          "Por favor intenta de nuevo en unos minutos o llámanos al 922-159-36-88 📞"
        );
      } catch (replyError) {
        console.error("❌ No se pudo enviar mensaje de fallback:", replyError.message);
      }
    }
  }
});

// ─── API Express para enviar mensajes ─────────────────────

app.get("/health", (req, res) => {
  res.json({
    status: isReady ? "connected" : "disconnected",
    qrPending: !!qrCodeData,
    timestamp: new Date().toISOString(),
  });
});

app.get("/qr", (req, res) => {
  if (isReady) {
    res.json({ status: "already_connected" });
  } else if (qrCodeData) {
    res.json({ status: "qr_pending", qr: qrCodeData });
  } else {
    res.json({ status: "initializing" });
  }
});

app.post("/send", async (req, res) => {
  try {
    const { chatId, message } = req.body;

    if (!chatId || !message) {
      return res.status(400).json({ error: "chatId y message son requeridos" });
    }

    if (!isReady) {
      return res.status(503).json({ error: "WhatsApp no está conectado" });
    }

    await client.sendMessage(chatId, message);
    console.log(`📤 Respuesta enviada a ${chatId.split("@")[0]}`);
    res.json({ status: "sent" });
  } catch (error) {
    console.error("❌ Error enviando mensaje:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Endpoint para enviar imágenes ────────────────────────────────
app.post("/send-image", async (req, res) => {
  try {
    const { chatId, imagePath, caption } = req.body;

    if (!chatId || !imagePath) {
      return res.status(400).json({ error: "chatId e imagePath son requeridos" });
    }

    if (!isReady) {
      return res.status(503).json({ error: "WhatsApp no está conectado" });
    }

    // Resolver path absoluto
    const absPath = path.isAbsolute(imagePath) ? imagePath : path.join(__dirname, imagePath);

    if (!fs.existsSync(absPath)) {
      console.error(`❌ Imagen no encontrada: ${absPath}`);
      return res.status(404).json({ error: `Imagen no encontrada: ${absPath}` });
    }

    const media = MessageMedia.fromFilePath(absPath);
    await client.sendMessage(chatId, media, { caption: caption || "" });
    console.log(`🖼️ Imagen enviada a ${chatId.split("@")[0]}: ${path.basename(absPath)}`);
    res.json({ status: "sent" });
  } catch (error) {
    console.error("❌ Error enviando imagen:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Iniciar todo ─────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🌐 Bridge API corriendo en http://127.0.0.1:${PORT}`);
  console.log(`🔗 Flask backend en: ${FLASK_URL}`);
  console.log("");
});

client.initialize();
