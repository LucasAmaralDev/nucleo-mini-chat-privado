# Núcleo — mini chat

Mini chat privado criado a partir da CLI oficial `create-next-app@latest`.

## Stack

- Next.js 16.3.1 com App Router e TypeScript;
- React 19;
- SQLite local com `better-sqlite3`;
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

Abra `http://localhost:3000` e compartilhe a mesma chave somente com as pessoas autorizadas.

O banco é criado automaticamente em `data/chat.db`. Essa pasta está ignorada pelo Git para que o histórico local não seja versionado.

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
