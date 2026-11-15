/* ==========================================================
   SportStats - servidor de notícias (sem dependências)
   ----------------------------------------------------------
   Como usar:   node servidor/server.js
   Depois abra: http://localhost:3000

   O que ele faz:
   1. Busca notícias nos feeds RSS (veja config.js) a cada X minutos
   2. Guarda tudo em memória (e em cache-noticias.json)
   3. Entrega para o site em  /api/noticias
   4. Entrega também as próprias páginas do site (HTML/CSS/JS)

   Guardamos só título, um trecho curto, a fonte e o LINK da
   matéria original. O leitor clica e lê no site do portal.
   Requer Node.js 18 ou mais novo.
   ========================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const config = require('./config');
const api = require('./api');
const banco = require('./banco');
const auth = require('./auth');

const PORTA = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = aceita outros aparelhos da rede e hospedagens
const RAIZ_SITE = path.resolve(__dirname, '..');
const ARQUIVO_CACHE = path.join(__dirname, 'cache-noticias.json');

/* ---------- Estado em memória ---------- */

let estado = { atualizadoEm: null, noticias: [], fontes: {} };

function carregarCache() {
    try {
        const lido = JSON.parse(fs.readFileSync(ARQUIVO_CACHE, 'utf-8'));
        if (Array.isArray(lido.noticias)) estado = { ...estado, ...lido };
        log(`Cache carregado: ${estado.noticias.length} notícias.`);
    } catch (e) { /* primeira execução: sem cache */ }
}

function salvarCache() {
    try {
        fs.writeFileSync(ARQUIVO_CACHE, JSON.stringify(estado));
    } catch (e) {
        log('Não consegui salvar o cache: ' + e.message);
    }
}

function log(msg) {
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
}

/* ---------- Leitura de RSS / Atom ---------- */

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodificarEntidades(texto) {
    return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, cod) => {
        if (cod[0] === '#') {
            const n = cod[1].toLowerCase() === 'x' ? parseInt(cod.slice(2), 16) : parseInt(cod.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
        }
        return ENTIDADES[cod.toLowerCase()] ?? inteiro;
    });
}

// Pega o conteúdo bruto de uma tag. Devolve HTML/texto já "desembrulhado".
function conteudoDaTag(bloco, tag) {
    const m = bloco.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return '';
    const interno = m[1];
    const cdata = interno.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    return cdata ? cdata[1] : decodificarEntidades(interno);
}

function atributo(bloco, tag, nomeAttr) {
    const m = bloco.match(new RegExp(`<${tag}\\s[^>]*?${nomeAttr}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return m ? decodificarEntidades(m[1]) : '';
}

function textoLimpo(html) {
    return decodificarEntidades(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function urlHttp(valor) {
    return /^https?:\/\//i.test(valor || '') ? valor : '';
}

function extrairImagem(bloco, descricaoHtml) {
    const candidatos = [
        atributo(bloco, 'media:content', 'url'),
        atributo(bloco, 'media:thumbnail', 'url'),
        /type\s*=\s*["']image/i.test(bloco) ? atributo(bloco, 'enclosure', 'url') : '',
        (descricaoHtml.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1]
    ];
    for (const c of candidatos) {
        const u = urlHttp(c && decodificarEntidades(c));
        if (u) return u;
    }
    return '';
}

// Transforma o XML de um feed em uma lista de notícias simples
function analisarFeed(xml, feed) {
    const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
    const itens = [];

    for (const bloco of blocos) {
        let titulo = textoLimpo(conteudoDaTag(bloco, 'title'));

        // RSS usa <link>texto</link>; Atom usa <link href="..."/>
        let link = textoLimpo(conteudoDaTag(bloco, 'link')) || atributo(bloco, 'link', 'href');
        link = urlHttp(link);
        if (!titulo || !link) continue;

        const fonte = textoLimpo(conteudoDaTag(bloco, 'source')) || feed.nome;

        // O Google Notícias coloca " - Nome do portal" no fim do título
        const sufixo = ` - ${fonte}`;
        if (fonte && titulo.endsWith(sufixo)) titulo = titulo.slice(0, -sufixo.length).trim();

        const descricaoHtml = conteudoDaTag(bloco, 'description')
            || conteudoDaTag(bloco, 'summary')
            || conteudoDaTag(bloco, 'content:encoded');
        let resumo = textoLimpo(descricaoHtml);
        // Se o "resumo" só repete o título (comum no Google Notícias), descarta
        if (resumo.toLowerCase().startsWith(titulo.toLowerCase().slice(0, 30))) resumo = '';
        if (resumo.length > 220) resumo = resumo.slice(0, 217).trimEnd() + '…';

        const dataBruta = conteudoDaTag(bloco, 'pubDate')
            || conteudoDaTag(bloco, 'published')
            || conteudoDaTag(bloco, 'updated')
            || conteudoDaTag(bloco, 'dc:date');
        const data = new Date(dataBruta.trim());

        itens.push({
            id: crypto.createHash('sha1').update(link).digest('hex').slice(0, 12),
            titulo,
            resumo,
            link,
            fonte,
            data: isNaN(data) ? new Date().toISOString() : data.toISOString(),
            imagem: extrairImagem(bloco, descricaoHtml),
            tags: feed.tag ? [feed.tag] : []
        });

        if (itens.length >= config.maxPorFonte) break;
    }
    return itens;
}

/* ---------- Etiquetas automáticas ---------- */

function normalizar(texto) {
    return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectarEtiquetas(noticia) {
    const titulo = ' ' + normalizar(noticia.titulo).replace(/[^a-z0-9-]+/g, ' ') + ' ';
    const tags = new Set(noticia.tags);
    for (const et of config.etiquetas) {
        const achou = et.palavras.some(p => titulo.includes(' ' + normalizar(p).replace(/[^a-z0-9-]+/g, ' ').trim() + ' '));
        if (achou) tags.add(et.nome);
    }
    // times antes dos campeonatos (o primeiro vira o rótulo do cartão)
    const posicao = nome => config.etiquetas.findIndex(e => e.nome === nome);
    noticia.tags = [...tags].sort((a, b) => posicao(b) - posicao(a));
    return noticia;
}

/* ---------- Busca nos feeds ---------- */

async function buscarFeed(feed) {
    const resposta = await fetch(feed.url, {
        headers: {
            'User-Agent': 'SportStats/1.0 (leitor de noticias esportivas)',
            'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(12000)
    });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    return analisarFeed(await resposta.text(), feed);
}

const pausa = ms => new Promise(r => setTimeout(r, ms));
let atualizando = false;

async function atualizarNoticias() {
    if (atualizando) return;
    atualizando = true;
    try {
        await executarAtualizacao();
    } catch (erro) {
        log('Erro inesperado ao atualizar: ' + (erro.stack || erro));
    } finally {
        atualizando = false; // sempre libera, mesmo se der erro
    }
}

async function executarAtualizacao() {
    log(`Atualizando notícias (${config.feeds.length} fontes)...`);

    const novas = [];
    const fontes = {};

    for (const feed of config.feeds) {
        try {
            const itens = await buscarFeed(feed);
            novas.push(...itens);
            fontes[feed.nome] = { ok: true, itens: itens.length, em: new Date().toISOString() };
        } catch (erro) {
            fontes[feed.nome] = { ok: false, erro: String(erro.message || erro), em: new Date().toISOString() };
            log(`  ✗ ${feed.nome}: ${erro.message || erro}`);
        }
        await pausa(400); // educado com os servidores
    }

    // Junta com as notícias antigas (se uma fonte falhar, não perdemos o que já tínhamos)
    const porId = new Map();
    for (const n of [...estado.noticias, ...novas]) {
        const existente = porId.get(n.id);
        if (existente) {
            existente.tags = [...new Set([...existente.tags, ...n.tags])];
            if (!existente.imagem && n.imagem) existente.imagem = n.imagem;
        } else {
            porId.set(n.id, { ...n });
        }
    }

    // Remove duplicatas pelo título (a mesma matéria vinda de feeds diferentes)
    const porTitulo = new Map();
    for (const n of porId.values()) {
        const chave = normalizar(n.titulo);
        const outra = porTitulo.get(chave);
        if (outra) {
            outra.tags = [...new Set([...outra.tags, ...n.tags])];
        } else {
            porTitulo.set(chave, n);
        }
    }

    const limite = Date.now() - config.maxDias * 86400000;
    const lista = [...porTitulo.values()]
        .map(detectarEtiquetas)
        .filter(n => new Date(n.data).getTime() >= limite)
        .sort((a, b) => new Date(b.data) - new Date(a.data))
        .slice(0, config.maxTotal);

    const okCount = Object.values(fontes).filter(f => f.ok).length;
    estado = { atualizadoEm: new Date().toISOString(), noticias: lista, fontes };
    salvarCache();
    log(`Pronto: ${lista.length} notícias no ar (${okCount}/${config.feeds.length} fontes responderam).`);
}

/* ---------- API ---------- */

function responderJson(res, dados, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': '*', // dados públicos; permite abrir o site direto do arquivo
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify(dados));
}

function rotaApi(url, res) {
    if (url.pathname === '/api/noticias') {
        const tag = (url.searchParams.get('tag') || '').trim();
        const busca = normalizar((url.searchParams.get('q') || '').trim());
        const limite = Math.min(Math.max(parseInt(url.searchParams.get('limite'), 10) || 20, 1), 100);

        let lista = estado.noticias;
        if (tag) {
            const t = normalizar(tag);
            lista = lista.filter(n => n.tags.some(x => normalizar(x) === t));
        }
        if (busca) lista = lista.filter(n => normalizar(n.titulo).includes(busca));

        return responderJson(res, {
            atualizadoEm: estado.atualizadoEm,
            total: lista.length,
            noticias: lista.slice(0, limite)
        });
    }

    if (url.pathname === '/api/tags') {
        // campeonatos primeiro, depois times, só os que têm notícia
        const contagem = {};
        estado.noticias.forEach(n => n.tags.forEach(t => { contagem[t] = (contagem[t] || 0) + 1; }));
        const ordem = config.etiquetas.map(e => e.nome);
        const tags = ordem.filter(t => contagem[t]).map(t => ({ nome: t, total: contagem[t] }));
        return responderJson(res, { tags });
    }

    if (url.pathname === '/api/status') {
        return responderJson(res, {
            atualizadoEm: estado.atualizadoEm,
            total: estado.noticias.length,
            fontes: estado.fontes
        });
    }

    return responderJson(res, { erro: 'Rota não encontrada' }, 404);
}

/* ---------- Arquivos do site ---------- */

const TIPOS = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
};

function rotaArquivo(url, req, res) {
    let caminho;
    try {
        caminho = decodeURIComponent(url.pathname);
    } catch (e) {
        res.writeHead(400); return res.end('Endereço inválido');
    }

    if (caminho === '/') caminho = '/index.html';

    const absoluto = path.resolve(RAIZ_SITE, '.' + caminho);
    const relativo = path.relative(RAIZ_SITE, absoluto);

    // Segurança: nada fora da pasta do site, nada de arquivos ocultos e
    // a pasta do servidor (config, cache, código) nunca é entregue.
    const bloqueado = relativo.startsWith('..')
        || path.isAbsolute(relativo)
        || relativo.split(path.sep).some(p => p.startsWith('.') || p === 'servidor' || p === 'banco' || p === 'teste' || p === 'node_modules');
    const tipo = TIPOS[path.extname(absoluto).toLowerCase()];

    if (bloqueado || !tipo) {
        res.writeHead(404); return res.end('Não encontrado');
    }

    fs.readFile(absoluto, (erro, conteudo) => {
        if (erro) { res.writeHead(404); return res.end('Não encontrado'); }
        res.writeHead(200, {
            'Content-Type': tipo,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'same-origin',
            'Cache-Control': 'no-cache'
        });
        res.end(req.method === 'HEAD' ? undefined : conteudo);
    });
}

/* ---------- Servidor ---------- */

const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
        if (await api.tratar(req, res, url)) return; // partidas, contas, admin
        if (req.method === 'GET' || req.method === 'HEAD') return rotaApi(url, res); // notícias
        res.writeHead(405); return res.end('Método não permitido');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); return res.end('Método não permitido');
    }

    if (url.pathname.startsWith('/imagens/')) return api.entregarImagem(url, res);
    rotaArquivo(url, req, res);
});

async function iniciar() {
    // Para testes: SPORTSTATS_FEEDS=http://.../a.xml,http://.../b.xml usa só esses feeds
    if (process.env.SPORTSTATS_FEEDS) {
        config.feeds = process.env.SPORTSTATS_FEEDS.split(',').map((u, i) => ({ nome: 'teste' + (i + 1), url: u.trim(), tag: i === 0 ? 'Flamengo' : '' }));
    }

    carregarCache();

    // No modo Supabase, carrega partidas, contas e imagens ANTES de aceitar visitas.
    // Se o banco estiver errado, o servidor avisa o motivo e não liga (melhor do que
    // abrir o site vazio e parecer que os dados sumiram).
    log(`Armazenamento: ${banco.MODO === 'supabase' ? 'Supabase' : 'arquivos locais (pasta banco/)'}`);
    try {
        const resumo = await banco.carregarTudo();
        if (banco.MODO === 'supabase') {
            log(`Supabase conectado: ${resumo.partidas} partida(s), ${resumo.contas} conta(s), ${resumo.imagens} imagem(ns).`);
        }
    } catch (erro) {
        console.error('\nNÃO FOI POSSÍVEL CONECTAR AO SUPABASE:\n  ' + erro.message + '\n');
        process.exit(1);
    }
    auth.limparSessoesVencidas();

    servidor.listen(PORTA, HOST, () => {
        log('SportStats no ar!');

        if (process.env.RENDER_EXTERNAL_URL) {
            log(`  Endereço público:  ${process.env.RENDER_EXTERNAL_URL}`);
        } else {
            log(`  Neste computador:  http://localhost:${PORTA}`);

            // endereços para abrir de outros aparelhos na mesma rede Wi-Fi
            Object.values(os.networkInterfaces()).flat()
                .filter(i => i && i.family === 'IPv4' && !i.internal)
                .forEach(i => log(`  Outros aparelhos na mesma rede:  http://${i.address}:${PORTA}`));
        }

        log(`  Painel do administrador:  /cadastrar-partida.html`);
        if (process.env.ADMIN_SENHA) {
            log('  Chave do administrador: definida pela variável ADMIN_SENHA');
        } else {
            log(`  Chave do administrador (guardada em ${auth.infoAdmin.origem}):`);
            log(`      ${auth.infoAdmin.senha}`);
        }

        atualizarNoticias();
        setInterval(atualizarNoticias, config.intervaloMinutos * 60 * 1000);
    });
}

// O Render avisa (SIGTERM) antes de desligar numa nova versão: termina as gravações e sai.
let desligando = false;
async function desligar(sinal) {
    if (desligando) return;
    desligando = true;
    log(`${sinal} recebido: terminando as gravações pendentes...`);
    setTimeout(() => process.exit(0), 8000).unref();
    servidor.close();
    try { await banco.esvaziarFila(); } catch (e) { /* já registrado */ }
    process.exit(0);
}

if (require.main === module) {
    process.on('SIGTERM', () => desligar('SIGTERM'));
    process.on('SIGINT', () => desligar('SIGINT'));
    // um erro solto numa rotina em segundo plano não pode derrubar o site inteiro
    process.on('unhandledRejection', (erro) => console.error('Erro não tratado:', erro));
    iniciar();
}

module.exports = { analisarFeed, detectarEtiquetas };
