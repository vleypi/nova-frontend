const EMPTY_DIV_LINE = "<div><br></div>";

const ALLOWED_INLINE_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "DEL",
  "STRIKE",
  "A",
  "SPAN",
  "FONT",
  "BR",
]);

const BLOCK_LEVEL_TAGS = new Set([
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "OL",
  "UL",
  "BLOCKQUOTE",
  "PRE",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "TR",
  "TD",
  "TH",
  "DT",
  "DD",
  "FIGURE",
  "FIGCAPTION",
  "NAV",
  "MAIN",
  "ASIDE",
]);

const STRIPPED_PASTE_SELECTOR =
  "script,style,meta,link,iframe,object,embed,form,input,textarea,select,button,img,video,audio,canvas,svg,table,thead,tbody,tfoot,colgroup,col";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;
const RGB_COLOR_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;
const SAFE_HREF_RE = /^https?:\/\//i;

function getElementTag(node: Node): string | null {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  return (node as Element).tagName;
}

function rgbChannelToHex(channel: string): string {
  return parseInt(channel, 10).toString(16).padStart(2, "0");
}

// Преобразует произвольный HTML в последовательность <div>-строк, понятных редактору.
export function normalizeHtmlToDivLines(html: string): string {
  if (!html || !html.trim()) return EMPTY_DIV_LINE;

  const container = document.createElement("div");
  container.innerHTML = html;

  const topChildren = Array.from(container.childNodes);
  const hasDivStructure = topChildren.some((node) => getElementTag(node) === "DIV");
  if (hasDivStructure) return html;

  const lineHtmls: string[] = [];
  let currentLine = document.createElement("div");

  const flushLine = () => {
    lineHtmls.push(currentLine.innerHTML || "");
    currentLine = document.createElement("div");
  };

  for (const node of topChildren) {
    if (getElementTag(node) === "BR") {
      flushLine();
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent ?? "").split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) flushLine();
        if (parts[i]) currentLine.appendChild(document.createTextNode(parts[i]));
      }
      continue;
    }

    currentLine.appendChild(node.cloneNode(true));
  }
  flushLine();

  return lineHtmls.map((lineHtml) => `<div>${lineHtml || "<br>"}</div>`).join("");
}

// Возвращает текст редактируемого элемента с переносами строк по визуальным линиям.
export function getEditableText(element: HTMLElement): string {
  return element.innerText;
}

// Раскладывает plain text по <div>-строкам внутри редактируемого элемента.
export function setEditableDivLines(element: HTMLElement, text: string): void {
  element.innerHTML = "";
  const lines = text.split("\n");
  for (const line of lines) {
    const lineDiv = document.createElement("div");
    if (line) {
      lineDiv.textContent = line;
    } else {
      lineDiv.innerHTML = "<br>";
    }
    element.appendChild(lineDiv);
  }
}

function copyAllowedAttributes(source: Element, target: Element): void {
  const tag = source.tagName;

  if (tag === "A") {
    const href = source.getAttribute("href") || "";
    if (SAFE_HREF_RE.test(href)) target.setAttribute("href", href);
    return;
  }

  if (tag === "SPAN" || tag === "FONT") {
    const sourceStyle = (source as HTMLElement).style;
    const targetStyle = (target as HTMLElement).style;
    if (sourceStyle?.color) targetStyle.color = sourceStyle.color;
    if (sourceStyle?.backgroundColor) targetStyle.backgroundColor = sourceStyle.backgroundColor;
    const fontColorAttr = source.getAttribute("color");
    if (fontColorAttr) target.setAttribute("color", fontColorAttr);
  }
}

function sanitizeNodeRecursive(node: Node): Node[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ? [document.createTextNode(node.textContent)] : [];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const element = node as Element;
  const tag = element.tagName;

  if (BLOCK_LEVEL_TAGS.has(tag)) {
    const wrapper = document.createElement("div");
    appendSanitizedChildren(element, wrapper);
    return [wrapper];
  }

  if (ALLOWED_INLINE_TAGS.has(tag)) {
    if (tag === "BR") return [document.createElement("br")];
    const clone = document.createElement(tag);
    copyAllowedAttributes(element, clone);
    appendSanitizedChildren(element, clone);
    return [clone];
  }

  const flattened: Node[] = [];
  for (const child of Array.from(element.childNodes)) {
    flattened.push(...sanitizeNodeRecursive(child));
  }
  return flattened;
}

function appendSanitizedChildren(source: Element, target: Element): void {
  for (const child of Array.from(source.childNodes)) {
    sanitizeNodeRecursive(child).forEach((sanitized) => target.appendChild(sanitized));
  }
}

// Чистит вставленный HTML от опасных тегов и приводит его к div-строкам.
export function sanitizePastedHtml(rawHtml: string): string {
  const container = document.createElement("div");
  container.innerHTML = rawHtml;
  container.querySelectorAll(STRIPPED_PASTE_SELECTOR).forEach((element) => element.remove());

  const result = document.createElement("div");
  appendSanitizedChildren(container, result);

  const html = result.innerHTML;
  if (!html.trim()) return "";
  return normalizeHtmlToDivLines(html);
}

// Парсит "#rrggbb" или "rgb(r, g, b)" и возвращает hex в нижнем регистре.
export function rgbToHex(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (HEX_COLOR_RE.test(trimmed)) return trimmed;

  const match = trimmed.match(RGB_COLOR_RE);
  if (!match) return null;

  return `#${rgbChannelToHex(match[1])}${rgbChannelToHex(match[2])}${rgbChannelToHex(match[3])}`;
}

// Возвращает <div>-строку, в которой сейчас находится курсор внутри editable.
export function getCurrentDiv(editable: HTMLElement): HTMLDivElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  let node: Node | null = range.startContainer;

  while (node && node !== editable) {
    if (node.parentNode === editable && getElementTag(node) === "DIV") {
      return node as HTMLDivElement;
    }
    node = node.parentNode;
  }

  if (node === editable) {
    const offset = range.startOffset;
    const children = editable.childNodes;
    for (let i = Math.min(offset, children.length) - 1; i >= 0; i--) {
      if (getElementTag(children[i]) === "DIV") {
        return children[i] as HTMLDivElement;
      }
    }
  }

  const directDivs = editable.querySelectorAll(":scope > div");
  if (directDivs.length === 0) return null;
  return directDivs[directDivs.length - 1] as HTMLDivElement;
}
