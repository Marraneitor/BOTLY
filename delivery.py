"""
Servicio de delivery para Sr y Sra Burger 🛵
Calcula distancias y costos de envío usando Google Maps Distance Matrix API.
"""

import logging
import googlemaps

import config

logger = logging.getLogger(__name__)

# ─── Cliente de Google Maps ────────────────────────────────
gmaps_client = None

# Origen fijo: dirección del restaurante
RESTAURANT_ORIGIN = f"{config.RESTAURANT_ADDRESS}, Minatitlán, Veracruz, México"

# Tarifa de envío
PRICE_PER_KM = float(config.DELIVERY_PRICE_PER_KM)  # $8 MXN por km
MIN_DELIVERY_FEE = float(config.DELIVERY_MIN_FEE)     # Mínimo $15 MXN
MAX_DELIVERY_DISTANCE = float(config.DELIVERY_MAX_KM)  # Máximo 15 km


def init_maps():
    """Inicializa el cliente de Google Maps."""
    global gmaps_client
    api_key = config.MAPS_API_KEY
    if api_key:
        gmaps_client = googlemaps.Client(key=api_key)
        logger.info("✅ Google Maps inicializado para cálculo de envíos")
    else:
        logger.warning("⚠️ No se configuró MAPS_API_KEY — el cálculo de envío no estará disponible")


def calculate_delivery(destination: str) -> dict:
    """
    Calcula la distancia y costo de envío a una dirección/colonia.
    
    Args:
        destination: Dirección o colonia del cliente (ej: "Col. Insurgentes" o "Av. Juárez 123")
    
    Returns:
        dict con: distance_km, distance_text, duration_text, delivery_fee, success, error
    """
    if not gmaps_client:
        return {
            "success": False,
            "error": "Servicio de mapas no disponible",
            "delivery_fee": None,
        }

    # Agregar contexto geográfico si el cliente solo puso la colonia
    dest = destination.strip()
    dest_lower = dest.lower()
    
    # Si no tiene "minatitlán" o "veracruz", agregarlo
    if "minatitlán" not in dest_lower and "minatitlan" not in dest_lower and "veracruz" not in dest_lower:
        dest = f"{dest}, Minatitlán, Veracruz, México"

    try:
        result = gmaps_client.distance_matrix(
            origins=[RESTAURANT_ORIGIN],
            destinations=[dest],
            mode="driving",
            language="es",
            units="metric",
        )

        if result["status"] != "OK":
            return {
                "success": False,
                "error": f"Error de Google Maps: {result['status']}",
                "delivery_fee": None,
            }

        element = result["rows"][0]["elements"][0]

        if element["status"] != "OK":
            return {
                "success": False,
                "error": "No se encontró la dirección. ¿Podrías ser más específico?",
                "delivery_fee": None,
            }

        # Distancia en km
        distance_meters = element["distance"]["value"]
        distance_km = distance_meters / 1000.0
        distance_text = element["distance"]["text"]

        # Duración
        duration_text = element["duration"]["text"]

        # Verificar distancia máxima
        if distance_km > MAX_DELIVERY_DISTANCE:
            return {
                "success": False,
                "error": f"La dirección está a {distance_text}, fuera de nuestra zona de entrega (máximo {MAX_DELIVERY_DISTANCE:.0f} km).",
                "distance_km": round(distance_km, 1),
                "distance_text": distance_text,
                "delivery_fee": None,
            }

        # Calcular costo
        delivery_fee = max(distance_km * PRICE_PER_KM, MIN_DELIVERY_FEE)
        # Redondear al múltiplo de 5 más cercano
        delivery_fee = round(delivery_fee / 5) * 5
        # Mínimo no puede ser 0
        if delivery_fee < MIN_DELIVERY_FEE:
            delivery_fee = MIN_DELIVERY_FEE

        return {
            "success": True,
            "distance_km": round(distance_km, 1),
            "distance_text": distance_text,
            "duration_text": duration_text,
            "delivery_fee": delivery_fee,
            "error": None,
        }

    except googlemaps.exceptions.ApiError as e:
        logger.error(f"Error API de Google Maps: {e}")
        return {
            "success": False,
            "error": "Error al consultar Google Maps. Intenta de nuevo.",
            "delivery_fee": None,
        }
    except Exception as e:
        logger.error(f"Error calculando delivery: {e}")
        return {
            "success": False,
            "error": "Error calculando la distancia. Intenta de nuevo.",
            "delivery_fee": None,
        }


def get_delivery_info_for_prompt() -> str:
    """Genera texto de info de delivery para incluir en el prompt de la IA."""
    return f"""SERVICIO DE ENVÍO A DOMICILIO 🛵:
- Tarifa: ${PRICE_PER_KM:.0f} MXN por kilómetro
- Costo mínimo de envío: ${MIN_DELIVERY_FEE:.0f} MXN
- Zona de cobertura: hasta {MAX_DELIVERY_DISTANCE:.0f} km desde el restaurante
- Ubicación del restaurante: {RESTAURANT_ORIGIN}
- El costo se redondea al múltiplo de $5 más cercano

CÓMO FUNCIONA EL CÁLCULO:
- Cuando el cliente quiera envío a domicilio, PRIMERO pregunta la colonia o dirección
- El sistema calculará automáticamente la distancia y el costo
- Ejemplo: si la distancia es 3.2 km → 3.2 × ${PRICE_PER_KM:.0f} = ${3.2 * PRICE_PER_KM:.0f} → Se redondea a ${round(3.2 * PRICE_PER_KM / 5) * 5:.0f} MXN de envío
- Ejemplo: si la distancia es 1 km → 1 × ${PRICE_PER_KM:.0f} = ${PRICE_PER_KM:.0f} → Como es menor al mínimo, se cobra ${MIN_DELIVERY_FEE:.0f} MXN

IMPORTANTE SOBRE DELIVERY:
- Si el cliente da su colonia, usa esa info para calcular
- Muestra el costo de envío separado del pedido
- El TOTAL FINAL = Total del pedido + Costo de envío
- Si la distancia excede {MAX_DELIVERY_DISTANCE:.0f} km, indica que está fuera de la zona de entrega"""
