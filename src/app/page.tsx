"use client";

/* Imagens protegidas dependem do cookie da sessão; por isso não usam o otimizador público do Next. */
/* eslint-disable @next/next/no-img-element */

import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DocumentPictureInPictureManager = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureManager;
  }
}

type Message = {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
  imageUrl?: string;
};

type ViewState = "checking" | "locked" | "chat";

type DraftImage = {
  file: File;
  previewUrl: string;
  name: string;
};

type QueuedMessage = {
  id: string;
  body: string;
  image?: File;
  status: "pending" | "sending" | "failed";
};

const IMAGE_QUALITY = 0.7;
const MAX_IMAGE_DIMENSION = 1920;
const MAX_SOURCE_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_COMPRESSED_IMAGE_SIZE = 4 * 1024 * 1024;

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

function formatFileSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}

async function compressImage(file: File) {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
    throw new Error("Escolha uma imagem JPEG, PNG ou WebP.");
  }

  if (file.size > MAX_SOURCE_IMAGE_SIZE) {
    throw new Error("Escolha uma imagem de até 15 MB para comprimir.");
  }

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Não foi possível abrir esta imagem."));
      nextImage.src = sourceUrl;
    });
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const compressed = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível comprimir a imagem."))),
        "image/webp",
        IMAGE_QUALITY,
      );
    });

    if (compressed.size > MAX_COMPRESSED_IMAGE_SIZE) {
      throw new Error("A imagem ficou maior que 4 MB mesmo após a compressão.");
    }

    return new File(
      [compressed],
      `${file.name.replace(/\.[^.]+$/, "") || "imagem"}.webp`,
      { type: "image/webp" },
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function HomePage() {
  const [view, setView] = useState<ViewState>("checking");
  const [name, setName] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [miniDraft, setMiniDraft] = useState("");
  const [draftImage, setDraftImage] = useState<DraftImage | null>(null);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [outbox, setOutbox] = useState<QueuedMessage[]>([]);
  const [miniRoot, setMiniRoot] = useState<HTMLElement | null>(null);
  const [miniMode, setMiniMode] = useState<"pip" | "popup" | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const miniMessageListRef = useRef<HTMLDivElement | null>(null);
  const miniWindowRef = useRef<Window | null>(null);
  const miniCleanupRef = useRef<(() => void) | null>(null);
  const outboxRef = useRef<QueuedMessage[]>([]);
  const isProcessingOutboxRef = useRef(false);

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
    source.addEventListener("cleared", () => {
      setMessages([]);
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
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTo({
        top: messageList.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  useEffect(() => {
    const messageList = miniMessageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, miniRoot]);

  useEffect(() => {
    return () => {
      if (draftImage) URL.revokeObjectURL(draftImage.previewUrl);
    };
  }, [draftImage]);

  function prepareMiniWindow(nextWindow: Window) {
    const nextDocument = nextWindow.document;
    nextDocument.documentElement.lang = "pt-BR";
    nextDocument.title = "Núcleo | Mini chat";
    nextDocument.head.innerHTML = "";

    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      nextDocument.head.appendChild(node.cloneNode(true));
    });

    const miniStyle = nextDocument.createElement("style");
    miniStyle.textContent = "html, body { min-width: 0; min-height: 100%; }";
    nextDocument.head.appendChild(miniStyle);
    nextDocument.body.innerHTML = "";
    nextDocument.body.className = "mini-window-body";

    const root = nextDocument.createElement("div");
    root.id = "mini-chat-root";
    nextDocument.body.appendChild(root);
    return root;
  }

  function closeMiniChat() {
    const currentWindow = miniWindowRef.current;
    miniCleanupRef.current?.();
    miniCleanupRef.current = null;
    miniWindowRef.current = null;
    setMiniRoot(null);
    setMiniMode(null);

    if (currentWindow && !currentWindow.closed) {
      currentWindow.close();
    }
  }

  async function openMiniChat() {
    if (miniWindowRef.current && !miniWindowRef.current.closed) {
      miniWindowRef.current.focus();
      return;
    }

    let nextWindow: Window | null = null;
    let nextMode: "pip" | "popup" = "popup";

    try {
      if (window.documentPictureInPicture) {
        nextWindow = await window.documentPictureInPicture.requestWindow({
          width: 360,
          height: 620,
        });
        nextMode = "pip";
      } else {
        nextWindow = window.open(
          "about:blank",
          "nucleo-mini-chat",
          "popup=yes,width=360,height=620,resizable=yes"
        );
      }
    } catch {
      nextWindow = window.open(
        "about:blank",
        "nucleo-mini-chat",
        "popup=yes,width=360,height=620,resizable=yes"
      );
    }

    if (!nextWindow) {
      setError("O navegador bloqueou a janela do mini chat.");
      return;
    }

    let root: HTMLElement;
    try {
      root = prepareMiniWindow(nextWindow);
    } catch {
      nextWindow.close();
      setError("Não foi possível preparar a janela do mini chat.");
      return;
    }
    miniWindowRef.current = nextWindow;
    setMiniMode(nextMode);
    setMiniRoot(root);
    nextWindow.focus();

    const handlePageHide = () => {
      if (miniWindowRef.current !== nextWindow) return;
      miniWindowRef.current = null;
      miniCleanupRef.current = null;
      setMiniRoot(null);
      setMiniMode(null);
    };

    nextWindow.addEventListener("pagehide", handlePageHide, { once: true });
    miniCleanupRef.current = () => {
      nextWindow?.removeEventListener("pagehide", handlePageHide);
    };
  }

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

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const sourceImage = event.target.files?.[0];
    event.target.value = "";
    if (!sourceImage || isCompressingImage) return;

    setError("");
    setIsCompressingImage(true);

    try {
      const compressedImage = await compressImage(sourceImage);
      setDraftImage({
        file: compressedImage,
        previewUrl: URL.createObjectURL(compressedImage),
        name: sourceImage.name,
      });
    } catch (imageError) {
      setError(
        imageError instanceof Error
          ? imageError.message
          : "Não foi possível preparar a imagem.",
      );
    } finally {
      setIsCompressingImage(false);
    }
  }

  const replaceOutbox = useCallback(
    (update: (current: QueuedMessage[]) => QueuedMessage[]) => {
      const nextOutbox = update(outboxRef.current);
      outboxRef.current = nextOutbox;
      setOutbox(nextOutbox);
    },
    [],
  );

  async function postQueuedMessage(message: QueuedMessage) {
    const formData = new FormData();
    formData.set("body", message.body);
    if (message.image) formData.set("image", message.image);

    const response = await fetch("/api/messages", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as { error?: string };
    return { payload, response };
  }

  const processOutbox = useCallback(async () => {
    if (isProcessingOutboxRef.current) return;
    isProcessingOutboxRef.current = true;

    try {
      while (true) {
        const message = outboxRef.current[0];
        if (!message || message.status === "failed") break;

        replaceOutbox((current) =>
          current.map((item) =>
            item.id === message.id ? { ...item, status: "sending" } : item,
          ),
        );

        try {
          const { response, payload } = await postQueuedMessage(message);

          if (!response.ok) {
            if (response.status === 401) {
              replaceOutbox(() => []);
              closeRealtime();
              setView("locked");
            } else {
              replaceOutbox((current) =>
                current.map((item) =>
                  item.id === message.id ? { ...item, status: "failed" } : item,
                ),
              );
            }
            setError(payload.error || "Não foi possível enviar a mensagem.");
            break;
          }

          replaceOutbox((current) =>
            current.filter((item) => item.id !== message.id),
          );
        } catch {
          replaceOutbox((current) =>
            current.map((item) =>
              item.id === message.id ? { ...item, status: "failed" } : item,
            ),
          );
          setError("Não foi possível enviar a mensagem. Tente novamente.");
          break;
        }
      }
    } finally {
      isProcessingOutboxRef.current = false;
    }
  }, [closeRealtime, replaceOutbox]);

  function enqueueMessage(messageBody: string) {
    const message: QueuedMessage = {
      body: messageBody,
      id: crypto.randomUUID(),
      image: draftImage?.file,
      status: "pending",
    };

    replaceOutbox((current) => [...current, message]);
    void processOutbox();
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const messageBody = draft.trim();
    if ((!messageBody && !draftImage) || isCompressingImage) return;

    setError("");
    enqueueMessage(messageBody);
    setDraft("");
    setDraftImage(null);
  }

  function handleMiniSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const messageBody = miniDraft.trim();
    if ((!messageBody && !draftImage) || isCompressingImage) return;

    setError("");
    enqueueMessage(messageBody);
    setMiniDraft("");
    setDraftImage(null);
  }

  function retryOutbox() {
    setError("");
    replaceOutbox((current) =>
      current.map((item) =>
        item.status === "failed" ? { ...item, status: "pending" } : item,
      ),
    );
    void processOutbox();
  }

  function discardFailedOutbox() {
    replaceOutbox((current) => current.filter((item) => item.status !== "failed"));
    void processOutbox();
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
    closeMiniChat();
    closeRealtime();
    await fetch("/api/logout", { method: "POST" });
    setMessages([]);
    setDraft("");
    setDraftImage(null);
    replaceOutbox(() => []);
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
  const hasFailedOutbox = outbox.some((message) => message.status === "failed");
  const outboxLabel = hasFailedOutbox
    ? "Envio pausado"
    : outbox[0]?.status === "sending"
      ? `Enviando ${outbox.length} ${outbox.length === 1 ? "mensagem" : "mensagens"}…`
      : `${outbox.length} ${outbox.length === 1 ? "mensagem na fila" : "mensagens na fila"}`;

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
            <button
              aria-label={miniRoot ? "Fechar mini chat" : "Abrir mini chat"}
              className="pip-button"
              onClick={() => {
                if (miniRoot) closeMiniChat();
                else void openMiniChat();
              }}
              title={miniMode === "pip" ? "Mini chat sempre visível" : "Abrir mini chat"}
              type="button"
            >
              <span aria-hidden="true">↗</span>
              <span>{miniRoot ? "Fechar mini chat" : "Mini chat"}</span>
            </button>
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

          <div className="message-list" aria-live="polite" ref={messageListRef}>
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
                            {message.imageUrl && (
                              <a
                                className="message-image-link"
                                href={message.imageUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <img
                                  alt={`Imagem enviada por ${message.authorName}`}
                                  loading="lazy"
                                  src={message.imageUrl}
                                />
                              </a>
                            )}
                            {message.body && <p>{message.body}</p>}
                            <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        <footer className="composer-wrap">
          {error && <p className="composer-error" role="alert">{error}</p>}
          {outbox.length > 0 && (
            <div className="outbox-status" role="status">
              <span>{outboxLabel}</span>
              {hasFailedOutbox && (
                <div>
                  <button onClick={retryOutbox} type="button">Tentar novamente</button>
                  <button onClick={discardFailedOutbox} type="button">Descartar falha</button>
                </div>
              )}
            </div>
          )}
          {draftImage && (
            <div className="image-preview">
              <img alt="Prévia da imagem selecionada" src={draftImage.previewUrl} />
              <span>
                <strong>{draftImage.name}</strong>
                <small>WebP · {formatFileSize(draftImage.file.size)} · 70%</small>
              </span>
              <button
                aria-label="Remover imagem"
                onClick={() => setDraftImage(null)}
                type="button"
              >
                ×
              </button>
            </div>
          )}
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
            <label className="image-upload-button" title="Adicionar imagem">
              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label="Adicionar imagem"
                onChange={handleImageChange}
                type="file"
              />
              <span aria-hidden="true">▧</span>
            </label>
            <button aria-label="Enviar mensagem" className="send-button" disabled={(!draft.trim() && !draftImage) || isCompressingImage} type="submit">
              <span aria-hidden="true">↑</span>
            </button>
          </form>
          <div className="composer-help"><span>{isCompressingImage ? "Comprimindo imagem…" : outbox.length > 0 ? outboxLabel : "70% de qualidade"}</span><span>Enter envia</span><span>Shift + Enter quebra a linha</span></div>
        </footer>
      </section>
      {miniRoot && createPortal(
        <div className="mini-chat-window">
          <header className="mini-chat-header">
            <div className="mini-chat-brand">
              <span className="brand-icon" aria-hidden="true"><span /></span>
              <div>
                <strong>NÚCLEO</strong>
                <span>{isConnected ? "Online em tempo real" : "Reconectando…"}</span>
              </div>
            </div>
            <button aria-label="Fechar mini chat" className="mini-close-button" onClick={closeMiniChat} type="button">×</button>
          </header>

          <div className="mini-chat-title">
            <strong>Conversa principal</strong>
            <span>{name}</span>
          </div>

          <div className="mini-chat-list" aria-live="polite" ref={miniMessageListRef}>
            {messages.length === 0 ? (
              <div className="mini-empty-chat">A conversa está esperando a primeira mensagem.</div>
            ) : (
              messages.slice(-60).map((message) => {
                const isMine = message.authorName === name;
                return (
                  <article className={`mini-message ${isMine ? "mine" : ""}`} key={message.id}>
                    {!isMine && <span className="mini-message-author">{message.authorName}</span>}
                    <div className="mini-message-bubble">
                      {message.imageUrl && (
                        <a
                          className="message-image-link"
                          href={message.imageUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <img
                            alt={`Imagem enviada por ${message.authorName}`}
                            loading="lazy"
                            src={message.imageUrl}
                          />
                        </a>
                      )}
                      {message.body && <p>{message.body}</p>}
                      <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <div className="mini-composer-wrap">
            {outbox.length > 0 && (
              <div className="outbox-status mini-outbox-status" role="status">
                <span>{outboxLabel}</span>
                {hasFailedOutbox && (
                  <div>
                    <button onClick={retryOutbox} type="button">Tentar</button>
                    <button onClick={discardFailedOutbox} type="button">Descartar</button>
                  </div>
                )}
              </div>
            )}
            {draftImage && (
              <div className="mini-image-preview">
                <img alt="Prévia da imagem selecionada" src={draftImage.previewUrl} />
                <span>WebP · {formatFileSize(draftImage.file.size)} · 70%</span>
                <button aria-label="Remover imagem" onClick={() => setDraftImage(null)} type="button">×</button>
              </div>
            )}
            <form className="mini-composer" onSubmit={handleMiniSend}>
              <textarea
                aria-label="Mensagem do mini chat"
                maxLength={2000}
                onChange={(event) => setMiniDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Escreva uma mensagem…"
                rows={1}
                value={miniDraft}
              />
              <label className="image-upload-button mini-image-upload-button" title="Adicionar imagem">
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Adicionar imagem"
                  onChange={handleImageChange}
                  type="file"
                />
                <span aria-hidden="true">▧</span>
              </label>
              <button aria-label="Enviar mensagem do mini chat" className="mini-send-button" disabled={(!miniDraft.trim() && !draftImage) || isCompressingImage} type="submit">↑</button>
            </form>
          </div>
        </div>,
        miniRoot,
      )}
    </main>
  );
}
