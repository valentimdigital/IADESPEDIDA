const fs = require('fs');
const path = require('path');
const request = require('request');

let API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
if (!API_KEY) {
  try {
    const k = fs.readFileSync(path.join(__dirname, 'gemini.key'), 'utf8').trim();
    API_KEY = k || '';
  } catch {}
}
if (!API_KEY) {
  try {
    const bot = fs.readFileSync(path.join(__dirname, 'ValentinaBOT.ts'), 'utf8');
    const m = bot.match(/const\s+API_KEY\s*=\s*'([^']+)'/);
    if (m && m[1]) API_KEY = m[1].trim();
  } catch {}
}
if (!API_KEY) {
  console.error('Chave da Gemini não encontrada. Defina GEMINI_API_KEY, crie gemini.key, ou mantenha a constante em ValentinaBOT.ts.');
  process.exit(1);
}

const sysFile = process.argv[2] || path.join(__dirname, 'sys_inst.light.config');
const userMessage = process.argv[3] || 'Teste rápido: responda com OK se estiver funcionando.';

let sysInstructions = '';
try {
  sysInstructions = fs.readFileSync(sysFile, 'utf8');
} catch (e) {
  console.error(`Não foi possível ler o arquivo de instruções: ${sysFile}`);
  process.exit(1);
}

const historyPath = process.argv[4];
let history = [];
if (historyPath) {
  try {
    const raw = fs.readFileSync(historyPath, 'utf8');
    history = JSON.parse(raw);
  } catch (e) {
    console.warn('Histórico não pôde ser lido/parseado, seguindo sem histórico.');
  }
}

const messages = [];
if (Array.isArray(history)) {
  for (const h of history) {
    if (h && h.role && typeof h.text === 'string') {
      messages.push({ role: h.role, parts: { text: h.text } });
    }
  }
}
messages.push({ role: 'user', parts: { text: userMessage } });

const payload = {
  system_instruction: { parts: { text: sysInstructions } },
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

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

request.post(
  url,
  { json: true, body: payload, timeout: 20000 },
  (err, resp, body) => {
    if (err) {
      console.error('Erro de requisição:', err);
      process.exit(1);
    }
    if (!resp || resp.statusCode !== 200) {
      console.error('Falha da API:', resp && resp.statusCode, body);
      process.exit(1);
    }
    try {
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('RESPOSTA DA GEMINI:\n');
      console.log(text);
    } catch (e) {
      console.error('Resposta inesperada da API:', body);
      process.exit(1);
    }
  }
);


