import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createBridgeStore, mountBridgeRoutes, registerBridgeTools, bridgeRuntime } from '../visaciones-bridge.js';

const id = 'a'.repeat(64), ownerKey = 'b'.repeat(64), fingerprint = 'c'.repeat(64);
const secret = 'synthetic-bridge-test-secret-only';
const dossier = {id:'synthetic-dossier',documentId:'12345',taskId:'task-test',fingerprint,files:[]};
const envelope = {format:'visaciones-chatgpt-v1',dossierId:dossier.id,documentId:dossier.documentId,taskId:dossier.taskId,fingerprint,result:{summary:'SYNTHETIC RESULT ONLY'}};

test('encrypted bridge persists across restart, binds document version and never overwrites results', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'visaciones-bridge-test-'));
  let now = 1000000;
  try {
    const store = createBridgeStore({directory,secret,now:()=>now});
    const job = store.register({requestId:id,ownerKey,dossier,prompt:'SYNTHETIC REQUEST ONLY'});
    assert.equal(job.result,null);
    assert.throws(()=>store.read('../secret'));
    assert.throws(()=>store.save(id,{...envelope,documentId:'98765'}));
    assert.throws(()=>store.save(id,{...envelope,fingerprint:'wrong'}));
    assert.equal(store.save(id,envelope).savedInVisor,false);
    const repeat = store.save(id,envelope);
    assert.equal(repeat.savedInBridge,true);
    assert.throws(()=>store.save(id,{...envelope,result:{summary:'different'}}));
    const encrypted = fs.readFileSync(path.join(directory,id+'.json.enc'));
    assert.equal(encrypted.includes(Buffer.from('SYNTHETIC')),false);
    const restarted = createBridgeStore({directory,secret,now:()=>now});
    assert.deepEqual(restarted.read(id).result,envelope);
    now = job.expiresAt + 1;
    assert.throws(()=>restarted.read(id),e=>e.status===410);
    restarted.prune();
    assert.equal(fs.readdirSync(directory).length,0);
    assert.throws(()=>bridgeRuntime({VISACIONES_BRIDGE_ENABLED:'true',VISACIONES_API_KEY:secret}),e=>e.status===503);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('HTTP Site registration and MCP write/read use separate authentication, safe errors and accurate annotations', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'visaciones-bridge-http-test-'));
  const getStore = () => createBridgeStore({directory,secret});
  const app = express();
  mountBridgeRoutes(app,{getStore,secret});
  app.post('/mcp', express.json({limit:'180kb'}), async (req,res) => {
    if(req.get('Authorization')!=='Bearer synthetic-mcp-token') return res.sendStatus(401);
    const server = new McpServer({name:'synthetic-bridge',version:'1.0'});
    registerBridgeTools(server,{getStore});
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
    res.on('close',()=>{transport.close();server.close();});
    await server.connect(transport); await transport.handleRequest(req,res,req.body);
  });
  const http = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>http.once('listening',resolve));
  const base = `http://127.0.0.1:${http.address().port}`;
  let seq=0;
  const rpc = async(method,params) => {
    const res = await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer synthetic-mcp-token','Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});
    const raw = await res.text();
    const data = raw.startsWith('event:') ? JSON.parse(raw.split('\n').find(l=>l.startsWith('data:')).slice(5)) : JSON.parse(raw);
    assert.equal(res.status,200); return data.result;
  };
  try {
    assert.equal((await fetch(base+'/visaciones-bridge/status')).status,401);
    assert.equal((await fetch(base+'/visaciones-bridge/status',{headers:{Authorization:'Bearer '+secret,Origin:'https://other.example'}})).status,401);
    assert.equal((await fetch(base+'/visaciones-bridge/status?token=x',{headers:{Authorization:'Bearer '+secret}})).status,401);
    assert.equal((await fetch(base+'/visaciones-bridge/requests',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({requestId:id,ownerKey,dossier,prompt:'synthetic'})})).status,200);
    await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-test',version:'1'}});
    const list = await rpc('tools/list',{});
    assert.equal(list.tools.length,2);
    const write = list.tools.find(t=>t.name==='visaciones_guardar_revision');
    assert.equal(write.annotations.readOnlyHint,false);
    assert.equal(write.annotations.idempotentHint,true);
    assert.equal(write.annotations.destructiveHint,false);
    const read = await rpc('tools/call',{name:'visaciones_obtener_solicitud',arguments:{solicitud_id:id}});
    assert.equal(JSON.parse(read.content[0].text).dossier.id,dossier.id);
    assert.equal(read.content[0].text.includes(ownerKey),false);
    const bad = await rpc('tools/call',{name:'visaciones_guardar_revision',arguments:{solicitud_id:id,revision_json:'{SENSITIVE INVALID INPUT'}});
    assert.equal(bad.isError,true); assert.equal(bad.content[0].text.includes('SENSITIVE'),false);
    const saved = await rpc('tools/call',{name:'visaciones_guardar_revision',arguments:{solicitud_id:id,revision_json:JSON.stringify(envelope)}});
    assert.equal(JSON.parse(saved.content[0].text).state,'ready_for_visor');
    assert.equal((await fetch(base+'/visaciones-bridge/requests/'+id,{headers:{Authorization:'Bearer '+secret,'X-Visaciones-Owner':'wrong'}})).status,404);
    const result = await fetch(base+'/visaciones-bridge/requests/'+id,{headers:{Authorization:'Bearer '+secret,'X-Visaciones-Owner':ownerKey}});
    assert.deepEqual((await result.json()).envelope,envelope);
  } finally { await new Promise(resolve=>http.close(resolve)); fs.rmSync(directory,{recursive:true,force:true}); }
});
