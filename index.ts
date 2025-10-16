import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import makeWASocket, { AnyMessageContent, delay, DisconnectReason, fetchLatestBaileysVersion, getAggregateVotesInPollMessage, makeCacheableSignalKeyStore, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey } from '@whiskeysockets/baileys';
import MAIN_LOGGER from '@whiskeysockets/baileys/lib/Utils/logger';
import fs from 'fs';

import ValentinaBOT from './ValentinaBOT';

// Tratamento global de promises rejeitadas
process.on('unhandledRejection', (reason, promise) => {
	console.log('[UNHANDLED REJECTION]', { reason, promise });
	// Não fazer throw para evitar crash
});

const logger = MAIN_LOGGER.child({});
logger.level = 'fatal';

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

// Cache para evitar processamento duplo de mensagens
const processedMessages = new NodeCache({ stdTTL: 300 }); // 5 minutos

// Sistema de reconexão com backoff exponencial
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseDelay = 5000; // 5 segundos

const getReconnectDelay = () => {
	const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), 300000); // máximo 5 minutos
	return delay + Math.random() * 1000; // adiciona jitter
};

// start a connection
const startSock = async() => {
	try {
		const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: true,
		browser: ["ValentinaBOT", "Chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.35"],
		auth: {
			creds: state.creds,
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		generateHighQualityLinkPreview: false,
		// Configurações otimizadas para resolver Connection Failure e conflitos
		connectTimeoutMs: 30_000,
		defaultQueryTimeoutMs: 30_000,
		keepAliveIntervalMs: 10_000,
		retryRequestDelayMs: 2000,
		maxMsgRetryCount: 3,
		markOnlineOnConnect: false,
		syncFullHistory: false,
		fireInitQueries: false,
		shouldSyncHistoryMessage: () => false,
		// Configurações para evitar conflitos de sessão
		shouldIgnoreJid: (jid) => {
			// Ignorar grupos de status e broadcasts desnecessários
			return jid.includes('status@broadcast') || jid.includes('newsletter');
		},
		// implement to handle retries & poll updates
		getMessage
	})

	// the process function lets you process all events that just occurred
	// efficiently in a batch
		sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			//console.log(JSON.stringify(events, undefined, 2));
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						if(reconnectAttempts < maxReconnectAttempts) {
							reconnectAttempts++;
							const delay = getReconnectDelay();
							console.log(`[RECONNECT] Tentativa ${reconnectAttempts}/${maxReconnectAttempts} em ${Math.round(delay/1000)}s...`);
							setTimeout(() => {
								startSock();
							}, delay);
						} else {
							console.log('[RECONNECT] Máximo de tentativas atingido. Parando reconexão automática.');
							reconnectAttempts = 0; // reset para próxima execução manual
						}
					} else {
						console.log('Connection closed. You are logged out.')
						reconnectAttempts = 0; // reset contador
					}
				}
				
				if(connection === 'open') {
					reconnectAttempts = 0; // reset contador em conexão bem-sucedida
					console.log('[CONNECTED] Conexão estabelecida com sucesso!');
					ValentinaBOT.init(sock);
				}

				console.log('connection update', update)
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
			}

			/*if(events['labels.association']) {
				console.log(events['labels.association'])
			}


			if(events['labels.edit']) {
				console.log(events['labels.edit'])
			}

			if(events.call) {
				console.log('recv call event', events.call)
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest } = events['messaging-history.set']
				console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest})`)
			}*/

			// received a new message
			if(events['messages.upsert']) {
				const upsert = events['messages.upsert']
				//console.log('recv messages ', upsert)//JSON.stringify(upsert, undefined, 2))
				//console.log(JSON.stringify(upsert, undefined, 2));
				const isRecent = (msg: any): boolean => {
					try {
						const tsSec = Number((msg as any)?.messageTimestamp);
						if(!tsSec || isNaN(tsSec)) return false; // sem timestamp, não processa (evita duplicação)
						const tsMs = tsSec < 1e12 ? tsSec * 1000 : tsSec; // lida com segundos ou ms
						const now = Date.now();
						const maxAgeMs = 2 * 60 * 1000; // 2 minutos
						return (now - tsMs) <= maxAgeMs;
					} catch { return false; }
				};

				// ===== Human takeover: silenciar conversa quando houver mensagem "fromMe" =====
				const humanLockMap = HumanLock.getInstance();
				const getText = (m: any): string | undefined => {
					try {
						return m?.message?.conversation
							|| m?.message?.extendedTextMessage?.text
							|| m?.message?.imageMessage?.caption
							|| m?.message?.videoMessage?.caption;
					} catch { return undefined; }
				};
const normalize = (s?: string) => (s || '')
	.replace(/[\u200B\u200C\u200D\u2060]/g, '') // zero-width
	.normalize('NFD').replace(/\p{Diacritic}+/gu, '')
	.toLowerCase();

// Normaliza JID para lidar com LID - tenta obter o número real quando possível
const normalizeJid = (jid: string, msg?: any): string => {
	if (!jid) return jid;
	
	// Se já é um JID normal (@s.whatsapp.net), retorna como está
	if (jid.includes('@s.whatsapp.net')) {
		return jid;
	}
	
	// Se é LID, tenta obter o JID alternativo
	if (jid.includes('@lid')) {
		const jidAlt = msg?.key?.remoteJidAlt;
		if (jidAlt && jidAlt.includes('@s.whatsapp.net')) {
			console.log('[LID MAPPING]', { original: jid, mapped: jidAlt });
			return jidAlt;
		}
		
		// Se não conseguiu mapear, mantém o LID mas adiciona flag
		console.log('[LID WARNING]', { jid, message: 'Não foi possível mapear LID para número' });
		return jid;
	}
	
	return jid;
};

				if(upsert.type === 'notify')
						for(const msg of upsert.messages) {
							const originalJid = msg.key.remoteJid;
							const jid = normalizeJid(originalJid, msg);
							// Log básico de cada mensagem recebida com suporte a LID 
							try {
								const preview = getText(msg);
								const jidAlt = (msg as any)?.key?.remoteJidAlt || jid;
								const isLid = jid?.includes('@lid');
								console.log('[MSG RECV]', {
									originalJid,
									normalizedJid: jid,
									jidAlt,
									isLid: originalJid?.includes('@lid'),
									fromMe: !!msg.key.fromMe,
									text: preview,
									ts: (msg as any)?.messageTimestamp
								});
							} catch {}
							if(msg.key.fromMe) {
								// Qualquer mensagem enviada pelo próprio número ativa o lock por 15 minutos
								const raw = getText(msg) || '';
								const text = normalize(raw);
								// Frases naturais para toggle do modo silencioso (sem expor comandos)
								// Desativar (silencioso): exemplos "estou iniciando", "estou iniciando seu atendimento", "estou começando"
								if(/\bestou\s+(iniciando|começando)\b/i.test(text) || 
								   /\b(iniciando|começando)\s+seu\s+atendimento\b/i.test(text) ||
								   /\bestou\s+(iniciando|começando)\s+seu\s+atendimento\b/i.test(text)) {
									console.log('[IA DESATIVADA]', { jid, motivo: 'takeover humano', frase: text });
									BotSwitch.disable(jid);
									// também trava por 15 min para takeover humano
									HumanLock.lock(jid, 60);
									continue;
								}
								// Reativar (voltar a responder): "estou a disposicao", "estou a disposição"
								if(/\bestou\s+a\s+disposicao\b/i.test(text) || /\bestou\s+\w*disposicao\b/i.test(text)) {
									console.log('[IA ATIVADA]', { jid, motivo: 'volta ao atendimento', frase: text });
									BotSwitch.enable(jid);
									HumanLock.clear(jid);
									continue;
								}
								if(text.includes('#liberar')) {
									HumanLock.clear(jid);
								} else {
									// #assumir força o lock; sem comando também bloqueia por activity
									HumanLock.lock(jid, 60);
								}
								continue;
							}

							// Se não é fromMe, processa somente se não estiver sob lock humano
							if(jid && HumanLock.isLocked(jid)) {
								// Silenciado por atendimento humano: ingerir texto para manter contexto e seguir
								console.log('[IA SILENCIADA]', { jid, motivo: 'lock humano ativo', text: getText(msg) });
								try {
									const silentText = getText(msg);
									if(silentText) (ValentinaBOT as any).ingestTextSilently(jid, silentText);
								} catch {}
								continue;
							}

							// Modo silencioso por JID (sem travar): ingerir contexto, não responder
							if(jid && BotSwitch.isDisabled(jid)) {
								console.log('[IA SILENCIADA]', { jid, motivo: 'modo silencioso ativo', text: getText(msg) });
								try {
									const silentText = getText(msg);
									if(silentText) (ValentinaBOT as any).ingestTextSilently(jid, silentText);
								} catch {}
								continue;
							}

                            // Processa mensagens de qualquer JID (sem whitelist fixa)
                            if(jid) {
                                if(isRecent(msg)) {
                                    // Verifica se já processou esta mensagem para evitar duplicação
                                    const msgId = msg.key.id;
                                    const msgKey = `${jid}_${msgId}`;
                                    
                                    if(processedMessages.get(msgKey)) {
                                        console.log('[IA IGNORANDO]', { jid, motivo: 'mensagem já processada', msgId });
                                        continue;
                                    }
                                    
                                    // Marca como processada
                                    processedMessages.set(msgKey, true);
                                    
                                    console.log('[IA PROCESSANDO]', { jid, text: getText(msg), msgId });
                                    try {
                                        await ValentinaBOT.handle(msg);
                                    } catch (error) {
                                        console.log('[VALENTINA HANDLE ERROR]', { jid, error: error?.message || error });
                                    }
                                } else {
                                    // Ignora mensagens antigas para evitar respostas em massa pós-reconexão
                                    console.log('[IA IGNORANDO]', { jid, motivo: 'mensagem antiga', text: getText(msg) });
                                }
                            }
						}
			}

			// messages updated like status delivered, message deleted etc.
			/*if(events['messages.update']) {
				console.log(
					JSON.stringify(events['messages.update'], undefined, 2)
				)

				for(const { key, update } of events['messages.update']) {
					if(update.pollUpdates) {
						const pollCreation = await getMessage(key)
						if(pollCreation) {
							console.log(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							)
						}
					}
				}
			}

			if(events['message-receipt.update']) {
				console.log(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				console.log(events['messages.reaction'])
			}

			if(events['presence.update']) {
				console.log(events['presence.update'])
			}

			if(events['chats.update']) {
				console.log(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						console.log(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						)
					}
				}
			}

			if(events['chats.delete']) {
				console.log('chats deleted ', events['chats.delete'])
			}*/
		}
	)

	return sock

	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		return {} as WAMessageContent;
	}
	} catch (error) {
		console.log('[START SOCK ERROR]', { error: error?.message || error });
		// Em caso de erro, tenta reconectar após delay
		if(reconnectAttempts < maxReconnectAttempts) {
			reconnectAttempts++;
			const delay = getReconnectDelay();
			console.log(`[ERROR RECONNECT] Tentativa ${reconnectAttempts}/${maxReconnectAttempts} em ${Math.round(delay/1000)}s...`);
			setTimeout(() => {
				startSock();
			}, delay);
		} else {
			console.log('[ERROR RECONNECT] Máximo de tentativas atingido após erro.');
			reconnectAttempts = 0;
		}
	}
}

startSock()

// ===== BotSwitch: modo silencioso por JID (toggle por frases naturais) =====
class BotSwitch {
    private static disabled: Record<string, boolean> = {};
    static disable(jid: string){ if(jid) this.disabled[jid] = true; }
    static enable(jid: string){ if(jid) delete this.disabled[jid]; }
    static isDisabled(jid: string){ return !!(jid && this.disabled[jid]); }
}

// ===== HumanLock: bloqueio temporário por atendimento humano =====
class HumanLock {
    private static instance: HumanLock;
    private locks: Record<string, number> = {};
    static getInstance(){
        if(!this.instance) this.instance = new HumanLock();
        return this.instance;
    }
    lock(jid: string, minutes: number){
        if(!jid || !minutes) return;
        this.locks[jid] = Date.now() + minutes*60*1000;
    }
    clear(jid: string){ if(jid) delete this.locks[jid]; }
    isLocked(jid: string){
        if(!jid) return false;
        const until = this.locks[jid];
        if(!until) return false;
        if(Date.now() > until){ delete this.locks[jid]; return false; }
        return true;
    }
    // static helpers
    static lock(jid: string, minutes: number){ this.getInstance().lock(jid, minutes); }
    static clear(jid: string){ this.getInstance().clear(jid); }
    static isLocked(jid: string){ return this.getInstance().isLocked(jid); }
}
