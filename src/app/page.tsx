"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
};

type ViewState = "checking" | "locked" | "chat";

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatDate(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function HomePage() {
  const [view, setView] = useState<ViewState>("checking");
  const [name, setName] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const closeRealtime = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsConnected(false);
  }, []);

  const openRealtime = useCallback(() => {
    closeRealtime();
    const source = new EventSource("/api/events");
    eventSourceRef.current = source;

    source.onopen = () => setIsConnected(true);
    source.onerror = () => setIsConnected(false);
    source.addEventListener("message", (event) => {
      const nextMessage = JSON.parse(event.data) as Message;
      setMessages((current) =>
        current.some((message) => message.id === nextMessage.id)
          ? current
          : [...current, nextMessage],
      );
    });
  }, [closeRealtime]);

  const loadConversation = useCallback(async () => {
    try {
      const response = await fetch("/api/messages", { cache: "no-store" });
      if (!response.ok) {
        setView("locked");
        return;
      }

      const payload = (await response.json()) as {
        name: string;
        messages: Message[];
      };
      setName(payload.name);
      setMessages(payload.messages);
      setView("chat");
      openRealtime();
    } catch {
      setError("Não foi possível carregar a conversa.");
      setView("locked");
    }
  }, [openRealtime]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadConversation();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      closeRealtime();
    };
  }, [closeRealtime, loadConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, key: accessKey }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error || "Não foi possível liberar o acesso.");
        return;
      }

      setAccessKey("");
      await loadConversation();
    } catch {
      setError("Não foi possível conectar ao chat agora.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const messageBody = draft.trim();
    if (!messageBody || isSending) return;

    setIsSending(true);
    setError("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: messageBody }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        if (response.status === 401) {
          closeRealtime();
          setView("locked");
        }
        setError(payload.error || "Não foi possível enviar a mensagem.");
        return;
      }

      setDraft("");
    } catch {
      setError("Não foi possível enviar a mensagem.");
    } finally {
      setIsSending(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function handleLogout() {
    closeRealtime();
    await fetch("/api/logout", { method: "POST" });
    setMessages([]);
    setDraft("");
    setError("");
    setView("locked");
  }

  const groupedMessages = messages.reduce<
    Array<{ date: string; messages: Message[] }>
  >((groups, message) => {
    const date = formatDate(message.createdAt);
    const group = groups.find((item) => item.date === date);
    if (group) group.messages.push(message);
    else groups.push({ date, messages: [message] });
    return groups;
  }, []);

  if (view === "checking") {
    return (
      <main className="page-shell centered-shell">
        <div className="loading-mark" aria-label="Carregando" />
      </main>
    );
  }

  if (view === "locked") {
    return (
      <main className="page-shell access-shell">
        <div className="access-layout">
          <section className="intro-copy">
            <div className="brand-lockup">
              <span className="brand-icon" aria-hidden="true"><span /></span>
              <span>NÚCLEO</span>
            </div>
            <p className="eyebrow">CONVERSA PRIVADA</p>
            <h1>Um espaço breve para ideias que precisam circular.</h1>
            <p className="intro-description">
              Entre com seu nome e a chave compartilhada para acompanhar a conversa em tempo real.
            </p>
            <div className="intro-note">
              <span className="pulse-dot" />
              <span>Histórico salvo nesta conversa</span>
            </div>
          </section>

          <section className="access-card" aria-labelledby="access-title">
            <div className="card-kicker">ACESSO AUTORIZADO</div>
            <h2 id="access-title">Entre na conversa</h2>
            <p className="card-description">A chave é compartilhada apenas com quem deve participar.</p>

            <form className="access-form" onSubmit={handleAccess}>
              <label>
                <span>Como podemos chamar você?</span>
                <input
                  autoComplete="nickname"
                  autoFocus
                  maxLength={32}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Seu nome"
                  value={name}
                />
              </label>
              <label>
                <span>Chave de acesso</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="Digite a chave compartilhada"
                  type="password"
                  value={accessKey}
                />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Validando…" : "Abrir conversa"}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className="privacy-hint">Sem cadastro. Sem senha. Apenas uma chave de acesso.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell chat-shell">
      <section className="chat-window" aria-label="Mini chat">
        <header className="chat-header">
          <div className="brand-lockup compact">
            <span className="brand-icon" aria-hidden="true"><span /></span>
            <span>NÚCLEO</span>
          </div>
          <div className="conversation-title">
            <div className="title-line">
              <span className={`connection-dot ${isConnected ? "online" : ""}`} />
              <strong>Conversa principal</strong>
            </div>
            <span>{isConnected ? "Atualizando em tempo real" : "Reconectando…"}</span>
          </div>
          <div className="user-menu">
            <span className="avatar">{getInitials(name)}</span>
            <span className="user-name">{name}</span>
            <button className="logout-button" onClick={handleLogout} type="button">Sair</button>
          </div>
        </header>

        <div className="chat-body">
          <div className="conversation-intro">
            <span className="intro-symbol">✦</span>
            <div>
              <p>Você chegou ao começo.</p>
              <span>As mensagens desta conversa ficam disponíveis no histórico.</span>
            </div>
          </div>

          <div className="message-list" aria-live="polite">
            {groupedMessages.length === 0 ? (
              <div className="empty-chat">
                <span>☼</span>
                <p>A conversa está esperando a primeira mensagem.</p>
              </div>
            ) : (
              groupedMessages.map((group) => (
                <div className="message-group" key={group.date}>
                  <div className="date-divider"><span>{group.date}</span></div>
                  {group.messages.map((message) => {
                    const isMine = message.authorName === name;
                    return (
                      <article className={`message-row ${isMine ? "mine" : ""}`} key={message.id}>
                        {!isMine && <span className="message-avatar">{getInitials(message.authorName)}</span>}
                        <div className="message-content">
                          {!isMine && <span className="message-author">{message.authorName}</span>}
                          <div className="message-bubble">
                            <p>{message.body}</p>
                            <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <footer className="composer-wrap">
          {error && <p className="composer-error" role="alert">{error}</p>}
          <form className="composer" onSubmit={handleSend}>
            <textarea
              aria-label="Mensagem"
              maxLength={2000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Escreva uma mensagem…"
              rows={1}
              value={draft}
            />
            <button aria-label="Enviar mensagem" className="send-button" disabled={!draft.trim() || isSending} type="submit">
              <span aria-hidden="true">↑</span>
            </button>
          </form>
          <div className="composer-help"><span>Enter envia</span><span>Shift + Enter quebra a linha</span></div>
        </footer>
      </section>
    </main>
  );
}
