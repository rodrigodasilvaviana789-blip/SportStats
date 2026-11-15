/* ==========================================================
   SportStats - armazenamento dos dados
   ----------------------------------------------------------
   Dois modos, escolhidos sozinhos:

   1) SUPABASE  (quando SUPABASE_URL e SUPABASE_SECRET_KEY existem)
      Os dados ficam no banco do Supabase, que NÃO é apagado quando
      o Render reinicia. É o modo para o site no ar.

   2) ARQUIVOS  (sem essas variáveis)
      Os dados ficam na pasta "banco/" (ou em DATA_DIR). É o modo
      para testar no seu computador.

   Como funciona no modo Supabase: ao ligar, o servidor carrega tudo
   para a memória (por isso as leituras são rápidas) e cada alteração
   é gravada no Supabase ANTES de responder ao usuário. Só enviamos
   para o Supabase o que mudou.

   A conversa com o Supabase usa a API REST dele (HTTPS), sem
   nenhuma biblioteca extra. A chave secreta fica SÓ no servidor.
   ========================================================== */

const fs = require('fs');
const path = require('path');

const PASTA = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '..', 'banco');

/* ---------- Configuração do Supabase ---------- */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_CHAVE = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const MODO = SUPABASE_URL && SUPABASE_CHAVE ? 'supabase' : 'arquivos';

if (MODO === 'supabase') {
    // A chave nunca pode trafegar sem criptografia (exceto para teste em localhost)
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(SUPABASE_URL);
    if (!/^https:\/\//i.test(SUPABASE_URL) && !local) {
        throw new Error('SUPABASE_URL precisa começar com https:// (copie em Project Settings > API).');
    }
}

class ErroBanco extends Error {
    constructor(mensagem, status) {
        super(mensagem);
        this.codigo = 'BANCO_INDISPONIVEL';
        this.status = status || 0;
    }
}

const pausa = ms => new Promise(r => setTimeout(r, ms));

/* Uma requisição ao Supabase, com nova tentativa em falhas passageiras. */
async function rest(metodo, caminho, { corpo, prefer, tentativas = 3 } = {}) {
    const cabecalhos = { apikey: SUPABASE_CHAVE, 'Content-Type': 'application/json' };
    // Chaves novas (sb_secret_...) vão SÓ em "apikey". Se forem também em
    // "Authorization: Bearer", o Supabase rejeita com "Invalid JWT".
    // Já a chave antiga (service_role) é um JWT e também vai em Bearer.
    if (SUPABASE_CHAVE.startsWith('eyJ')) cabecalhos.Authorization = 'Bearer ' + SUPABASE_CHAVE;
    if (prefer) cabecalhos.Prefer = prefer;

    let ultimo;
    for (let t = 0; t < tentativas; t++) {
        if (t > 0) await pausa(400 * 2 ** (t - 1));
        try {
            const resposta = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
                method: metodo,
                headers: cabecalhos,
                body: corpo === undefined ? undefined : JSON.stringify(corpo),
                signal: AbortSignal.timeout(15000)
            });

            if (resposta.ok) {
                const texto = await resposta.text();
                return texto ? JSON.parse(texto) : null;
            }

            let detalhe = {};
            try { detalhe = await resposta.json(); } catch (e) { /* sem JSON */ }
            ultimo = new ErroBanco(explicarErro(resposta.status, detalhe), resposta.status);

            // erro do nosso lado (chave errada, tabela inexistente...): repetir não adianta
            if (resposta.status < 500 && resposta.status !== 429) throw ultimo;
        } catch (erro) {
            if (erro instanceof ErroBanco && erro.status < 500 && erro.status !== 429 && erro.status !== 0) throw erro;
            ultimo = erro instanceof ErroBanco ? erro
                : new ErroBanco('Não consegui falar com o Supabase (projeto pausado, URL errada ou sem internet).', 0);
        }
    }
    throw ultimo;
}

function explicarErro(status, d) {
    const texto = `${d.message || ''} ${d.code || ''}`;
    if (status === 401 || status === 403 || /invalid (api key|jwt)/i.test(texto)) {
        return 'O Supabase recusou a chave. Confira SUPABASE_SECRET_KEY (use a chave SECRET / service_role, não a publishable/anon).';
    }
    if (status === 404 || /PGRST205|relation .* does not exist|schema cache/i.test(texto)) {
        return 'Tabela não encontrada no Supabase. Rode o arquivo supabase.sql no SQL Editor do projeto.';
    }
    return `Erro do Supabase (${status}): ${d.message || 'sem detalhes'}`;
}

// Lê uma tabela inteira, de 1000 em 1000 (limite padrão da API)
async function lerTabela(tabela, colunas, ordem) {
    const linhas = [];
    for (let inicio = 0; ; inicio += 1000) {
        const parte = await rest('GET', `${tabela}?select=${colunas}&order=${ordem}&limit=1000&offset=${inicio}`);
        linhas.push(...parte);
        if (parte.length < 1000) break;
    }
    return linhas;
}

/* ---------- Coleções (partidas, contas, sessões) ---------- */

const colecoes = [];

/* arquivo('partidas.json', () => [])      -> lista de objetos com "id"
   arquivo('contas.json',   () => ({}))    -> objeto indexado por chave
   Devolve { dados, salvar() }. salvar() devolve uma Promise: quem precisa ter
   certeza de que gravou deve usar "await". */
function arquivo(nome, padrao) {
    const tabela = nome.replace(/\.json$/, '');
    let dados = padrao();
    const ehLista = Array.isArray(dados);
    const entradas = () => (ehLista ? dados.map(i => [i.id, i]) : Object.entries(dados));

    if (MODO === 'arquivos') {
        fs.mkdirSync(path.join(PASTA, 'imagens'), { recursive: true });
        const caminho = path.join(PASTA, nome);
        try { dados = JSON.parse(fs.readFileSync(caminho, 'utf-8')); } catch (e) { /* primeira vez */ }
        return {
            get dados() { return dados; },
            salvar() {
                const temporario = caminho + '.tmp';
                fs.writeFileSync(temporario, JSON.stringify(dados), { mode: 0o600 });
                fs.renameSync(temporario, caminho);
                return Promise.resolve();
            }
        };
    }

    // ----- modo Supabase -----
    let fotografia = new Map(); // o que o Supabase já tem: chave -> JSON
    let fila = Promise.resolve();

    async function sincronizar() {
        const atual = new Map(entradas().map(([k, v]) => [String(k), JSON.stringify(v)]));
        const alteradas = [...atual].filter(([k, j]) => fotografia.get(k) !== j);
        const removidas = [...fotografia.keys()].filter(k => !atual.has(k));

        for (let i = 0; i < alteradas.length; i += 100) {
            const lote = alteradas.slice(i, i + 100);
            await rest('POST', `${tabela}?on_conflict=chave`, {
                corpo: lote.map(([chave, json]) => ({ chave, valor: JSON.parse(json) })),
                prefer: 'resolution=merge-duplicates,return=minimal'
            });
            lote.forEach(([k, j]) => fotografia.set(k, j));
        }
        for (const chave of removidas) {
            await rest('DELETE', `${tabela}?chave=eq.${encodeURIComponent(chave)}`, { prefer: 'return=minimal' });
            fotografia.delete(chave);
        }
    }

    const colecao = {
        tabela,
        get dados() { return dados; },
        salvar() {
            // uma gravação por vez, na ordem em que foram pedidas
            const p = fila.catch(() => {}).then(sincronizar);
            fila = p;
            p.catch(e => console.error(`[banco] falha ao gravar "${tabela}": ${e.message}`)); // evita "unhandled rejection"
            return p;
        },
        async carregar() {
            const linhas = await lerTabela(tabela, 'chave,valor', 'criado_em.asc,chave.asc');
            if (ehLista) dados = linhas.map(l => l.valor); else dados = Object.fromEntries(linhas.map(l => [l.chave, l.valor]));
            fotografia = new Map(linhas.map(l => [l.chave, JSON.stringify(l.valor)]));
            return linhas.length;
        },
        esvaziar() { return fila.catch(() => {}); }
    };
    colecoes.push(colecao);
    return colecao;
}

/* ---------- Imagens (escudos e fotos) ---------- */

const imagensConhecidas = new Set();
const cacheImagens = new Map(); // nome -> { tipo, buffer }
let bytesEmCache = 0;
const LIMITE_CACHE = 30 * 1024 * 1024;

function guardarNoCache(nome, item) {
    if (cacheImagens.has(nome)) return;
    cacheImagens.set(nome, item);
    bytesEmCache += item.buffer.length;
    for (const antigo of cacheImagens.keys()) { // descarta as mais antigas
        if (bytesEmCache <= LIMITE_CACHE) break;
        bytesEmCache -= cacheImagens.get(antigo).buffer.length;
        cacheImagens.delete(antigo);
    }
}

const TIPO_POR_EXTENSAO = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

const imagens = {
    // true se já guardamos a imagem (nome = "<hash>.png")
    existe(nome) {
        return MODO === 'supabase' ? imagensConhecidas.has(nome) : fs.existsSync(path.join(PASTA, 'imagens', nome));
    },

    async guardar(nome, buffer) {
        if (MODO === 'arquivos') {
            const caminho = path.join(PASTA, 'imagens', nome);
            if (!fs.existsSync(caminho)) fs.writeFileSync(caminho, buffer);
            return;
        }
        if (imagensConhecidas.has(nome)) return;
        await rest('POST', 'imagens?on_conflict=chave', {
            corpo: [{ chave: nome, tipo: TIPO_POR_EXTENSAO[nome.split('.')[1]], dados: buffer.toString('base64') }],
            prefer: 'resolution=merge-duplicates,return=minimal'
        });
        imagensConhecidas.add(nome);
        guardarNoCache(nome, { tipo: TIPO_POR_EXTENSAO[nome.split('.')[1]], buffer });
    },

    // devolve { tipo, buffer } ou null
    async ler(nome) {
        const ext = nome.split('.')[1];
        if (MODO === 'arquivos') {
            try { return { tipo: TIPO_POR_EXTENSAO[ext], buffer: await fs.promises.readFile(path.join(PASTA, 'imagens', nome)) }; }
            catch (e) { return null; }
        }
        if (cacheImagens.has(nome)) return cacheImagens.get(nome);
        if (!imagensConhecidas.has(nome)) return null;
        const linhas = await rest('GET', `imagens?chave=eq.${encodeURIComponent(nome)}&select=tipo,dados`);
        if (!linhas || !linhas[0]) return null;
        const item = { tipo: linhas[0].tipo, buffer: Buffer.from(linhas[0].dados, 'base64') };
        guardarNoCache(nome, item);
        return item;
    }
};

/* ---------- Ao ligar / ao desligar ---------- */

// Carrega tudo do Supabase para a memória. Chame antes de aceitar visitas.
async function carregarTudo() {
    if (MODO !== 'supabase') return {};
    const resumo = {};
    for (const c of colecoes) resumo[c.tabela] = await c.carregar();

    const nomes = await lerTabela('imagens', 'chave', 'chave.asc');
    nomes.forEach(l => imagensConhecidas.add(l.chave));
    resumo.imagens = nomes.length;
    return resumo;
}

// Espera as gravações pendentes terminarem (usado ao desligar o servidor)
async function esvaziarFila() {
    await Promise.all(colecoes.map(c => c.esvaziar()));
}

module.exports = { PASTA, MODO, arquivo, imagens, carregarTudo, esvaziarFila, ErroBanco };
