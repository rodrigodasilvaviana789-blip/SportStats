/* ==========================================================
   SportStats - leva os dados do seu computador para o Supabase
   ----------------------------------------------------------
   Use UMA vez, se você já cadastrou partidas e contas testando
   no modo "arquivos" (pasta banco/) e quer ter tudo no Supabase.

   1) Preencha o arquivo .env (veja .env.example)
   2) Rode:   npm run migrar
      (ou:    node --env-file=.env servidor/migrar-para-supabase.js [pasta-do-banco])

   O que ele faz:
   - lê partidas, contas e imagens da pasta banco/
   - envia para o Supabase só o que ainda não existe lá
   - NUNCA apaga nem sobrescreve nada que já esteja no Supabase
   - as sessões de login não são levadas (todos entram de novo)
   ========================================================== */

const fs = require('fs');
const path = require('path');

const temChave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL || !temChave) {
    console.error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY no arquivo .env antes de rodar.');
    process.exit(1);
}

const banco = require('./banco');
const partidas = banco.arquivo('partidas.json', () => []);
const contas = banco.arquivo('contas.json', () => ({}));

const pasta = path.resolve(process.argv[2] || path.join(__dirname, '..', 'banco'));

function lerJson(nome, padrao) {
    try { return JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf-8')); } catch (e) { return padrao; }
}

(async () => {
    if (!fs.existsSync(pasta)) {
        console.error(`Pasta não encontrada: ${pasta}`);
        process.exit(1);
    }
    console.log(`Lendo os dados locais de: ${pasta}`);

    const antes = await banco.carregarTudo();
    console.log(`Já no Supabase: ${antes.partidas} partida(s), ${antes.contas} conta(s), ${antes.imagens} imagem(ns).`);

    // imagens
    let imagensNovas = 0;
    const pastaImagens = path.join(pasta, 'imagens');
    if (fs.existsSync(pastaImagens)) {
        for (const nome of fs.readdirSync(pastaImagens)) {
            if (!/^[a-f0-9]{40}\.(png|jpg|webp|gif)$/.test(nome) || banco.imagens.existe(nome)) continue;
            await banco.imagens.guardar(nome, fs.readFileSync(path.join(pastaImagens, nome)));
            imagensNovas++;
        }
    }

    // partidas (só as que ainda não existem)
    let partidasNovas = 0;
    const idsExistentes = new Set(partidas.dados.map(p => p.id));
    for (const p of lerJson('partidas.json', [])) {
        if (p && p.id && !idsExistentes.has(p.id)) { partidas.dados.push(p); partidasNovas++; }
    }

    // contas (só as que ainda não existem)
    let contasNovas = 0;
    for (const [email, conta] of Object.entries(lerJson('contas.json', {}))) {
        if (!contas.dados[email]) { contas.dados[email] = conta; contasNovas++; }
    }

    await partidas.salvar();
    await contas.salvar();

    console.log(`\nEnviado para o Supabase: ${partidasNovas} partida(s), ${contasNovas} conta(s), ${imagensNovas} imagem(ns).`);
    console.log('Pronto! Nada que já existia foi apagado ou alterado.');
})().catch((erro) => {
    console.error('\nFalhou:', erro.message);
    process.exit(1);
});
