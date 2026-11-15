/* ==========================================================
   SportStats - contas, sessões e senha do administrador
   ----------------------------------------------------------
   - Senhas de usuários: guardadas com scrypt + sal (nunca em texto)
   - Sessões: token aleatório em cookie HttpOnly (o servidor só
     guarda o "hash" do token)
   - Administrador: quem cadastra partidas entra com uma senha
     própria (ADMIN_SENHA), separada das contas dos usuários
   - Limite de tentativas: evita adivinhar senhas
   ========================================================== */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const banco = require('./banco');

const scrypt = promisify(crypto.scrypt);
const contas = banco.arquivo('contas.json', () => ({}));
const sessoes = banco.arquivo('sessoes.json', () => ({}));

const DIAS_USUARIO = 30;
const DIAS_ADMIN = 7;

/* ---------- Senhas ---------- */

async function gerarHashSenha(senha) {
    const sal = crypto.randomBytes(16);
    const chave = await scrypt(senha, sal, 64);
    return sal.toString('hex') + ':' + chave.toString('hex');
}

async function conferirSenha(senha, guardado) {
    const [salHex, chaveHex] = String(guardado || '').split(':');
    if (!salHex || !chaveHex) return false;
    const esperado = Buffer.from(chaveHex, 'hex');
    const calculado = await scrypt(senha, Buffer.from(salHex, 'hex'), esperado.length);
    return crypto.timingSafeEqual(esperado, calculado);
}

/* ---------- Sessões ---------- */

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

function limparSessoesVencidas() {
    const agora = Date.now();
    let mudou = false;
    for (const [k, s] of Object.entries(sessoes.dados)) {
        if (s.exp < agora) { delete sessoes.dados[k]; mudou = true; }
    }
    if (mudou) sessoes.salvar();
}
limparSessoesVencidas();
setInterval(limparSessoesVencidas, 60 * 60 * 1000).unref();
// (no modo Supabase os dados só chegam depois; o server.js chama de novo ao ligar)

function criarSessao(tipo, email) {
    const token = crypto.randomBytes(32).toString('base64url');
    const dias = tipo === 'admin' ? DIAS_ADMIN : DIAS_USUARIO;
    sessoes.dados[hashToken(token)] = { tipo, email: email || '', exp: Date.now() + dias * 86400000 };
    sessoes.salvar();
    return { token, maxAge: dias * 86400 };
}

function lerSessao(token, tipo) {
    if (!token) return null;
    const s = sessoes.dados[hashToken(token)];
    if (!s || s.tipo !== tipo || s.exp < Date.now()) return null;
    return s;
}

function encerrarSessao(token) {
    if (!token) return;
    delete sessoes.dados[hashToken(token)];
    sessoes.salvar();
}

function encerrarSessoesDoUsuario(email) {
    for (const [k, s] of Object.entries(sessoes.dados)) {
        if (s.tipo === 'user' && s.email === email) delete sessoes.dados[k];
    }
    sessoes.salvar();
}

/* ---------- Limite de tentativas ---------- */

const tentativas = new Map();
const MAX_FALHAS = 8;
const JANELA_MS = 15 * 60 * 1000;

const limite = {
    bloqueado(chave) {
        const t = tentativas.get(chave);
        if (!t) return false;
        if (t.ate < Date.now()) { tentativas.delete(chave); return false; }
        return t.n >= MAX_FALHAS;
    },
    falhou(chave) {
        const t = tentativas.get(chave);
        if (!t || t.ate < Date.now()) tentativas.set(chave, { n: 1, ate: Date.now() + JANELA_MS });
        else t.n++;
    },
    ok(chave) { tentativas.delete(chave); }
};

/* ---------- Senha do administrador ---------- */

function carregarSenhaAdmin() {
    if (process.env.ADMIN_SENHA) {
        if (banco.MODO === 'supabase' && process.env.ADMIN_SENHA.length < 8) {
            throw new Error('ADMIN_SENHA precisa ter pelo menos 8 caracteres.');
        }
        return { senha: process.env.ADMIN_SENHA, origem: 'variável ADMIN_SENHA' };
    }

    // No ar (Supabase) não dá para guardar a chave em arquivo: o disco do Render é apagado a cada reinício.
    if (banco.MODO === 'supabase') {
        throw new Error('Defina a variável ADMIN_SENHA (a chave de administrador, com 8+ caracteres) no Render.');
    }

    const arquivoSenha = path.join(banco.PASTA, 'senha-admin.txt');
    try {
        const lida = fs.readFileSync(arquivoSenha, 'utf-8').trim();
        if (lida) return { senha: lida, origem: arquivoSenha };
    } catch (e) { /* ainda não existe */ }

    const nova = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(arquivoSenha, nova + '\n', { mode: 0o600 });
    return { senha: nova, origem: arquivoSenha };
}

const admin = carregarSenhaAdmin();

function senhaAdminCorreta(tentativa) {
    const a = crypto.createHash('sha256').update(String(tentativa)).digest();
    const b = crypto.createHash('sha256').update(admin.senha).digest();
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    contas, gerarHashSenha, conferirSenha, limparSessoesVencidas,
    criarSessao, lerSessao, encerrarSessao, encerrarSessoesDoUsuario,
    limite, senhaAdminCorreta, infoAdmin: admin
};
