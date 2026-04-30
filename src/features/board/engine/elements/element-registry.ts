import type { IElementHandler } from "@engine/elements/interfaces/element-handler";

// Глобальный реестр handlers. Заполняется side-effect-импортами из register-handlers.ts
// при загрузке движка. Один handler на тип элемента.
const handlers = new Map<string, IElementHandler>();

// Регистрирует handler для типа элемента. Перезатирает существующий.
export function registerHandler(type: string, handler: IElementHandler): void {
  handlers.set(type, handler);
}

// Возвращает handler по типу элемента. Бросает если не зарегистрирован.
export function getHandler(type: string): IElementHandler {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`No element handler registered for type "${type}"`);
  }
  return handler;
}
