import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

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

function buildServer() {
  const server = new McpServer({ name: "docdigital", version: "1.0.0" });

  server.tool(
    "docdigital_listar_recibidos",
    "Lista las comunicaciones oficiales recibidas por la entidad autenticada en DocDigital.",
    {},
    async () => toolResult(await apiRequest("GET", "/documentos/recibidos"))
  );

  server.tool(
    "docdigital_detalle_comunicacion",
    "Obtiene el detalle de una comunicacion de DocDigital por su identificador: destinatarios, firmantes, visadores, documento principal y anexos.",
    { id: z.union([z.string(), z.number()]).describe("Identificador de la comunicacion") },
    async ({ id }) => toolResult(await apiRequest("GET", `/documentos/${id}`))
  );

  server.tool(
    "docdigital_descargar_archivo",
    "Descarga el contenido en base64 de un archivo asociado a una comunicacion de DocDigital.",
    {
      id: z.union([z.string(), z.number()]).describe("Identificador de la comunicacion"),
      archivo_id: z.string().optional().describe("Identificador unico (UUID) del archivo dentro de la comunicacion"),
    },
    async ({ id, archivo_id }) =>
      toolResult(await apiRequest("GET", `/documentos/${id}/archivo`, { query: { archivo_id } }))
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
