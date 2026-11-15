/* ==========================================================
   SportStats - configuração do servidor de notícias
   ----------------------------------------------------------
   Aqui você escolhe DE ONDE vêm as notícias e COMO elas são
   organizadas. Não precisa mexer no server.js.
   ========================================================== */

// Google Notícias em RSS: junta vários portais (GE, Lance!, ESPN, CNN...)
// e é gratuito. O "when:7d" limita às notícias da última semana.
function googleNoticias(busca) {
    const q = encodeURIComponent(`${busca} when:7d`);
    return `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

module.exports = {

    // De quantos em quantos minutos o servidor busca notícias novas
    intervaloMinutos: 10,

    // Notícias mais velhas que isso (em dias) somem da lista
    maxDias: 7,

    // Quantas notícias guardar no total
    maxTotal: 300,

    // Quantas notícias pegar de cada fonte por vez
    maxPorFonte: 15,

    /* FONTES
       - nome: só para os logs
       - url:  endereço do feed RSS
       - tag:  (opcional) etiqueta dada a TODAS as notícias dessa fonte.
       Para adicionar um portal que tenha RSS, é só incluir uma linha:
       { nome: 'Meu portal', url: 'https://site.com/feed.xml', tag: 'Brasileirão' } */
    feeds: [
        // Campeonatos
        { nome: 'Brasileirão',    url: googleNoticias('Campeonato Brasileiro futebol'), tag: 'Brasileirão' },
        { nome: 'Libertadores',   url: googleNoticias('Libertadores futebol'),          tag: 'Libertadores' },
        { nome: 'Copa do Brasil', url: googleNoticias('Copa do Brasil futebol'),        tag: 'Copa do Brasil' },
        { nome: 'Champions',      url: googleNoticias('Champions League'),              tag: 'Champions League' },

        // Times
        { nome: 'Flamengo',      url: googleNoticias('Flamengo futebol'),      tag: 'Flamengo' },
        { nome: 'Palmeiras',     url: googleNoticias('Palmeiras futebol'),     tag: 'Palmeiras' },
        { nome: 'Corinthians',   url: googleNoticias('Corinthians futebol'),   tag: 'Corinthians' },
        { nome: 'São Paulo',     url: googleNoticias('"São Paulo FC"'),        tag: 'São Paulo' },
        { nome: 'Santos',        url: googleNoticias('Santos FC futebol'),     tag: 'Santos' },
        { nome: 'Fluminense',    url: googleNoticias('Fluminense futebol'),    tag: 'Fluminense' },
        { nome: 'Vasco',         url: googleNoticias('Vasco da Gama futebol'), tag: 'Vasco' },
        { nome: 'Botafogo',      url: googleNoticias('Botafogo futebol'),      tag: 'Botafogo' },
        { nome: 'Grêmio',        url: googleNoticias('Grêmio futebol'),        tag: 'Grêmio' },
        { nome: 'Internacional', url: googleNoticias('Internacional futebol'), tag: 'Internacional' },
        { nome: 'Atlético-MG',   url: googleNoticias('Atlético Mineiro'),      tag: 'Atlético-MG' },
        { nome: 'Cruzeiro',      url: googleNoticias('Cruzeiro futebol'),      tag: 'Cruzeiro' },
        { nome: 'Bahia',         url: googleNoticias('Bahia futebol EC'),      tag: 'Bahia' },
        { nome: 'Fortaleza',     url: googleNoticias('Fortaleza futebol'),     tag: 'Fortaleza' }
    ],

    /* DETECÇÃO AUTOMÁTICA DE ETIQUETAS
       Se o título da notícia tiver uma dessas palavras (palavra inteira), ela ganha a
       etiqueta (sem diferenciar maiúsculas nem acentos). Assim uma
       notícia que veio da fonte "Flamengo" mas fala do Palmeiras
       também aparece na aba do Palmeiras. */
    etiquetas: [
        { nome: 'Brasileirão',      palavras: ['brasileirao', 'campeonato brasileiro', 'serie a'] },
        { nome: 'Libertadores',     palavras: ['libertadores'] },
        { nome: 'Copa do Brasil',   palavras: ['copa do brasil'] },
        { nome: 'Champions League', palavras: ['champions'] },

        { nome: 'Flamengo',      palavras: ['flamengo', 'mengao'] },
        { nome: 'Palmeiras',     palavras: ['palmeiras', 'verdao'] },
        { nome: 'Corinthians',   palavras: ['corinthians', 'timao'] },
        { nome: 'São Paulo',     palavras: ['sao paulo fc', 'spfc', 'tricolor paulista'] },
        { nome: 'Santos',        palavras: ['santos fc', 'peixe'] },
        { nome: 'Fluminense',    palavras: ['fluminense', 'flu'] },
        { nome: 'Vasco',         palavras: ['vasco'] },
        { nome: 'Botafogo',      palavras: ['botafogo'] },
        { nome: 'Grêmio',        palavras: ['gremio'] },
        { nome: 'Internacional', palavras: ['sc internacional', 'inter de porto alegre', 'colorado'] },
        { nome: 'Atlético-MG',   palavras: ['atletico-mg', 'atletico mineiro', 'galo'] },
        { nome: 'Cruzeiro',      palavras: ['cruzeiro'] },
        { nome: 'Bahia',         palavras: ['bahia'] },
        { nome: 'Fortaleza',     palavras: ['fortaleza'] }
    ]
};
