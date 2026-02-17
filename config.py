"""
Configuración del bot de WhatsApp - Sr y Sra Burger 🍔
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ─── Restaurante ───────────────────────────────────────────
RESTAURANT_NAME = "Sr y Sra Burger"
RESTAURANT_PHONE = "922-159-36-88"
RESTAURANT_ADDRESS = "Coahuila #36, Colonia Emiliano Zapata"
RESTAURANT_HOURS = {
    "lunes": "Descansamos 🚫",
    "martes": "6:00 PM - 10:00 PM",
    "miércoles": "6:00 PM - 10:00 PM",
    "jueves": "6:00 PM - 10:00 PM",
    "viernes": "6:00 PM - 10:00 PM",
    "sábado": "4:00 PM - 10:00 PM",
    "domingo": "4:00 PM - 10:00 PM",
}

# ─── Google Gemini ─────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# ─── Flask ─────────────────────────────────────────────────
FLASK_HOST = os.getenv("FLASK_HOST", "127.0.0.1")
FLASK_PORT = int(os.getenv("FLASK_PORT", "5000"))
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "sr-sra-burger-bot-secret-key")

# ─── WhatsApp Bridge (Node.js) ─────────────────────────────
BRIDGE_URL = os.getenv("BRIDGE_URL", "http://127.0.0.1:3001")

# ─── Bot settings ──────────────────────────────────────────
AUTO_REPLY = os.getenv("AUTO_REPLY", "true").lower() == "true"
MAX_HISTORY_PER_CHAT = int(os.getenv("MAX_HISTORY_PER_CHAT", "20"))
IGNORED_CONTACTS = os.getenv("IGNORED_CONTACTS", "").split(",") if os.getenv("IGNORED_CONTACTS") else []

# ─── Google Maps / Delivery ─────────────────────────────────
MAPS_API_KEY = os.getenv("MAPS_API_KEY", "")
DELIVERY_PRICE_PER_KM = os.getenv("DELIVERY_PRICE_PER_KM", "9")
DELIVERY_MIN_FEE = os.getenv("DELIVERY_MIN_FEE", "15")
DELIVERY_MAX_KM = os.getenv("DELIVERY_MAX_KM", "15")

# ─── Métodos de pago ────────────────────────────────────────
PAYMENT_METHODS = ["efectivo", "transferencia"]
TRANSFER_CLABE = "722969010805762486"
TRANSFER_BANK = "Mercado Pago W"
TRANSFER_NAME = "Joel Maciel Villalobos"
