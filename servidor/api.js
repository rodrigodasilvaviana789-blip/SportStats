/* ==========================================================
   SportStats - API de partidas, contas e administrador
   ----------------------------------------------------------
   Tudo que chega do navegador é validado aqui: o servidor
   nunca confia no que o site envia.
   ========================================================== */

const crypto = require('crypto');
const banco = require('./banco');
const auth = require('./auth');

const partidasArq = banco.arquivo('partidas.json', () => []);

const MAX_PARTIDAS = 2000;
const MAX_CONTAS = 2000;
const MAX_CADASTROS_POR_HORA = 60;
const cadastrosRecentes = [];

class ErroApi extends Error {
    constructor(status, mensagem) { super(mensagem); this.status = status; }
}

/* ---------- Utilidades HTTP ---------- */

function responder(res, status, dados, cabecalhos = {}) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...cabecalhos
    });
    res.end(JSON.stringify(dados));
}

function lerCorpo(req, maxBytes) {
    return new Promise((resolve, reject) => {
        if (!/^application\/json/i.test(req.headers['content-type'] || '')) {
            return reject(new ErroApi(415, 'Envie os dados em JSON.'));
        }
        const partes = [];
        let total = 0;
        req.on('data', (parte) => {
            total += parte.length;
            if (total > maxBytes) {
                reject(new ErroApi(413, 'Dados grandes demais.'));
                req.destroy();
                return;
            }
            partes.push(parte);
        });
        req.on('end', () => {
            try {
                const obj = JSON.parse(Buffer.concat(partes).toString('utf-8') || '{}');
                if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error();
                resolve(obj);
            } catch (e) {
                reject(new ErroApi(400, 'JSON inválido.'));
            }
        });
        req.on('error', () => reject(new ErroApi(400, 'Falha ao ler os dados.')));
    });
}

function lerCookies(req) {
    const saida = {};
    (req.headers.cookie || '').split(';').forEach((par) => {
        const i = par.indexOf('=');
        if (i > 0) saida[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
    });
    return saida;
}

function cookie(req, nome, valor, maxAge) {
    const https = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `${nome}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

/* ---------- Imagens (escudos e fotos) ---------- */

const EXTENSOES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGEM = 400 * 1024;

function assinaturaConfere(buf, ext) {
    if (ext === 'png') return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
    if (ext === 'jpg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (ext === 'gif') return buf.slice(0, 4).toString('latin1') === 'GIF8';
    if (ext === 'webp') return buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
    return false;
}

async function guardarImagem(dataUrl) {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!m) throw new ErroApi(400, 'Imagem inválida. Use PNG, JPG, WEBP ou GIF.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGEM) throw new ErroApi(413, 'Imagem grande demais (máximo 400 KB).');
    const ext = EXTENSOES[m[1]];
    if (!assinaturaConfere(buf, ext)) throw new ErroApi(400, 'O arquivo não é uma imagem válida.');
    const nome = crypto.createHash('sha1').update(buf).digest('hex') + '.' + ext;
    await banco.imagens.guardar(nome, buf);
    return '/imagens/' + nome;
}

const RE_IMAGEM_LOCAL = /^\/imagens\/[a-f0-9]{40}\.(png|jpg|webp|gif)$/;

// Aceita: vazio, imagem enviada (data:), imagem já guardada, link http(s) ou (se permitido) emoji/texto curto
async function tratarCampoImagem(valor, permitirTexto) {
    if (valor === undefined || valor === null || valor === '') return '';
    if (typeof valor !== 'string') throw new ErroApi(400, 'Imagem inválida.');
    if (valor.startsWith('data:')) return await guardarImagem(valor);
    if (RE_IMAGEM_LOCAL.test(valor)) {
        return banco.imagens.existe(valor.slice('/imagens/'.length)) ? valor : '';
    }
    if (/^https?:\/\//i.test(valor)) {
        if (valor.length > 500) throw new ErroApi(400, 'Link de imagem muito longo.');
        try { new URL(valor); } catch (e) { throw new ErroApi(400, 'Link de imagem inválido.'); }
        return valor;
    }
    // emoji ou texto curto; nada que pareça um endereço (javascript:, data:, etc.)
    if (permitirTexto && valor.length <= 20 && !/^[a-z][a-z0-9+.\-]*:/i.test(valor)) return valor;
    throw new ErroApi(400, 'Imagem inválida.');
}

async function entregarImagem(url, res) {
    const nome = url.pathname.slice('/imagens/'.length);
    if (!/^[a-f0-9]{40}\.(png|jpg|webp|gif)$/.test(nome)) { res.writeHead(404); return res.end(); }

    let imagem = null;
    try {
        imagem = await banco.imagens.ler(nome);
    } catch (e) {
        res.writeHead(503, { 'Retry-After': '5' });
        return res.end();
    }
    if (!imagem) { res.writeHead(404); return res.end(); }

    res.writeHead(200, {
        'Content-Type': imagem.tipo,
        'Cache-Control': 'public, max-age=31536000, immutable', // o nome é o hash: nunca muda
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(imagem.buffer);
}

/* ---------- Validação da partida ---------- */

function texto(valor, max, obrigatorio, rotulo) {
    const t = typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim() : '';
    if (obrigatorio && !t) throw new ErroApi(400, `Preencha: ${rotulo}.`);
    if (t.length > max) throw new ErroApi(400, `${rotulo} está grande demais.`);
    return t;
}

function inteiro(valor, min, max) {
    const n = parseInt(valor, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : 0;
}

async function limparTime(t, rotulo) {
    t = t && typeof t === 'object' ? t : {};
    return {
        nome: texto(t.nome, 60, true, `nome do ${rotulo}`),
        escudo: await tratarCampoImagem(t.escudo, true),
        cor: /^#[0-9a-fA-F]{6}$/.test(t.cor) ? t.cor : '#888888',
        gols: inteiro(t.gols, 0, 99)
    };
}

async function limparPartida(e, idExistente) {
    const status = ['agendada', 'aovivo', 'encerrada'].includes(e.status) ? e.status : null;
    if (!status) throw new ErroApi(400, 'Situação da partida inválida.');

    const data = texto(e.data, 10, false, 'data');
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroApi(400, 'Data inválida.');
    const hora = texto(e.hora, 5, false, 'horário');
    if (hora && !/^\d{2}:\d{2}$/.test(hora)) throw new ErroApi(400, 'Horário inválido.');

    const stats = {};
    if (e.stats && typeof e.stats === 'object') {
        const chaves = Object.keys(e.stats).slice(0, 30);
        for (const k of chaves) {
            if (!/^[a-z]{1,30}$/.test(k) || !Array.isArray(e.stats[k])) continue;
            stats[k] = [inteiro(e.stats[k][0], 0, 999), inteiro(e.stats[k][1], 0, 999)];
        }
    }

    return {
        id: idExistente,
        campeonato: texto(e.campeonato, 80, true, 'campeonato'),
        rodada: texto(e.rodada, 10, false, 'rodada'),
        temporada: texto(e.temporada, 10, false, 'temporada'),
        status,
        minuto: texto(e.minuto, 8, false, 'minuto'),
        data,
        hora,
        estadio: texto(e.estadio, 100, false, 'estádio'),
        local: texto(e.local, 100, false, 'local'),
        casa: await limparTime(e.casa, 'mandante'),
        fora: await limparTime(e.fora, 'visitante'),
        stats
    };
}

/* ---------- Contas ---------- */

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usuarioPublico(c) {
    return { nome: c.nome, email: c.email, foto: c.foto || '', timeCoracao: c.timeCoracao || '', admin: c.admin === true };
}

function usuarioDaRequisicao(req) {
    const s = auth.lerSessao(lerCookies(req).sid, 'user');
    return s && auth.contas.dados[s.email] ? auth.contas.dados[s.email] : null;
}

// Administrador = conta comum que foi promovida com a chave de administrador
function ehAdmin(req) {
    const conta = usuarioDaRequisicao(req);
    return !!(conta && conta.admin === true);
}

function exigirAdmin(req) {
    if (!ehAdmin(req)) throw new ErroApi(401, 'Acesso restrito ao administrador.');
}

/* ---------- Rotas ---------- */

async function rotear(req, res, url) {
    const { pathname } = url;
    const metodo = req.method;

    /* verificação de saúde (o Render usa; não consulta o banco) */
    if (pathname === '/api/saude' && metodo === 'GET') {
        return responder(res, 200, { ok: true, banco: banco.MODO });
    }

    /* sessão atual */
    if (pathname === '/api/sessao' && metodo === 'GET') {
        const u = usuarioDaRequisicao(req);
        return responder(res, 200, { usuario: u ? usuarioPublico(u) : null, admin: !!(u && u.admin === true) });
    }

    /* contas */
    if (pathname === '/api/auth/cadastro' && metodo === 'POST') {
        const c = await lerCorpo(req, 4096);
        const nome = texto(c.nome, 80, true, 'nome');
        const email = texto(c.email, 120, true, 'e-mail').toLowerCase();
        const senha = typeof c.senha === 'string' ? c.senha : '';
        if (!RE_EMAIL.test(email)) throw new ErroApi(400, 'E-mail inválido.');
        if (senha.length < 6 || senha.length > 200) throw new ErroApi(400, 'A senha precisa ter de 6 a 200 caracteres.');
        if (auth.contas.dados[email]) throw new ErroApi(409, 'Já existe uma conta com esse e-mail.');

        const agora = Date.now();
        while (cadastrosRecentes.length && cadastrosRecentes[0] < agora - 3600000) cadastrosRecentes.shift();
        if (cadastrosRecentes.length >= MAX_CADASTROS_POR_HORA || Object.keys(auth.contas.dados).length >= MAX_CONTAS) {
            throw new ErroApi(429, 'Muitos cadastros agora. Tente novamente mais tarde.');
        }
        cadastrosRecentes.push(agora);

        const senhaHash = await auth.gerarHashSenha(senha);
        // confere de novo: enquanto a senha era processada, outro cadastro igual pode ter entrado
        if (auth.contas.dados[email]) throw new ErroApi(409, 'Já existe uma conta com esse e-mail.');

        auth.contas.dados[email] = {
            nome, email, senhaHash,
            foto: '', timeCoracao: '', admin: false, criadaEm: new Date().toISOString()
        };
        try {
            await auth.contas.salvar();
        } catch (e) {
            delete auth.contas.dados[email]; // não ficou gravada: permite tentar de novo
            throw e;
        }

        const s = auth.criarSessao('user', email);
        return responder(res, 201, { usuario: usuarioPublico(auth.contas.dados[email]) },
            { 'Set-Cookie': cookie(req, 'sid', s.token, s.maxAge) });
    }

    if (pathname === '/api/auth/entrar' && metodo === 'POST') {
        const c = await lerCorpo(req, 4096);
        const email = String(c.email || '').trim().toLowerCase().slice(0, 120);
        const senha = typeof c.senha === 'string' ? c.senha.slice(0, 200) : '';
        const chave = 'login:' + email;

        if (auth.limite.bloqueado(chave)) throw new ErroApi(429, 'Muitas tentativas. Aguarde alguns minutos.');

        const conta = auth.contas.dados[email];
        // sem conta, gastamos o mesmo tempo para não revelar quais e-mails existem
        const certa = conta ? await auth.conferirSenha(senha, conta.senhaHash) : (await auth.gerarHashSenha(senha), false);
        if (!certa) {
            auth.limite.falhou(chave);
            throw new ErroApi(401, 'E-mail ou senha incorretos. Se ainda não tem conta, cadastre-se.');
        }
        auth.limite.ok(chave);

        const s = auth.criarSessao('user', email);
        return responder(res, 200, { usuario: usuarioPublico(conta) },
            { 'Set-Cookie': cookie(req, 'sid', s.token, s.maxAge) });
    }

    if (pathname === '/api/auth/sair' && metodo === 'POST') {
        auth.encerrarSessao(lerCookies(req).sid);
        return responder(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'sid', '', 0) });
    }

    if (pathname === '/api/auth/eu' && (metodo === 'PATCH' || metodo === 'DELETE')) {
        const conta = usuarioDaRequisicao(req);
        if (!conta) throw new ErroApi(401, 'Entre na sua conta.');

        if (metodo === 'DELETE') {
            delete auth.contas.dados[conta.email];
            await auth.contas.salvar();
            auth.encerrarSessoesDoUsuario(conta.email);
            return responder(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'sid', '', 0) });
        }

        const c = await lerCorpo(req, 600 * 1024);
        if ('nome' in c) conta.nome = texto(c.nome, 80, true, 'nome');
        if ('timeCoracao' in c) conta.timeCoracao = texto(c.timeCoracao, 60, false, 'time do coração');
        if ('foto' in c) conta.foto = await tratarCampoImagem(c.foto, false);
        await auth.contas.salvar();
        return responder(res, 200, { usuario: usuarioPublico(conta) });
    }

    /* administrador: promove a conta que está logada, usando a chave de administrador */
    if (pathname === '/api/admin/entrar' && metodo === 'POST') {
        const conta = usuarioDaRequisicao(req);
        if (!conta) throw new ErroApi(401, 'Entre na sua conta primeiro.');
        const c = await lerCorpo(req, 2048);

        if (auth.limite.bloqueado('admin')) throw new ErroApi(429, 'Muitas tentativas. Aguarde alguns minutos.');
        if (!auth.senhaAdminCorreta(c.senha || '')) {
            auth.limite.falhou('admin');
            throw new ErroApi(401, 'Chave de administrador incorreta.');
        }
        auth.limite.ok('admin');

        conta.admin = true;
        try {
            await auth.contas.salvar();
        } catch (e) {
            conta.admin = false;
            throw e;
        }
        return responder(res, 200, { admin: true });
    }

    /* partidas */
    if (pathname === '/api/partidas' && metodo === 'GET') {
        return responder(res, 200, partidasArq.dados);
    }

    if (pathname === '/api/partidas' && metodo === 'POST') {
        exigirAdmin(req);
        const corpo = await lerCorpo(req, 1024 * 1024);
        const lista = partidasArq.dados;

        let id = typeof corpo.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(corpo.id) ? corpo.id : '';
        const indice = id ? lista.findIndex(p => p.id === id) : -1;
        if (!id) id = crypto.randomBytes(5).toString('hex');
        if (indice < 0 && lista.length >= MAX_PARTIDAS) throw new ErroApi(400, 'Limite de partidas atingido.');

        const partida = await limparPartida(corpo, id);
        const anterior = indice >= 0 ? lista[indice] : null;
        if (indice >= 0) lista[indice] = partida; else lista.push(partida);
        try {
            await partidasArq.salvar();
        } catch (e) {
            // não gravou no banco: desfaz, para a tela não mostrar algo que não foi salvo
            if (anterior) lista[lista.indexOf(partida)] = anterior; else lista.splice(lista.indexOf(partida), 1);
            throw e;
        }
        return responder(res, indice >= 0 ? 200 : 201, partida);
    }

    const m = /^\/api\/partidas\/([a-zA-Z0-9_-]{1,40})$/.exec(pathname);
    if (m && metodo === 'GET') {
        const p = partidasArq.dados.find(x => x.id === m[1]);
        return p ? responder(res, 200, p) : responder(res, 404, { erro: 'Partida não encontrada.' });
    }
    if (m && metodo === 'DELETE') {
        exigirAdmin(req);
        const i = partidasArq.dados.findIndex(x => x.id === m[1]);
        if (i < 0) return responder(res, 404, { erro: 'Partida não encontrada.' });
        const [removida] = partidasArq.dados.splice(i, 1);
        try {
            await partidasArq.salvar();
        } catch (e) {
            partidasArq.dados.splice(i, 0, removida); // não gravou: devolve a partida
            throw e;
        }
        return responder(res, 200, { ok: true });
    }

    /* biblioteca de times (montada a partir das partidas) */
    if (pathname === '/api/times' && metodo === 'GET') {
        const times = {};
        [...partidasArq.dados]
            .sort((a, b) => ((a.data || '') + (a.hora || '')).localeCompare((b.data || '') + (b.hora || '')))
            .forEach((p) => {
                for (const t of [p.casa, p.fora]) {
                    const chave = t.nome.toLowerCase();
                    const antigo = times[chave] || {};
                    times[chave] = { nome: t.nome, escudo: t.escudo || antigo.escudo || '', cor: t.cor || antigo.cor || '' };
                }
            });
        return responder(res, 200, times);
    }

    return false; // não é uma rota deste módulo
}

// Devolve true se tratou a requisição
async function tratar(req, res, url) {
    try {
        const resultado = await rotear(req, res, url);
        return resultado !== false;
    } catch (e) {
        if (e instanceof ErroApi) {
            if (!res.headersSent) responder(res, e.status, { erro: e.message });
            return true;
        }
        if (e && e.codigo === 'BANCO_INDISPONIVEL') {
            console.error('Banco indisponível:', e.message);
            if (!res.headersSent) responder(res, 503, { erro: 'Não consegui salvar agora. Tente de novo em instantes.' });
            return true;
        }
        console.error('Erro na API:', e);
        if (!res.headersSent) responder(res, 500, { erro: 'Erro interno do servidor.' });
        return true;
    }
}

module.exports = { tratar, entregarImagem };
