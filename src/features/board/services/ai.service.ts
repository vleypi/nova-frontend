import boardWsService, { type SocketListener } from "./board-ws.service";

// Имена AI-событий через тот же socket, что и board-события.
const WS_EVENT_AI = {
  MESSAGE: "ai:message",
  RESPONSE: "ai:response",
  ERROR: "ai:error",
} as const;

export interface IAiHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface IAiResponseData {
  message: string;
  actions: Array<{ tool: string; elementId?: string }>;
}

export interface IAiErrorData {
  error: string;
}

// Сервис AI-чата. Использует тот же socket, что и BoardWsService
// (через generic on/emit), refCount уже держится в боард-сервисе.
class AiService {
  // Отправляет пользовательское сообщение AI с историей и hint-ом viewport.
  emitMessage(
    boardId: string,
    message: string,
    history: IAiHistoryEntry[],
    viewportHint?: { x: number; y: number; zoom: number },
  ): void {
    boardWsService.emit(WS_EVENT_AI.MESSAGE, {
      boardId,
      message,
      history,
      viewportHint,
    });
  }

  // Подписка на ответ AI с возможными actions для движка.
  onResponse(cb: (data: IAiResponseData) => void): () => void {
    return boardWsService.on(WS_EVENT_AI.RESPONSE, cb as SocketListener);
  }

  // Подписка на ошибки AI-обработки.
  onError(cb: (data: IAiErrorData) => void): () => void {
    return boardWsService.on(WS_EVENT_AI.ERROR, cb as SocketListener);
  }
}

export const aiService = new AiService();
export default aiService;
