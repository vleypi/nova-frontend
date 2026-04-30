import { getCurrentDiv } from "./editor.text-utils";

export interface ITextEditorCommandsCallbacks {
  notifyChange: () => void;
  onListStateChange?: (type: "bullet" | "number" | null) => void;
}

// Команды форматирования inline-редактора: списки, вставка, ссылки, цвет.
export class TextEditorCommands {
  constructor(
    private readonly editable: HTMLDivElement,
    private readonly callbacks: ITextEditorCommandsCallbacks,
  ) {}

  // Пересчитывает порядковые номера у пунктов нумерованного списка.
  updateListIndices(): void {
    let counter = 0;
    let prevWasNum = false;
    for (const child of Array.from(this.editable.children)) {
      const div = child as HTMLDivElement;
      if (div.dataset.liType === "number") {
        if (!prevWasNum) counter = 0;
        counter++;
        div.dataset.liIndex = String(counter);
        prevWasNum = true;
      } else {
        prevWasNum = false;
      }
    }
  }

  // Обрабатывает Enter: выходит из пустого пункта списка или продолжает список.
  handleEnter(): void {
    const curDiv = getCurrentDiv(this.editable);
    const liType = curDiv?.dataset?.liType;
    const liLevel = curDiv?.dataset?.liLevel;
    const divEmpty = !!curDiv && (curDiv.textContent ?? "") === "";
    if (liType && curDiv && divEmpty) {
      delete curDiv.dataset.liType;
      delete curDiv.dataset.liLevel;
      this.updateListIndices();
      this.callbacks.onListStateChange?.(null);
      this.callbacks.notifyChange();
      return;
    }
    document.execCommand("insertParagraph");
    if (liType || liLevel) {
      let newDiv = getCurrentDiv(this.editable) as HTMLDivElement | null;
      if (!newDiv || newDiv === curDiv) {
        const sib = curDiv?.nextElementSibling;
        newDiv = (sib?.tagName === "DIV" ? sib : null) as HTMLDivElement | null;
      }
      if (newDiv && newDiv !== curDiv) {
        if (liType) newDiv.dataset.liType = liType;
        if (liLevel) newDiv.dataset.liLevel = liLevel;
      }
    }
    this.updateListIndices();
    this.callbacks.notifyChange();
  }

  // Включает или выключает список заданного типа на текущей строке.
  toggleList(type: "bullet" | "number"): void {
    this.editable.focus({ preventScroll: true });
    const div = getCurrentDiv(this.editable);
    if (!div) return;
    if (div.dataset.liType === type) {
      delete div.dataset.liType;
      delete div.dataset.liLevel;
    } else {
      div.dataset.liType = type;
      div.dataset.liLevel = "0";
    }
    this.updateListIndices();
    this.callbacks.notifyChange();
  }

  // Вставляет plain text, разбивая многострочный текст по div-строкам.
  pasteText(text: string): void {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
    const lines = text.split("\n");
    if (lines.length === 1) {
      document.execCommand("insertText", false, lines[0]);
      this.callbacks.notifyChange();
      return;
    }
    const curDiv = getCurrentDiv(this.editable);
    if (!curDiv) {
      this.callbacks.notifyChange();
      return;
    }
    const afterFragment = this.extractAfterFragment(curDiv, sel);
    if (lines[0]) curDiv.appendChild(document.createTextNode(lines[0]));
    if (!curDiv.textContent) curDiv.innerHTML = "<br>";
    let lastDiv: HTMLDivElement = curDiv;
    for (let i = 1; i < lines.length; i++) {
      const lineDiv = document.createElement("div");
      if (lines[i]) lineDiv.textContent = lines[i];
      else lineDiv.innerHTML = "<br>";
      lastDiv.after(lineDiv);
      lastDiv = lineDiv;
    }
    this.appendFragmentAndPlaceCaret(lastDiv, afterFragment, sel);
    this.callbacks.notifyChange();
  }

  // Вставляет санитизированный HTML, сохраняя структуру div-строк.
  pasteHtml(html: string): void {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const pastedDivs = Array.from(temp.querySelectorAll(":scope > div"));
    if (pastedDivs.length === 0) {
      document.execCommand("insertText", false, temp.textContent || "");
      this.callbacks.notifyChange();
      return;
    }
    const curDiv = getCurrentDiv(this.editable);
    if (!curDiv) {
      document.execCommand("insertText", false, temp.textContent || "");
      this.callbacks.notifyChange();
      return;
    }
    const afterFragment = this.extractAfterFragment(curDiv, sel);
    const firstDiv = pastedDivs[0];
    while (firstDiv.firstChild) curDiv.appendChild(firstDiv.firstChild);
    if (!curDiv.textContent && !curDiv.querySelector("br"))
      curDiv.innerHTML = "<br>";
    let lastDiv = curDiv as HTMLDivElement;
    for (let i = 1; i < pastedDivs.length; i++) {
      const newDiv = pastedDivs[i] as HTMLDivElement;
      lastDiv.after(newDiv);
      lastDiv = newDiv;
    }
    this.appendFragmentAndPlaceCaret(lastDiv, afterFragment, sel);
    this.callbacks.notifyChange();
  }

  // Вставляет ссылку: оборачивает выделенный текст или вставляет href как текст.
  insertLink(rawUrl: string, restoreRange: Range | null): void {
    const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    this.editable.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (sel && restoreRange) {
      sel.removeAllRanges();
      sel.addRange(restoreRange);
    }
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const selectedText = range ? range.toString() : "";
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = selectedText || href;
    if (range) {
      range.deleteContents();
      range.insertNode(anchor);
      if (anchor.parentNode === this.editable) {
        let nextSib = anchor.nextSibling;
        while (nextSib && (nextSib as Element).tagName !== "DIV")
          nextSib = nextSib.nextSibling;
        if (nextSib) {
          (nextSib as HTMLDivElement).insertBefore(anchor, nextSib.firstChild);
        } else {
          let prevSib = anchor.previousSibling;
          while (prevSib && (prevSib as Element).tagName !== "DIV")
            prevSib = prevSib.previousSibling;
          if (prevSib) (prevSib as HTMLDivElement).appendChild(anchor);
        }
      }
      const newRange = document.createRange();
      newRange.setStartAfter(anchor);
      newRange.collapse(true);
      sel!.removeAllRanges();
      sel!.addRange(newRange);
    }
    this.callbacks.notifyChange();
  }

  // Применяет цвет шрифта к текущему выделению.
  applyColor(color: string, restoreRange: Range | null): void {
    this.editable.focus({ preventScroll: true });
    this.restoreSelection(restoreRange);
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, color);
    this.callbacks.notifyChange();
  }

  // Применяет цвет фона (highlight) к текущему выделению.
  applyHighlight(color: string, restoreRange: Range | null): void {
    this.editable.focus({ preventScroll: true });
    this.restoreSelection(restoreRange);
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(
      "hiliteColor",
      false,
      color === "transparent" ? "inherit" : color,
    );
    this.callbacks.notifyChange();
  }

  private restoreSelection(range: Range | null): void {
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  private extractAfterFragment(
    curDiv: HTMLDivElement,
    sel: Selection,
  ): DocumentFragment {
    const r = sel.getRangeAt(0);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(curDiv);
    try {
      afterRange.setStart(r.startContainer, r.startOffset);
    } catch {}
    return afterRange.extractContents();
  }

  private appendFragmentAndPlaceCaret(
    lastDiv: HTMLDivElement,
    afterFragment: DocumentFragment,
    sel: Selection,
  ): void {
    const childCountBeforeAppend = lastDiv.childNodes.length;
    lastDiv.appendChild(afterFragment);
    if (!lastDiv.textContent && !lastDiv.querySelector("br"))
      lastDiv.innerHTML = "<br>";
    const newRange = document.createRange();
    if (childCountBeforeAppend > 0) {
      const lastPastedNode = lastDiv.childNodes[childCountBeforeAppend - 1];
      if (lastPastedNode.nodeType === Node.TEXT_NODE) {
        newRange.setStart(
          lastPastedNode,
          lastPastedNode.textContent?.length ?? 0,
        );
      } else {
        newRange.setStartAfter(lastPastedNode);
      }
    } else {
      newRange.setStart(lastDiv, 0);
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}
