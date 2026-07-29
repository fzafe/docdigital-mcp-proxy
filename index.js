import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import MsgReaderPkg from "@kenjiuno/msgreader";
const MsgReader = MsgReaderPkg.default ?? MsgReaderPkg;

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

// El endpoint /documentos/buscar de DocDigital devuelve textos con tildes mal codificados
// (ej. "ValdÃ©s" en vez de "Valdés"): son bytes UTF-8 leidos como Latin-1 por su backend.
// Se revierte reinterpretando la cadena como Latin-1 y decodificandola de vuelta a UTF-8.
function fixMojibake(value) {
  if (typeof value === "string") {
    if (/Ã.|â€/.test(value)) {
      try {
        const fixed = Buffer.from(value, "latin1").toString("utf8");
        if (!fixed.includes("�")) return fixed;
      } catch {
        // deja el valor original si la conversion falla
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(fixMojibake);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixMojibake(v);
    return out;
  }
  return value;
}

// Fechas de DocDigital vienen como "DD-MM-YYYY HH:MM:SS"
function parseFechaDocDigital(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  const [d, m, y] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = (timePart || "").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, ss);
}

// ---------------------------------------------------------------------------
// Extraccion de archivos: texto, ZIP y .msg (soporte para docdigital_descargar_todos_archivos)
// ---------------------------------------------------------------------------

const MIME_POR_EXTENSION = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  msg: "application/vnd.ms-outlook",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

const TEXTO_MAX_CHARS = 50_000;
const EMBED_MAX_BYTES_POR_ARCHIVO = 15 * 1024 * 1024;
const EMBED_MAX_BYTES_TOTAL = 40 * 1024 * 1024;
const MAX_ITEMS_INVENTARIO = 40;
const SHAREPOINT_HOSTS = /sharepoint\.com$|1drv\.ms$|-my\.sharepoint\.com$/i;

function extensionDe(nombreArchivo) {
  if (!nombreArchivo) return "";
  const m = /\.([a-z0-9]+)$/i.exec(nombreArchivo.trim());
  return m ? m[1].toLowerCase() : "";
}

function mimeDe(ext) {
  return MIME_POR_EXTENSION[ext] || "application/octet-stream";
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function truncarTexto(texto) {
  if (!texto) return { texto: texto || "", truncado: false, longitud_total: texto ? texto.length : 0 };
  if (texto.length <= TEXTO_MAX_CHARS) return { texto, truncado: false, longitud_total: texto.length };
  return { texto: texto.slice(0, TEXTO_MAX_CHARS), truncado: true, longitud_total: texto.length };
}

// Intenta extraer texto de un buffer segun su extension. No lanza: siempre devuelve un resultado clasificado.
async function extraerTexto(buffer, ext) {
  try {
    if (ext === "pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const data = await parser.getText();
        const texto = (data.text || "").trim();
        const totalPaginas = data.total ?? data.pages?.length ?? null;
        const promedioPorPagina = totalPaginas ? texto.length / totalPaginas : texto.length;
        if (texto.length === 0 || promedioPorPagina < 15) {
          return { extraccion_texto: "requiere_ocr", ...truncarTexto(texto), paginas_totales: totalPaginas };
        }
        return { extraccion_texto: "ok", ...truncarTexto(texto), paginas_totales: totalPaginas };
      } finally {
        await parser.destroy();
      }
    }
    if (ext === "docx") {
      const { value } = await mammoth.extractRawText({ buffer });
      return { extraccion_texto: "ok", ...truncarTexto((value || "").trim()) };
    }
    if (ext === "doc") {
      return { extraccion_texto: "fallo", texto: "", truncado: false, longitud_total: 0, motivo: "Formato .doc legado no soportado; se requiere .docx." };
    }
    if (ext === "xlsx" || ext === "xls" || ext === "csv") {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const partes = wb.SheetNames.map((nombre) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[nombre]);
        return `--- Hoja: ${nombre} ---\n${csv}`;
      });
      return { extraccion_texto: "ok", ...truncarTexto(partes.join("\n\n")) };
    }
    if (ext === "txt") {
      return { extraccion_texto: "ok", ...truncarTexto(buffer.toString("utf8")) };
    }
    return { extraccion_texto: "no_aplica", texto: "", truncado: false, longitud_total: 0 };
  } catch (err) {
    return { extraccion_texto: "fallo", texto: "", truncado: false, longitud_total: 0, motivo: err.message };
  }
}

function esSharePoint(url) {
  try {
    return SHAREPOINT_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Descarga un enlace externo (ANEXO_URL) con timeout corto. No lanza: clasifica el resultado.
async function intentarDescargarExterno(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const contentType = res.headers.get("content-type") || "";
    if (res.status === 401 || res.status === 403) {
      return { ok: false, incidencia: "no_autorizado" };
    }
    if (!res.ok) {
      return { ok: false, incidencia: res.status === 404 ? "link_expirado" : "otro" };
    }
    if (contentType.includes("text/html")) {
      // Muy probablemente una pantalla de login o una pagina web, no un archivo descargable
      return { ok: false, incidencia: "requiere_login" };
    }
    const arrayBuffer = await res.arrayBuffer();
    return { ok: true, buffer: Buffer.from(arrayBuffer), contentType };
  } catch (err) {
    return { ok: false, incidencia: err.name === "AbortError" ? "otro" : "otro", detalle: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// Procesa un item de inventario: lo descarga (via DocDigital o enlace externo), extrae texto,
// y si corresponde expande su contenido (ZIP, .msg). Devuelve el item resuelto y, si aplica,
// items hijos generados por la expansion.
async function procesarItemInventario(item, { comunicacionId, extraerZip, extraerMsg, contadorEmbed }) {
  const resultado = {
    archivo_id: item.archivo_id,
    nombre_original: item.nombre_original,
    tipo: item.tipo,
    extension: item.extension,
    mime_type: item.mime_type,
    orden: item.orden ?? null,
    tamano: null,
    descargado: false,
    motivo_falla: null,
    url_origen: item.url_origen || null,
    hash: null,
    texto_extraido: null,
    texto_truncado: false,
    extraccion_texto: "no_aplica",
    archivo_padre: item.archivo_padre || null,
  };

  let buffer = null;

  if (item.esExterno) {
    const descarga = await intentarDescargarExterno(item.url_origen);
    if (!descarga.ok) {
      resultado.motivo_falla = descarga.incidencia;
      return { item: resultado, hijos: [] };
    }
    buffer = descarga.buffer;
  } else {
    try {
      const data = await apiRequest("GET", `/documentos/${comunicacionId}/archivo`, { query: { archivo_id: item.archivo_id } });
      const base64 = typeof data === "string" ? data : data?.result;
      if (!base64) throw new Error("Respuesta de DocDigital sin contenido (campo result vacio).");
      buffer = Buffer.from(base64, "base64");
    } catch (err) {
      resultado.motivo_falla = err.message;
      return { item: resultado, hijos: [] };
    }
  }

  resultado.descargado = true;
  resultado.tamano = buffer.length;
  resultado.hash = sha256(buffer);

  const hijos = [];

  if (item.extension === "zip" && extraerZip) {
    try {
      const zip = new AdmZip(buffer);
      const entradas = zip.getEntries().filter((e) => !e.isDirectory);
      for (const entrada of entradas) {
        if (hijos.length >= MAX_ITEMS_INVENTARIO) break;
        const extInterna = extensionDe(entrada.entryName);
        const bufferInterno = entrada.getData();
        const extraccion = await extraerTexto(bufferInterno, extInterna);
        hijos.push({
          archivo_id: `${item.archivo_id}::${entrada.entryName}`,
          nombre_original: entrada.entryName,
          tipo: "extraido_zip",
          extension: extInterna,
          mime_type: mimeDe(extInterna),
          orden: null,
          tamano: bufferInterno.length,
          descargado: true,
          motivo_falla: null,
          url_origen: null,
          hash: sha256(bufferInterno),
          texto_extraido: extraccion.texto || null,
          texto_truncado: extraccion.truncado,
          extraccion_texto: extraccion.extraccion_texto,
          archivo_padre: item.archivo_id,
          _buffer: bufferInterno,
        });
      }
    } catch (err) {
      resultado.motivo_falla = `ZIP no se pudo leer: ${err.message}`;
    }
  } else if (item.extension === "msg" && extraerMsg) {
    try {
      const reader = new MsgReader(buffer);
      const msgData = reader.getFileData();
      const encabezado = [
        `Asunto: ${msgData.subject || ""}`,
        `De: ${msgData.senderName || ""} ${msgData.senderEmail || ""}`.trim(),
        `Para: ${(msgData.recipients || []).map((r) => r.name || r.email).join(", ")}`,
        `Fecha: ${msgData.creationTime || msgData.clientSubmitTime || ""}`,
        "",
        msgData.body || "",
      ].join("\n");
      const extraccion = truncarTexto(encabezado.trim());
      resultado.texto_extraido = extraccion.texto;
      resultado.texto_truncado = extraccion.truncado;
      resultado.extraccion_texto = "ok";

      for (const att of msgData.attachments || []) {
        if (hijos.length >= MAX_ITEMS_INVENTARIO) break;
        try {
          const adjunto = reader.getAttachment(att);
          const bufferAdjunto = Buffer.from(adjunto.content);
          const extAdjunto = extensionDe(adjunto.fileName);
          const extraccionAdjunto = await extraerTexto(bufferAdjunto, extAdjunto);
          hijos.push({
            archivo_id: `${item.archivo_id}::${adjunto.fileName}`,
            nombre_original: adjunto.fileName,
            tipo: "adjunto_msg",
            extension: extAdjunto,
            mime_type: mimeDe(extAdjunto),
            orden: null,
            tamano: bufferAdjunto.length,
            descargado: true,
            motivo_falla: null,
            url_origen: null,
            hash: sha256(bufferAdjunto),
            texto_extraido: extraccionAdjunto.texto || null,
            texto_truncado: extraccionAdjunto.truncado,
            extraccion_texto: extraccionAdjunto.extraccion_texto,
            archivo_padre: item.archivo_id,
            _buffer: bufferAdjunto,
          });
        } catch (err) {
          hijos.push({
            archivo_id: `${item.archivo_id}::adjunto_no_leido`,
            nombre_original: att.fileName || "adjunto_msg_desconocido",
            tipo: "adjunto_msg",
            extension: extensionDe(att.fileName),
            mime_type: mimeDe(extensionDe(att.fileName)),
            orden: null,
            tamano: null,
            descargado: false,
            motivo_falla: err.message,
            url_origen: null,
            hash: null,
            texto_extraido: null,
            texto_truncado: false,
            extraccion_texto: "fallo",
            archivo_padre: item.archivo_id,
          });
        }
      }
    } catch (err) {
      resultado.motivo_falla = `.msg no se pudo leer: ${err.message}`;
    }
  } else {
    const extraccion = await extraerTexto(buffer, item.extension);
    resultado.texto_extraido = extraccion.texto || null;
    resultado.texto_truncado = extraccion.truncado;
    resultado.extraccion_texto = extraccion.extraccion_texto;
    if (extraccion.motivo) resultado.motivo_falla = extraccion.motivo;
  }

  resultado._buffer = buffer;
  return { item: resultado, hijos };
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
    "docdigital_buscar_documentos",
    "Busca documentos de DocDigital usando el endpoint /documentos/buscar con filtros flexibles. Por defecto se acota a la entidad del token (JUNJI). Usar siempre con estadoTramitacion o algun otro filtro: sin filtros retorna el historico completo y la peticion cae por timeout.",
    {
      estadoTramitacion: z
        .enum([
          "BORRADOR",
          "PENDIENTE_VISACION",
          "PENDIENTE_FIRMA",
          "OPS_PENDIENTE_DESPACHO",
          "OPS_RESUELTO_ENVIADO",
          "OPS_RECHAZADO",
          "RECHAZADO_VISACION",
          "RECHAZADO_FIRMA",
          "OPE_RECIBIDO_PARCIALMENTE",
          "OPE_DEVUELTO_PARCIALMENTE",
          "OPE_RECIBIDO_PARCIALMENTE_CON_DEVOLUCION",
          "OPE_RECEPCION_TOTAL",
          "OPE_DEVOLUCION_TOTAL",
          "OPE_RECEPCION_TOTAL_CON_DEVOLUCION",
          "DOCUMENTO_FIRMADO",
          "CANCELADO_ADMINISTRADOR",
        ])
        .optional()
        .describe("Estado de la tramitacion del documento"),
      tipoTramitacion: z.enum(["COMUNICACION_OFICIAL", "COMUNICACION_INTERNA", "GENERACION_DOCUMENTO_FEA"]).optional(),
      pageSize: z.number().int().min(1).max(200).optional().describe("Tamano de pagina (por defecto 100, para evitar timeout)"),
      pageNumber: z.number().int().min(0).optional().describe("Numero de pagina, base 0 (por defecto 0)"),
      orderType: z.enum(["ASC", "DESC"]).optional(),
    },
    async ({ estadoTramitacion, tipoTramitacion, pageSize, pageNumber, orderType }) => {
      const data = await apiRequest("GET", "/documentos/buscar", {
        query: {
          estadoTramitacion,
          tipoTramitacion,
          pageSize: pageSize ?? 100,
          pageNumber: pageNumber ?? 0,
          orderType: orderType ?? "ASC",
        },
      });
      return toolResult(fixMojibake(data));
    }
  );

  server.tool(
    "docdigital_mis_pendientes_visar",
    "Obtiene los documentos con estado 'Pendiente de visacion' en DocDigital donde Felipe Ignacio Zafe Contreras (Jefe de Gabinete, Junta Nacional de Jardines Infantiles) figura como visador. Recorre las paginas del endpoint de busqueda de DocDigital y filtra por nombre de visador, porque el filtro nativo de la API por visador (runVisador/nombreVisador) esta deprecado y no es confiable. LIMITACION CONOCIDA: no se puede distinguir de forma confiable si el documento esta pendiente especificamente en la etapa de Felipe o en otra etapa de la cadena de visacion; puede incluir documentos donde Felipe ya visto o donde el turno actual es de otra persona.",
    {
      limite: z.number().int().min(1).max(200).optional().describe("Cantidad maxima de documentos a retornar, ordenados del mas antiguo al mas reciente (por defecto 200, para traer el total completo)"),
    },
    async ({ limite }) => {
      const NOMBRE_VISADOR = "felipe ignacio zafe contreras";
      const PAGE_SIZE = 200;
      const MAX_PAGINAS = 20;
      let pageNumber = 0;
      let totalPages = 1;
      const encontrados = [];
      do {
        const data = await apiRequest("GET", "/documentos/buscar", {
          query: { estadoTramitacion: "PENDIENTE_VISACION", pageSize: PAGE_SIZE, pageNumber, orderType: "ASC" },
        });
        const items = Array.isArray(data?.result) ? data.result : [];
        totalPages = data?.total_pages || 1;
        for (const item of items) {
          const etapas = item?.info_visaciones?.visadores;
          const esVisador =
            Array.isArray(etapas) &&
            etapas.some(
              (etapa) =>
                Array.isArray(etapa) &&
                etapa.some((v) => (v?.usuario_nombre || "").trim().toLowerCase() === NOMBRE_VISADOR)
            );
          if (esVisador) encontrados.push(item);
        }
        pageNumber++;
      } while (pageNumber < totalPages && pageNumber < MAX_PAGINAS);

      encontrados.sort(
        (a, b) =>
          parseFechaDocDigital(a?.documento_principal?.fechaCreacion) -
          parseFechaDocDigital(b?.documento_principal?.fechaCreacion)
      );
      return toolResult(fixMojibake(encontrados.slice(0, limite || 200)));
    }
  );

  server.tool(
    "docdigital_detalle_comunicacion",
    "Obtiene el detalle de una comunicacion de DocDigital por su identificador: destinatarios, firmantes, visadores, documento principal y anexos. Incluye ademas un resumen con campos explicitos (tema_literal_docdigital, tipo_acto, etapa_actual, archivos_disponibles, etc.) pensados para que el agente no tenga que inferirlos del JSON crudo.",
    { id: z.union([z.string(), z.number()]).describe("Identificador de la comunicacion") },
    async ({ id }) => {
      const raw = await apiRequest("GET", `/documentos/${id}`);
      const principal = raw?.documento_principal;
      const anexos = Array.isArray(raw?.documentos_anexos) ? raw.documentos_anexos : [];
      const archivos_disponibles = [
        ...(principal
          ? [
              {
                archivo_id: principal.id,
                nombre_archivo: principal.nombre_archivo,
                tipo: "principal",
                orden: 0,
              },
            ]
          : []),
        ...anexos.map((a, i) => ({
          archivo_id: a.anexo_id || a.id,
          nombre_archivo: a.nombre_archivo,
          tipo: a.tipo === "ANEXO_URL" ? "anexo_url" : "anexo",
          orden: a.correlativo ?? i + 1,
        })),
      ];
      const estado = raw?.estado_tramitacion || null;
      const resumen = {
        tema_literal_docdigital: principal?.materia || null,
        id_documento: principal?.documento_id ?? id,
        id_comunicacion: id,
        fecha_creacion: principal?.fechaCreacion || null,
        estado,
        tipo_acto: principal?.tipo || null,
        remitente: raw?.info_creador || null,
        destinatarios: raw?.destinatarios || null,
        firmantes: raw?.info_firmas?.firmantes || null,
        visadores: raw?.info_visaciones?.visadores || null,
        etapa_actual:
          estado === "PENDIENTE_VISACION"
            ? "Pendiente de visacion (DocDigital no expone de forma confiable en que etapa especifica de la cadena de visadores se encuentra)"
            : estado,
        archivos_disponibles,
      };
      return toolResult({ ...raw, resumen });
    }
  );

  server.tool(
    "docdigital_descargar_todos_archivos",
    "Descarga el documento principal y todos los anexos de una comunicacion de DocDigital de una sola vez, con inventario completo y trazabilidad. A diferencia de docdigital_descargar_archivo (que baja un solo archivo), esta herramienta: extrae texto de PDF/Word/Excel/TXT; expande y procesa el contenido de anexos ZIP; extrae asunto/remitente/destinatarios/cuerpo/adjuntos de anexos .msg; detecta enlaces a SharePoint u otros sitios externos y reporta si no se pudieron resolver; y entrega un resumen de completitud (cuantos archivos se esperaban vs. cuantos se lograron descargar/leer). Es de solo lectura: no visa, no rechaza ni acusa recibo. Usar esta herramienta cuando se necesite revisar un expediente completo con certeza de que no quedaron anexos sin revisar.",
    {
      id: z.union([z.string(), z.number()]).describe("Identificador de la comunicacion"),
      incluir_principal: z.boolean().optional().describe("Incluir el documento principal (por defecto true)"),
      incluir_anexos: z.boolean().optional().describe("Incluir todos los anexos (por defecto true)"),
      extraer_zip: z.boolean().optional().describe("Extraer y procesar el contenido de anexos ZIP (por defecto true)"),
      extraer_msg: z.boolean().optional().describe("Extraer asunto/remitente/cuerpo/adjuntos de anexos .msg (por defecto true)"),
    },
    async ({ id, incluir_principal, incluir_anexos, extraer_zip, extraer_msg }) => {
      const detalle = await apiRequest("GET", `/documentos/${id}`);
      const principal = detalle?.documento_principal;
      const anexosRaw = Array.isArray(detalle?.documentos_anexos) ? detalle.documentos_anexos : [];

      const itemsBase = [];
      if ((incluir_principal ?? true) && principal) {
        itemsBase.push({
          archivo_id: principal.id,
          nombre_original: principal.nombre_archivo,
          tipo: "principal",
          extension: extensionDe(principal.nombre_archivo),
          mime_type: mimeDe(extensionDe(principal.nombre_archivo)),
          orden: 0,
          esExterno: false,
        });
      }
      if (incluir_anexos ?? true) {
        anexosRaw.forEach((a, i) => {
          const esUrl = a.tipo === "ANEXO_URL";
          itemsBase.push({
            archivo_id: a.anexo_id || a.id,
            nombre_original: a.nombre_archivo,
            tipo: esUrl ? (esSharePoint(a.url_documento) ? "link_sharepoint" : "link_externo") : "anexo",
            extension: extensionDe(a.nombre_archivo),
            mime_type: mimeDe(extensionDe(a.nombre_archivo)),
            orden: a.correlativo ?? i + 1,
            esExterno: esUrl,
            url_origen: esUrl ? a.url_documento : null,
          });
        });
      }

      const totalEsperados = itemsBase.length;
      const inventarioFinal = [];
      let totalExtraidosZip = 0;
      let totalExtraidosMsg = 0;

      for (const item of itemsBase.slice(0, MAX_ITEMS_INVENTARIO)) {
        const { item: procesado, hijos } = await procesarItemInventario(item, {
          comunicacionId: id,
          extraerZip: extraer_zip ?? true,
          extraerMsg: extraer_msg ?? true,
        });
        inventarioFinal.push(procesado);
        for (const hijo of hijos) {
          inventarioFinal.push(hijo);
          if (hijo.tipo === "extraido_zip") totalExtraidosZip++;
          if (hijo.tipo === "adjunto_msg") totalExtraidosMsg++;
        }
      }

      // Adjuntar como recursos descargables (con limite de tamano total) y limpiar buffers internos del JSON
      const contentAdicional = [];
      let embebidoAcumulado = 0;
      for (const it of inventarioFinal) {
        const buffer = it._buffer;
        delete it._buffer;
        if (!buffer) continue;
        if (buffer.length > EMBED_MAX_BYTES_POR_ARCHIVO) continue;
        if (embebidoAcumulado + buffer.length > EMBED_MAX_BYTES_TOTAL) continue;
        embebidoAcumulado += buffer.length;
        it.archivo_adjunto = true;
        contentAdicional.push({
          type: "resource",
          resource: {
            uri: `docdigital://documentos/${id}/archivo/${it.archivo_id}`,
            mimeType: it.mime_type,
            blob: buffer.toString("base64"),
            name: it.nombre_original || undefined,
          },
        });
      }
      inventarioFinal.forEach((it) => {
        if (it.archivo_adjunto === undefined) it.archivo_adjunto = false;
      });

      const totalDescargados = inventarioFinal.filter((it) => it.descargado).length;
      const totalNoDescargados = inventarioFinal.filter((it) => !it.descargado).length;
      const fallas = inventarioFinal
        .filter((it) => it.motivo_falla)
        .map((it) => ({ archivo_id: it.archivo_id, nombre_original: it.nombre_original, motivo: it.motivo_falla }));
      const noProcesadosPorLimite = itemsBase.length > MAX_ITEMS_INVENTARIO ? itemsBase.length - MAX_ITEMS_INVENTARIO : 0;

      let completitud;
      if (totalNoDescargados === 0 && noProcesadosPorLimite === 0) completitud = "completa";
      else if (totalDescargados === 0) completitud = "insuficiente";
      else completitud = "parcial";

      const resumen = {
        total_archivos_esperados: totalEsperados,
        total_descargados: totalDescargados,
        total_no_descargados: totalNoDescargados,
        total_extraidos_zip: totalExtraidosZip,
        total_extraidos_msg: totalExtraidosMsg,
        no_procesados_por_limite: noProcesadosPorLimite,
        hay_fallas: fallas.length > 0,
        fallas,
        completitud,
      };

      return {
        content: [
          { type: "text", text: JSON.stringify({ resumen, inventario: inventarioFinal }, null, 2) },
          ...contentAdicional,
        ],
      };
    }
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
