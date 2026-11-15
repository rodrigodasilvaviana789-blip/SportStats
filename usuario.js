/* ==========================================================
   SportStats - conta do usuário e sessão
   ----------------------------------------------------------
   As contas ficam no SERVIDOR. A senha viaja para o servidor,
   que guarda só um "hash" dela, e o login fica num cookie
   protegido (HttpOnly) que o JavaScript do site não consegue ler.
   Depende de dados.js (usa api() e esc()).

   Antes de usar usuarioAtual() / ehAdmin() em uma tela, espere
   carregarSessao() terminar.
   ========================================================== */

let sessao = null;
let promessaSessao = null;

// Pergunta ao servidor quem está logado (e se é administrador)
function carregarSessao(forcar) {
    if (!promessaSessao || forcar) {
        promessaSessao = api('GET', '/api/sessao')
            .then((s) => { sessao = s; return s; })
            .catch(() => { sessao = { usuario: null, admin: false }; return sessao; });
    }
    return promessaSessao;
}

function usuarioAtual() {
    return sessao ? sessao.usuario : null;
}

function ehAdmin() {
    return !!(sessao && sessao.admin);
}

/* ---------- Contas ---------- */

async function criarConta({ nome, email, senha }) {
    await api('POST', '/api/auth/cadastro', { nome, email, senha });
    await carregarSessao(true);
}

async function entrar(email, senha) {
    await api('POST', '/api/auth/entrar', { email, senha });
    await carregarSessao(true);
}

async function sair() {
    await api('POST', '/api/auth/sair');
    await carregarSessao(true);
}

// campos: nome, timeCoracao, foto (a foto pode ser enviada como data:image/...)
async function atualizarUsuario(campos) {
    await api('PATCH', '/api/auth/eu', campos);
    await carregarSessao(true);
}

async function excluirContaAtual() {
    await api('DELETE', '/api/auth/eu');
    await carregarSessao(true);
}

/* ---------- Administrador (quem cadastra partidas) ---------- */

// A conta que está logada vira administradora ao digitar a chave (só na primeira vez).
// Depois disso, basta entrar normalmente com e-mail e senha.
async function entrarAdmin(senha) {
    await api('POST', '/api/admin/entrar', { senha });
    await carregarSessao(true);
}


/* ---------- Voltar para onde a pessoa estava ---------- */

// ?voltar=cadastrar-partida.html  ->  só aceita páginas .html do próprio site
function paginaDeRetorno() {
    const voltar = new URLSearchParams(window.location.search).get('voltar') || '';
    return /^[a-zA-Z0-9_-]+\.html$/.test(voltar) ? voltar : 'inicio.html';
}

// Mantém o ?voltar nos links entre "entrar" e "cadastrar"
function propagarRetorno() {
    const voltar = new URLSearchParams(window.location.search).get('voltar');
    if (!voltar || paginaDeRetorno() === 'inicio.html') return;
    document.querySelectorAll('a[href="index.html"], a[href="cadastro.html"]').forEach((a) => {
        a.href = a.getAttribute('href') + '?voltar=' + encodeURIComponent(voltar);
    });
}

/* ---------- Cabeçalho ---------- */

/* Transforma o 👤 do cabeçalho em link para o perfil (mostra a foto ou a
   inicial do nome) e esconde "Cadastrar partida" de quem não é administrador. */
async function ativarIconePerfil() {
    await carregarSessao();

    if (!ehAdmin()) {
        document.querySelectorAll('.menu-superior a[href="cadastrar-partida.html"]').forEach(a => a.remove());
    }

    const icone = document.querySelector('.perfil');
    if (!icone) return;

    const u = usuarioAtual();
    let conteudo = '👤';

    if (u && u.foto) {
        conteudo = `<img class="foto-mini" src="${esc(u.foto)}" alt="Meu perfil">`;
    } else if (u && u.nome) {
        conteudo = `<span class="inicial-mini">${esc(u.nome.trim().charAt(0).toUpperCase())}</span>`;
    }

    icone.innerHTML = `<a href="${u ? 'perfil.html' : 'index.html'}" title="${u ? 'Meu perfil' : 'Entrar'}">${conteudo}</a>`;
}

document.addEventListener('DOMContentLoaded', ativarIconePerfil);
