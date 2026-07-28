import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.FIXIE_URL) {
  setGlobalDispatcher(new ProxyAgent(process.env.FIXIE_URL));
}

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.DOCDIGITAL_BASE_URL || "https://api-demodoc.digital.gob.cl/api";
const CLIENT_ID = process.env.DOCDIGITAL_CLIENT_ID;
const CLIENT_SECRET = process.env.DOCDIGITAL_CLIENT_SECRET;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Faltan DOCDIGITAL_CLIENT_ID / DOCDIGITAL_CLIENT_SECRET en el entorno.");
  process.exit(1);
}
if (!PROXY_API_KEY) {
  console.error("Falta PROXY_API_KEY en el entorno (token que usara el agente de ChatGPT para autenticarse contra este servidor MCP).");
  process.exit(1);
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30_000) {
    return cachedToken;
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`No se pudo obtener el token DocDigital (HTTP ${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ? data.expires_in * 1000 : 5 * 60 * 1000);
  return cachedToken;
}

async function apiRequest(method, path, { query, body } = {}) {
  const token = await getToken();
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`DocDigital API error HTTP ${res.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

function toolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Fechas de DocDigital vienen como "DD-MM-YYYY HH:MM:SS"
function parseFechaDocDigital(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  const [d, m, y] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = (timePart || "").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

function buildServer() {
  const server = new McpServer({ name: "docdigital", version: "1.0.0" });

  server.tool(
    "docdigital_listar_recibidos",
    "Lista las comunicaciones oficiales recibidas por la entidad autenticada en DocDigital. IMPORTANTE: DocDigital exige el parametro notificado en produccion — llamar este endpoint sin filtro devuelve el historico completo y la peticion cae por timeout (HTTP 504), confirmado por soporte de DocDigital.",
    {
      notificado: z
        .boolean()
        .optional()
        .describe(
          "false = documentos pendientes de acuse de recibo (por defecto). true = documentos que ya tienen acuse de recibo. Siempre se envia uno de los dos para evitar timeout."
        ),
    },
    async ({ notificado }) =>
      toolResult(await apiRequest("GET", "/documentos/recibidos", { query: { notificado: notificado ?? false } }))
  );

  server.tool(
    "docdigital_pendientes_mas_antiguos",
    "Obtiene las comunicaciones recibidas que aun estan con estado 'Pendiente acuse' para la entidad autenticada, ordenadas de la mas antigua a la mas reciente segun la fecha de creacion del documento principal. Usar esta herramienta (en vez de docdigital_listar_recibidos) para procesar la cola de pendientes en orden.",
    {
      limite: z.number().int().min(1).max(50).optional().describe("Cantidad maxima de comunicaciones a retornar (por defecto 5)"),
    },
    async ({ limite }) => {
      const data = await apiRequest("GET", "/documentos/recibidos", { query: { notificado: false } });
      const items = Array.isArray(data?.result) ? data.result : [];
      const pendientes = items.filter((item) =>
        item?.destinatarios?.con_copia?.entidades?.some((e) => e.estado === "Pendiente acuse")
      );
      pendientes.sort(
        (a, b) =>
          parseFechaDocDigital(a?.documento_principal?.fechaCreacion) -
          parseFechaDocDigital(b?.documento_principal?.fechaCreacion)
      );
      return toolResult(pendientes.slice(0, limite || 5));
    }
  );

  server.tool(
    "docdigital_detalle_comunicacion",
    "Obtiene el detalle de una comunicacion de DocDigital por su identificador: destinatarios, firmantes, visadores, documento principal y anexos.",
    { id: z.union([z.string(), z.number()]).describe("Identificador de la comunicacion") },
    async ({ id }) => toolResult(await apiRequest("GET", `/documentos/${id}`))
  );

  server.tool(
    "docdigital_descargar_archivo",
    "Descarga un archivo (documento principal o anexo) de una comunicacion de DocDigital y lo entrega como adjunto PDF legible, no como texto.",
    {
      id: z.union([z.string(), z.number()]).describe("Identificador de la comunicacion"),
      archivo_id: z.string().optional().describe("Identificador unico (UUID) del archivo dentro de la comunicacion"),
      nombre_archivo: z.string().optional().describe("Nombre de archivo a mostrar (opcional, solo referencial)"),
    },
    async ({ id, archivo_id, nombre_archivo }) => {
      const data = await apiRequest("GET", `/documentos/${id}/archivo`, { query: { archivo_id } });
      const base64 = typeof data === "string" ? data : data?.result;
      if (!base64) {
        throw new Error("La respuesta de DocDigital no incluyo contenido de archivo (campo result vacio).");
      }
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: `docdigital://documentos/${id}/archivo/${archivo_id || "principal"}`,
              mimeType: "application/pdf",
              blob: base64,
              name: nombre_archivo || undefined,
            },
          },
        ],
      };
    }
  );

  server.tool(
    "docdigital_acuse_recibo",
    "Da acuse de recibido (aceptacion) a una comunicacion pendiente recibida en DocDigital.",
    {
      id: z.union([z.string(), z.number()]).describe("Identificador del documento a recepcionar"),
      entidadDestinataria: z.union([z.string(), z.number()]).optional().describe("Identificador de entidad destinataria (opcional)"),
    },
    async ({ id, entidadDestinataria }) =>
      toolResult(await apiRequest("PUT", `/documentos/recibidos/${id}/acusorecibo`, { query: { entidadDestinataria } }))
  );

  server.tool(
    "docdigital_rechazar_comunicacion",
    "Rechaza (devuelve) una comunicacion pendiente recibida en DocDigital, indicando el motivo del rechazo.",
    {
      id: z.union([z.string(), z.number()]).describe("Identificador del documento a recepcionar"),
      motivo: z.string().min(3).max(255).describe("Motivo de rechazo del documento (entre 3 y 255 caracteres)"),
      entidadDestinataria: z.union([z.string(), z.number()]).optional().describe("Identificador de entidad destinataria (opcional)"),
    },
    async ({ id, motivo, entidadDestinataria }) =>
      toolResult(
        await apiRequest("PUT", `/documentos/recibidos/${id}/devolver`, {
          query: { entidadDestinataria },
          body: motivo,
        })
      )
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

function checkAuth(req, res) {
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.get("X-API-Key");
  if (token !== PROXY_API_KEY) {
    res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "API key invalida o ausente" } });
    return false;
  }
  return true;
}

// Servidor MCP stateless sobre HTTP: cada request crea su propia instancia (sin sesiones persistentes)
app.post("/mcp", async (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: err.message } });
    }
  }
});

app.get("/mcp", (req, res) => {
  res.status(405).json({ error: "Metodo no soportado: este servidor MCP es stateless, usa POST /mcp" });
});

app.listen(PORT, () => {
  console.log(`docdigital MCP HTTP server escuchando en puerto ${PORT}`);
});
