import type { IElement, IElementChange } from "./elements.types";

// Запись в стеке истории. Discriminated union по полю type.
// Один тип "move|resize|edit" объединяет три семантически разных, но структурно одинаковых
// действия (применяются через restoreSnapshot с oldData/newData), чтобы не плодить ветки в HistoryApplicator.
export type THistoryEntry =
  | {
      type: "draw";
      element: IElement;
    }
  | {
      type: "erase";
      elements: IElement[];
    }
  | {
      type: "move" | "resize" | "edit";
      changes: IElementChange[];
    }
  | {
      type: "paste";
      elements: IElement[];
    };
