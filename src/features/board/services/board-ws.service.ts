import { io, Socket } from "socket.io-client";
import {
  IElement,
  IPoint,
  IWsBoardState,
  IWsUserJoined,
  IWsUserLeft,
  IWsCursorUpdated,
  IWsCursorRemoved,
  IWsElementDrawing,
  IWsElementCreated,
  IWsElementUpdated,
  IWsElementDeleted,
  IWsBoardError,
} from "../engine/types";

const COLLAB_URL =
  process.env.NEXT_PUBLIC_COLLAB_URL || "http://localhost:5003";

// Имена WebSocket-событий между клиентом и collab-сервером.
// Сгруппированы по доменам: board (мета), cursor, element (рисование/правки).
const WS_EVENT = {
  BOARD_JOIN: "board:join",
  BOARD_LEAVE: "board:leave",
  BOARD_STATE: "board:state",
  BOARD_USER_JOINED: "board:user_joined",
  BOARD_USER_LEFT: "board:user_left",
  BOARD_ERROR: "board:error",
  CURSOR_MOVE: "cursor:move",
  CURSOR_UPDATED: "cursor:updated",
  CURSOR_REMOVED: "cursor:removed",
  ELEMENT_DRAWING: "element:drawing",
  ELEMENT_CREATE: "element:create",
  ELEMENT_UPDATE: "element:update",
  ELEMENT_DELETE: "element:delete",
  ELEMENT_CREATED: "element:created",
  ELEMENT_UPDATED: "element:updated",
  ELEMENT_DELETED: "element:deleted",
} as const;

export type SocketListener = (...args: unknown[]) => void;

// Singleton-обёртка над socket.io-client. Один socket на всё приложение,
// reference-counted (несколько BoardSocket на одной странице делят один сокет).
// Подписки до connect буферизуются в pendingListeners и регистрируются при connect.
class BoardWsService {
  private socket: Socket | null = null;
  private pendingListeners: Array<[string, SocketListener]> = [];
  private refCount = 0;

  // Открывает соединение или возвращает существующее. Увеличивает refCount.
  connect(): Socket {
    this.refCount++;
    if (this.socket) return this.socket;
    this.socket = io(COLLAB_URL, {
      withCredentials: true,
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    // Регистрируем буферизованные подписки.
    for (const [event, cb] of this.pendingListeners) {
      this.socket.on(event, cb);
    }
    this.pendingListeners = [];
    return this.socket;
  }

  // Уменьшает refCount, закрывает соединение когда последний потребитель отключился.
  disconnect(): void {
    if (this.refCount > 0) this.refCount--;
    if (this.refCount > 0) return;
    this.socket?.disconnect();
    this.socket = null;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  // ===== Board: join/leave =====

  joinBoard(boardId: string): void {
    this.socket?.emit(WS_EVENT.BOARD_JOIN, { boardId });
  }

  leaveBoard(boardId: string): void {
    this.socket?.emit(WS_EVENT.BOARD_LEAVE, { boardId });
  }

  // ===== Cursor: emit =====

  emitCursorMove(boardId: string, x: number, y: number): void {
    this.socket?.emit(WS_EVENT.CURSOR_MOVE, { boardId, x, y });
  }

  // ===== Element: emit =====

  emitElementDrawing(
    boardId: string,
    elementId: string,
    points: IPoint[],
    color: string,
    width: number,
  ): void {
    this.socket?.emit(WS_EVENT.ELEMENT_DRAWING, {
      boardId,
      elementId,
      points,
      color,
      width,
    });
  }

  emitElementCreate(boardId: string, element: IElement): void {
    this.socket?.emit(WS_EVENT.ELEMENT_CREATE, { boardId, element });
  }

  emitElementUpdate(
    boardId: string,
    elementId: string,
    patch: Record<string, unknown>,
  ): void {
    this.socket?.emit(WS_EVENT.ELEMENT_UPDATE, { boardId, elementId, patch });
  }

  emitElementDelete(boardId: string, elementIds: string[]): void {
    this.socket?.emit(WS_EVENT.ELEMENT_DELETE, { boardId, elementIds });
  }

  // ===== Connection lifecycle =====

  onConnect(cb: () => void): () => void {
    return this.addListener(
      "connect",
      cb as unknown as SocketListener,
    );
  }

  onDisconnect(cb: (reason: string) => void): () => void {
    return this.addListener("disconnect", cb as unknown as SocketListener);
  }

  // Manager-события (не socket): подписка только пока socket существует.
  onReconnectAttempt(cb: () => void): () => void {
    const manager = this.socket?.io;
    if (!manager) return () => {};
    manager.on("reconnect_attempt", cb);
    return () => {
      manager.off("reconnect_attempt", cb);
    };
  }

  onReconnectFailed(cb: () => void): () => void {
    const manager = this.socket?.io;
    if (!manager) return () => {};
    manager.on("reconnect_failed", cb);
    return () => {
      manager.off("reconnect_failed", cb);
    };
  }

  // ===== Board: subscribe =====

  onBoardState(cb: (data: IWsBoardState) => void): () => void {
    return this.addListener(WS_EVENT.BOARD_STATE, cb as SocketListener);
  }

  onUserJoined(cb: (data: IWsUserJoined) => void): () => void {
    return this.addListener(WS_EVENT.BOARD_USER_JOINED, cb as SocketListener);
  }

  onUserLeft(cb: (data: IWsUserLeft) => void): () => void {
    return this.addListener(WS_EVENT.BOARD_USER_LEFT, cb as SocketListener);
  }

  onBoardError(cb: (data: IWsBoardError) => void): () => void {
    return this.addListener(WS_EVENT.BOARD_ERROR, cb as SocketListener);
  }

  // ===== Cursor: subscribe =====

  onCursorUpdated(cb: (data: IWsCursorUpdated) => void): () => void {
    return this.addListener(WS_EVENT.CURSOR_UPDATED, cb as SocketListener);
  }

  onCursorRemoved(cb: (data: IWsCursorRemoved) => void): () => void {
    return this.addListener(WS_EVENT.CURSOR_REMOVED, cb as SocketListener);
  }

  // ===== Element: subscribe =====

  onElementDrawing(cb: (data: IWsElementDrawing) => void): () => void {
    return this.addListener(WS_EVENT.ELEMENT_DRAWING, cb as SocketListener);
  }

  onElementCreated(cb: (data: IWsElementCreated) => void): () => void {
    return this.addListener(WS_EVENT.ELEMENT_CREATED, cb as SocketListener);
  }

  onElementUpdated(cb: (data: IWsElementUpdated) => void): () => void {
    return this.addListener(WS_EVENT.ELEMENT_UPDATED, cb as SocketListener);
  }

  onElementDeleted(cb: (data: IWsElementDeleted) => void): () => void {
    return this.addListener(WS_EVENT.ELEMENT_DELETED, cb as SocketListener);
  }

  // ===== Generic event API для соседних сервисов (например ai.service) =====

  // Подписка на произвольное socket-событие. Если socket ещё не подключён,
  // listener буферизуется и регистрируется при следующем connect.
  // Возвращает unsubscribe-функцию.
  on(event: string, cb: SocketListener): () => void {
    return this.addListener(event, cb);
  }

  // Эмит произвольного события. No-op если socket ещё не подключён.
  emit(event: string, data: unknown): void {
    this.socket?.emit(event, data);
  }

  // Регистрирует listener сразу или буферизует если socket ещё не подключён.
  // Возвращает unsubscribe-функцию, которая чистит и socket.on, и pendingListeners.
  private addListener(event: string, cb: SocketListener): () => void {
    if (this.socket) {
      this.socket.on(event, cb);
    } else {
      this.pendingListeners.push([event, cb]);
    }
    return () => {
      this.socket?.off(event, cb);
      const idx = this.pendingListeners.findIndex(
        ([e, c]) => e === event && c === cb,
      );
      if (idx !== -1) this.pendingListeners.splice(idx, 1);
    };
  }
}

export const boardWsService = new BoardWsService();
export default boardWsService;
