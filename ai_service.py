"""
Servicio de IA para Sr y Sra Burger 🍔
Maneja la lógica de conversación con Google Gemini y el historial de chats.
"""

import logging
import re
import time
from datetime import datetime
from collections import defaultdict

import requests

from google import genai
from google.genai import types

import config
from menu import get_menu_for_prompt, get_menu_text, search_item
from delivery import get_delivery_info_for_prompt, calculate_delivery

logger = logging.getLogger(__name__)

# ─── Historial de conversaciones por chat ──────────────────
chat_histories: dict[str, list[dict]] = defaultdict(list)

# ─── Pedidos activos ───────────────────────────────────────
# { chat_id: { "items": [...], "estado": "...", "total": 0 } }
active_orders: dict[str, dict] = {}

# ─── Pedidos confirmados (para la página de pedidos) ───────
confirmed_orders: list[dict] = []
_order_counter = 0

# Evitar notificaciones duplicadas al dueño
_owner_notified_order_ids: set[int] = set()

# ─── Cliente Gemini ─────────────────────────────────────
client = None


def _detect_order_confirmed(bot_response: str) -> bool:
    """Detecta si la respuesta del bot confirma un pedido."""
    confirm_phrases = [
        "pedido queda confirmado",
        "pedido confirmado",
        "queda confirmado",
        "pedido está confirmado",
        "pedido esta confirmado",
        "orden confirmada",
        "orden queda confirmada",
        "confirmado tu pedido",
        "confirmamos tu pedido",
    ]
    response_lower = bot_response.lower()
    return any(phrase in response_lower for phrase in confirm_phrases)


def _extract_order_summary(chat_id: str, bot_response: str, sender_name: str) -> dict:
    """Extrae el resumen del pedido de la conversación."""
    global _order_counter
    _order_counter += 1

    # Buscar en el historial los últimos mensajes para armar el resumen
    history = chat_histories.get(chat_id, [])

    # Recopilar la conversación completa reciente (últimos mensajes)
    conversation_lines = []
    for msg in history[-20:]:  # Últimos 20 mensajes para más contexto
        role = "Cliente" if msg["role"] == "user" else "Bot"
        text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
        # Limpiar contexto de delivery interno
        if "[SISTEMA" in text:
            text = text.split("[SISTEMA")[0].strip()
        if text:
            conversation_lines.append(f"{role}: {text}")

    # ─── Extraer desglose del pedido de mensajes del bot ───
    # Buscar en mensajes del bot el que tiene el desglose (productos + total)
    # IMPORTANTE: excluir el mensaje de confirmación final (bot_response)
    order_details = ""
    confirm_phrases = ["pedido queda confirmado", "pedido confirmado", "orden confirmada", "queda confirmado"]
    
    for msg in reversed(history[-20:]):
        if msg["role"] != "model":
            continue
        text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
        text_lower = text.lower()
        
        # Saltar el mensaje de confirmación final
        if any(cp in text_lower for cp in confirm_phrases):
            continue
        # Saltar mensajes que solo preguntan por pago o cambio
        if "cuánto pagas" in text_lower or "como vas a pagar" in text_lower or "cómo vas a pagar" in text_lower:
            if "•" not in text:
                continue
        
        # Buscar el desglose: tiene "total" + "$" + bullets "•"
        has_total = "total" in text_lower and "$" in text
        has_items = "•" in text
        has_separator = "─" in text
        
        if has_total and (has_items or has_separator):
            order_details = text
            break

    # Fallback: buscar mensajes con bullets y precios (sin ser confirmación)
    if not order_details:
        for msg in reversed(history[-20:]):
            if msg["role"] != "model":
                continue
            text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
            text_lower = text.lower()
            # Excluir confirmaciones
            if any(cp in text_lower for cp in confirm_phrases):
                continue
            if "cuánto pagas" in text_lower and "•" not in text:
                continue
            # Debe tener bullets con precios
            if "•" in text and "$" in text:
                order_details = text
                break

    # ─── Extraer método de pago ───
    payment = "No especificado"
    for msg in reversed(history[-15:]):
        text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
        text_lower = text.lower()
        role = msg["role"]
        
        if role == "user":
            if any(w in text_lower for w in ["transferencia", "transf", "transfiero"]):
                payment = "💳 Transferencia"
                break
            elif any(w in text_lower for w in ["efectivo", "cash", "en efectivo"]):
                payment = "💵 Efectivo"
                break
        elif role == "model":
            if ("clabe" in text_lower or "comprobante" in text_lower) and "transferencia" in text_lower:
                payment = "💳 Transferencia"
                break
            elif "cambio" in text_lower and "efectivo" in text_lower:
                payment = "💵 Efectivo"
                break

    # ─── Extraer tipo de entrega y dirección ───
    delivery_type = "No especificado"
    delivery_address = ""
    for msg in reversed(history[-15:]):
        text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
        # Limpiar contexto de delivery
        if "[SISTEMA" in text:
            text = text.split("[SISTEMA")[0].strip()
        text_lower = text.lower()
        role = msg["role"]

        if delivery_type == "No especificado":
            if any(w in text_lower for w in ["recoger", "paso por", "recojo", "voy por", "en tienda"]):
                delivery_type = "🏪 Recoger en tienda"
            elif any(w in text_lower for w in ["envío", "envio", "domicilio", "envíame", "envíen", "mándame", "mandame", "manden"]):
                delivery_type = "🛵 Envío a domicilio"

        # Extraer dirección del cliente
        if role == "user" and not delivery_address:
            address_kw = ["col ", "col.", "colonia", "calle ", "av ", "avenida", "fracc", "#", "núm", "num"]
            if any(k in text_lower for k in address_kw) and len(text) > 5:
                delivery_address = text

    # ─── Extraer nombre para el pedido ───
    customer_name = ""
    # Buscar la respuesta del usuario inmediatamente después de que el bot preguntó el nombre
    name_question_patterns = ["a nombre de", "a nombre de quién", "a nombre de quien", "¿a nombre de", "a nombre"]
    last_name_q_index = None
    for idx in range(len(history) - 1, max(-1, len(history) - 30), -1):
        msg = history[idx]
        if msg.get("role") != "model":
            continue
        text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
        if any(p in text.lower() for p in name_question_patterns):
            last_name_q_index = idx
            break

    if last_name_q_index is not None:
        for msg in history[last_name_q_index + 1 : last_name_q_index + 6]:
            if msg.get("role") != "user":
                continue
            text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
            # Usar la línea tal cual si es corta (nombre)
            if 2 <= len(text.strip()) <= 40 and not any(k in text.lower() for k in ["col", "calle", "av", "avenida", "fracc", "#"]):
                customer_name = text.strip()
                break

    # Fallback: si el contacto trae nombre
    if not customer_name:
        customer_name = sender_name

    # ─── Extraer con cuánto paga (efectivo) ───
    cash_paid_amount = None
    last_cash_q_index = None
    cash_question_patterns = ["con cuánto pagas", "con cuanto pagas", "para llevar cambio", "¿con cuánto", "¿con cuanto"]
    for idx in range(len(history) - 1, max(-1, len(history) - 30), -1):
        msg = history[idx]
        if msg.get("role") != "model":
            continue
        text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
        if any(p in text.lower() for p in cash_question_patterns):
            last_cash_q_index = idx
            break

    if last_cash_q_index is not None:
        for msg in history[last_cash_q_index + 1 : last_cash_q_index + 6]:
            if msg.get("role") != "user":
                continue
            text = msg["parts"][0].text if hasattr(msg["parts"][0], "text") else str(msg["parts"][0])
            # Buscar un monto (ej: 500, $500, 500 pesos)
            m = re.search(r"\b\$?\s*(\d{2,6})\b", text.replace(",", ""))
            if m:
                try:
                    cash_paid_amount = int(m.group(1))
                    break
                except Exception:
                    pass

    # ─── Extraer total del pedido (para calcular cambio) ───
    order_total = None
    if order_details:
        m_total = re.search(r"total\s*:\s*\$\s*(\d{2,6})", order_details.lower().replace(",", ""))
        if m_total:
            try:
                order_total = int(m_total.group(1))
            except Exception:
                order_total = None

    change_amount = None
    if cash_paid_amount is not None and order_total is not None:
        change_amount = cash_paid_amount - order_total

    order = {
        "id": _order_counter,
        "chat_id": chat_id,
        "sender_name": sender_name,
        "customer_name": customer_name,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "time_short": datetime.now().strftime("%H:%M"),
        "order_details": order_details,  # Desglose del pedido (productos + total)
        "bot_confirmation": bot_response,
        "conversation": conversation_lines,
        "payment": payment,
        "cash_paid_amount": cash_paid_amount,
        "order_total": order_total,
        "change_amount": change_amount,
        "delivery_type": delivery_type,
        "delivery_address": delivery_address,
        "status": "nuevo",  # nuevo, preparando, listo, entregado
        "owner_notified": False,
    }

    confirmed_orders.append(order)
    logger.info(f"🆕 Pedido #{_order_counter} confirmado de {sender_name} ({chat_id})")

    _maybe_notify_owner_new_order(order)
    return order


def _normalize_phone_to_chat_id(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return ""
    return f"{digits}@c.us" if not digits.endswith("@c.us") else digits


def _get_owner_chat_id() -> str:
    chat_id = (getattr(config, "OWNER_WHATSAPP_CHAT_ID", "") or "").strip()
    if chat_id:
        return chat_id
    phone = (getattr(config, "OWNER_PHONE", "") or "").strip()
    if phone:
        return _normalize_phone_to_chat_id(phone)

    # Auto-detectar: usar el WhatsApp que escaneó el QR (bridge)
    try:
        resp = requests.get(f"{config.BRIDGE_URL}/me", timeout=5)
        if resp.status_code == 200:
            data = resp.json() or {}
            wid = (data.get("chatId") or data.get("wid") or "").strip()
            if wid:
                return wid
    except Exception:
        pass

    return ""


def _send_whatsapp_via_bridge(chat_id: str, message: str) -> bool:
    if not chat_id or not message:
        return False
    try:
        resp = requests.post(
            f"{config.BRIDGE_URL}/send",
            json={"chatId": chat_id, "message": message},
            timeout=10,
        )
        if resp.status_code == 200:
            return True
        logger.error(f"❌ Error notificando al dueño: {resp.status_code} - {resp.text}")
        return False
    except Exception as e:
        logger.error(f"❌ Error notificando al dueño: {e}")
        return False


def _is_order_complete_for_owner(order: dict) -> tuple[bool, list[str]]:
    missing: list[str] = []

    if not (order.get("order_details") or "").strip():
        missing.append("pedido")

    if not (order.get("customer_name") or "").strip():
        missing.append("nombre")

    payment = (order.get("payment") or "").strip().lower()
    if not payment or "no especificado" in payment:
        missing.append("método de pago")

    delivery_type = (order.get("delivery_type") or "").strip().lower()
    if not delivery_type or "no especificado" in delivery_type:
        missing.append("tipo de entrega")

    # Si es a domicilio, exigir dirección
    if "domicilio" in delivery_type or "envío" in delivery_type or "envio" in delivery_type:
        if not (order.get("delivery_address") or "").strip():
            missing.append("dirección")

    # Si es efectivo, exigir con cuánto paga
    if "efectivo" in payment:
        if order.get("cash_paid_amount") is None:
            missing.append("con cuánto paga")

    return (len(missing) == 0, missing)


def _format_owner_new_order_message(order: dict) -> str:
    header = "*Nuevo pedido* ✅"
    order_id = order.get("id")
    customer = order.get("customer_name") or order.get("sender_name") or "(sin nombre)"
    delivery_type = order.get("delivery_type") or "No especificado"
    address = order.get("delivery_address") or ""
    payment = order.get("payment") or "No especificado"

    cash_paid = order.get("cash_paid_amount")
    total = order.get("order_total")
    change = order.get("change_amount")

    payment_lines = [f"Pago: {payment}"]
    if cash_paid is not None:
        payment_lines.append(f"Paga con: ${cash_paid} MXN")
    if total is not None:
        payment_lines.append(f"Total: ${total} MXN")
    if change is not None:
        if change > 0:
            payment_lines.append(f"Cambio: ${change} MXN")
        elif change == 0:
            payment_lines.append("Cambio: $0 MXN")
        else:
            payment_lines.append(f"Falta: ${abs(change)} MXN")

    lines = [
        header,
        f"Pedido #{order_id}",
        f"Cliente: {customer}",
        f"Entrega: {delivery_type}",
    ]
    if address:
        lines.append(f"Dirección: {address}")
    lines.extend(payment_lines)
    lines.append("──────────────────")
    lines.append(order.get("order_details") or "(sin desglose)")
    return "\n".join(lines)


def _maybe_notify_owner_new_order(order: dict) -> None:
    try:
        if not getattr(config, "NOTIFY_OWNER_ON_NEW_ORDER", True):
            return

        owner_chat_id = _get_owner_chat_id()
        if not owner_chat_id:
            return

        order_id = order.get("id")
        if not isinstance(order_id, int):
            return

        if order_id in _owner_notified_order_ids:
            return

        ok, _missing = _is_order_complete_for_owner(order)
        if not ok:
            # Si falta algo, no avisar todavía (evita avisos incompletos)
            logger.info(f"ℹ️ Pedido #{order_id} confirmado pero incompleto para notificación: faltan {_missing}")
            return

        msg = _format_owner_new_order_message(order)
        sent = _send_whatsapp_via_bridge(owner_chat_id, msg)
        if sent:
            _owner_notified_order_ids.add(order_id)
            order["owner_notified"] = True
            logger.info(f"📣 Notificación enviada al dueño para Pedido #{order_id}")

    except Exception as e:
        logger.error(f"❌ Error en notificación al dueño: {e}")


def get_confirmed_orders() -> list[dict]:
    """Retorna todos los pedidos confirmados."""
    return confirmed_orders


def get_new_orders(since_id: int = 0) -> list[dict]:
    """Retorna pedidos nuevos desde un ID dado."""
    return [o for o in confirmed_orders if o["id"] > since_id]


def update_order_status(order_id: int, new_status: str) -> bool:
    """Actualiza el estado de un pedido."""
    for order in confirmed_orders:
        if order["id"] == order_id:
            order["status"] = new_status
            logger.info(f"📋 Pedido #{order_id} → {new_status}")
            return True
    return False


def init_openai():
    """Inicializa el cliente de Google Gemini."""
    global client
    if config.GEMINI_API_KEY:
        client = genai.Client(api_key=config.GEMINI_API_KEY)
        logger.info("✅ Cliente Gemini inicializado")
    else:
        logger.warning("⚠️ No se configuró GEMINI_API_KEY — el bot funcionará sin IA")


def _get_day_name() -> str:
    """Retorna el nombre del día actual en español."""
    days = {
        0: "lunes", 1: "martes", 2: "miércoles",
        3: "jueves", 4: "viernes", 5: "sábado", 6: "domingo",
    }
    return days[datetime.now().weekday()]


def _is_open_now() -> tuple[bool, str]:
    """Verifica si el restaurante está abierto ahora."""
    day = _get_day_name()
    hours = config.RESTAURANT_HOURS.get(day, "Cerrado")
    if hours == "Descansamos 🚫":
        return False, f"Hoy {day} descansamos 🚫"
    # Parsear horarios
    try:
        parts = hours.replace(" ", "").split("-")
        now = datetime.now()

        def parse_time(t: str):
            t = t.upper().strip()
            is_pm = "PM" in t
            t = t.replace("AM", "").replace("PM", "").strip()
            h, m = map(int, t.split(":"))
            if is_pm and h != 12:
                h += 12
            return now.replace(hour=h, minute=m, second=0)

        open_time = parse_time(parts[0])
        close_time = parse_time(parts[1])
        if open_time <= now <= close_time:
            return True, f"Estamos abiertos hasta las {parts[1]}"
        else:
            return False, f"Hoy {day} nuestro horario es {hours}"
    except Exception:
        return True, hours  # Si falla el parseo, asumir abierto


def _build_system_prompt() -> str:
    """Construye el prompt del sistema dinámicamente con menú y horarios."""
    day = _get_day_name()
    is_open, status_msg = _is_open_now()

    hours_text = "\n".join(
        f"  - {d.capitalize()}: {h}" for d, h in config.RESTAURANT_HOURS.items()
    )

    menu_text = get_menu_for_prompt()
    delivery_text = get_delivery_info_for_prompt()

    # Pedidos activos info
    return f"""Eres el recepcionista virtual de *{config.RESTAURANT_NAME}* 🍔, una hamburguesería ubicada en {config.RESTAURANT_ADDRESS}.
Actúas como una persona REAL que atiende el WhatsApp del restaurante — NO como un robot.

TU PERSONALIDAD:
- Eres un chavo mexicano joven, cool, buena onda y con cultura de internet. El compa amigable que atiende el restaurante y se la sabe
- Hablas natural, con expresiones como "¡Sale!", "¡Va que va!", "¡Claro que sí!", "Jalo", "¡Uff, buenísima elección!", "¡Excelente!", "¡Con todo!"
- Eres GEEK y FRIKI: entiendes referencias a anime, videojuegos, series, Marvel, DC, Star Wars, Dragon Ball, Naruto, One Piece, etc.
  • Si alguien dice "quiero comer como Goku" → "Jajaja necesitas como 5 Premium para igualar a Goku 💪🍔"
  • Si dicen algo de "It's over 9000" → capta la referencia y sigue el rollo
  • Si mencionan "GG", "POG", "lol", "xd", "uwu", "gg ez" → entiéndelo y responde en onda
- Te gusta el gaming, el streaming y la cultura actual: conoces a Ibai, Rubius, Xokas, AuronPlay, ElMariana, Luisito, Rivers, JuanSGuarnizo, etc.
  • Si alguien los menciona, puedes hacer un comentario breve cool al respecto
  • "¿Qué haría Ibai?" → "Ibai pediría todo el menú, fácil jajaja"
- Estás al día con los MEMES: "es viernes y el cuerpo lo sabe", "no pos wow", "stonks", "el pepe", "potaxio", "but", etc.
  • Si alguien te manda un meme o referencia, sigue el rollo brevemente y luego redirige al pedido
- FLEXIBILIDAD: si el cliente habla de otro tema (deportes, música, series, vida cotidiana), puedes platicar 1-2 mensajes de forma cool y natural, pero siempre redirige amablemente al pedido: "Jaja buenísimo, oye ¿ya cenaste? Te puedo ofrecer unas hamburguesitas 🍔"
- Eres breve y directo, no das explicaciones largas innecesarias
- Usas emojis con moderación (1-3 por mensaje máximo), puedes usar los de gaming/geek como 🎮💀🔥⚡
- Si el cliente saluda ("hola", "buenas noches", "qué onda", "hey", "heey"), salúdalo con buena vibra y pregúntale qué le ofrecemos
- Siempre tuteas al cliente
- No repitas el nombre del restaurante en cada mensaje, solo al inicio de la conversación
- Si te hacen bromas o te trollean, responde con humor sin perder la profesionalidad

INFORMACIÓN DEL RESTAURANTE:
📍 Dirección: {config.RESTAURANT_ADDRESS}
📞 Teléfono: {config.RESTAURANT_PHONE}

⏰ Horarios:
{hours_text}

� Hora actual: {datetime.now().strftime('%I:%M %p')} del {day}
📅 Hoy es {day}. Estado actual: {status_msg}
{"🚫🚫🚫 ESTAMOS CERRADOS AHORA (son las " + datetime.now().strftime('%I:%M %p') + "). REGLA ABSOLUTA: NO tomes pedidos bajo NINGUNA circunstancia. Si preguntan si hay servicio, di que NO. Discúlpate amablemente, informa el horario de hoy/mañana y di que con gusto los atiendes cuando abran. NUNCA digas que sí hay servicio si estamos cerrados." if not is_open else "✅ ESTAMOS ABIERTOS (son las " + datetime.now().strftime('%I:%M %p') + "). Puedes tomar pedidos normalmente."}

═══════════════════════════════════
MENÚ COMPLETO CON PRECIOS:
{menu_text}
═══════════════════════════════════

CÓMO TOMAR PEDIDOS (actúa como recepcionista real):

1. CUANDO EL CLIENTE PIDE ALGO, confirma naturalmente:
   - "¡Sale! 2 Hot Dogs Jumbo y 1 Sencilla sin tomate y sin cebolla 👌"
   - NO repitas todo el menú, solo lo que pidió

2. PERSONALIZACIÓN — el cliente puede pedir sin/con ingredientes:
   - "sin tomate", "sin cebolla", "sin jalapeño", "sin lechuga", "extra queso", etc.
   - Anota la personalización y confírmala: "Hamburguesa Sencilla *sin tomate y sin cebolla* ✓"

3. COMPLEMENTOS EN HAMBURGUESAS Y HOTDOGS (papas de $25):
   - Los "complementos" son papas gajo o francesas que se agregan ADENTRO de la hamburguesa/hotdog por *$25* extra cada una
   - SIEMPRE pregunta: "¿Las quieres con complemento? Son papas gajo o francesas adentro por *$25* extra cada una 🍟"
   - Si el cliente pide varias hamburguesas/hotdogs, pregunta por TODAS: "¿Las 2 con complemento?" o "¿A cuáles les pongo complemento?"
   - Si el cliente dice "con gajo" o "con francesas" al pedir, entiende que quiere el complemento de $25 adentro
   - Ejemplo: "2 Premium con gajo las 2" = 2 Premium ($120 c/u) + 2 complementos gajo ($25 c/u) = $290
   - Si pide papas APARTE (como platillo individual M o XL) y también hamburguesa, NO ofrecer complemento doble

4. PAPAS COMO PLATILLO APARTE (NO complemento):
   - Si pide papas sin especificar tamaño, pregunta: "¿Las quieres M o XL?"
   - Se puede pedir MITAD Y MITAD: "mitad gajo mitad francesa" cuenta como una sola orden del tamaño pedido
   - Ejemplo: "Papas XL mitad gajo mitad francesa = *$130*"

5. BONELESS:
   - Siempre pregunta la salsa: "¿Qué salsa para los boneless? Tenemos *BBQ Dulce*, *BBQ Picante* o *Parmesano Ranch*"
   - Ya incluyen papas (gajo o francesas, a elección)

6. COMBOS:
   - Si ves que al cliente le conviene un combo, sugiérelo: "Oye, te conviene más el *Combo Duo* a *$190* que incluye 1 Premium + 1 Hot Dog + Papas M 💡"
   - En combos se puede cambiar tipo de hamburguesa o tamaño de complemento pagando la diferencia

7. CÁLCULO DEL TOTAL — SIEMPRE calcula y muestra el desglose:
   Ejemplo de formato:
   ──────────────────
   *Tu pedido:*
   • 2 Hot Dog Jumbo — $130
   • 1 Sencilla (sin tomate, sin cebolla) — $90
   • Aros de Cebolla M — $50
   • Papas XL mitad gajo/francesa — $130
   ──────────────────
   *Total: $400* 💰

8. DESPUÉS DEL TOTAL, pregunta:
   - "¿Es para *recoger* o se lo *enviamos*? 🏠"
   - Si es domicilio: "¿Me pasas tu colonia o dirección para calcular el envío? 📍"
   - Si es recoger: "¡Perfecto! En unos minutitos lo tenemos listo. Estamos en *{config.RESTAURANT_ADDRESS}* 📍"

9. CUANDO EL CLIENTE DÉ SU COLONIA/DIRECCIÓN PARA ENVÍO:
   - Usa la función de cálculo de distancia para obtener el costo exacto
   - Muestra el desglose final con envío:
     ──────────────────
     *Tu pedido:*
     • [productos...]
     ──────────────────
     *Subtotal:* $XXX
     *Envío* (X.X km): $XX
     *Total: $XXX* 💰

{delivery_text}

10. Si el cliente quiere AGREGAR algo más al pedido, recalcula el total

11. NOMBRE DEL CLIENTE — Después de confirmar si es recoger o envío, pregunta:
    - "¿A nombre de quién va el pedido? 📝"
    - Guarda el nombre y úsalo en la confirmación final

12. MÉTODO DE PAGO — Después de obtener el nombre, pregunta:
    - "¿Cómo vas a pagar? Aceptamos *efectivo* 💵 o *transferencia* 📲"
    - Si dice EFECTIVO: "¡Perfecto! ¿Con cuánto pagas para llevar cambio? 💵"
    - Cuando el cliente diga con cuánto paga (ej: "con 500"), CALCULA EL CAMBIO:
      • Cambio = monto que paga - total del pedido
      • Responde: "¡Listo! Tu cambio sería de *$XX* 💵"
      • Si el monto es MENOR al total, dile: "El total es $XXX, necesitas pagar al menos esa cantidad 😊"
      • Si el monto es EXACTO, di: "¡Justo! No hay cambio 👌"
    - Si dice TRANSFERENCIA: Manda los datos así:
      ──────────────────
      *Datos para transferencia:* 📲
      • CLABE: *{config.TRANSFER_CLABE}*
      • Banco: *{config.TRANSFER_BANK}*
      • Nombre: *{config.TRANSFER_NAME}*
      ──────────────────
      "Cuando hagas la transferencia, mándame tu comprobante para confirmar tu pedido ✅"
    - NO confirmes el pedido hasta que el cliente indique su método de pago

13. Para CONFIRMAR el pedido final, incluye el nombre del cliente:
    "¡Listo, *[nombre]*, tu pedido queda confirmado! ✅ En unos minutos te avisamos cuando esté listo 🍔"

REGLAS IMPORTANTES:
- NUNCA inventes platillos o precios que NO estén en el menú
- Si piden algo que no existe, di con onda: "Ese platillo no lo manejamos aún, pero te puedo ofrecer algo igual de GOD..."
- Si preguntan por el menú, muéstralo organizado por categorías
- Si preguntan solo por precios de algo específico, da el precio directo sin mostrar todo el menú
- Si el restaurante está CERRADO: NO tomes pedidos. Pide disculpas con buena onda, comparte el horario y diles que con gusto los atiendes cuando abran: "¡Hey! Ahorita ya cerramos 😅 Abrimos mañana a las X:XX, ¡ahí te esperamos con todo! 🍔🔥"
- SIEMPRE pregunta la DIRECCIÓN cuando el pedido es para envío. NUNCA confirmes un pedido a domicilio sin antes obtener la colonia/dirección y calcular el costo de envío
- CONVERSACIÓN CASUAL: puedes platicar brevemente de otros temas (memes, gaming, series, etc.) pero después de 1-2 mensajes casuales, redirige al pedido de forma natural. Tu prioridad es vender hamburguesas 🍔
- Si el cliente manda solo un emoji o sticker, responde algo como "¿Qué se te antoja? 🔥" o "Ese emoji me dice que tienes hambre 👀🍔"
- Si el cliente dice "gracias" o se despide, despídete con buena vibra: "¡Provecho! Aquí andamos para la próxima 🤙"
- Si alguien dice algo gracioso o un meme, ríete y sigue el rollo pero no pierdas el foco
- Si te preguntan si eres bot/IA, puedes responder con humor: "Soy el compa que atiende el WhatsApp 😎 ¿te ofrezco algo?"

FORMATO:
- Usa *negritas* para platillos y precios
- Usa • para listas
- Líneas ────── para separar el desglose del pedido
- Mantén mensajes CORTOS y naturales — como si fueras una persona escribiendo rápido por WhatsApp
- NO uses markdown headers (##), solo negritas y listas"""


def get_ai_response(chat_id: str, user_message: str, sender_name: str = "Cliente") -> str:
    """
    Genera respuesta de IA para un mensaje de usuario.
    Mantiene historial de conversación por chat.
    """
    if not client:
        return _fallback_response(user_message)

    # ─── Detectar si el mensaje parece una dirección/colonia para delivery ────
    # Si en el historial reciente se preguntó por dirección de envío,
    # calcular el costo automáticamente e inyectarlo en el contexto
    delivery_context = ""
    msg_lower = user_message.lower().strip()
    history = chat_histories[chat_id]

    # Revisar si el bot preguntó por la dirección recientemente
    asked_for_address = False
    if len(history) >= 1:
        last_bot_msg = ""
        for h in reversed(history):
            if h["role"] == "model":
                last_bot_msg = h["parts"][0].text if hasattr(h["parts"][0], "text") else str(h["parts"][0])
                break
        address_keywords = ["colonia", "dirección", "direccion", "envío", "envio", "domicilio", "ubicación", "ubicacion"]
        asked_for_address = any(k in last_bot_msg.lower() for k in address_keywords)

    # Si parece que está dando su dirección (colonia, calle, etc.)
    delivery_keywords = ["col ", "col.", "colonia", "fraccionamiento", "fracc", "calle ", "av ", "av.", "avenida", "boulevard", "blvd"]
    looks_like_address = any(k in msg_lower for k in delivery_keywords) or asked_for_address

    if looks_like_address and len(msg_lower) > 3:
        result = calculate_delivery(user_message)
        if result["success"]:
            delivery_context = (
                f"\n[SISTEMA - CÁLCULO DE ENVÍO AUTOMÁTICO]:\n"
                f"Destino: {user_message}\n"
                f"Distancia: {result['distance_text']} ({result['distance_km']} km)\n"
                f"Tiempo estimado: {result['duration_text']}\n"
                f"Costo de envío: ${result['delivery_fee']:.0f} MXN\n"
                f"Incluye esta información en tu respuesta de forma natural.\n"
            )
        elif result.get("distance_km") and result["distance_km"] > float(config.DELIVERY_MAX_KM):
            delivery_context = (
                f"\n[SISTEMA - FUERA DE ZONA]:\n"
                f"La dirección '{user_message}' está a {result['distance_text']}, "
                f"fuera de la zona de entrega (máximo {config.DELIVERY_MAX_KM} km). "
                f"Informa al cliente amablemente que no llegamos ahí y sugiere recoger en tienda.\n"
            )

    # ─── Inyectar contexto de hora/estado en CADA mensaje ────
    is_open, status_msg = _is_open_now()
    time_context = ""
    if not is_open:
        time_context = (
            f"\n[SISTEMA - VERIFICACIÓN DE HORARIO]: "
            f"Son las {datetime.now().strftime('%I:%M %p')} del {_get_day_name()}. "
            f"El restaurante está CERRADO. {status_msg}. "
            f"NO confirmes servicio ni tomes pedidos. Informa que estamos cerrados."
        )

    # Agregar mensaje del usuario al historial (con contexto de delivery y hora)
    extra_context = delivery_context + time_context
    if extra_context:
        # Agregar contexto invisible para la IA
        enriched_message = user_message + extra_context
        history.append({"role": "user", "parts": [types.Part.from_text(text=enriched_message)]})
    else:
        history.append({"role": "user", "parts": [types.Part.from_text(text=user_message)]})

    # Limitar historial
    if len(history) > config.MAX_HISTORY_PER_CHAT:
        history = history[-config.MAX_HISTORY_PER_CHAT:]
        chat_histories[chat_id] = history

    try:
        # Reintentar hasta 3 veces si hay rate limit (429)
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=config.GEMINI_MODEL,
                    contents=history,
                    config=types.GenerateContentConfig(
                        system_instruction=_build_system_prompt(),
                        temperature=0.7,
                        max_output_tokens=1000,
                    ),
                )
                assistant_message = response.text.strip()

                # Guardar respuesta en historial
                history.append({"role": "model", "parts": [types.Part.from_text(text=assistant_message)]})
                chat_histories[chat_id] = history

                # Detectar si el pedido fue confirmado
                if _detect_order_confirmed(assistant_message):
                    _extract_order_summary(chat_id, assistant_message, sender_name)

                return assistant_message

            except Exception as retry_err:
                err_str = str(retry_err)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    wait_time = 30 * (attempt + 1)  # 30s, 60s, 90s
                    logger.warning(f"⏳ Rate limit alcanzado, reintentando en {wait_time}s (intento {attempt+1}/{max_retries})")
                    time.sleep(wait_time)
                else:
                    raise retry_err

        # Si agotamos reintentos
        logger.error("❌ Se agotaron los reintentos por rate limit")
        return _fallback_response(user_message)

    except Exception as e:
        logger.error(f"Error con Gemini: {e}")
        return _fallback_response(user_message)


def _fallback_response(message: str) -> str:
    """Respuesta sin IA basada en palabras clave."""
    msg = message.lower().strip()

    # Saludos
    greetings = ["hola", "buenas", "buen día", "buenas tardes", "buenas noches", "hey", "hi", "hello"]
    if any(g in msg for g in greetings):
        _, status = _is_open_now()
        return (
            f"¡Hola! 👋 Bienvenido a *{config.RESTAURANT_NAME}* 🍔\n\n"
            f"{status}\n\n"
            "¿En qué puedo ayudarte?\n"
            "• Escribe *menú* para ver nuestros platillos\n"
            "• Escribe *horarios* para ver nuestros horarios\n"
            "• Escribe *ubicación* para saber dónde estamos\n"
            "• O dime directamente qué se te antoja 😋"
        )

    # Menú
    if any(w in msg for w in ["menú", "menu", "carta", "que tienen", "qué tienen", "platillos"]):
        return get_menu_text()

    # Horarios
    if any(w in msg for w in ["horario", "hora", "abren", "cierran", "abierto", "cerrado"]):
        hours_lines = [f"⏰ *Horarios de {config.RESTAURANT_NAME}:*\n"]
        for day, hours in config.RESTAURANT_HOURS.items():
            hours_lines.append(f"  • {day.capitalize()}: {hours}")
        _, status = _is_open_now()
        hours_lines.append(f"\n📍 {status}")
        return "\n".join(hours_lines)

    # Ubicación
    if any(w in msg for w in ["ubicación", "ubicacion", "dirección", "direccion", "donde", "dónde", "llegar"]):
        return (
            f"📍 *{config.RESTAURANT_NAME}*\n"
            f"Dirección: {config.RESTAURANT_ADDRESS}\n"
            f"📞 {config.RESTAURANT_PHONE}\n\n"
            "¡Te esperamos! 🍔"
        )

    # Combos / Promociones
    if any(w in msg for w in ["combo", "promo", "promoción", "promocion", "oferta"]):
        from menu import get_category_text
        return get_category_text("combos") or "Pregunta por nuestros combos 📦"

    # Búsqueda de platillo
    results = search_item(msg)
    if results:
        lines = ["Encontré esto para ti:\n"]
        for r in results[:5]:
            precio = f"${r['precio']}" if r["precio"] else "Consultar"
            lines.append(f"• *{r['nombre']}* — {precio}")
            lines.append(f"  {r['descripcion']}")
            lines.append(f"  📂 {r['categoria']}")
        lines.append("\n¿Te gustaría ordenar algo? 😋")
        return "\n".join(lines)

    # Default
    return (
        f"¡Gracias por escribirnos a *{config.RESTAURANT_NAME}*! 🍔\n\n"
        "No entendí tu mensaje, pero puedo ayudarte con:\n"
        "• *menú* — ver nuestros platillos y precios\n"
        "• *horarios* — cuándo estamos abiertos\n"
        "• *ubicación* — cómo llegar\n"
        "• *combos* — ver nuestras promociones\n\n"
        "O cuéntame qué se te antoja y con gusto te ayudo 😊"
    )


def clear_history(chat_id: str):
    """Limpia el historial de un chat."""
    chat_histories.pop(chat_id, None)
    active_orders.pop(chat_id, None)


def clear_all_histories():
    """Limpia todos los historiales."""
    chat_histories.clear()
    active_orders.clear()
