import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';

const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 180000;
const TTL = 7 * 24 * 3600 * 1000;
export class BridgeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new BridgeError(status, message); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// All state is encrypted and atomically written to the attached persistent volume.
// One Node process/replica; synchronous critical sections prevent competing writes.
export function createBridgeStore({ directory, secret, now = Date.now }) {
  if (!directory || !secret || secret.length < 24) fail(503, 'Almacenamiento del puente no habilitado.');
  const key = crypto.createHash('sha256').update('visaciones-bridge-v1\0' + secret).digest();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = id => {
    if (!HEX.test(id)) fail(400, 'Identificador de solicitud inválido.');
    return path.join(directory, id + '.json.enc');
  };
  function readRaw(id) {
    let bytes;
    try { bytes = fs.readFileSync(file(id)); }
    catch (e) { if (e.code === 'ENOENT') fail(404, 'Solicitud no encontrada. Prepara la revisión desde el visor.'); throw e; }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  }
  function read(id) {
    const value = readRaw(id);
    if (value.expiresAt <= now()) fail(410, 'La solicitud venció. Prepara una nueva solicitud en el visor.');
    return value;
  }
  function write(id, value) {
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > MAX_BYTES) fail(413, 'El resultado supera el tamaño admitido.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const content = Buffer.concat([cipher.update(data), cipher.final()]);
    const target = file(id), temporary = target + '.' + crypto.randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, Buffer.concat([iv, cipher.getAuthTag(), content]));
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, target);
      const dir = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  function prune() {
    let count = 0;
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-f0-9]{64}\.json\.enc$/.test(name)) continue;
      const id = name.slice(0, 64);
      if (readRaw(id).expiresAt <= now()) fs.unlinkSync(file(id));
      else count++;
    }
    return count;
  }
  function register(input) {
    if (!input || !HEX.test(input.requestId) || !HEX.test(input.ownerKey) || !input.dossier ||
        !HEX.test(input.dossier.fingerprint) || typeof input.dossier.id !== 'string' ||
        !/^\d{1,20}$/.test(input.dossier.documentId) || typeof input.dossier.taskId !== 'string' ||
        !Array.isArray(input.dossier.files) || input.dossier.files.length > 20 ||
        typeof input.prompt !== 'string' || input.prompt.length > 80000)
      fail(400, 'Solicitud de revisión inválida.');
    prune();
    let previous;
    try { previous = read(input.requestId); } catch (e) { if (!(e instanceof BridgeError) || e.status !== 404) throw e; }
    const payloadHash = digest({ownerKey: input.ownerKey, dossierId: input.dossier.id, fingerprint: input.dossier.fingerprint, documentId: input.dossier.documentId, taskId: input.dossier.taskId});
    if (previous) {
      if (previous.payloadHash !== payloadHash) fail(409, 'No se puede cambiar una solicitud registrada.');
      return previous;
    }
    if (prune() >= 200) fail(429, 'Hay demasiadas solicitudes pendientes. Inténtalo después de que venzan.');
    const entry = { ...input, payloadHash, createdAt: now(), expiresAt: now() + TTL, result: null, resultHash: null };
    write(input.requestId, entry);
    return entry;
  }
  function save(id, envelope) {
    const job = read(id), d = job.dossier;
    if (!envelope || envelope.format !== 'visaciones-chatgpt-v1' || envelope.dossierId !== d.id ||
        envelope.fingerprint !== d.fingerprint || envelope.documentId !== d.documentId || envelope.taskId !== d.taskId ||
        !envelope.result || typeof envelope.result !== 'object' || Array.isArray(envelope.result))
      fail(409, 'El resultado no corresponde al documento y versión solicitados.');
    const resultHash = digest(envelope);
    if (job.resultHash && job.resultHash !== resultHash) fail(409, 'Ya existe un resultado distinto. No se sobrescribirá.');
    if (!job.resultHash) write(id, { ...job, result: envelope, resultHash, completedAt: now() });
    return { requestId: id, state: 'ready_for_visor', resultHash, savedInBridge: true, savedInVisor: false,
      message: 'Resultado conservado en el puente MCP. Abre el visor y pulsa Consultar resultado para validarlo y guardarlo allí. No se ha visado, rechazado ni enviado un correo.' };
  }
  return { register, read, save, prune };
}

export function bridgeRuntime(env = process.env) {
  if (env.VISACIONES_BRIDGE_ENABLED !== 'true' || !env.RAILWAY_VOLUME_MOUNT_PATH ||
      env.RAILWAY_VOLUME_MOUNT_PATH !== '/data/visaciones')
    fail(503, 'El puente requiere su volumen persistente habilitado.');
  return createBridgeStore({ directory: env.RAILWAY_VOLUME_MOUNT_PATH, secret: env.VISACIONES_API_KEY });
}
const safeError = e => e instanceof BridgeError ? e.message : 'No se pudo completar el intercambio de revisión.';

export function mountBridgeRoutes(app, { getStore = bridgeRuntime, secret = process.env.VISACIONES_API_KEY } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const provided = Buffer.from((req.get('Authorization') || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(secret || '');
    if (req.get('Origin') || Object.keys(req.query).length || !expected.length || provided.length !== expected.length ||
        !crypto.timingSafeEqual(provided, expected)) return res.status(401).json({error: 'Acceso al puente no autorizado.'});
    next();
  });
  router.use(express.json({limit: '180kb', inflate: false}));
  router.get('/status', (req, res, next) => {
    try { getStore().prune(); res.json({ ok: true, persistent: true, version: 1 }); } catch (e) { next(e); }
  });
  router.post('/requests', (req, res, next) => {
    try {
      const j = getStore().register(req.body);
      res.json({ requestId: j.requestId, expiresAt: j.expiresAt, state: j.result ? 'ready_for_visor' : 'pending' });
    } catch (e) { next(e); }
  });
  router.get('/requests/:id', (req, res, next) => {
    try {
      const j = getStore().read(req.params.id);
      if (req.get('X-Visaciones-Owner') !== j.ownerKey) fail(404, 'Solicitud no encontrada.');
      res.json({ requestId: j.requestId, state: j.result ? 'ready_for_visor' : 'pending', envelope: j.result, resultHash: j.resultHash });
    } catch (e) { next(e); }
  });
  router.use((err, req, res, next) => res.status(err instanceof BridgeError ? err.status : err.status === 413 ? 413 : 500).json({ error: safeError(err) }));
  app.use('/visaciones-bridge', router);
}

export function registerBridgeTools(server, { getStore = bridgeRuntime } = {}) {
  const requestId = z.string().regex(HEX).describe('ID de la solicitud preparado por el visor. No es el número del documento ni una credencial.');
  server.tool('visaciones_obtener_solicitud',
    'Obtiene una solicitud de revisión registrada por Felipe en el visor privado. Usa el ID que entrega el visor. Devuelve inventario e instrucciones de referencia; NO acredita que los documentos estén leídos. Descarga y lee los archivos con las herramientas DocDigital antes de revisar.',
    { solicitud_id: requestId }, { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({solicitud_id}) => {
      try {
        const j = getStore().read(solicitud_id);
        return {content: [{type: 'text', text: JSON.stringify({requestId: j.requestId, dossier: j.dossier, prompt: j.prompt, expiresAt: j.expiresAt, existingResultHash: j.resultHash})}]};
      } catch (e) { return {isError: true, content: [{type:'text', text:safeError(e)}]}; }
    });
  server.tool('visaciones_guardar_revision',
    'Conserva la revisión terminada en el puente autenticado del visor. Usar SOLO después de leer el expediente y por solicitud del usuario. No visa, rechaza ni envía correos. Recibe el JSON visaciones-chatgpt-v1. Es inmutable: repetir el mismo resultado no lo duplica; un resultado diferente se rechaza. El visor debe Consultar resultado para validarlo e incorporarlo a su base privada. No afirmar que ya se guardó en el visor.',
    { solicitud_id: requestId, revision_json: z.string().min(2).max(140000).describe('JSON completo de la revisión, con format, documentId, taskId, dossierId, fingerprint y result. Sin bloques Markdown.') },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({solicitud_id, revision_json}) => {
      try {
        let envelope;
        try { envelope = JSON.parse(revision_json); } catch { fail(400, 'El JSON de la revisión no es válido.'); }
        return {content: [{type:'text', text:JSON.stringify(getStore().save(solicitud_id, envelope))}]};
      } catch (e) { return {isError:true, content:[{type:'text',text:safeError(e)}]}; }
    });
}
