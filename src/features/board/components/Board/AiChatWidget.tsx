"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import aiService from "@/features/board/services/ai.service";
import { ICamera } from "@/features/board/engine/types";
interface IAction {
  tool: string;
  elementId?: string;
}
interface IMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  actions?: IAction[];
  isError?: boolean;
}
type IHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};
function SendIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}
function CanvasIcon() {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}
interface IAiChatWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  cameraRef: React.RefObject<ICamera>;
}
export function AiChatWidget({
  isOpen,
  onClose,
  boardId,
  cameraRef,
}: IAiChatWidgetProps) {
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<IHistoryEntry[]>([]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);
  useEffect(() => {
    const unsubResponse = aiService.onResponse((data) => {
      const aiMsg: IMessage = {
        id: crypto.randomUUID(),
        role: "ai",
        text: data.message,
        actions: data.actions?.length ? data.actions : undefined,
      };
      setMessages((prev) => [...prev, aiMsg]);
      historyRef.current = [
        ...historyRef.current,
        { role: "assistant", content: data.message },
      ];
      setIsLoading(false);
    });
    const unsubError = aiService.onError((data) => {
      const errMsg: IMessage = {
        id: crypto.randomUUID(),
        role: "ai",
        text: data.error || "Что-то пошло не так. Попробуйте ещё раз.",
        isError: true,
      };
      setMessages((prev) => [...prev, errMsg]);
      setIsLoading(false);
    });
    return () => {
      unsubResponse();
      unsubError();
    };
  }, []);
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    const userMsg: IMessage = { id: crypto.randomUUID(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    const cam = cameraRef.current;
    const history = [...historyRef.current];
    historyRef.current = [...history, { role: "user", content: text }];
    aiService.emitMessage(
      boardId,
      text,
      history,
      cam ? { x: cam.x, y: cam.y, zoom: cam.zoom } : undefined,
    );
  }, [input, isLoading, boardId, cameraRef]);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  const formatActionLabel = (action: IAction): string => {
    const labels: Record<string, string> = {
      text: "текст",
      stroke: "рисунок",
      rectangle: "прямоугольник",
      ellipse: "эллипс",
      arrow: "стрелка",
      image: "изображение",
    };
    return labels[action.tool] ?? action.tool;
  };
  return (
    <>
      {isOpen && <div className="fixed inset-0 z-[60]" onClick={onClose} />}

      <div
        className={`fixed right-4 top-4 bottom-4 w-[380px] z-[70] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 transition-all duration-300 ease-out ${
          isOpen
            ? "translate-x-0 opacity-100"
            : "translate-x-[calc(100%+16px)] opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4262ff] via-[#9d6cff] to-[#ff79d1] flex items-center justify-center">
              <svg
                className="w-3.5 h-3.5 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" />
              </svg>
            </div>
            <span className="font-semibold text-sm text-gray-900">Nova AI</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#4262ff]/10 via-[#9d6cff]/10 to-[#ff79d1]/10 flex items-center justify-center mb-3">
                <svg
                  className="w-6 h-6 text-[#9d6cff]"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">Nova AI</p>
              <p className="text-xs mt-1">Спросите что-нибудь о вашей доске</p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-[#4262ff] text-white rounded-br-md"
                      : msg.isError
                        ? "bg-red-50 text-red-600 rounded-bl-md border border-red-100"
                        : "bg-gray-100 text-gray-800 rounded-bl-md"
                  }`}
                >
                  {msg.text}
                </div>

                {msg.actions && msg.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.actions.map((action, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4262ff]/8 text-[#4262ff] text-[11px] font-medium"
                      >
                        <CanvasIcon />
                        добавлен {formatActionLabel(action)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-end gap-2 bg-gray-50 rounded-xl px-3 py-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Спросите Nova AI..."
              rows={1}
              disabled={isLoading}
              className="flex-1 bg-transparent text-sm resize-none outline-none placeholder-gray-400 max-h-[80px] disabled:opacity-60"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#4262ff] text-white disabled:opacity-30 hover:bg-[#3451e6] transition-colors"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
