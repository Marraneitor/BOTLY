"""
App principal Flask para el bot de WhatsApp - Sr y Sra Burger 🍔
Recibe mensajes del bridge de WhatsApp, genera respuestas con IA y las envía de vuelta.
"""

import logging
import json
import os
from datetime import datetime

import requests
from flask import Flask, request, jsonify, render_template_string

import config
from ai_service import get_ai_response, init_openai, clear_history, clear_all_histories, get_confirmed_orders, get_new_orders, update_order_status
from menu import get_menu_text
from delivery import init_maps

# ─── Configurar logging ───────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Crear app Flask ───────────────────────────────────────
app = Flask(__name__)
app.secret_key = config.FLASK_SECRET_KEY

# ─── Almacén de mensajes recientes (para el dashboard) ────
recent_messages: list[dict] = []
MAX_RECENT = 100

# ─── Estadísticas ─────────────────────────────────────────
stats = {
    "messages_received": 0,
    "messages_sent": 0,
    "errors": 0,
    "started_at": datetime.now().isoformat(),
}


# ─── RUTAS API ─────────────────────────────────────────────

@app.route("/")
def index():
    """Dashboard sencillo del bot."""
    return render_template_string(DASHBOARD_HTML, stats=stats, messages=recent_messages[-20:], config=config)


@app.route("/health", methods=["GET"])
def health():
    """Health check."""
    return jsonify({"status": "ok", "restaurant": config.RESTAURANT_NAME, "timestamp": datetime.now().isoformat()})


@app.route("/webhook/message", methods=["POST"])
def receive_message():
    """
    Recibe mensajes del bridge de WhatsApp.
    Esperado: { "chatId": "...", "message": "...", "sender": "...", "senderName": "..." }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data"}), 400

        chat_id = data.get("chatId", "")
        message = data.get("message", "").strip()
        sender = data.get("sender", "desconocido")
        sender_name = data.get("senderName", sender)

        if not message:
            return jsonify({"error": "Empty message"}), 400

        # Verificar si el contacto está ignorado
        if any(ignored in sender for ignored in config.IGNORED_CONTACTS if ignored):
            logger.info(f"Mensaje ignorado de {sender}")
            return jsonify({"status": "ignored"})

        logger.info(f"📩 Mensaje de {sender_name} ({chat_id}): {message[:100]}...")
        stats["messages_received"] += 1

        # Guardar mensaje reciente
        recent_messages.append({
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "sender": sender_name,
            "chat_id": chat_id,
            "message": message,
            "direction": "incoming",
        })
        if len(recent_messages) > MAX_RECENT:
            recent_messages.pop(0)

        # Generar respuesta con IA
        response_text = get_ai_response(chat_id, message, sender_name)

        # Enviar respuesta automáticamente si está habilitado
        if config.AUTO_REPLY:
            send_result = send_message(chat_id, response_text)
            if send_result:
                stats["messages_sent"] += 1
                recent_messages.append({
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "sender": "🤖 Bot",
                    "chat_id": chat_id,
                    "message": response_text[:200] + "..." if len(response_text) > 200 else response_text,
                    "direction": "outgoing",
                })

                # Enviar imágenes de productos si hay fotos disponibles
                detect_and_send_product_images(chat_id, response_text, message)

        return jsonify({
            "status": "ok",
            "response": response_text,
            "auto_sent": config.AUTO_REPLY,
        })

    except Exception as e:
        logger.error(f"❌ Error procesando mensaje: {e}", exc_info=True)
        stats["errors"] += 1
        return jsonify({"error": str(e)}), 500


@app.route("/api/send", methods=["POST"])
def api_send():
    """Envía un mensaje manualmente."""
    data = request.get_json()
    chat_id = data.get("chatId", "")
    message = data.get("message", "")
    if not chat_id or not message:
        return jsonify({"error": "chatId y message son requeridos"}), 400

    success = send_message(chat_id, message)
    return jsonify({"status": "sent" if success else "error"})


@app.route("/api/stats", methods=["GET"])
def api_stats():
    """Retorna estadísticas del bot."""
    return jsonify(stats)


@app.route("/api/menu", methods=["GET"])
def api_menu():
    """Retorna el menú completo."""
    return jsonify({"menu": get_menu_text()})


@app.route("/api/clear-history", methods=["POST"])
def api_clear_history():
    """Limpia el historial de un chat o de todos."""
    data = request.get_json() or {}
    chat_id = data.get("chatId")
    if chat_id:
        clear_history(chat_id)
        return jsonify({"status": f"Historial de {chat_id} limpiado"})
    else:
        clear_all_histories()
        return jsonify({"status": "Todos los historiales limpiados"})


# ─── API de Pedidos ────────────────────────────────────────

@app.route("/pedidos")
def pedidos_page():
    """Página de pedidos en tiempo real."""
    return app.send_static_file("Pedidoswhatsapp.html")


@app.route("/api/orders", methods=["GET"])
def api_orders():
    """Retorna todos los pedidos confirmados."""
    return jsonify({"orders": get_confirmed_orders()})


@app.route("/api/orders/new", methods=["GET"])
def api_orders_new():
    """Retorna pedidos nuevos desde un ID dado."""
    since_id = request.args.get("since", 0, type=int)
    new_orders = get_new_orders(since_id)
    return jsonify({"orders": new_orders, "count": len(new_orders)})


@app.route("/api/orders/<int:order_id>/status", methods=["POST"])
def api_order_status(order_id):
    """Actualiza el estado de un pedido."""
    data = request.get_json() or {}
    new_status = data.get("status", "")
    if not new_status:
        return jsonify({"error": "status es requerido"}), 400
    success = update_order_status(order_id, new_status)
    if success:
        return jsonify({"status": "ok", "order_id": order_id, "new_status": new_status})
    return jsonify({"error": "Pedido no encontrado"}), 404


# ─── Funciones auxiliares ──────────────────────────────────

def send_message(chat_id: str, message: str) -> bool:
    """Envía un mensaje a través del bridge de WhatsApp."""
    try:
        response = requests.post(
            f"{config.BRIDGE_URL}/send",
            json={"chatId": chat_id, "message": message},
            timeout=10,
        )
        if response.status_code == 200:
            logger.info(f"📤 Mensaje enviado a {chat_id}")
            return True
        else:
            logger.error(f"❌ Error enviando mensaje: {response.status_code} - {response.text}")
            return False
    except requests.exceptions.ConnectionError:
        logger.error(f"❌ No se pudo conectar al bridge en {config.BRIDGE_URL}. ¿Está corriendo?")
        return False
    except Exception as e:
        logger.error(f"❌ Error enviando mensaje: {e}")
        return False


def send_image(chat_id: str, image_path: str, caption: str = "") -> bool:
    """Envía una imagen a través del bridge de WhatsApp."""
    try:
        response = requests.post(
            f"{config.BRIDGE_URL}/send-image",
            json={"chatId": chat_id, "imagePath": image_path, "caption": caption},
            timeout=15,
        )
        if response.status_code == 200:
            logger.info(f"🖼️ Imagen enviada a {chat_id}: {os.path.basename(image_path)}")
            return True
        else:
            logger.error(f"❌ Error enviando imagen: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        logger.error(f"❌ Error enviando imagen: {e}")
        return False


# ─── Mapeo de productos a imágenes ────────────────────────
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "static", "images", "menu")

# Mapeo: palabra clave → archivo de imagen
PRODUCT_IMAGES = {
    # Hamburguesas
    "sencilla": "sencilla.png",
    "premium": "premium.png",
    "bbq bacon": "bbq_bacon.png",
    "bbq": "bbq_bacon.png",
    "bacon": "bbq_bacon.png",
    "alohawai": "alohawai.png",
    "hawaiana": "alohawai.png",
    "hawai": "alohawai.png",
    "cheesstorra": "cheesstorra.png",
    "chistorra": "cheesstorra.png",
    "salchiburger": "salchiburger.png",
    "salchi": "salchiburger.png",
    "choriargentina": "choriargentina.png",
    "chorizo": "choriargentina.png",
    "guacamole": "guacamole.png",
    "boneles burger": "boneles_burger.png",
    "boneless burger": "boneles_burger.png",
    # Hotdogs
    "hot dog": "hotdog.png",
    "hotdog": "hotdog.png",
    # Boneless
    "boneless": "boneles_burger.png",
    "boneles": "boneles_burger.png",
    # Complementos
    "papas francesas": "papas_francesas.png",
    "francesa": "papas_francesas.png",
    "papas gajo": "papas_gajo.png",
    "gajo": "papas_gajo.png",
    "papas": "papas_francesas.png",
    # Combos
    "combo amigos": "combo_amigos.png",
    "combo duo": "combo_duo.png",
    "combo familiar": "combo_familiar.png",
    "combo triple": "combo_tripledog.png",
    "combo boneles": "combo_boneles.png",
    "combo boneless": "combo_boneles.png",
    "combo": "combos.png",
    "combos": "combos.png",
    # Menú completo
    "menú": "menu_completo.png",
    "menu": "menu_completo.png",
    "carta": "menu_completo.png",
}


def detect_and_send_product_images(chat_id: str, bot_response: str, user_message: str):
    """Detecta si la respuesta del bot menciona productos y envía fotos disponibles."""
    msg_lower = user_message.lower()
    sent_images = set()

    # Si el usuario pregunta por el menú completo
    if any(w in msg_lower for w in ["menú", "menu", "carta", "qué tienen", "que tienen", "platillos"]):
        img_path = os.path.join(IMAGES_DIR, "menu_completo.png")
        if os.path.exists(img_path):
            send_image(chat_id, img_path, "📋 Nuestro menú 🍔🔥")
            # También mandar combos
            combos_path = os.path.join(IMAGES_DIR, "combos.png")
            if os.path.exists(combos_path):
                send_image(chat_id, combos_path, "📦 Nuestros combos")
        return

    # Buscar productos mencionados - priorizar keywords más largos primero
    sorted_keywords = sorted(PRODUCT_IMAGES.keys(), key=len, reverse=True)
    for keyword in sorted_keywords:
        filename = PRODUCT_IMAGES[keyword]
        if keyword in msg_lower and filename not in sent_images:
            img_path = os.path.join(IMAGES_DIR, filename)
            if os.path.exists(img_path):
                send_image(chat_id, img_path)
                sent_images.add(filename)
                if len(sent_images) >= 3:  # Máximo 3 imágenes por mensaje
                    break


# ─── Dashboard HTML ────────────────────────────────────────

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🍔 Sr y Sra Burger - Bot Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; }
        .header {
            background: linear-gradient(135deg, #e63946, #f4a261);
            padding: 20px 30px;
            text-align: center;
        }
        .header h1 { font-size: 1.8rem; color: white; }
        .header p { color: rgba(255,255,255,0.8); margin-top: 5px; }
        .container { max-width: 900px; margin: 20px auto; padding: 0 20px; }
        .stats-grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px; margin-bottom: 20px;
        }
        .stat-card {
            background: #16213e; border-radius: 12px; padding: 20px;
            text-align: center; border: 1px solid #0f3460;
        }
        .stat-card .number { font-size: 2rem; font-weight: bold; color: #f4a261; }
        .stat-card .label { font-size: 0.85rem; color: #aaa; margin-top: 5px; }
        .messages-section {
            background: #16213e; border-radius: 12px; padding: 20px;
            border: 1px solid #0f3460;
        }
        .messages-section h2 { margin-bottom: 15px; color: #f4a261; }
        .message {
            padding: 10px 15px; border-radius: 8px; margin-bottom: 8px;
            font-size: 0.9rem;
        }
        .message.incoming { background: #0f3460; border-left: 3px solid #e63946; }
        .message.outgoing { background: #1a3a5c; border-left: 3px solid #2ecc71; }
        .message .meta { font-size: 0.75rem; color: #888; margin-bottom: 3px; }
        .message .text { word-break: break-word; }
        .no-messages { text-align: center; color: #666; padding: 30px; }
        .refresh-btn {
            display: inline-block; margin: 15px 0; padding: 10px 20px;
            background: #e63946; color: white; border: none; border-radius: 8px;
            cursor: pointer; font-size: 0.9rem; text-decoration: none;
        }
        .refresh-btn:hover { background: #c62828; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🍔 Sr y Sra Burger — Bot WhatsApp</h1>
        <p>Panel de control del asistente virtual</p>
    </div>
    <div class="container">
        <div class="stats-grid">
            <div class="stat-card">
                <div class="number">{{ stats.messages_received }}</div>
                <div class="label">📩 Mensajes recibidos</div>
            </div>
            <div class="stat-card">
                <div class="number">{{ stats.messages_sent }}</div>
                <div class="label">📤 Respuestas enviadas</div>
            </div>
            <div class="stat-card">
                <div class="number">{{ stats.errors }}</div>
                <div class="label">❌ Errores</div>
            </div>
        </div>

        <a href="/" class="refresh-btn">🔄 Refrescar</a>

        <div class="messages-section">
            <h2>💬 Mensajes recientes</h2>
            {% if messages %}
                {% for msg in messages | reverse %}
                <div class="message {{ msg.direction }}">
                    <div class="meta">{{ msg.timestamp }} — {{ msg.sender }}</div>
                    <div class="text">{{ msg.message }}</div>
                </div>
                {% endfor %}
            {% else %}
                <div class="no-messages">
                    <p>Aún no hay mensajes. Esperando conexión con WhatsApp...</p>
                </div>
            {% endif %}
        </div>
    </div>
</body>
</html>
"""


# ─── Iniciar app ──────────────────────────────────────────

if __name__ == "__main__":
    init_openai()
    init_maps()
    logger.info(f"🍔 Bot de {config.RESTAURANT_NAME} iniciando...")
    logger.info(f"🌐 Dashboard: http://{config.FLASK_HOST}:{config.FLASK_PORT}")
    logger.info(f"🔗 Bridge URL: {config.BRIDGE_URL}")
    logger.info(f"🤖 Auto-reply: {'ON' if config.AUTO_REPLY else 'OFF'}")
    logger.info(f"🛵 Delivery: ${config.DELIVERY_PRICE_PER_KM}/km")
    app.run(host=config.FLASK_HOST, port=config.FLASK_PORT, debug=True)
