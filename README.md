# NÚCLEO — mini chat privado com modo PiP

O **NÚCLEO** foi pensado para conversas rápidas, sem a necessidade de criar uma conta ou fazer login. O usuário entra apenas com um nome e uma chave de acesso compartilhada.

Com o modo **Picture-in-Picture (PiP)**, a conversa pode ficar em uma janela flutuante enquanto o usuário realiza outras tarefas, troca de aplicação ou minimiza o navegador, mantendo o chat acessível e atualizado em tempo real.

Mini chat privado criado a partir da CLI oficial `create-next-app@latest`.

## Stack

- Next.js 16.3.1 com App Router e TypeScript;
- React 19;
- SQLite local com `sql.js` (WebAssembly, sem binários nativos);
- Server-Sent Events (SSE) para novas mensagens em tempo real;
- sessão assinada em cookie HttpOnly, sem cadastro, login ou senha.
- mini chat flutuante com Document Picture-in-Picture e fallback para popup.

## Rodando localmente

1. Copie `.env.example` para `.env.local` e defina uma chave forte:

   ```env
   CHAT_ACCESS_KEY=minha-chave-compartilhada
   CHAT_SESSION_SECRET=um-segredo-longo-e-diferente
   ```

2. Inicie o servidor:

   ```bash
   npm run dev
   ```

Abra `http://localhost:25000` e compartilhe a mesma chave somente com as pessoas autorizadas.

O banco é criado automaticamente em `data/chat.db`. Essa pasta está ignorada pelo Git para que o histórico local não seja versionado. A cada mensagem, o arquivo é persistido no disco; para este mini chat em uma única instância, isso evita depender de extensões nativas do sistema.

## Mini chat flutuante

Depois de entrar, use o botão `Mini chat` no header. Em navegadores compatíveis, o chat abre em uma janela Picture-in-Picture que fica sobre outras janelas. Nos demais navegadores, o projeto tenta abrir um popup comum.

O modo Picture-in-Picture exige um contexto seguro; em produção, use HTTPS. O suporte varia entre navegadores, então o popup é mantido como fallback.

## Scripts

```bash
npm run dev       # desenvolvimento
npm run lint      # ESLint
npm run typecheck # TypeScript
npm run build     # build de produção
npm run start     # servidor de produção
```

## Estrutura

- `src/app/page.tsx`: entrada e interface da conversa.
- `src/app/api/access`: valida a chave e cria a sessão.
- `src/app/api/messages`: lê o histórico e grava mensagens.
- `src/app/api/events`: mantém o canal SSE de atualização em tempo real.
- `src/lib/db.ts`: inicialização e consultas do SQLite.
- `src/lib/auth.ts`: assinatura e validação da sessão.
- `src/lib/realtime.ts`: distribuição dos eventos para os navegadores conectados.

## Observação de implantação

O canal de tempo real usa memória do processo para distribuir os eventos. Para uma primeira versão em um único servidor isso é suficiente. Se o chat for executado em múltiplas instâncias, troque o distribuidor por Redis, Postgres LISTEN/NOTIFY ou outro broker compartilhado e use armazenamento SQLite em volume persistente.

Se já existir um banco criado pela versão anterior e houver um arquivo `data/chat.db-wal`, execute antes da troca `sqlite3 data/chat.db "PRAGMA wal_checkpoint(TRUNCATE);"` para incorporar seu conteúdo ao banco principal. A nova versão interrompe a inicialização nessa situação para não correr o risco de perder mensagens. Depois faça o deploy normalmente com `npm ci`, `npm run build` e `npm start`.
