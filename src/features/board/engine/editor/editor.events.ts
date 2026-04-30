// Клавиши, которые при Ctrl/Meta пропускаем редактору без вмешательства.
const PASSTHROUGH_MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "z",
  "y",
  "c",
  "x",
  "v",
]);

// Колбэки событий редактируемой области текстового редактора.
export interface IEditorEventsCallbacks {
  onInput: () => void;
  onPointerDown: (event: PointerEvent) => void;
  onCancel: () => void;
  onEnter: () => void;
  onBlur: (event: FocusEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
}

// Подписывается на события editable и возвращает функцию отписки.
export function attachEditorEvents(
  editable: HTMLDivElement,
  callbacks: IEditorEventsCallbacks,
): () => void {
  const handleInput = (): void => {
    callbacks.onInput();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    callbacks.onPointerDown(event);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onCancel();
      return;
    }

    const hasModifier = event.ctrlKey || event.metaKey;
    if (hasModifier && PASSTHROUGH_MODIFIER_KEYS.has(event.key)) {
      event.stopPropagation();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onEnter();
      return;
    }
  };

  const handleBlur = (event: FocusEvent): void => {
    callbacks.onBlur(event);
  };

  const handlePaste = (event: ClipboardEvent): void => {
    callbacks.onPaste(event);
  };

  editable.addEventListener("input", handleInput);
  editable.addEventListener("pointerdown", handlePointerDown);
  editable.addEventListener("keydown", handleKeyDown);
  editable.addEventListener("blur", handleBlur);
  editable.addEventListener("paste", handlePaste);

  return () => {
    editable.removeEventListener("input", handleInput);
    editable.removeEventListener("pointerdown", handlePointerDown);
    editable.removeEventListener("keydown", handleKeyDown);
    editable.removeEventListener("blur", handleBlur);
    editable.removeEventListener("paste", handlePaste);
  };
}
