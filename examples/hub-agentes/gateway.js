import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import * as planificacion from "./agentes/planificacion.js";
import * as personas from "./agentes/personas.js";

const PORT = process.env.PORT || 3100;

// Cada "cliente" tiene su propia API key y su propia lista de agentes departamentales
// autorizados. Decision vigente (ver docs/estrategia-ia-junji-2026.md, 3.2): el unico
// cliente operativo en produccion es el Custom GPT de ChatGPT; Claude se usa del lado del
// equipo tecnico para programar y mantener este mismo gateway, no como consumidor en
// produccion. La entrada CLAUDE_API_KEY queda de ejemplo por si mas adelante se decide
// sumar Claude tambien como cerebro operativo, sin tener que rediseñar el gateway.
const CLIENTES = {
  [process.env.CHATGPT_API_KEY || "dev-chatgpt-key"]: {
    nombre: "chatgpt-custom-gpt",
    agentesPermitidos: ["planificacion"],
  },
  [process.env.CLAUDE_API_KEY || "dev-claude-key"]: {
    nombre: "claude-conector-mcp (ejemplo, no activo)",
    agentesPermitidos: ["planificacion", "personas"],
  },
};

// Registro de agentes departamentales ("tentaculos"). Agregar uno nuevo es sumar una entrada
// aca y crear el modulo correspondiente en agentes/<departamento>.js
const AGENTES = {
  planificacion,
  personas,
};

function auditoria({ cliente, agente, herramienta }) {
  // En produccion: enviar a un log centralizado (no a stdout) con timestamp, cliente,
  // agente, herramienta invocada y resultado (exito/error), para trazabilidad total.
  console.log(
    `[auditoria] ${new Date().toISOString()} cliente=${cliente} agente=${agente} herramienta=${herramienta}`
  );
}

function buildServerParaCliente(cliente) {
  const server = new McpServer({ name: "junji-nucleo-ia", version: "0.1.0" });

  for (const nombreAgente of cliente.agentesPermitidos) {
    const agente = AGENTES[nombreAgente];
    if (!agente) continue;
    agente.registerTools(server, {
      onCall: (herramienta) => auditoria({ cliente: cliente.nombre, agente: nombreAgente, herramienta }),
    });
  }

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

function autenticar(req, res) {
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.get("X-API-Key");
  const cliente = CLIENTES[token];
  if (!cliente) {
    res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "API key invalida o ausente" } });
    return null;
  }
  return cliente;
}

// Servidor MCP stateless: cada request arma un servidor con solo las herramientas que el
// cliente que llama tiene permitidas (mismo patron stateless que index.js).
app.post("/mcp", async (req, res) => {
  const cliente = autenticar(req, res);
  if (!cliente) return;
  try {
    const server = buildServerParaCliente(cliente);
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

app.listen(PORT, () => {
  console.log(`Nucleo Central de IA JUNJI (prototipo) escuchando en puerto ${PORT}`);
});
