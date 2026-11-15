# SportStats

Estatísticas, classificação e notícias de futebol.

> **Quer colocar o site no ar (GitHub + Supabase + Render + Cloudflare)?**
> Siga o passo a passo em **[COLOCAR-NO-AR.md](COLOCAR-NO-AR.md)**.

## 1. Rodar no seu computador

1. Instale o **Node.js** (versão 18 ou mais nova, https://nodejs.org). Não precisa de `npm install`.
2. Na pasta do projeto: `node servidor/server.js` (no Windows, dá para clicar duas vezes em `iniciar.bat`).
3. Abra **http://localhost:3000**.

Assim o site guarda os dados em arquivos na pasta `banco/` (modo "arquivos"), só para testar.
Para parar: `Ctrl + C`.

> Não abra os arquivos `.html` direto da pasta. O site só funciona pelo endereço do servidor.

### Testar usando o Supabase (como no site no ar)

1. Copie `.env.example` para `.env` e preencha (veja a parte 2 do `COLOCAR-NO-AR.md`).
2. Rode `npm run start:supabase` (precisa do Node 20.6 ou mais novo).

O servidor escolhe sozinho o modo: **com** `SUPABASE_URL` e `SUPABASE_SECRET_KEY` usa o Supabase,
**sem** elas usa arquivos. O log mostra qual está em uso.

## 2. Administrador

O administrador é uma **conta comum** (e-mail e senha) promovida uma vez com a **chave de administrador**.

1. Crie sua conta em `cadastro.html` e entre.
2. Abra o **Perfil > Ativar acesso de administrador** (ou vá em `/cadastrar-partida.html`).
3. Digite a **chave de administrador** (só na primeira vez).
4. Pronto: daí em diante é só entrar com e-mail e senha, em qualquer aparelho, e o link
   "Cadastrar partida" aparece no menu. Usuários comuns não veem o link e o servidor recusa
   qualquer tentativa deles.

Onde está a chave:
- **Local, modo arquivos:** aparece no terminal ao ligar e fica em `banco/senha-admin.txt`.
- **No ar (Render):** é a variável `ADMIN_SENHA` (obrigatória, 8+ caracteres).

Depois de 8 chaves erradas, as tentativas travam por 15 minutos.
**Não compartilhe a chave:** quem a tiver pode promover qualquer conta a administradora.

## 3. Mostrar para outros aparelhos

- **Mesma rede Wi-Fi:** ao ligar, o terminal mostra algo como `http://192.168.0.10:3000`. Abra no celular.
  Se o Windows perguntar sobre o firewall, permita.
- **Demonstração rápida de qualquer lugar** (sem hospedar): com o servidor ligado, rode
  `cloudflared tunnel --url http://localhost:3000` (instale com `winget install --id Cloudflare.cloudflared`).
  O link `https://....trycloudflare.com` **muda a cada vez**, e seu computador precisa ficar ligado.
- **Link fixo, 24 horas:** `COLOCAR-NO-AR.md`.

## 4. Testes automáticos

`npm test` roda 31 verificações (permissões, validação, segurança, e se os dados sobrevivem a um
reinício) nos dois modos de armazenamento. Não precisa de internet.

## 5. Notícias automáticas

- Vêm de feeds RSS (por padrão, Google Notícias: GE, Lance!, ESPN, CNN etc.), atualizadas a cada 10 minutos.
- O site mostra título, trecho curto, fonte e link da matéria original.
- Para mudar fontes, times ou intervalo, edite `servidor/config.js`.
- Para ver se cada fonte responde: `/api/status`.

## 6. Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` / `cadastro.html` | Login e criação de conta |
| `inicio.html` | Lista de jogos + notícias na lateral |
| `partida.html` | Estatísticas de uma partida (`?id=...`) |
| `noticias.html` | Todas as notícias, com filtro por time/campeonato |
| `classificacao.html` | Tabela de classificação de cada campeonato |
| `cadastrar-partida.html` | Cadastro das partidas (só administrador) |
| `perfil.html` | Perfil do usuário |
| `dados.js` / `usuario.js` / `noticias.js` | Conversa do site com o servidor |
| `servidor/server.js` | Servidor: entrega o site e junta tudo |
| `servidor/api.js` | Partidas, contas e administrador (com validação) |
| `servidor/auth.js` | Senhas, sessões e limite de tentativas |
| `servidor/banco.js` | Armazenamento: Supabase ou arquivos |
| `servidor/config.js` | Fontes e etiquetas das notícias |
| `servidor/migrar-para-supabase.js` | Leva dados locais para o Supabase (`npm run migrar`) |
| `supabase.sql` | Cria as tabelas no Supabase |
| `render.yaml` | Configuração do Render |
| `.env.example` | Modelo das variáveis (copie para `.env`) |
| `COLOCAR-NO-AR.md` | Passo a passo para publicar |
| `teste/` | Testes automáticos |
