import { WASocket, WAMessage, delay } from "@whiskeysockets/baileys";
import fs from 'fs';
import request from 'request';
import path from 'path';

const API_KEY = 'AIzaSyAjKemXKp_eFgC-BbAFr1-UU5h6CGa7SZs';
let this_sock: WASocket;

// Wrapper para executar funções async com tratamento de erro robusto
const safeAsync = async <T>(fn: () => Promise<T>, fallback?: T): Promise<T | undefined> => {
	try {
		return await fn();
	} catch (error) {
		console.log('[SAFE ASYNC ERROR]', { error: error?.message || error });
		return fallback;
	}
};

function init(sock: WASocket) {
	this_sock = sock;
}

const sendMessage = async (jid: string, text: string) => {
	try {
		// Simula digitação (1.5s a 5s)
		const ms = Math.floor(1500 + Math.random() * 3500);
		await this_sock.sendPresenceUpdate('composing', jid);
		await delay(ms);
		await this_sock.sendPresenceUpdate('paused', jid);
	} catch {}
	try {
		return await this_sock.sendMessage(jid, { text: text });
	} catch (error) {
		console.log('[SEND ERROR]', { jid, error: error?.message || error });
		// Silencioso: não enviar mensagem de erro para o usuário
		return null;
	}
}

const sendMessageWithImage = async (jid: string, text: string, imagePath: string) => {
	try {
		// Simula digitação (1.5s a 5s)
		const ms = Math.floor(1500 + Math.random() * 3500);
		await this_sock.sendPresenceUpdate('composing', jid);
		await delay(ms);
		await this_sock.sendPresenceUpdate('paused', jid);
	} catch {}
	
	try {
		// Envia imagem com legenda
		const imageBuffer = fs.readFileSync(imagePath);
		return await this_sock.sendMessage(jid, {
			image: imageBuffer,
			caption: text
		});
	} catch (error) {
		console.log('[SEND IMAGE ERROR]', { jid, error: error?.message || error });
		// Silencioso: não enviar mensagem de erro para o usuário
		return null;
	}
}

const loadSysInstructions = (jid: string, isGroup: boolean): string => {
    if(isGroup) {
        const p = `sys_inst.${jid}.config`;
        if(fs.existsSync(p)) {
            try { return fs.readFileSync(p, 'utf8'); } catch {}
        } else {
            console.log(`sys_inst.${jid}.config NOT FOUND...`);
        }
        return fs.readFileSync(`sys_inst.default.config`, 'utf8');
    } else {
        return fs.readFileSync('sys_inst.light.config', 'utf8');
    }
}

const sendToGeminiAPI = async (sysInstructions: string, message: string, history: { role: string, text: string }[]): Promise<string> => {
	const messages = [];
	if(history) {
		console.log('[GEMINI DEBUG] Histórico carregado:', history.length, 'mensagens');
		for(const h of history) {
			messages.push({ role: h.role, parts: { text: h.text } });
		}
	}
	messages.push({ role: 'user', parts: { text: message } });
	
	console.log('[GEMINI DEBUG] Total de mensagens enviadas:', messages.length);
	console.log('[GEMINI DEBUG] Última mensagem:', message);
	
	const contents = {
		system_instruction: {
			parts: { 
				text: sysInstructions
			}
		},
		safetySettings: [
			{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
			{ category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
		],
		generationConfig: {
			temperature: 0.7,
			topP: 0.8,
			topK: 40,
			maxOutputTokens: 2048
		},
		contents: messages
	};
	
	return new Promise((resolve, reject) => {
		request.post(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
			{ 
				json: true, 
				body: contents 
			},
			(err, resp, body) => {
				try {
					if (!err && resp.statusCode == 200) {
						const result = `${body.candidates[0].content.parts[0].text}`;
						resolve(result);
					} else {
						console.log('[GEMINI API ERROR]', { err, statusCode: resp?.statusCode, body });
						reject(err || new Error(`API Error: ${resp?.statusCode}`));
					}
				} catch(ex) {
					console.log('[GEMINI PARSE ERROR]', { ex });
					reject(ex);
				}
			}
		);
	});
}

// Detecta se é uma conversa antiga baseada no histórico e ficha
const isOldConversation = (history: any[], fichaCtx: string): boolean => {
	// Só considera conversa antiga se for uma saudação simples E tiver histórico significativo
	const isSimpleGreeting = /\b(oi|olá|bom dia|boa tarde|boa noite|tudo bem|como vai)\b/i.test(history[history.length - 1]?.text || '');
	const hasSignificantHistory = history.length >= 6; // pelo menos 3 trocas de mensagens
	
	return isSimpleGreeting && hasSignificantHistory;
};

// Sistema de Objeções Inteligente
const handleObjections = (text: string, ficha: any): string | null => {
	const lowerText = text.toLowerCase();
	
	// Objeção: Preço alto
	if (/\b(caro|preço\s+alto|muito\s+caro|não\s+tenho\s+dinheiro|orçamento|barato)\b/i.test(text)) {
		const price = ficha?.nomenclaturaPlano || 'R$ 139,99';
		return `Entendo sua preocupação com investimento. O valor ${price} inclui:
• Conectividade de alta velocidade (até 100x mais rápida)
• Suporte técnico especializado 24/7
• Economia em múltiplas linhas (gestão única)
• ROI comprovado: empresas economizam até 30% vs concorrentes
• Sem taxa de instalação (economia imediata)

Posso mostrar um plano mais econômico?`;
	}
	
	// Objeção: Fibra não disponível
	if (/\b(não\s+tem|indisponível|não\s+chega|fibra\s+não)\b/i.test(text)) {
		return `Perfeito! Mesmo sem fibra, temos solução completa:
• TIM Empresa Internet (Roteador 4G) - mesma velocidade
• Plug and play - funciona em 24h
• 7 dias de teste gratuito (sem multa)
• Cobertura 4G+ em todo RJ/MG/ES
• Mesmo suporte técnico especializado

Quer testar por 7 dias sem compromisso?`;
	}
	
	// Objeção: Fidelização
	if (/\b(fidelização|contrato|multa|sair|cancelar)\b/i.test(text)) {
		return `A fidelização de 24 meses garante:
• Preço fixo (sem reajustes surpresa)
• Suporte prioritário
• Upgrade gratuito quando disponível
• Estabilidade para seu negócio

Mas se precisar cancelar, cobramos apenas o proporcional dos meses restantes (sem multa abusiva).`;
	}
	
	// Objeção: Competência técnica
	if (/\b(confiança|segurança|qualidade|problema|instabilidade)\b/i.test(text)) {
		return `Somos Parceiros Oficiais TIM com:
• 15+ anos de experiência
• Suporte técnico especializado
• SLA de 99,9% de disponibilidade
• Equipe certificada pela TIM
• Mais de 10.000 empresas atendidas

Posso enviar referências de clientes na sua região?`;
	}
	
	// Objeção: Processo complexo
	if (/\b(demora|complexo|difícil|burocrático|documentos)\b/i.test(text)) {
		return `Nosso processo é super simples:
• Documentos por WhatsApp (foto mesmo)
• Validação em até 24h
• Instalação em 48h
• Eu conduzo tudo para você
• Atualização a cada etapa

Só preciso de: CNPJ + documento com foto + comprovante de endereço.`;
	}
	
	// Objeção: Parcelamento
	if (/\b(parcelar|parcela|parcelamento|dividir|financiar)\b/i.test(text)) {
		return `O pagamento dos planos TIM é realizado mensalmente por débito em conta, não sendo possível o parcelamento do valor total.

Os valores são cobrados mensalmente via débito automático, facilitando o controle financeiro da empresa.`;
	}
	
	return null; // Não é objeção conhecida
};

// Detecção de Urgência/Intenção
const detectUrgency = (text: string): 'alta' | 'media' | 'baixa' => {
	if (/\b(urgente|rápido|hoje|agora|emergência|imediato|asap)\b/i.test(text)) return 'alta';
	if (/\b(quando|prazo|tempo|quanto\s+tempo|rapidez)\b/i.test(text)) return 'media';
	return 'baixa';
};

// Detectar estágio da negociação
const detectStage = (ficha: any): 'prospecção' | 'qualificação' | 'proposta' | 'fechamento' => {
	if (!ficha?.cnpj) return 'prospecção';
	if (!ficha?.plano) return 'qualificação';
	if (!ficha?.email) return 'proposta';
	return 'fechamento';
};

// Gera resposta direta para conversas antigas
const generateOldConversationResponse = (fichaCtx: string, text: string): string => {
	const isSimpleGreeting = /^(oi|olá|ola|bom dia|boa tarde|boa noite|hey|hi)$/i.test(text.trim());
	
	if (isSimpleGreeting) {
		if (fichaCtx) {
			// Extrai informações principais da ficha
			const cnpjMatch = fichaCtx.match(/CNPJ:\s*(\d{14})/);
			const planoMatch = fichaCtx.match(/Plano:\s*([^|]+)/);
			const enderecoMatch = fichaCtx.match(/Endereço:\s*([^|]+)/);
			
			let resumo = "Vejo que você já estava negociando conosco! ";
			
			if (cnpjMatch) resumo += `CNPJ ${cnpjMatch[1]}. `;
			if (planoMatch) resumo += `Plano: ${planoMatch[1].trim()}. `;
			if (enderecoMatch) resumo += `Endereço: ${enderecoMatch[1].trim()}. `;
			
			resumo += "Quer retomar a negociação? Posso ajudar com:";
			resumo += "\n• Finalizar documentação";
			resumo += "\n• Agendar instalação";
			resumo += "\n• Alterar plano";
			resumo += "\n• Outras dúvidas";
			
			return resumo;
		} else {
			return "Olá! Vejo que já conversamos antes. Quer retomar nossa negociação? Posso ajudar com:\n• Finalizar documentação\n• Agendar instalação\n• Alterar plano\n• Outras dúvidas";
		}
	}
	
	return ""; // Não é saudação simples, deixa o Gemini processar normalmente
};

const handleGemini = async (sysInstructions: string, text: string, jid: string) => {
	try {
		const histFilename = `./historical/hist.${jid}.json`;
		let history = [];
		try {
			history = JSON.parse(fs.readFileSync(histFilename, 'utf8'));
		} catch {
		}
		
		// Anexa contexto da FICHA ao system_instruction para que a IA conheça o progresso
		const fichaCtx = buildFichaContext(jid);
		const ficha = loadFicha(jid);
		
		console.log('[FICHA CONTEXT]', { jid, fichaCtx, fichaKeys: Object.keys(ficha) });
		
		// Sistema de Objeções Inteligente - PRIORIDADE MÁXIMA
		const objectionResponse = handleObjections(text, ficha);
		if (objectionResponse) {
			console.log('[OBJEÇÃO] Detectada e respondida para', jid, 'text:', text);
			trackMetric(jid, 'objection_handled', { 
				urgency: detectUrgency(text),
				stage: detectStage(ficha),
				objectionType: 'detected'
			});
			// Salva no histórico mesmo quando é objeção
			try {
				history.push({role: 'user', text: text });
				history.push({role: 'model', text: objectionResponse });
				fs.writeFileSync(histFilename, JSON.stringify(history, undefined, 2), 'utf8');
			} catch {}
			
			await sendMessage(jid, objectionResponse);
			return; // Não processa com Gemini para objeções
		}
		
		// Verifica se é conversa antiga e gera resposta direta para saudações simples
		if (isOldConversation(history, fichaCtx)) {
			console.log('[OLD CONV] Detectada para', jid, 'text:', text);
			const directResponse = generateOldConversationResponse(fichaCtx, text);
			if (directResponse) {
				console.log('[OLD CONV] Enviando resposta direta para', jid);
				await sendMessage(jid, directResponse);
				return; // Não processa com Gemini para saudações simples
			}
		}
		
		const continuityRules = [
			'[REGRAS DE CONTINUIDADE - PRIORIDADE MÁXIMA]',
			'- Não repetir abertura se o cliente já forneceu dados-chave (porte, CNPJ, CEP, linhas, portabilidade, velocidade, endereço de entrega).',
			'- Sempre consolidar o que já foi dito em 1 linha e avançar pedindo apenas o que falta.',
			'- Ordem: confirmar dados -> coletar pendências -> propor/alternativa -> orientar docs e próximos passos.',
			'- Para conversas antigas: seja direto, resuma o contexto rapidamente e foque no próximo passo.'
		].join('\n');
		const baseInst = `${continuityRules}\n\n${sysInstructions}`;
		const augmentedSysInst = fichaCtx ? `${baseInst}\n\n[FICHA - CONTEXTO ATUAL]\n${fichaCtx}` : baseInst;
		const gResponse = await safeAsync(() => sendToGeminiAPI(augmentedSysInst, text, history));
	
	if(gResponse) {
		// Métricas: Resposta do Gemini
		trackMetric(jid, 'gemini_response', {
			urgency: detectUrgency(text),
			stage: detectStage(ficha),
			responseLength: gResponse.length,
			hasPlanOffer: /\b(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})\b/i.test(gResponse)
		});
		
		try {
			history.push({role: 'user', text: text });
			history.push({role: 'model', text: gResponse });
			
			fs.writeFileSync(histFilename, JSON.stringify(history, undefined, 2), 'utf8')
		} catch {
		}
		
		// Se a resposta contém ofertas de planos MÓVEIS, enviar com imagem
		const isMobilePlanOffer = /\b(black\s*empresa|150\s*gb|100\s*gb|50\s*gb|linhas?\s*móveis?|chips?|móvel)\b/i.test(gResponse) && 
								  /\b(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})\b/i.test(gResponse);
		
		// Se a resposta contém ofertas de FIBRA, enviar só texto
		const isFiberPlanOffer = /\b(1\s*giga|700\s*mega|400\s*mega|fibra|ultra\s*fibra)\b/i.test(gResponse) && 
								 /\b(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})\b/i.test(gResponse);
		
		if(isMobilePlanOffer) {
			const imagePath = path.join(__dirname, 'medias', '01.jpg');
			if(fs.existsSync(imagePath)) {
				console.log('[PLANOS MÓVEIS] Enviando oferta com imagem para', jid);
				trackMetric(jid, 'mobile_plan_sent', { withImage: true });
				await sendMessageWithImage(jid, gResponse, imagePath);
			} else {
				console.log('[PLANOS MÓVEIS] Imagem não encontrada, enviando só texto para', jid);
				trackMetric(jid, 'mobile_plan_sent', { withImage: false });
				await sendMessage(jid, gResponse);
			}
		} else if(isFiberPlanOffer) {
			console.log('[PLANOS FIBRA] Enviando oferta só texto para', jid);
			trackMetric(jid, 'fiber_plan_sent', { withImage: false });
			await sendMessage(jid, gResponse);
		} else {
			await sendMessage(jid, gResponse); 
		}
	} else {
		console.log('[GEMINI NO RESPONSE]', { jid });
	}
	} catch (error) {
		console.log('[HANDLE GEMINI ERROR]', { jid, error: error?.message || error });
	}
}

const handleFromGroup = async (text: string, jid: string): Promise<void> => {
	if(text.toLowerCase().includes("valentina")) {
		const sysInstructions = loadSysInstructions(jid, true);
		handleGemini(sysInstructions, text, jid);
	}
}

const handleFromPm = async (text: string, jid: string): Promise<void> => {
	const sysInstructions = loadSysInstructions(jid, false);
	handleGemini(sysInstructions, text, jid);
}

const fromGroup = (msg: WAMessage): boolean => {
	return msg?.key?.remoteJid?.endsWith('@g.us');
}

const extractText = (msg: WAMessage): string => {
	const firstNNOE = (...params: string[]) => {
		for(let p of params)
			if(p)
				return p;
		return null;
	};

	return firstNNOE(
		msg.message?.conversation,
		msg.message?.imageMessage?.caption,
		msg.message?.videoMessage?.caption,
		msg.message?.extendedTextMessage?.text,
		msg.message?.buttonsResponseMessage?.selectedDisplayText,
		msg.message?.listResponseMessage?.title,
		msg.message?.eventMessage?.name
	);
}

const hasImageOrDocument = (msg: WAMessage): boolean => {
    return !!(msg.message?.imageMessage || msg.message?.documentMessage);
}

async function handle(msg: WAMessage): Promise<void> {
	try {
		const text = extractText(msg);
		const isGroup = fromGroup(msg);
		const jid = msg.key.remoteJid;

	if(text) {
		const withCnpj = await safeAsync(() => enrichWithCnpjIfPresent(text), text);
		const finalText = await safeAsync(() => enrichWithCepIfPresent(withCnpj || text), withCnpj || text);
		// Guard: se houver CPF válido e NÃO houver CNPJ válido, solicitar CNPJ
		try {
			const hasCnpj = !!findFirstCnpjInText(finalText);
			const cpf = findFirstCpfInText(finalText);
			if(!hasCnpj && cpf) {
				await sendMessage(jid, 'Entendi o CPF. Para seguirmos, preciso do CNPJ da empresa (14 dígitos). Pode me informar o CNPJ?');
				return;
			}
		} catch {}

        // Se o usuário informou CNPJ nesta mensagem, validar na API, enviar resumo e pedir confirmação
        try {
            const cnpjNow = findFirstCnpjInText(text);
            if(cnpjNow) {
				const result = await safeAsync(() => fetchCnpjData(cnpjNow), { data: null, source: 'error' });
				const { data, source } = result || { data: null, source: 'error' };
                if(data) {
                    // Atualiza ficha com dados da empresa
                    try {
                        const f = loadFicha(jid);
                        f.cnpj = cnpjNow;
                        f.razaoSocial = data?.razao_social || data?.nome || data?.razao || f.razaoSocial;
                        f.situacaoCadastral = data?.descricao_situacao_cadastral || data?.situacao || f.situacaoCadastral;
                        f.endereco = [data?.logradouro, data?.numero, data?.bairro, (data?.municipio||data?.cidade), data?.uf, data?.cep].filter(Boolean).join(', ') || f.endereco;
                        saveFicha(jid, f);
                    } catch {}

                    // Calcula idade da empresa
                    const parseDate = (s: string | undefined): Date | null => {
                        if(!s) return null;
                        // formatos possíveis: YYYY-MM-DD ou DD/MM/YYYY
                        if(/\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
                        const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                        if(m) return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
                        return null;
                    };
                    const startStr = data?.data_inicio_atividade || data?.abertura;
                    const start = parseDate(startStr);
                    const ageMonths = (() => {
                        if(!start) return null;
                        const now = new Date();
                        return (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth());
                    })();

                    const resumo = formatCnpjSummary(data, cnpjNow);
                    // Log no terminal a análise do CNPJ
                    try {
                        console.log('[CNPJ CHECK]', {
                            cnpj: cnpjNow,
                            source,
                            ageMonths,
                            razao: data?.razao_social || data?.nome || data?.razao,
                            situacao: data?.descricao_situacao_cadastral || data?.situacao,
                            municipio: data?.municipio || data?.cidade,
                            uf: data?.uf
                        });
                    } catch {}
                    if(ageMonths !== null && ageMonths < 6) {
                        await sendMessage(jid, `${resumo}\n\nPelo cadastro, a empresa tem menos de 6 meses. No momento não trabalhamos com CNPJs com menos de 6 meses de abertura.`);
                        // segue sem prosseguir oferta
                        return;
                    } else {
                        await sendMessage(jid, `${resumo}\n\nEsses dados conferem com a sua empresa? Posso seguir com a portabilidade/contratação.`);
                        // Marca que já enviou confirmação de CNPJ para evitar processamento duplo
                        return;
                    }
                }
            }
        } catch {}

		// Se o usuário informou CEP nesta mensagem, validar na API, enviar resumo e pedir confirmação
		try {
			const cepNow = findFirstCepInText(text);
			if(cepNow) {
				const result = await safeAsync(() => fetchCepData(cepNow), { data: null, source: 'error' });
				const { data, source } = result || { data: null, source: 'error' };
				if(data) {
					// Atualiza ficha com dados de localização
					try {
						const f = loadFicha(jid);
						f.cep = cepNow;
						f.cidade = data?.city || data?.municipio || f.cidade;
						f.estado = data?.state || data?.uf || f.estado;
						f.bairro = data?.neighborhood || data?.bairro || f.bairro;
						f.endereco = f.endereco || data?.street || data?.logradouro || f.endereco;
						saveFicha(jid, f);
					} catch {}

					const resumoCep = formatCepSummary(data, cepNow);
					try {
						console.log('[CEP CHECK]', { cep: cepNow, source, resumo: resumoCep });
					} catch {}
					await sendMessage(jid, `${resumoCep}\n\nEsses dados conferem? Qual é o número e complemento do endereço para eu validar a instalação e seguir com as opções.`);
					// Marca que já enviou confirmação de CEP para evitar processamento duplo
					return;
				}
			}
		} catch {}
        // Se cliente avisar que enviou documentos, verificar ficha e orientar próximos passos
        try {
            const lower = (finalText || '').toLowerCase();
            if(/enviei|mandei|acabei de enviar|enviado/.test(lower)) {
                // Analisa o histórico para extrair informações perdidas
                analyzeConversationHistory(jid);
                
                const ficha = loadFicha(jid);
                const missing = buildMissingChecklistText(jid);
                
                // Se não há pendências críticas, confirmar que está tudo ok
                if (!missing) {
                    await sendMessage(jid, 'Perfeito! Com todos os dados coletados, vou processar sua solicitação. O setor administrativo entrará em contato para finalizar a formalização.');
                    return;
                }
                
                // Se há pendências, mas são apenas documentos, orientar sobre envio
                const missingArray = missing.split('\n').filter(line => line.trim());
                const onlyDocuments = missingArray.every(item => 
                    item.includes('documento') || 
                    item.includes('contrato') || 
                    item.includes('foto') ||
                    item.includes('representante')
                );
                
                if (onlyDocuments) {
                    await sendMessage(jid, `Entendi que você enviou os documentos. Para finalizarmos, ainda preciso de:\n${missing}\n\nPode me enviar por aqui?`);
                } else {
                    await sendMessage(jid, `Entendi que você enviou os documentos. Para finalizarmos, ainda preciso de:\n${missing}\n\nPode me enviar por aqui?`);
                }
                return;
            }
        } catch {}

        // Se o cliente perguntar "o que falta" ou similar, enviar checklist de pendências da ficha
        try {
            const lower = (finalText || '').toLowerCase();
            if(/\bo que falta\b|\bfalta algo\b|\bfaltando\b|\bpendenc/i.test(lower)) {
                // Analisa o histórico para extrair informações perdidas
                analyzeConversationHistory(jid);
                
                const missing = buildMissingChecklistText(jid);
                const resp = missing
                    ? `Para concluirmos, ainda falta(m):\n${missing}\n\nSe preferir, pode enviar por e-mail: valentimdigitalnegocios@gmail.com e me avisar por aqui.`
                    : 'Ótimo, não há pendências críticas na ficha no momento. Posso avançar para os próximos passos.';
                await sendMessage(jid, resp);
                return;
            }
        } catch {}

        // Atualiza ficha com quaisquer dados reconhecíveis e responde a comandos de ficha
		await safeAsync(() => updateFichaFromText(jid, finalText));
		if(isGroup)
			await safeAsync(() => handleFromGroup(finalText, jid)); else
			await safeAsync(() => handleFromPm(finalText, jid));
		return;
	}

		// Sem texto: se houver mídia, apenas informar e seguir com fluxo padrão
		if(hasImageOrDocument(msg)) {
			// Não é possível confirmar documentos via WhatsApp. Em vez disso, listar pendências da ficha
			const missing = buildMissingChecklistText(jid);
			const msgTxt = missing
				? `Recebi o arquivo. Para proteger seus dados, a validação é feita pelo setor administrativo.\n\nEnquanto isso, falta(m):\n${missing}\n\nSe preferir, pode enviar os documentos para o e-mail corporativo: valentimdigitalnegocios@gmail.com e me avisar aqui para eu seguir.`
				: `Recebi o arquivo. A validação é feita pelo setor administrativo. Se puder, me avise aqui quando enviar também para o e-mail corporativo: valentimdigitalnegocios@gmail.com.`;
			await sendMessage(jid, msgTxt);
		}
	} catch (error) {
		console.log('[HANDLE ERROR]', { jid: msg?.key?.remoteJid, error: error?.message || error });
		// Silencioso: não enviar mensagem de erro para o usuário
	}
}

const extractDigits = (value: string): string => (value || '').replace(/\D+/g, '');

const validateCnpj = (cnpjRaw: string): boolean => {
	const c = extractDigits(cnpjRaw);
	if(c.length !== 14) return false;
	if(/^([0-9])\1{13}$/.test(c)) return false;
	const calc = (base: string, factors: number[]) => {
		let sum = 0;
		for(let i = 0; i < factors.length; i++) sum += parseInt(base.charAt(i), 10) * factors[i];
		const mod = sum % 11;
		return (mod < 2) ? 0 : 11 - mod;
	};
	const d1 = calc(c.substr(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
	const d2 = calc(c.substr(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
	return (parseInt(c.charAt(12), 10) === d1) && (parseInt(c.charAt(13), 10) === d2);
}

const validateCpf = (cpfRaw: string): boolean => {
    const s = extractDigits(cpfRaw);
    if(s.length !== 11) return false;
    if(/^([0-9])\1{10}$/.test(s)) return false;
    const calc = (base: string, factors: number[]) => {
        let sum = 0;
        for(let i = 0; i < factors.length; i++) sum += parseInt(base.charAt(i), 10) * factors[i];
        const mod = sum % 11;
        return (mod < 2) ? 0 : 11 - mod;
    };
    const d1 = calc(s.substr(0, 9), [10,9,8,7,6,5,4,3,2]);
    const d2 = calc(s.substr(0,10), [11,10,9,8,7,6,5,4,3,2]);
    return (parseInt(s.charAt(9), 10) === d1) && (parseInt(s.charAt(10), 10) === d2);
}

const findFirstCnpjInText = (text: string): string => {
	const regex = /\b\d{2}[\.\s-]?\d{3}[\.\s-]?\d{3}[\/\s-]?\d{4}[\s-]?\d{2}\b/g;
	const matches = text ? text.match(regex) : null;
	if(!matches || matches.length === 0) return null as any;
	for(const m of matches) {
		const onlyDigits = extractDigits(m);
		if(validateCnpj(onlyDigits)) return onlyDigits;
	}
	return null as any;
}

const findFirstCpfInText = (text: string): string => {
    const regex = /\b\d{3}[\.\s-]?\d{3}[\.\s-]?\d{3}[\s-]?\d{2}\b/g;
    const matches = text ? text.match(regex) : null;
    if(!matches || matches.length === 0) return null as any;
    for(const m of matches) {
        const onlyDigits = extractDigits(m);
        if(validateCpf(onlyDigits)) return onlyDigits;
    }
    return null as any;
}

const cacheDir = './historical/cache';
const ensureDir = (p: string) => { try { if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); } catch {} };
const readCache = (key: string): any | null => {
    try {
        ensureDir(cacheDir);
        const file = `${cacheDir}/${key}.json`;
        if(!fs.existsSync(file)) return null;
        const stat = fs.statSync(file);
        const ageMs = Date.now() - stat.mtimeMs;
        const maxAge = 24*60*60*1000;
        if(ageMs > maxAge) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return null; }
};
const writeCache = (key: string, value: any) => {
    try {
        ensureDir(cacheDir);
        fs.writeFileSync(`${cacheDir}/${key}.json`, JSON.stringify(value, undefined, 2), 'utf8');
    } catch {}
};

const fetchCnpjData = async (cnpj: string): Promise<{ data: any, source: string }> => {
    const key = `cnpj_${cnpj}`;
    const cached = readCache(key);
    if(cached) return { data: cached, source: 'cache' };
	// 1) Tenta BrasilAPI
	const brasil = await new Promise((resolve) => {
		request.get(
			`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
			{ json: true, timeout: 10000 },
			(err, resp, body) => {
				if(!err && resp && resp.statusCode === 200 && body) return resolve({ ok: true, body });
				return resolve({ ok: false });
			}
		);
	}) as any;
    if(brasil?.ok) { writeCache(key, brasil.body); return { data: brasil.body, source: 'BrasilAPI' }; }

	// 2) Fallback ReceitaWS (terceiro, sujeito a limites)
	const receita = await new Promise((resolve) => {
		request.get(
			`https://www.receitaws.com.br/v1/cnpj/${cnpj}`,
			{ json: true, timeout: 10000 },
			(err, resp, body) => {
				if(!err && resp && resp.statusCode === 200 && body && body.status !== 'ERROR') return resolve({ ok: true, body });
				return resolve({ ok: false });
			}
		);
	}) as any;
    if(receita?.ok) { writeCache(key, receita.body); return { data: receita.body, source: 'ReceitaWS' }; }

	throw new Error('CNPJ lookup failed (BrasilAPI and ReceitaWS)');
}

const formatCnpjSummary = (data: any, cnpj: string): string => {
	const parts = [] as string[];
	parts.push(`CNPJ: ${cnpj}`);
	// Mapeia campos para BrasilAPI e ReceitaWS
	const razao = data?.razao_social || data?.nome || data?.razao;
	const fantasia = data?.nome_fantasia || data?.fantasia;
	const situacao = data?.descricao_situacao_cadastral || data?.situacao;
	const cnaeDesc = data?.cnae_fiscal_descricao || data?.atividade_principal?.[0]?.text;
	const logradouro = data?.logradouro || data?.logradouro || data?.qsa?.logradouro;
	const numero = data?.numero;
	const bairro = data?.bairro;
	const municipio = data?.municipio || data?.municipio || data?.cidade;
	const uf = data?.uf || data?.uf;
	const cep = data?.cep;
	if(razao) parts.push(`Razão Social: ${razao}`);
	if(fantasia) parts.push(`Nome Fantasia: ${fantasia}`);
	if(situacao) parts.push(`Situação: ${situacao}`);
	if(cnaeDesc) parts.push(`CNAE: ${cnaeDesc}`);
	const endereco = [logradouro, numero, bairro, municipio, uf, cep].filter(Boolean).join(', ');
	if(endereco) parts.push(`Endereço: ${endereco}`);
	return parts.join(' | ');
}

const writeCnpjAudit = (jid: string, cnpj: string, source: string) => {
	try {
		const line = `${new Date().toISOString()}\t${jid}\t${cnpj}\t${source}\n`;
		fs.appendFileSync('./historical/cnpj_audit.log', line, 'utf8');
	} catch {}
}

const enrichWithCnpjIfPresent = async (text: string): Promise<string> => {
	try {
		const cnpj = findFirstCnpjInText(text);
		if(!cnpj) return text;
		const result = await fetchCnpjData(cnpj).catch(() => null);
		if(!result) return text;
		writeCnpjAudit((this_sock as any)?.user?.id || 'unknown', cnpj, result.source);
		const resumo = formatCnpjSummary(result.data, cnpj);
		return `${text}\n\n[Dados CNPJ verificados]\n${resumo}`;
	} catch {
		return text;
	}
}

// ===== CEP detection, lookup (BrasilAPI -> ViaCEP fallback), audit and enrichment =====
const normalizeCep = (cep: string): string => extractDigits(cep);

const isValidCep = (cep: string): boolean => {
    const d = normalizeCep(cep);
    return /^\d{8}$/.test(d);
}

const findFirstCepInText = (text: string): string => {
    if(!text) return null as any;
    const regex = /\b\d{5}[-\s]?\d{3}\b|\b\d{8}\b/g;
    const matches = text.match(regex);
    if(!matches) return null as any;
    for(const m of matches) {
        const d = normalizeCep(m);
        if(isValidCep(d)) return d;
    }
    return null as any;
}

const fetchCepData = async (cep8: string): Promise<{ data: any, source: string }> => {
    const key = `cep_${cep8}`;
    const cached = readCache(key);
    if(cached) return { data: cached, source: 'cache' };
    // 1) Try BrasilAPI
    const brasil = await new Promise((resolve) => {
        request.get(
            `https://brasilapi.com.br/api/cep/v1/${cep8}`,
            { json: true, timeout: 10000 },
            (err, resp, body) => {
                if(!err && resp && resp.statusCode === 200 && body) return resolve({ ok: true, body });
                return resolve({ ok: false, status: resp?.statusCode });
            }
        );
    }) as any;
    if(brasil?.ok) { writeCache(key, brasil.body); return { data: brasil.body, source: 'BrasilAPI' };
    }

    // 2) Fallback ViaCEP
    const via = await new Promise((resolve) => {
        request.get(
            `https://viacep.com.br/ws/${cep8}/json/`,
            { json: true, timeout: 10000 },
            (err, resp, body) => {
                if(!err && resp && resp.statusCode === 200 && body && body.erro !== true) return resolve({ ok: true, body });
                return resolve({ ok: false });
            }
        );
    }) as any;
    if(via?.ok) {
        const mapped = {
            cep: cep8,
            state: via.body.uf,
            city: via.body.localidade,
            neighborhood: via.body.bairro,
            street: via.body.logradouro
        };
        writeCache(key, mapped);
        return { data: mapped, source: 'ViaCEP' };
    }

    throw new Error('CEP lookup failed (BrasilAPI and ViaCEP)');
}

const formatCepHuman = (cep8: string): string => `${cep8.slice(0,5)}-${cep8.slice(5)}`;

const formatCepSummary = (data: any, cep8: string): string => {
    const parts = [] as string[];
    parts.push(`CEP: ${formatCepHuman(cep8)}`);
    const uf = data?.state || data?.uf;
    const city = data?.city || data?.municipio;
    const neighborhood = data?.neighborhood || data?.bairro;
    const street = data?.street || data?.logradouro;
    if(uf) parts.push(`UF: ${uf}`);
    if(city) parts.push(`Cidade: ${city}`);
    if(neighborhood) parts.push(`Bairro: ${neighborhood}`);
    if(street) parts.push(`Logradouro: ${street}`);
    return parts.join(' | ');
}

const writeCepAudit = (jid: string, cep8: string, source: string) => {
    try {
        const line = `${new Date().toISOString()}\t${jid}\t${formatCepHuman(cep8)}\t${source}\n`;
        fs.appendFileSync('./historical/cep_audit.log', line, 'utf8');
    } catch {}
}

const enrichWithCepIfPresent = async (text: string): Promise<string> => {
    try {
        const cep = findFirstCepInText(text);
        if(!cep) return text;
        const result = await fetchCepData(cep).catch(() => null);
        if(!result) return text;
        writeCepAudit((this_sock as any)?.user?.id || 'unknown', cep, result.source);
        const resumo = formatCepSummary(result.data, cep);
        return `${text}\n\n[CEP verificado]\n${resumo}`;
    } catch {
        return text;
    }
}

export = {
	init,
    handle,
    ingestTextSilently
};

// ================== FICHA: extração, persistência e exibição ==================

type FichaEmpresa = {
    data?: string;
    consultor?: string;
    // Empresa
    razaoSocial?: string;
    cnpj?: string;
    inscricaoEstadual?: string;
    situacaoCadastral?: string;
    // Contato
    representanteLegal?: string;
    rg?: string;
    cpf?: string;
    email?: string;
    telefone1?: string;
    telefone2?: string;
    endereco?: string;
    complemento?: string;
    cep?: string;
    bairro?: string;
    pontoReferencia?: string;
    cidade?: string;
    estado?: string;
    vencimento?: string; // dia
    // Plano
    portabilidade?: string; // Sim/Não
    operadora?: string;
    numeroPortado?: string;
    migracaoTimParaTim?: boolean; // Flag para migração TIM->TIM (não fazemos)
    nomeCedente?: string;
    cpfCedente?: string;
    totalAcessos?: string;
    plano?: string; // e.g., TIM Black Empresa III
    nomenclaturaPlano?: string;
    dataVencimento?: string;
    fastChip?: string; // Sim/Não
};

const fichaFile = (jid: string) => `./historical/ficha.${sanitizeFile(jid)}.json`;

const sanitizeFile = (name: string) => (name || '').replace(/[^a-zA-Z0-9_.-]/g, '_');

const loadFicha = (jid: string): FichaEmpresa => {
    try {
        return JSON.parse(fs.readFileSync(fichaFile(jid), 'utf8')) as FichaEmpresa;
    } catch {
        return {} as FichaEmpresa;
    }
}

const saveFicha = (jid: string, ficha: FichaEmpresa) => {
    try {
        fs.writeFileSync(fichaFile(jid), JSON.stringify(ficha, undefined, 2), 'utf8');
    } catch {}
}

const tryHandleFichaCommands = async (text: string, jid: string): Promise<boolean> => {
    const lower = (text || '').toLowerCase();
    const isFichaCmd = /(\bficha\b|\bstatus\b|\bprogresso\b)/.test(lower);
    // Não responder mais com a ficha; apenas sinaliza que não tratou
    return false;
}

const renderFicha = async (ficha: FichaEmpresa): Promise<string> => {
    let template = '';
    try {
        template = fs.readFileSync('templates/ficha_tim.txt', 'utf8');
    } catch {
        // fallback: gerar uma versão direta
        return formatFichaPlain(ficha);
    }
    // Como o template é texto livre, apenas anexamos valores ao final de cada linha conhecida
    const fill = (label: string, value?: string) => value ? `${label} ${value}` : label;
    const lines = template.split(/\r?\n/).map(line => {
        const l = line.trimEnd();
        switch(true) {
            case /^DATA:/.test(l): return fill('DATA:', ficha.data);
            case /^CONSULTOR:/.test(l): return fill('CONSULTOR:', ficha.consultor);
            case /^Razão Social:/.test(l): return fill('Razão Social:', ficha.razaoSocial);
            case /^CNPJ:/.test(l): return fill('CNPJ:', ficha.cnpj);
            case /^Inscrição Estadual:|^Inscricao Estadual:|^Inscrição Estadual:/.test(l): return fill('Inscrição Estadual:', ficha.inscricaoEstadual);
            case /^Situação Cadastral:/.test(l): return fill('Situação Cadastral:', ficha.situacaoCadastral);
            case /^Representante Legal:/.test(l): return fill('Representante Legal:', ficha.representanteLegal);
            case /^RG:/.test(l): return fill('RG:', ficha.rg);
            case /^CPF:/.test(l): return fill('CPF:', ficha.cpf);
            case /^E-mail:/.test(l): return fill('E-mail:', ficha.email);
            case /^Telefone 1:/.test(l): return fill('Telefone 1:', ficha.telefone1);
            case /^Telefone 2:/.test(l): return fill('Telefone 2:', ficha.telefone2);
            case /^Endereço:/.test(l): return fill('Endereço:', ficha.endereco);
            case /^Complemento:/.test(l): return fill('Complemento:', ficha.complemento);
            case /^CEP:|^Cep:/.test(l): return fill('CEP:', ficha.cep);
            case /^Bairro:/.test(l): return fill('Bairro:', ficha.bairro);
            case /^Ponto de Referência:/.test(l): return fill('Ponto de Referência:', ficha.pontoReferencia);
            case /^Cidade:/.test(l): return fill('Cidade:', ficha.cidade);
            case /^Estado:/.test(l): return fill('Estado:', ficha.estado);
            case /^VENCIMENTO:/.test(l): return fill('VENCIMENTO:', ficha.vencimento);
            case /^Operadora:/.test(l): return fill('Operadora:', ficha.operadora);
            case /^Número a ser portado:|^NÚMERO A SER PORTADO/.test(l): return fill('Número a ser portado:', ficha.numeroPortado);
            case /^Nome do Cedente:/.test(l): return fill('Nome do Cedente:', ficha.nomeCedente);
            case /^CPF do Cedente:|^CPF DO CEDENTE/.test(l): return fill('CPF do Cedente:', ficha.cpfCedente);
            case /^Total de acessos:/.test(l): return fill('Total de acessos:', ficha.totalAcessos);
            case /^Plano:/.test(l): return fill('Plano:', ficha.plano);
            case /^Nomenclatura do plano:|^NOMENCLATURA DO PLANO/.test(l): return fill('Nomenclatura do plano:', ficha.nomenclaturaPlano);
            case /^Data de vencimento:/.test(l): return fill('Data de vencimento:', ficha.dataVencimento);
            default: return l;
        }
    });
    // tratar Portabilidade e FAST CHIP como blocos
    let text = lines.join('\n');
    if(/Portabilidade:/.test(text)) {
        text = text.replace(/Portabilidade:[^\n]*/i, `Portabilidade: ${ficha.portabilidade || ''}`);
    }
    if(/FAST CHIP/i.test(text)) {
        text = text.replace(/FAST CHIP[\s\S]*/i, `FAST CHIP\nSim ( ${ficha.fastChip === 'Sim' ? 'X' : ' '} )\nNão ( ${ficha.fastChip === 'Não' ? 'X' : ' '} )`);
    }
    return text;
}

const formatFichaPlain = (f: FichaEmpresa): string => {
    const val = (v?: string) => v || '';
    return [
        'FICHA TIM',
        `DATA: ${val(f.data)}`,
        `CONSULTOR: ${val(f.consultor)}`,
        '',
        'DADOS DA EMPRESA:',
        `Razão Social: ${val(f.razaoSocial)}`,
        `CNPJ: ${val(f.cnpj)}`,
        `Inscrição Estadual: ${val(f.inscricaoEstadual)}`,
        `Situação Cadastral: ${val(f.situacaoCadastral)}`,
        '',
        'DADOS DO CONTATO',
        `Representante Legal: ${val(f.representanteLegal)}`,
        `RG: ${val(f.rg)}`,
        `CPF: ${val(f.cpf)}`,
        `E-mail: ${val(f.email)}`,
        `Telefone 1: ${val(f.telefone1)}`,
        `Telefone 2: ${val(f.telefone2)}`,
        `Endereço: ${val(f.endereco)}`,
        `Complemento: ${val(f.complemento)}`,
        `CEP: ${val(f.cep)}`,
        `Bairro: ${val(f.bairro)}`,
        `Ponto de Referência: ${val(f.pontoReferencia)}`,
        `Cidade: ${val(f.cidade)}`,
        `Estado: ${val(f.estado)}`,
        '',
        `VENCIMENTO: ${val(f.vencimento)}`,
        '',
        'INFORMAÇÕES DO PLANO',
        `Portabilidade: ${val(f.portabilidade)}`,
        `Operadora: ${val(f.operadora)}`,
        `Número a ser portado: ${val(f.numeroPortado)}`,
        '',
        'CASO SEJA TROCA DE TITULARIDADE (TT) / PORTABILIDADE:',
        `Nome do Cedente: ${val(f.nomeCedente)}`,
        `CPF do Cedente: ${val(f.cpfCedente)}`,
        '',
        `Total de acessos: ${val(f.totalAcessos)}`,
        `Plano: ${val(f.plano)}`,
        `Nomenclatura do plano: ${val(f.nomenclaturaPlano)}`,
        `Data de vencimento: ${val(f.dataVencimento)}`,
        '',
        'FAST CHIP',
        `Sim (${f.fastChip === 'Sim' ? 'X' : ' '})`,
        `Não (${f.fastChip === 'Não' ? 'X' : ' '})`,
    ].join('\n');
}

const buildFichaContext = (jid: string): string => {
    const f = loadFicha(jid);
    const pairs: Array<[string, string | undefined]> = [
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
        ['Migração TIM-TIM', f.migracaoTimParaTim ? 'Sim (não fazemos)' : 'Não'],
        ['Cedente', f.nomeCedente],
        ['CPF Cedente', f.cpfCedente],
        ['Acessos', f.totalAcessos],
        ['Plano', f.plano],
        ['Nomenclatura', f.nomenclaturaPlano],
        ['Fast Chip', f.fastChip]
    ];
    const filled = pairs.filter(([_, v]) => !!v).map(([k, v]) => `${k}: ${v}`);
    
    // Adiciona contexto adicional sobre o que já foi discutido
    let contextInfo = '';
    if (f.cnpj && f.razaoSocial) {
        contextInfo += ` | EMPRESA CONFIRMADA: ${f.razaoSocial} (${f.cnpj})`;
    }
    if (f.cep && f.cidade) {
        contextInfo += ` | LOCALIZAÇÃO: ${f.cidade}/${f.estado} - CEP ${f.cep}`;
    }
    if (f.plano || f.nomenclaturaPlano) {
        contextInfo += ` | PLANO ESCOLHIDO: ${f.plano || f.nomenclaturaPlano}`;
    }
    if (f.portabilidade === 'Sim') {
        contextInfo += ` | PORTABILIDADE: Sim (${f.operadora || 'operadora não informada'})`;
    }
    if (f.email) {
        contextInfo += ` | EMAIL: ${f.email}`;
    }
    if (f.vencimento || f.dataVencimento) {
        contextInfo += ` | VENCIMENTO: ${f.vencimento || f.dataVencimento}`;
    }
    
    return filled.length ? filled.join(' | ') + contextInfo : contextInfo;
}

// Sistema de Métricas
const trackMetric = (jid: string, event: string, data: any = {}) => {
    try {
        const metricsFile = './historical/metrics.json';
        let metrics = [];
        
        try {
            metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
        } catch {
            metrics = [];
        }
        
        const metric = {
            timestamp: Date.now(),
            date: new Date().toISOString().split('T')[0],
            jid: jid.replace('@s.whatsapp.net', '').replace('@lid', ''),
            event,
            data,
            hour: new Date().getHours()
        };
        
        metrics.push(metric);
        
        // Manter apenas últimos 1000 registros
        if (metrics.length > 1000) {
            metrics = metrics.slice(-1000);
        }
        
        fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
        console.log('[METRIC]', event, jid, data);
    } catch (error) {
        console.log('[METRIC ERROR]', error);
    }
};

// Permite ingestão de texto para atualizar a ficha sem gerar resposta no chat
async function ingestTextSilently(jid: string, text: string | undefined): Promise<void> {
    if(!text) return;
    await updateFichaFromText(jid, text);
}

const updateFichaFromText = async (jid: string, text: string): Promise<void> => {
    if(!text) return;
    const f = loadFicha(jid);
    const setIf = (k: keyof FichaEmpresa, v?: string) => {
        if(!v) return;
        if(!f[k]) (f as any)[k] = v;
    };
    const setIfBool = (k: keyof FichaEmpresa, v?: boolean) => {
        if(v === undefined) return;
        if(!f[k]) (f as any)[k] = v;
    };
    // Regex básicas
    const m = (re: RegExp) => (text.match(re) || [])[1];
    // e-mail básico
    const email = m(/\b([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/);
    if(email && /^[^@]{1,64}@.{3,255}$/.test(email)) setIf('email', email);
    // CEP: valida 8 dígitos
    const cepCap = m(/\b(\d{5}[-\s]?\d{3}|\d{8})\b/);
    const cep8 = cepCap ? cepCap.replace(/\D+/g,'') : undefined;
    if(cep8 && /^\d{8}$/.test(cep8)) setIf('cep', cep8);
    // CNPJ com DV
    const cnpjCap = m(/\b(\d{2}[\.\s-]?\d{3}[\.\s-]?\d{3}[\/.\s-]?\d{4}[\s-]?\d{2})\b/);
    const cnpjDigits = cnpjCap ? cnpjCap.replace(/\D+/g,'') : undefined;
    if(cnpjDigits && validateCnpj(cnpjDigits)) setIf('cnpj', cnpjDigits);
    // CPF com DV simples
    const cpfCap = m(/\b(\d{3}[\.\s-]?\d{3}[\.\s-]?\d{3}[\s-]?\d{2})\b/);
    const cpfDigits = cpfCap ? cpfCap.replace(/\D+/g,'') : undefined;
    if(cpfDigits && validateCpf(cpfDigits)) setIf('cpf', cpfDigits);
    setIf('telefone1', m(/(?:tel|telefone|contato)\s*[:\-]?\s*(\+?\d{10,15})/i));
    
    // MELHORADO: Detecção de data de vencimento mais robusta
    const vencimentoMatch = m(/venc(?:imento)?\s*[:\-]?\s*(\d{1,2})/i) || m(/\b(\d{1,2})\b.*vencimento/i) || m(/data\s*de\s*vencimento\s*[:\-]?\s*(\d{1,2})/i);
    if(vencimentoMatch) {
        setIf('vencimento', vencimentoMatch);
        setIf('dataVencimento', vencimentoMatch);
    }
    
    // MELHORADO: Detecção de portabilidade mais robusta
    if(/\bportabilidade\b/i.test(text) || /\bportar\b/i.test(text) || /\btrazer\s*número\b/i.test(text)) {
        setIf('portabilidade', /(\bn[aã]o\b)/i.test(text) ? 'Não' : 'Sim');
        setIf('operadora', m(/operadora\s*[:\-]?\s*([A-Za-zÀ-ÿ\s]+)/i));
        setIf('numeroPortado', m(/(\+?\d{10,15})/));
        
        // Detectar migração TIM para TIM (não fazemos)
        const operadora = m(/operadora\s*[:\-]?\s*([A-Za-zÀ-ÿ\s]+)/i);
        if(operadora && /tim/i.test(operadora)) {
            setIfBool('migracaoTimParaTim', true); // flag especial para migração
        }
    }
    
    // MELHORADO: Detecção de número de linhas mais robusta
    const linhasMatch = m(/(\d+)\s*(?:linhas?|chips?|acessos?|números?)/i) || m(/(\d+)\s*(?:fofas?|linhas?)/i);
    if(linhasMatch) {
        setIf('totalAcessos', linhasMatch);
    }
    
    // Fast chip
    if(/fast\s*chip/i.test(text)) setIf('fastChip', /(\bn[aã]o\b)/i.test(text) ? 'Não' : 'Sim');
    // Nomes/endereços (heurística leve)
    setIf('razaoSocial', m(/raz[aã]o\s*social\s*[:\-]?\s*(.+)/i));
    setIf('representanteLegal', m(/representante\s*legal\s*[:\-]?\s*([\wÀ-ÿ\s]+)/i));
    // Endereço e número/complemento a partir de texto livre
    const addr = m(/endere[cç]o\s*[:\-]?\s*([^\n]+)/i) || m(/rua\s*[:\-]?\s*([^\n]+)/i) || m(/logradouro\s*[:\-]?\s*([^\n]+)/i);
    const numero = m(/n[uú]mero\s*[:\-]?\s*(\w+)/i) || m(/\b(\d{1,5}[A-Za-z]?)\b(?=\s*(?:apto|apt\.|bloco|cj|casa|fundos|complemento|,|$))/i);
    const compl = m(/complemento\s*[:\-]?\s*([^\n]+)/i) || m(/\b(apto\.?\s*\w+|bloco\s*\w+|casa\s*\w+|fundos|sobrado|loja\s*\w+)\b/i);
    if(addr || numero || compl) {
        const parts = [addr, numero, compl].filter(Boolean).join(', ');
        setIf('endereco', parts);
        if(compl) setIf('complemento', compl);
    }
    setIf('bairro', m(/bairro\s*[:\-]?\s*(.+)/i));
    setIf('cidade', m(/cidade\s*[:\-]?\s*([\wÀ-ÿ\s]+)/i));
    setIf('estado', m(/estado\s*[:\-]?\s*([A-Za-z]{2})/i));
    
    // MELHORADO: Detecção de planos e valores mais robusta
    const price = m(/(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})/i);
    const fibraSpeed = m(/\b(\d+\s*(?:giga|mega))\b/i);
    const mobileData = m(/\b(\d+\s*gb)\b/i);
    
    // Detectar planos móveis
    if(/black\s*empresa/i.test(text) || mobileData) {
        if(mobileData) setIf('plano', `TIM Black Empresa ${mobileData.toUpperCase ? mobileData.toUpperCase() : mobileData}`);
        if(price) setIf('nomenclaturaPlano', `${price}`);
    }
    
    // Detectar planos de fibra
    if(fibraSpeed || /\bfibra\b/i.test(text)) {
        if(fibraSpeed) setIf('plano', `Fibra ${fibraSpeed.toUpperCase ? fibraSpeed.toUpperCase() : fibraSpeed}`);
        if(price) setIf('nomenclaturaPlano', `${price}`);
    }

    saveFicha(jid, f);
}

// Analisa o histórico da conversa para extrair informações perdidas
const analyzeConversationHistory = (jid: string): void => {
    try {
        const histFilename = `historical/hist.${jid.replace('@s.whatsapp.net', '@s.whatsapp.net')}.json`;
        if (!fs.existsSync(histFilename)) return;
        
        const history = JSON.parse(fs.readFileSync(histFilename, 'utf8')) as Array<{role: string, text: string}>;
        const f = loadFicha(jid);
        let updated = false;
        
        // Analisa todas as mensagens do histórico
        for (const msg of history) {
            const text = msg.text || '';
            
            // Extrai informações que podem ter sido perdidas
            // Data de vencimento
            if (!f.vencimento && !f.dataVencimento) {
                const vencMatch = text.match(/\b(\d{1,2})\b.*vencimento/i) || text.match(/vencimento.*?(\d{1,2})/i);
                if (vencMatch) {
                    f.vencimento = vencMatch[1];
                    f.dataVencimento = vencMatch[1];
                    updated = true;
                }
            }
            
            // Número de linhas
            if (!f.totalAcessos) {
                const linhasMatch = text.match(/(\d+)\s*(?:linhas?|chips?|acessos?|fofas?)/i);
                if (linhasMatch) {
                    f.totalAcessos = linhasMatch[1];
                    updated = true;
                }
            }
            
            // Plano e valores
            if (!f.plano) {
                if (text.includes('50gb') || text.includes('50 gb')) {
                    f.plano = 'TIM Black Empresa 50GB';
                    updated = true;
                } else if (text.includes('100gb') || text.includes('100 gb')) {
                    f.plano = 'TIM Black Empresa 100GB';
                    updated = true;
                } else if (text.includes('150gb') || text.includes('150 gb')) {
                    f.plano = 'TIM Black Empresa 150GB';
                    updated = true;
                }
            }
            
            // Valor do plano
            if (!f.nomenclaturaPlano) {
                const priceMatch = text.match(/(R\$\s?\d{1,3}(?:\.\d{3})*,\d{2})/i);
                if (priceMatch) {
                    f.nomenclaturaPlano = priceMatch[1];
                    updated = true;
                }
            }
            
            // Portabilidade
            if (!f.portabilidade) {
                if (text.includes('portabilidade') || text.includes('portar') || text.includes('trazer número')) {
                    f.portabilidade = text.includes('não') ? 'Não' : 'Sim';
                    updated = true;
                }
            }
        }
        
        if (updated) {
            saveFicha(jid, f);
            console.log('[HISTORY ANALYSIS]', { jid, updated: true });
        }
    } catch (error) {
        console.log('[HISTORY ANALYSIS ERROR]', { jid, error: error?.message });
    }
};

// Monta checklist resumido do que ainda falta na ficha
function buildMissingChecklistText(jid: string): string {
    const f = loadFicha(jid);
    const missing: string[] = [];
    
    // Informações básicas obrigatórias
    if(!f.cnpj) missing.push('- CNPJ (14 dígitos)');
    if(!f.razaoSocial) missing.push('- Razão Social');
    if(!f.cep) missing.push('- CEP de instalação');
    if(!f.endereco) missing.push('- Endereço com número e complemento');
    if(!f.email) missing.push('- E-mail de contato/financeiro');
    
    // Portabilidade - só pedir se não foi mencionada
    if(!f.portabilidade) missing.push('- Portabilidade (Sim/Não)');
    
    // Detalhes de portabilidade - só pedir se portabilidade = Sim
    if(f.portabilidade === 'Sim') {
        if(!f.operadora) missing.push('- Operadora atual');
        if(!f.numeroPortado) missing.push('- Número(s) a portar');
    }
    
    // Plano e valores - só pedir se não foi mencionado
    if(!f.plano) missing.push('- Plano escolhido (Fibra/Móvel)');
    if(!f.nomenclaturaPlano) missing.push('- Valor do plano');
    
    // Data de vencimento - só pedir se não foi mencionada
    if(!f.vencimento && !f.dataVencimento) missing.push('- Data de vencimento desejada');
    
    // Total de acessos - só pedir se não foi mencionado
    if(!f.totalAcessos) missing.push('- Total de acessos (linhas)');
    
    return missing.join('\n');
}

