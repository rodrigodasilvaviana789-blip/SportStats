/* ==========================================================
   SportStats - camada de dados
   ----------------------------------------------------------
   TODAS as telas pegam os dados por aqui. As partidas ficam no
   SERVIDOR (servidor/server.js), então qualquer aparelho que
   abra o site vê as mesmas partidas.
   Para ligar a API-Football, o servidor passa a buscar lá e
   estas funções continuam iguais.
   ========================================================== */

/* ---------- Conversa com o servidor ---------- */

async function api(metodo, caminho, corpo) {
    const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
    if (corpo !== undefined) {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(corpo);
    }

    let resposta;
    try {
        resposta = await fetch(caminho, opcoes);
    } catch (e) {
        const erro = new Error('Não consegui falar com o servidor. Ele está ligado?');
        erro.status = 0;
        throw erro;
    }

    let dados = null;
    try { dados = await resposta.json(); } catch (e) { /* resposta sem JSON */ }

    if (!resposta.ok) {
        const erro = new Error((dados && dados.erro) || `Erro ${resposta.status}`);
        erro.status = resposta.status;
        throw erro;
    }
    return dados;
}

// Se abriram o HTML direto do arquivo, avisa como abrir do jeito certo
if (window.location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', () => {
        const aviso = document.createElement('div');
        aviso.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;padding:10px 16px;font:14px sans-serif;text-align:center';
        aviso.innerHTML = 'Abra o site pelo servidor: rode <b>node servidor/server.js</b> e acesse <b>http://localhost:3000</b>';
        document.body.prepend(aviso);
    });
}

/* Lista de estatísticas. Para criar uma nova, basta adicionar
   uma linha aqui: ela aparece sozinha no formulário e na tela
   da partida. */
const ESTATISTICAS = [
    { chave: 'posse',        nome: 'Posse de bola',                   sufixo: '%' },
    { chave: 'finalizacoes', nome: 'Finalizações',                    sufixo: ''  },
    { chave: 'escanteios',   nome: 'Escanteios',                      sufixo: ''  },
    { chave: 'faltas',       nome: 'Faltas',                          sufixo: ''  },
    { chave: 'chances',      nome: 'Chances criadas (perigo de gol)', sufixo: ''  },
    { chave: 'desarmes',     nome: 'Desarmes',                        sufixo: ''  },
    { chave: 'amarelos',     nome: '🟨 Cartões amarelos',             sufixo: ''  },
    { chave: 'vermelhos',    nome: '🟥 Cartões vermelhos',            sufixo: ''  }
];

const STATUS = {
    agendada:  'Agendada',
    aovivo:    'Ao vivo',
    encerrada: 'Encerrada'
};

/* ---------- Partidas ---------- */

async function listarPartidas() {
    return api('GET', '/api/partidas');
}

async function obterPartida(id) {
    try {
        return await api('GET', '/api/partidas/' + encodeURIComponent(id));
    } catch (erro) {
        if (erro.status === 404) return null;
        throw erro;
    }
}

// Só o administrador consegue salvar e excluir
async function salvarPartida(partida) {
    return api('POST', '/api/partidas', partida);
}

async function excluirPartida(id) {
    await api('DELETE', '/api/partidas/' + encodeURIComponent(id));
}

/* ---------- Utilidades ---------- */

function formatarData(iso) {
    if (!iso) return '—';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
}

// Escapa texto para não quebrar o HTML (o que o usuário digita vira texto puro)
function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Só aceita cor no formato #rrggbb
function corSegura(cor, padrao) {
    return /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : padrao;
}


/* ==========================================================
   ESCUDOS (imagem) e biblioteca de times
   ----------------------------------------------------------
   O campo "escudo" de um time pode ser:
   - uma imagem enviada (o servidor guarda e devolve /imagens/...)
   - o link de uma imagem (https://...) -> é assim que a
     API-Football entrega os escudos
   - um emoji (como era antes)
   ========================================================== */

function ehImagem(valor) {
    return /^(data:image\/|https?:\/\/|\/imagens\/)/i.test(valor || '');
}

// Devolve o HTML do escudo: <img> se for imagem, senão o emoji (ou ⚽)
function htmlEscudo(valor, tamanho) {
    if (ehImagem(valor)) {
        const estilo = tamanho ? ` style="width:${tamanho}px;height:${tamanho}px"` : '';
        return `<img class="escudo-img" src="${esc(valor)}" alt=""${estilo}>`;
    }
    return esc(valor) || '⚽';
}

// Reduz a imagem para não encher o armazenamento do navegador
function redimensionarImagem(arquivo, max, tipo) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onerror = reject;
        leitor.onload = () => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const w = img.width || max;
                const h = img.height || max;
                const fator = Math.min(1, max / Math.max(w, h));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(w * fator));
                canvas.height = Math.max(1, Math.round(h * fator));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL(tipo || 'image/png', 0.85));
            };
            img.src = leitor.result;
        };
        leitor.readAsDataURL(arquivo);
    });
}

/* Biblioteca de times: o servidor monta a lista a partir das partidas
   (escudo e cor mais recentes de cada time). Chame carregarTimes() antes
   de usar obterTime() / nomesDeTimes(). */

let timesCache = {};

async function carregarTimes() {
    try {
        timesCache = await api('GET', '/api/times');
    } catch (erro) {
        timesCache = {};
    }
    return timesCache;
}

function obterTime(nome) {
    return timesCache[(nome || '').trim().toLowerCase()] || null;
}

function nomesDeTimes() {
    return Object.values(timesCache).map(t => t.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}


/* ==========================================================
   CLASSIFICAÇÃO DOS CAMPEONATOS
   ----------------------------------------------------------
   Por enquanto a tabela é CALCULADA a partir das partidas
   encerradas que você cadastrou. Quando ligarmos a API-Football,
   é só trocar o corpo de obterClassificacao() por um fetch ao
   servidor: a tela (classificacao.html) continua igual.
   ========================================================== */

/* Zonas coloridas da tabela (Libertadores, rebaixamento...).
   Ajuste as posições se o regulamento mudar. */
const ZONAS_BRASILEIRAO = [
    { de: 1,  ate: 4,  nome: 'Libertadores (fase de grupos)', cor: '#3b82f6' },
    { de: 5,  ate: 6,  nome: 'Pré-Libertadores',              cor: '#38bdf8' },
    { de: 7,  ate: 12, nome: 'Sul-Americana',                 cor: '#f59e0b' },
    { de: 17, ate: 20, nome: 'Rebaixamento',                  cor: '#ef4444' }
];

function zonasDoCampeonato(nome) {
    // reconhece "Campeonato Brasileiro", "Brasileirão Série A", etc.
    return /brasileir/i.test(nome || '') ? ZONAS_BRASILEIRAO : [];
}

function chaveCampeonato(nome) {
    return (nome || '').trim().toLowerCase();
}

// Lista os campeonatos que têm partidas cadastradas (o primeiro nome digitado é o exibido)
async function listarCampeonatos() {
    const vistos = new Map();
    (await listarPartidas()).forEach(p => {
        const chave = chaveCampeonato(p.campeonato);
        if (chave && !vistos.has(chave)) vistos.set(chave, p.campeonato.trim());
    });
    return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/* Devolve { campeonato, jogosConsiderados, tabela:[...] }.
   Cada linha: { pos, nome, escudo, pontos, j, v, e, d, gp, gc, sg, forma:['V','E','D'...] } */
async function obterClassificacao(campeonato) {
    const chave = chaveCampeonato(campeonato);

    const jogos = (await listarPartidas())
        .filter(p => chaveCampeonato(p.campeonato) === chave && p.status === 'encerrada')
        .sort((a, b) => ((a.data || '') + (a.hora || '')).localeCompare((b.data || '') + (b.hora || '')));

    const times = new Map();

    function registro(time) {
        const nome = (time.nome || '').trim();
        const k = nome.toLowerCase();
        if (!times.has(k)) {
            times.set(k, { nome, escudo: '', j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, forma: [] });
        }
        const r = times.get(k);
        r.nome = nome;
        if (time.escudo) r.escudo = time.escudo; // fica com o escudo da partida mais recente
        return r;
    }

    function aplicar(r, feitos, sofridos) {
        r.j++;
        r.gp += feitos;
        r.gc += sofridos;
        const resultado = feitos > sofridos ? 'V' : feitos < sofridos ? 'D' : 'E';
        if (resultado === 'V') r.v++; else if (resultado === 'E') r.e++; else r.d++;
        r.forma.push(resultado);
    }

    jogos.forEach(p => {
        if (!(p.casa.nome || '').trim() || !(p.fora.nome || '').trim()) return;
        const golsCasa = Number(p.casa.gols) || 0;
        const golsFora = Number(p.fora.gols) || 0;
        aplicar(registro(p.casa), golsCasa, golsFora);
        aplicar(registro(p.fora), golsFora, golsCasa);
    });

    const tabela = [...times.values()].map(r => ({
        ...r,
        pontos: r.v * 3 + r.e,
        sg: r.gp - r.gc,
        forma: r.forma.slice(-5) // últimos 5, do mais antigo para o mais recente
    }));

    // Critérios: pontos, vitórias, saldo de gols, gols pró, nome
    tabela.sort((a, b) =>
        b.pontos - a.pontos || b.v - a.v || b.sg - a.sg || b.gp - a.gp ||
        a.nome.localeCompare(b.nome, 'pt-BR'));

    tabela.forEach((r, i) => { r.pos = i + 1; });

    return { campeonato, jogosConsiderados: jogos.length, tabela };
}
