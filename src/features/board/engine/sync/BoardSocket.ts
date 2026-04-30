import { boardWsService } from "@/features/board/services/board-ws.service";
import {
  IElement,
  IPoint,
  IWsOnlineUser,
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
} from "@engine/types";
import { TConnectionStatus } from "@engine/types/ui.types";

export interface IBoardSocketCallbacks {
  onBoardState: (elements: IElement[], users: IWsOnlineUser[]) => void;
  onUserJoined: (user: IWsOnlineUser) => void;
  onUserLeft: (userId: string) => void;
  onCursorUpdated: (data: IWsCursorUpdated) => void;
  onCursorRemoved: (userId: string) => void;
  onElementCreated: (element: IElement) => void;
  onElementUpdated: (elementId: string, patch: Record<string, unknown>) => void;
  onElementDeleted: (elementIds: string[]) => void;
  onElementDrawing: (data: IWsElementDrawing) => void;
  onConnectionStatus?: (status: TConnectionStatus) => void;
  onBoardError?: (message: string) => void;
}

// Тонкая обёртка над глобальным boardWsService для одной доски.
// Подписывается на события сокета и роутит их в callbacks вызывающего.
export class BoardSocket {
  private boardId: string;
  private callbacks: IBoardSocketCallbacks;
  private unsubs: (() => void)[] = [];
  private offConnect: (() => void) | null = null;
  private statusUnsubs: (() => void)[] = [];

  constructor(boardId: string, callbacks: IBoardSocketCallbacks) {
    this.boardId = boardId;
    this.callbacks = callbacks;
  }

  // Открывает соединение, заходит на доску и подписывается на все события.
  connect(): void {
    const svc = boardWsService;
    svc.connect();
    this.offConnect = svc.onConnect(() => svc.joinBoard(this.boardId));
    if (svc.isConnected()) svc.joinBoard(this.boardId);
    this.statusUnsubs = this.subscribeStatusEvents(svc);
    this.unsubs = this.subscribeBoardEvents(svc);
  }

  // Покидает доску, отписывается от всех событий, закрывает соединение.
  disconnect(): void {
    boardWsService.leaveBoard(this.boardId);
    BoardSocket.disposeAll(this.unsubs);
    this.unsubs = [];
    BoardSocket.disposeAll(this.statusUnsubs);
    this.statusUnsubs = [];
    this.offConnect?.();
    this.offConnect = null;
    boardWsService.disconnect();
  }

  emitElementCreate(element: IElement): void {
    boardWsService.emitElementCreate(this.boardId, element);
  }

  emitElementUpdate(elementId: string, patch: Record<string, unknown>): void {
    boardWsService.emitElementUpdate(this.boardId, elementId, patch);
  }

  emitElementDelete(elementIds: string[]): void {
    boardWsService.emitElementDelete(this.boardId, elementIds);
  }

  emitCursorMove(x: number, y: number): void {
    boardWsService.emitCursorMove(this.boardId, x, y);
  }

  emitElementDrawing(
    elementId: string,
    points: IPoint[],
    color: string,
    width: number,
  ): void {
    boardWsService.emitElementDrawing(
      this.boardId,
      elementId,
      points,
      color,
      width,
    );
  }

  // Подписки на статус коннекшна (connect, disconnect, reconnect).
  private subscribeStatusEvents(svc: typeof boardWsService): (() => void)[] {
    return [
      svc.onDisconnect(() =>
        this.callbacks.onConnectionStatus?.("reconnecting"),
      ),
      svc.onReconnectAttempt(() =>
        this.callbacks.onConnectionStatus?.("reconnecting"),
      ),
      svc.onReconnectFailed(() =>
        this.callbacks.onConnectionStatus?.("failed"),
      ),
      svc.onConnect(() => this.callbacks.onConnectionStatus?.("connected")),
    ];
  }

  // Подписки на доменные события доски: пользователи, курсоры, элементы.
  private subscribeBoardEvents(svc: typeof boardWsService): (() => void)[] {
    return [
      svc.onBoardState(({ elements, users }: IWsBoardState) =>
        this.callbacks.onBoardState(elements, users),
      ),
      svc.onUserJoined(({ user }: IWsUserJoined) =>
        this.callbacks.onUserJoined(user),
      ),
      svc.onUserLeft(({ userId }: IWsUserLeft) =>
        this.callbacks.onUserLeft(userId),
      ),
      svc.onCursorUpdated((data: IWsCursorUpdated) =>
        this.callbacks.onCursorUpdated(data),
      ),
      svc.onCursorRemoved(({ userId }: IWsCursorRemoved) =>
        this.callbacks.onCursorRemoved(userId),
      ),
      svc.onElementCreated(({ element }: IWsElementCreated) =>
        this.callbacks.onElementCreated(element),
      ),
      svc.onElementUpdated(({ elementId, patch }: IWsElementUpdated) =>
        this.callbacks.onElementUpdated(elementId, patch),
      ),
      svc.onElementDeleted(({ elementIds }: IWsElementDeleted) =>
        this.callbacks.onElementDeleted(elementIds),
      ),
      svc.onElementDrawing((data: IWsElementDrawing) =>
        this.callbacks.onElementDrawing(data),
      ),
      svc.onBoardError(({ message }: IWsBoardError) =>
        this.callbacks.onBoardError?.(message),
      ),
    ];
  }

  private static disposeAll(arr: (() => void)[]): void {
    for (const dispose of arr) dispose();
  }
}
