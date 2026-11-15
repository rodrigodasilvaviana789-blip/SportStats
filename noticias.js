/* ==========================================================
   SportStats - notícias (lado do site)
   ----------------------------------------------------------
   Busca as notícias no servidor (servidor/server.js) e monta
   os cartões. Depende de dados.js (esc, obterTime, htmlEscudo).
   ========================================================== */

// O site e as notícias vêm do mesmo servidor.
const API_NOTICIAS = '';

async function buscarNoticias({ tag = '', limite = 20 } = {}) {
    const q = new URLSearchParams();
    if (tag) q.set('tag', tag);
    q.set('limite', limite);
    const resposta = await fetch(`${API_NOTICIAS}/api/noticias?${q}`);
    if (!resposta.ok) throw new Error('Servidor respondeu ' + resposta.status);
    return resposta.json();
}

async function buscarTags() {
    const resposta = await fetch(`${API_NOTICIAS}/api/tags`);
    if (!resposta.ok) throw new Error('Servidor respondeu ' + resposta.status);
    return (await resposta.json()).tags;
}

/* ---------- Utilidades ---------- */

function tempoRelativo(iso) {
    const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(minutos) || minutos < 0) return '';
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.floor(horas / 24);
    return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

// Só deixa passar links http/https (nunca javascript:)
function linkSeguro(url) {
    return /^https?:\/\//i.test(url || '') ? url : '#';
}

// Cor do cartão sem foto: usa a cor do time (se cadastrado) ou uma cor estável pela etiqueta
function fundoNoticia(tag) {
    const time = tag ? obterTime(tag) : null;
    if (time && /^#[0-9a-fA-F]{6}$/.test(time.cor || '')) {
        return `linear-gradient(135deg, ${time.cor}, #101310)`;
    }
    let h = 0;
    for (const c of tag || 'x') h = (h * 31 + c.charCodeAt(0)) % 360;
    return `linear-gradient(135deg, hsl(${h} 55% 28%), hsl(${h} 45% 8%))`;
}

function miolo(n) {
    const tag = (n.tags && n.tags[0]) || '';
    const time = tag ? obterTime(tag) : null;
    const simbolo = time && time.escudo ? htmlEscudo(time.escudo) : '⚽';
    return `<div class="imagem-noticia" style="background:${fundoNoticia(tag)}">
                <span class="simbolo-noticia">${simbolo}</span>
                ${n.imagem ? `<img class="foto-noticia" src="${esc(n.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
            </div>`;
}

// Se a foto não carregar, some e aparece o símbolo/cor do fundo
function tratarImagens(raiz) {
    raiz.querySelectorAll('img.foto-noticia').forEach(img => {
        img.addEventListener('error', () => img.remove());
    });
}

function rotuloTag(n) {
    return n.tags && n.tags.length ? esc(n.tags[0]).toUpperCase() : esc(n.fonte).toUpperCase();
}

/* Cartão compacto (lateral da tela inicial) */
function htmlNoticiaLateral(n) {
    return `
        <a class="noticia noticia-link" href="${esc(linkSeguro(n.link))}" target="_blank" rel="noopener noreferrer">
            ${miolo(n)}
            <div class="texto-noticia">
                <span class="nome-time">${rotuloTag(n)}</span>
                <h3>${esc(n.titulo)}</h3>
                <small>${esc(n.fonte)} • ${tempoRelativo(n.data)}</small>
            </div>
        </a>`;
}

/* Cartão grande (página de notícias) */
function htmlNoticiaCartao(n) {
    const outras = (n.tags || []).slice(1, 3).map(t => `<span class="etiqueta">${esc(t)}</span>`).join('');
    return `
        <a class="cartao-noticia" href="${esc(linkSeguro(n.link))}" target="_blank" rel="noopener noreferrer">
            ${miolo(n)}
            <div class="texto-noticia">
                <span class="nome-time">${rotuloTag(n)}</span>
                <h3>${esc(n.titulo)}</h3>
                ${n.resumo ? `<p>${esc(n.resumo)}</p>` : ''}
                <div class="rodape-cartao">
                    <small>${esc(n.fonte)} • ${tempoRelativo(n.data)}</small>
                    ${outras}
                </div>
            </div>
        </a>`;
}
