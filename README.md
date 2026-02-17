# 🍔 Sr y Sra Burger — Bot de WhatsApp con IA

Bot inteligente para atender clientes de **Sr y Sra Burger** por WhatsApp.
Responde preguntas del menú, toma pedidos, informa horarios y más.

---

## 📁 Estructura del proyecto

```
whatsapp-bot/
├── app.py              ← Backend Flask (recibe y responde mensajes)
├── ai_service.py       ← Servicio de IA con OpenAI
├── menu.py             ← Menú completo del restaurante (editable)
├── config.py           ← Configuración general
├── bridge.js           ← Bridge Node.js ↔ WhatsApp Web
├── package.json        ← Dependencias Node.js
├── requirements.txt    ← Dependencias Python
├── .env.example        ← Ejemplo de variables de entorno
└── .env                ← Tu configuración (crear a partir de .env.example)
```

---

## 🚀 Instalación paso a paso

### 1. Requisitos previos

- **Python 3.10+** → [Descargar](https://www.python.org/downloads/)
- **Node.js 18+** → [Descargar](https://nodejs.org/)
- **API Key de OpenAI** → [Obtener](https://platform.openai.com/api-keys)

### 2. Configurar variables de entorno

```bash
# Copiar el ejemplo
copy .env.example .env

# Editar .env y poner tu API Key de OpenAI
# OPENAI_API_KEY=sk-tu-api-key-real-aqui
```

### 3. Instalar dependencias de Python

```bash
pip install -r requirements.txt
```

### 4. Instalar dependencias de Node.js

```bash
npm install
```

---

## ▶️ Cómo ejecutar

Necesitas **2 terminales** abiertas al mismo tiempo:

### Terminal 1: Bridge de WhatsApp

```bash
node bridge.js
```

- Aparecerá un **código QR** en la terminal
- Abre **WhatsApp** en tu teléfono
- Ve a **Dispositivos vinculados** → **Vincular un dispositivo**
- Escanea el QR
- Cuando veas "✅ WhatsApp conectado", está listo

### Terminal 2: Backend Flask

```bash
python app.py
```

- Se abrirá el servidor en `http://127.0.0.1:5000`
- Abre esa URL en el navegador para ver el **dashboard**

---

## 💬 Qué puede hacer el bot

| Función | Ejemplo de mensaje |
|---|---|
| Saludar | "Hola", "Buenas tardes" |
| Ver menú completo | "Menú", "¿Qué tienen?" |
| Preguntar precios | "¿Cuánto cuesta la BBQ Bacon?" |
| Tomar pedidos | "Quiero 2 hamburguesas Premium" |
| Ver combos | "¿Tienen promociones?" |
| Horarios | "¿A qué hora abren?" |
| Ubicación | "¿Dónde están?" |
| Pedir a domicilio | "¿Hacen entregas?" |

---

## 📝 Personalizar el menú

Edita el archivo `menu.py` para agregar, quitar o cambiar platillos y precios.
Los cambios se reflejan inmediatamente sin reiniciar el bot.

---

## 🔧 API Endpoints

| Ruta | Método | Descripción |
|---|---|---|
| `/` | GET | Dashboard web |
| `/health` | GET | Estado del servidor |
| `/webhook/message` | POST | Recibir mensajes (Bridge → Flask) |
| `/api/send` | POST | Enviar mensaje manual |
| `/api/menu` | GET | Ver menú en JSON |
| `/api/stats` | GET | Estadísticas del bot |
| `/api/clear-history` | POST | Limpiar historial de chat |

---

## ⚠️ Notas importantes

- El bot solo responde a **mensajes directos**, no a grupos.
- Si el bot no tiene API Key de OpenAI, funciona con **respuestas automáticas básicas** (sin IA).
- La sesión de WhatsApp se guarda en la carpeta `.wwebjs_auth/` — no la borres o tendrás que escanear el QR otra vez.
- El modelo recomendado es `gpt-4o-mini` (barato y rápido). Puedes usar `gpt-4o` para respuestas más inteligentes.

---

## 📞 Información del restaurante

- **Nombre:** Sr y Sra Burger
- **Dirección:** Coahuila #36, Colonia Emiliano Zapata
- **Teléfono:** 922-159-36-88
- **Horarios:**
  - Lunes: Descansamos
  - Martes a Viernes: 6:00 PM - 10:00 PM
  - Sábado y Domingo: 4:00 PM - 10:00 PM
