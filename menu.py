"""
Menú completo de Sr y Sra Burger 🍔
Edita este archivo para actualizar platillos, precios y disponibilidad.
"""

MENU = {
    "hamburguesas": {
        "titulo": "🍔 HAMBURGUESAS",
        "nota": "Extra: Agrega papas a tu hamburguesa por solo $25",
        "items": [
            {"nombre": "Sencilla", "precio": 90, "descripcion": "Hamburguesa clásica sencilla"},
            {"nombre": "Premium", "precio": 105, "descripcion": "Hamburguesa premium con ingredientes selectos"},
            {"nombre": "BBQ Bacon", "precio": 115, "descripcion": "Con tocino crujiente y salsa BBQ"},
            {"nombre": "Alohawai", "precio": 120, "descripcion": "Con piña y toque hawaiano"},
            {"nombre": "Cheesstorra", "precio": 125, "descripcion": "Con chistorra y queso derretido"},
            {"nombre": "Salchiburger", "precio": 125, "descripcion": "Con salchicha especial"},
            {"nombre": "Choriargentina", "precio": 125, "descripcion": "Con chorizo argentino"},
            {"nombre": "Guacamole Burger", "precio": 140, "descripcion": "Con guacamole fresco"},
            {"nombre": "Boneles Burger", "precio": 150, "descripcion": "Con boneless crujientes"},
        ],
    },
    "hotdogs": {
        "titulo": "🌭 HOTDOGS",
        "nota": "Extra: Agrega papas a tu hotdog por solo $25 (gajo o francesas)",
        "items": [
            {"nombre": "Hot Dog Jumbo", "precio": 65, "descripcion": "Hot dog tamaño jumbo"},
        ],
    },
    "boneless": {
        "titulo": "🍗 BONELESS",
        "nota": "Incluyen papas gajo o francesas. Salsas: BBQ Dulce, BBQ Picante, Parmesano Ranch",
        "items": [
            {"nombre": "Boneless 250g", "precio": 130, "descripcion": "250 gramos de boneless con papas"},
            {"nombre": "Boneless 500g", "precio": 250, "descripcion": "500 gramos de boneless con papas"},
            {"nombre": "Boneless 1kg", "precio": 480, "descripcion": "1 kilogramo de boneless con papas"},
        ],
    },
    "complementos": {
        "titulo": "🍟 COMPLEMENTOS",
        "nota": "Disponibles en tamaño M y XL",
        "items": [
            {"nombre": "Papas Francesas M", "precio": 65, "descripcion": "Papas francesas tamaño mediano"},
            {"nombre": "Papas Francesas XL", "precio": 130, "descripcion": "Papas francesas tamaño extra grande"},
            {"nombre": "Papas Gajo M", "precio": 65, "descripcion": "Papas gajo tamaño mediano"},
            {"nombre": "Papas Gajo XL", "precio": 130, "descripcion": "Papas gajo tamaño extra grande"},
            {"nombre": "Salchipapas M", "precio": 90, "descripcion": "Papas con salchicha tamaño mediano"},
            {"nombre": "Salchipapas XL", "precio": 150, "descripcion": "Papas con salchicha tamaño extra grande"},
            {"nombre": "Parmesanas M", "precio": 100, "descripcion": "Papas parmesanas tamaño mediano"},
            {"nombre": "Parmesanas XL", "precio": 140, "descripcion": "Papas parmesanas tamaño extra grande"},
            {"nombre": "Aros de Cebolla M", "precio": 50, "descripcion": "Aros de cebolla tamaño mediano"},
            {"nombre": "Aros de Cebolla XL", "precio": 95, "descripcion": "Aros de cebolla tamaño extra grande"},
        ],
    },
    "postres": {
        "titulo": "🍰 POSTRES",
        "nota": "",
        "items": [
            {"nombre": "Cheesecake Fresa", "precio": 80, "descripcion": "Cheesecake de fresa"},
            {"nombre": "Cheesecake Avellana/Queso Bola", "precio": 85, "descripcion": "Cheesecake de avellana o queso bola"},
            {"nombre": "Cheesecake Kinder Delice", "precio": 90, "descripcion": "Cheesecake Kinder Delice"},
            {"nombre": "Cheesecake Lotus", "precio": 90, "descripcion": "Cheesecake Lotus"},
        ],
    },
    "bebidas": {
        "titulo": "🥤 BEBIDAS",
        "nota": "",
        "items": [
            {"nombre": "Coca-Cola 600ml", "precio": 25, "descripcion": "Coca-Cola personal"},
            {"nombre": "Coca-Cola 1.75L", "precio": 50, "descripcion": "Coca-Cola familiar mediana"},
            {"nombre": "Coca-Cola 3L", "precio": 65, "descripcion": "Coca-Cola familiar grande"},
        ],
    },
    "combos": {
        "titulo": "📦 COMBOS",
        "nota": "En todos los combos se puede cambiar el tipo de hamburguesa o tamaño de complemento pagando la diferencia",
        "items": [
            {
                "nombre": "Combo Amigos",
                "precio": 380,
                "descripcion": "3 Hamburguesas Premium + Aros de cebolla M + Papas a elección M",
            },
            {
                "nombre": "Combo Triple Dog",
                "precio": 215,
                "descripcion": "3 Hotdogs Jumbo + Papas a elección M",
            },
            {
                "nombre": "Combo Familiar",
                "precio": 680,
                "descripcion": "5 Hamburguesas Premium + Papas XL + Aros de cebolla XL + Coca-Cola 3L",
            },
            {
                "nombre": "Combo Boneles",
                "precio": 215,
                "descripcion": "1 Hamburguesa Premium + 250g de Boneless + Papas M",
            },
            {
                "nombre": "Combo Duo",
                "precio": 190,
                "descripcion": "1 Hamburguesa Premium + 1 Hotdog Jumbo + Papas M",
            },
        ],
    },
}


def get_menu_text() -> str:
    """Genera el menú completo en formato texto legible."""
    lines = [f"✨ *MENÚ Sr y Sra Burger* ✨\n"]
    for categoria in MENU.values():
        lines.append(f"\n{categoria['titulo']}")
        lines.append("─" * 28)
        for item in categoria["items"]:
            precio = f"${item['precio']}" if item["precio"] else "Consultar"
            lines.append(f"  • {item['nombre']} — {precio}")
        if categoria["nota"]:
            lines.append(f"  📌 {categoria['nota']}")
    lines.append("\n💬 ¿Qué se te antoja hoy?")
    return "\n".join(lines)


def get_category_text(category_key: str) -> str | None:
    """Genera texto de una categoría específica."""
    cat = MENU.get(category_key)
    if not cat:
        return None
    lines = [cat["titulo"], "─" * 28]
    for item in cat["items"]:
        precio = f"${item['precio']}" if item["precio"] else "Consultar"
        lines.append(f"  • {item['nombre']} — {precio}")
        if item["descripcion"]:
            lines.append(f"    {item['descripcion']}")
    if cat["nota"]:
        lines.append(f"\n📌 {cat['nota']}")
    return "\n".join(lines)


def search_item(query: str) -> list[dict]:
    """Busca un platillo por nombre (búsqueda parcial)."""
    query_lower = query.lower()
    results = []
    for cat_key, cat in MENU.items():
        for item in cat["items"]:
            if query_lower in item["nombre"].lower() or query_lower in item["descripcion"].lower():
                results.append({**item, "categoria": cat["titulo"]})
    return results


def get_menu_for_prompt() -> str:
    """Genera una representación compacta del menú para incluir en el prompt de la IA."""
    lines = []
    for cat in MENU.values():
        lines.append(f"\n{cat['titulo']}:")
        for item in cat["items"]:
            precio = f"${item['precio']}" if item["precio"] else "Precio por confirmar"
            lines.append(f"- {item['nombre']}: {precio} ({item['descripcion']})")
        if cat["nota"]:
            lines.append(f"  Nota: {cat['nota']}")
    return "\n".join(lines)
