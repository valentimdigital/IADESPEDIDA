const request = require('request');

const extractDigits = (v) => (v || '').replace(/\D+/g, '');

function validateCnpj(cnpjRaw){
  const c = extractDigits(cnpjRaw);
  if(c.length !== 14) return false;
  if(/^([0-9])\1{13}$/.test(c)) return false;
  const calc = (base, factors) => {
    let sum = 0; for(let i=0;i<factors.length;i++) sum += parseInt(base.charAt(i),10)*factors[i];
    const mod = sum % 11; return (mod < 2) ? 0 : 11 - mod;
  };
  const d1 = calc(c.substr(0,12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(c.substr(0,13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return (parseInt(c.charAt(12),10) === d1) && (parseInt(c.charAt(13),10) === d2);
}

function isValidCep(cepRaw){
  const d = extractDigits(cepRaw); return /^\d{8}$/.test(d);
}

function fetchCnpj(cnpj){
  return new Promise((resolve) => {
    request.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { json: true, timeout: 10000 }, (err, resp, body)=>{
      if(!err && resp && resp.statusCode===200 && body) return resolve({ ok:true, source:'BrasilAPI', data: body });
      request.get(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`, { json: true, timeout: 10000 }, (err2, resp2, body2)=>{
        if(!err2 && resp2 && resp2.statusCode===200 && body2 && body2.status!=='ERROR') return resolve({ ok:true, source:'ReceitaWS', data: body2 });
        return resolve({ ok:false });
      });
    });
  });
}

function fetchCep(cep8){
  return new Promise((resolve) => {
    request.get(`https://brasilapi.com.br/api/cep/v1/${cep8}`, { json: true, timeout: 10000 }, (err, resp, body)=>{
      if(!err && resp && resp.statusCode===200 && body) return resolve({ ok:true, source:'BrasilAPI', data: body });
      request.get(`https://viacep.com.br/ws/${cep8}/json/`, { json: true, timeout: 10000 }, (err2, resp2, body2)=>{
        if(!err2 && resp2 && resp2.statusCode===200 && body2 && body2.erro!==true) {
          const mapped = { cep: cep8, state: body2.uf, city: body2.localidade, neighborhood: body2.bairro, street: body2.logradouro };
          return resolve({ ok:true, source:'ViaCEP', data: mapped });
        }
        return resolve({ ok:false });
      });
    });
  });
}

async function main(){
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.findIndex(a => a === `--${name}`);
    return i>=0 ? args[i+1] : undefined;
  };
  const cnpjIn = getArg('cnpj');
  const cepIn = getArg('cep');

  if(cnpjIn){
    const cnpj = extractDigits(cnpjIn);
    const ok = validateCnpj(cnpj);
    console.log(`CNPJ ${cnpj} válido? ${ok}`);
    if(ok){
      const res = await fetchCnpj(cnpj);
      console.log('CNPJ lookup:', res.ok ? `${res.source}` : 'falhou');
      if(res.ok) console.log(res.data);
    }
  }

  if(cepIn){
    const cep = extractDigits(cepIn);
    const ok = isValidCep(cep);
    console.log(`CEP ${cep} válido? ${ok}`);
    if(ok){
      const res = await fetchCep(cep);
      console.log('CEP lookup:', res.ok ? `${res.source}` : 'falhou');
      if(res.ok) console.log(res.data);
    }
  }

  if(!cnpjIn && !cepIn){
    console.log('Uso: node scripts/test_cnpj_cep.js --cnpj 11222333000181 --cep 01311-000');
  }
}

main().catch(err => { console.error(err); process.exit(1); });


