const fs = require('fs');
const request = require('request');

function readFileSafe(path) {
  try { return fs.readFileSync(path, 'utf8'); } catch { return null; }
}

function loadSysInstructions(jid, isGroup) {
  if(isGroup) {
    const p = `sys_inst.${jid}.config`;
    const custom = readFileSafe(p);
    if(custom) return custom;
    const def = readFileSafe('sys_inst.default.config');
    if(def) return def;
    throw new Error('sys_inst.default.config não encontrado');
  } else {
    const light = readFileSafe('sys_inst.light.config');
    if(light) return light;
    throw new Error('sys_inst.light.config não encontrado');
  }
}

function loadFichaContext(jid) {
  const path = `./historical/ficha.${(jid||'').replace(/[^a-zA-Z0-9_.-]/g,'_')}.json`;
  const raw = readFileSafe(path);
  if(!raw) return '';
  let f = {};
  try { f = JSON.parse(raw); } catch {}
  const pairs = [
    ['Razão Social', f.razaoSocial],
    ['CNPJ', f.cnpj],
    ['IE', f.inscricaoEstadual],
    ['Situação', f.situacaoCadastral],
    ['Representante', f.representanteLegal],
    ['CPF', f.cpf],
    ['E-mail', f.email],
    ['Tel1', f.telefone1],
    ['Tel2', f.telefone2],
    ['Endereço', f.endereco],
    ['CEP', f.cep],
    ['Bairro', f.bairro],
    ['Cidade', f.cidade],
    ['UF', f.estado],
    ['Vencimento', f.vencimento || f.dataVencimento],
    ['Portabilidade', f.portabilidade],
    ['Operadora', f.operadora],
    ['Número Portado', f.numeroPortado],
    ['Cedente', f.nomeCedente],
    ['CPF Cedente', f.cpfCedente],
    ['Acessos', f.totalAcessos],
    ['Plano', f.plano],
    ['Nomenclatura', f.nomenclaturaPlano],
    ['Fast Chip', f.fastChip]
  ];
  const filled = pairs.filter(([, v]) => !!v).map(([k, v]) => `${k}: ${v}`);
  return filled.length ? filled.join(' | ') : '';
}

function loadHistory(jid) {
  const path = `./historical/hist.${jid}.json`;
  const raw = readFileSafe(path);
  if(!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function getApiKey() {
  if(process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // fallback: tenta extrair de ValentinaBOT.ts (const API_KEY = '...')
  const botTs = readFileSafe('ValentinaBOT.ts');
  if(botTs) {
    const m = botTs.match(/const\s+API_KEY\s*=\s*'([^']+)'/);
    if(m) return m[1];
  }
  throw new Error('Defina GEMINI_API_KEY no ambiente ou configure API_KEY em ValentinaBOT.ts');
}

function buildPayload(sysInstructions, message, history, fichaCtx) {
  const messages = [];
  if(Array.isArray(history)) {
    for(const h of history) messages.push({ role: h.role, parts: { text: h.text } });
  }
  messages.push({ role: 'user', parts: { text: message } });
  const augmented = fichaCtx ? `${sysInstructions}\n\n[FICHA - CONTEXTO ATUAL]\n${fichaCtx}` : sysInstructions;
  return {
    system_instruction: { parts: { text: augmented } },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ],
    generationConfig: { temperature: 2.0 },
    contents: messages
  };
}

async function callGemini(apiKey, payload){
  return new Promise((resolve, reject) => {
    request.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
      { json: true, body: payload },
      (err, resp, body) => {
        if(err) return reject(err);
        resolve({ status: resp && resp.statusCode, body });
      }
    );
  });
}

async function main(){
  const args = process.argv.slice(2);
  const getArg = (name, def) => {
    const i = args.findIndex(a => a === `--${name}`);
    return i>=0 ? args[i+1] : def;
  };
  const jid = getArg('jid', 'test@g.us');
  const isGroup = /^true$/i.test(getArg('group', 'true'));
  const message = getArg('message', 'Mensagem de teste para validação do payload.');
  const histUser = getArg('histUser');

  const sys = loadSysInstructions(jid, isGroup);
  const fichaCtx = loadFichaContext(jid);
  let history = loadHistory(jid);
  if(histUser){
    history = [...history, { role: 'user', text: histUser }];
  }
  const payload = buildPayload(sys, message, history, fichaCtx);

  // Exibe resumo do payload (sem chave)
  console.log('=== Payload a enviar (resumo) ===');
  console.log(JSON.stringify({ ...payload, system_instruction: { parts: { text: (payload.system_instruction.parts.text||'').slice(0,400) + '...' } } }, null, 2));

  const key = getApiKey();
  const res = await callGemini(key, payload).catch(err => ({ error: err }));
  if(res && !res.error) {
    console.log('=== Resposta ===');
    const text = res.body && res.body.candidates && res.body.candidates[0] && res.body.candidates[0].content && res.body.candidates[0].content.parts && res.body.candidates[0].content.parts[0] && res.body.candidates[0].content.parts[0].text;
    console.log({ status: res.status, text });
  } else {
    console.error('Erro ao chamar Gemini:', res && res.error ? res.error : 'desconhecido');
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err); process.exit(1); });


