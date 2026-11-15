# Colocar o SportStats no ar

GitHub + Supabase + Render (+ Cloudflare, se tiver domínio próprio).

```
 você  ──git push──▶  GitHub  ──(deploy automático)──▶  Render  ◀──▶  Supabase
                                                          │            (os dados ficam aqui)
 visitantes  ◀────────  link do site  ◀───────────────────┘
                  (Cloudflare fica na frente só se você tiver um domínio)
```

| Serviço | Para que serve | Obrigatório? |
|---|---|---|
| **GitHub** | Guarda o código. Cada `git push` atualiza o site. | Sim |
| **Supabase** | Guarda partidas, contas e imagens. **Não apaga** quando o Render reinicia. | Sim |
| **Render** | Roda o servidor e dá o link `https://...onrender.com`. | Sim |
| **Cloudflare** | Só serve para usar um **domínio próprio** (ex.: `sportstats.com.br`). | Não |

Faça **na ordem**: 1 → 2 → 3 → 4. A parte 5 (Cloudflare) é opcional.

---

## 1. GitHub

1. Crie uma conta em https://github.com e um repositório novo chamado `sportstats`.
   Marque **Private** (privado).
2. No terminal, dentro da pasta do projeto:

   ```
   git init
   git add .
   git status
   ```

   **Confira a lista do `git status`.** Ela NÃO pode mostrar `.env` nem a pasta `banco/`.
   (O arquivo `.gitignore` já impede isso, mas confira.)

3. Envie:

   ```
   git commit -m "SportStats: primeira versão"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/sportstats.git
   git push -u origin main
   ```

> **Regra de ouro:** senhas e chaves **nunca** vão para o GitHub. Elas ficam só nas
> variáveis de ambiente do Render (parte 3).

---

## 2. Supabase

1. Em https://supabase.com, crie um projeto (**New project**). Anote a senha do banco que ele pedir
   (o SportStats não usa essa senha, mas é bom guardar).
2. Abra **SQL Editor > New query**, cole **todo** o conteúdo do arquivo `supabase.sql` e clique em **Run**.
   Deve aparecer "Success". Em **Table Editor** você verá 4 tabelas: `partidas`, `contas`, `sessoes`, `imagens`.
   (Pode rodar de novo sem problema: ele não apaga nada.)
3. Pegue 2 informações:
   - **O endereço do projeto** (Project URL), parecido com `https://abcdefgh.supabase.co`.
     Fica em **Project Settings** (ou no botão **Connect** do projeto).
   - **A chave SECRETA**, em **Project Settings > API Keys**:
     - Aba **"Publishable and secret API keys"**: copie a chave `sb_secret_...`
       (se aparecer o botão "Create new API keys", clique nele primeiro).
     - Em projetos antigos, use a aba **"Legacy API Keys"** e copie a **`service_role`**.

> ⚠️ Use a chave **secret** (ou `service_role`). **Nunca** a "publishable" nem a "anon".
> A chave secret dá acesso total ao banco: guarde como uma senha e jamais publique.

O `supabase.sql` já deixa o banco **fechado**: quem tiver só a chave pública não lê nem grava nada.
Somente o servidor do SportStats, com a chave secreta, acessa os dados.

---

## 3. Render

### Jeito rápido (Blueprint, usa o arquivo `render.yaml`)

1. Em https://render.com, crie a conta (entre com o GitHub).
2. **New + > Blueprint** e escolha o repositório `sportstats`.
3. O Render pede 3 valores. Preencha:

   | Variável | Valor |
   |---|---|
   | `SUPABASE_URL` | o endereço do projeto (parte 2) |
   | `SUPABASE_SECRET_KEY` | a chave secreta (parte 2) |
   | `ADMIN_SENHA` | uma **chave de administrador** inventada por você, com 8+ caracteres. Guarde-a. |

4. Clique em **Apply** e espere o deploy.

### Jeito manual (se preferir)

**New + > Web Service**, escolha o repositório e configure:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node servidor/server.js` |
| Instance type | Free |
| Health Check Path | `/api/saude` |
| Environment | as 3 variáveis acima + `NODE_VERSION` = `22` |

### Conferir se deu certo

Abra a aba **Logs** do serviço. Você deve ver algo como:

```
Armazenamento: Supabase
Supabase conectado: 0 partida(s), 0 conta(s), 0 imagem(ns).
SportStats no ar!
```

O link do site está no topo da página do serviço: `https://sportstats-xxxx.onrender.com`.

---

## 4. Teste final (prova de que os dados não se perdem)

1. Abra o link do site e **crie uma conta** (`cadastro.html`).
2. Vá em **Perfil > Ativar acesso de administrador** e digite a `ADMIN_SENHA`. (Só na primeira vez.)
3. Cadastre uma partida com escudos.
4. No Render: **Manual Deploy > Restart service** (ou faça um novo `git push`).
5. Quando voltar, abra o site de **outro aparelho**: a partida e a conta têm que estar lá.

Se isso funcionou, o site está pronto para apresentar.

---

## 5. Cloudflare (opcional: só com domínio próprio)

Sem domínio, **pule esta parte**: o link `onrender.com` já funciona e tem HTTPS.

Com domínio (siga a ordem; ela segue a documentação do Render):

1. **No Render:** abra o serviço > **Settings > Custom Domains** e adicione `seudominio.com` e `www.seudominio.com`.
2. **No Cloudflare:** adicione seu domínio ao Cloudflare e aponte os nameservers (no lugar onde comprou o domínio).
3. **Cloudflare > SSL/TLS > Overview:** deixe o modo em **Full**.
4. **Cloudflare > DNS > Records:** crie 2 registros **CNAME**:

   | Tipo | Nome | Destino | Proxy |
   |---|---|---|---|
   | CNAME | `@` | `sportstats-xxxx.onrender.com` | **DNS only** (nuvem cinza) |
   | CNAME | `www` | `sportstats-xxxx.onrender.com` | **DNS only** (nuvem cinza) |

   Não crie registros `AAAA` (o Render usa IPv4).
5. **No Render:** volte em Custom Domains e clique em **Verify**. Espere os certificados ficarem válidos.
6. **Só depois disso**, se quiser, mude o Proxy dos dois registros para **Proxied** (nuvem laranja).

Dicas:
- Se, depois de um deploy, aparecer um visual ou comportamento antigo, use **Caching > Purge Everything** no Cloudflare.
- Se algo do site parar de funcionar só com o proxy ligado, desative otimizações de JavaScript do Cloudflare (como o Rocket Loader).

---

## 6. Dia a dia

```
(edite os arquivos)  →  git add .  →  git commit -m "o que mudou"  →  git push
```

O Render percebe o `push` e atualiza o site sozinho em poucos minutos.
Os dados **não são afetados**: ficam no Supabase.

### Levar o que você já cadastrou no seu computador para o Supabase (uma vez, opcional)

Se você já cadastrou partidas e contas testando localmente (pasta `banco/`):

1. Copie `.env.example` para `.env` e preencha as 3 variáveis.
2. Rode `npm run migrar`.

Ele envia só o que **ainda não existe** no Supabase e nunca apaga nem sobrescreve nada.
(Precisa do Node 20.6 ou mais novo, por causa do `--env-file`.)

---

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| Logs do Render: **"O Supabase recusou a chave"** | A `SUPABASE_SECRET_KEY` está errada ou é a publishable/anon. Copie a **secret** (ou `service_role`). |
| **"Tabela não encontrada no Supabase"** | Rode o `supabase.sql` no SQL Editor (parte 2). |
| **"Não consegui falar com o Supabase"** | Confira a `SUPABASE_URL`. No plano gratuito, o Supabase **pausa o projeto após 7 dias sem uso**: abra o painel e restaure o projeto. |
| **"Defina a variável ADMIN_SENHA"** | Crie a variável `ADMIN_SENHA` no Render (8+ caracteres). |
| Site **demora cerca de um minuto** no primeiro acesso | É o plano gratuito do Render, que "dorme" sem acessos. **Abra o site antes de apresentar.** |
| Mensagem **"Não consegui salvar agora"** (503) | O Supabase ficou indisponível por instantes. Tente de novo. Nada fica salvo pela metade. |
| **Notícias vazias** logo após ligar | Aguarde cerca de um minuto: o servidor busca as notícias ao iniciar. Veja `/api/status`. |
| Alterei o código e o site não mudou | Confira se o `git push` foi feito e se o deploy no Render terminou. Com Cloudflare, faça o Purge. |

## Segurança

- Se a chave secret do Supabase vazar (ex.: foi parar no GitHub), crie uma nova no painel do Supabase,
  apague a antiga e atualize a variável no Render. Troque também a `ADMIN_SENHA`.
- Mantenha o repositório **privado**.
- Não compartilhe a `ADMIN_SENHA`: quem a tiver pode promover qualquer conta a administradora.
- O servidor só se conecta ao Supabase por `https://`.

## O que foi testado (e o que não)

Testado automaticamente (`npm test`, 31 verificações) contra um **simulador** do Supabase que imita as
regras da API deles: gravação, leitura de mais de 1000 linhas, falhas de conexão, chave errada, tabela
inexistente, e **reinício do servidor com o disco apagado** (os dados voltam).
Não foi possível testar contra o Supabase, o Render e o Cloudflare **reais** (sem internet no ambiente
de desenvolvimento). Por isso, o servidor mostra mensagens claras no log quando algo está errado, e a
parte 4 deste guia serve como teste final.
