import { isEditingText } from "@engine/utils/dom-focus";

// Глобальные хоткеи доски: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Y и Ctrl/Cmd+Shift+Z (redo).
// Игнорируется во время редактирования текста, чтобы не перебивать встроенный
// undo/redo контента в браузерном редакторе.
export class KeyboardHandler {
  private undo: () => void;
  private redo: () => void;
  private boundKeyDown: (e: KeyboardEvent) => void;

  constructor(actions: { undo: () => void; redo: () => void }) {
    this.undo = actions.undo;
    this.redo = actions.redo;
    this.boundKeyDown = this.onKeyDown.bind(this);
  }

  attach(): void {
    window.addEventListener("keydown", this.boundKeyDown);
  }

  detach(): void {
    window.removeEventListener("keydown", this.boundKeyDown);
  }

  // Реагирует только на Ctrl/Cmd + Z/Y. Shift на Z переключает на redo.
  private onKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.code !== "KeyZ" && e.code !== "KeyY") return;
    if (isEditingText()) return;

    e.preventDefault();
    if (e.code === "KeyY" || e.shiftKey) {
      this.redo();
    } else {
      this.undo();
    }
  }
}
