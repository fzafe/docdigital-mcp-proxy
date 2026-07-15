# Prototipo: Núcleo Central de IA JUNJI (arquitectura "cerebro-pulpo")

Este directorio es un **prototipo de referencia**, no un servicio productivo. Muestra cómo
generalizar el patrón de `index.js` (proxy MCP de DocDigital) a un **gateway central** que
agrega agentes departamentales como módulos, en vez de tener una integración separada por
cada sistema y por cada modelo (ChatGPT / Claude).

Ver el documento completo de estrategia en [`docs/estrategia-ia-junji-2026.md`](../../docs/estrategia-ia-junji-2026.md).

## Idea central

```
gateway.js                  <- el "cerebro": un único servidor MCP sobre HTTP
  agentes/planificacion.js  <- "tentáculo" 1: herramientas del Depto. de Planificación
  agentes/personas.js       <- "tentáculo" 2: herramientas de Gestión y Desarrollo de Personas
  agentes/...                  (cada departamento agrega su propio módulo)
```

Cada agente departamental es simplemente un módulo que registra sus propias herramientas
(`server.tool(...)`) sobre la misma instancia de `McpServer`. El gateway central se encarga de:

- **Autenticación** (una sola API key / esquema de auth para todos los agentes).
- **Autorización por agente**: qué rol/cliente puede invocar qué herramientas.
- **Auditoría**: quién (qué modelo, detrás de qué usuario) llamó a qué herramienta y cuándo.
- **Punto único de entrada** tanto para un Custom GPT de ChatGPT (vía Actions + OpenAPI) como
  para Claude (vía conector MCP nativo o Claude Agent SDK).

## Cómo se conecta cada "cerebro"

- **ChatGPT**: se genera un `openapi.json` (igual al que ya existe en la raíz del repo para
  DocDigital) a partir de las mismas herramientas, y se configura como Action de un Custom GPT.
- **Claude**: se agrega este gateway como conector MCP remoto (misma URL `/mcp`, mismo esquema
  de autenticación por Bearer token que ya usa `index.js`).

Ambos modelos terminan llamando exactamente a las mismas herramientas, con las mismas reglas
de acceso — el objetivo del diseño es que la gobernanza no dependa de qué modelo se use.

## Ejecutar el prototipo

```bash
cd examples/hub-agentes
npm install express @modelcontextprotocol/sdk zod
PROXY_API_KEY=dev-key node gateway.js
```

## Extender con un nuevo departamento

1. Crear `agentes/<departamento>.js` exportando una función `registerTools(server, ctx)`.
2. Importarlo y sumarlo al arreglo `AGENTES` en `gateway.js`.
3. Definir en el propio módulo qué sistema fuente consulta (DocDigital, ERP, intranet, etc.) y
   qué controles de acceso aplican (ver `docs/estrategia-ia-junji-2026.md`, sección 6).
