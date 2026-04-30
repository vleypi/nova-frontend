"use client";
import { useEffect, useState } from "react";
import { IWsOnlineUser } from "../engine/types";
import { BoardEngine } from "../engine/BoardEngine";

// Данные курсора одного пользователя для отображения над канвасом.
export interface ICursorData {
  wx: number;
  wy: number;
  user: Pick<IWsOnlineUser, "name" | "avatar">;
}

interface IUseBoardCollaboratorsResult {
  onlineUsers: IWsOnlineUser[];
  cursors: Map<string, ICursorData>;
}

// Подписывается на usersChange/userLeft/cursorUpdated/cursorRemoved.
// Держит локальный список online-пользователей и Map курсоров.
export function useBoardCollaborators(
  engine: BoardEngine | null,
): IUseBoardCollaboratorsResult {
  const [onlineUsers, setOnlineUsers] = useState<IWsOnlineUser[]>([]);
  const [cursors, setCursors] = useState<Map<string, ICursorData>>(new Map());

  useEffect(() => {
    if (!engine) return;

    const unsubUsers = engine.on("usersChange", (users) => {
      setOnlineUsers((prev) => {
        // Один пользователь и он уже в списке — игнорируем (de-dup).
        if (users.length === 1 && prev.some((u) => u.id === users[0].id)) {
          return prev;
        }
        // Один новый — добавляем; иначе батч заменяет весь список.
        if (users.length === 1) return [...prev, users[0]];
        return users;
      });
    });

    const unsubLeft = engine.on("userLeft", (uid) => {
      setOnlineUsers((prev) => prev.filter((u) => u.id !== uid));
    });

    const unsubCursorUpdated = engine.on("cursorUpdated", (data) => {
      setCursors((prev) => {
        const next = new Map(prev);
        next.set(data.userId, { wx: data.x, wy: data.y, user: data.user });
        return next;
      });
    });

    const unsubCursorRemoved = engine.on("cursorRemoved", (userId) => {
      setCursors((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    });

    return () => {
      unsubUsers();
      unsubLeft();
      unsubCursorUpdated();
      unsubCursorRemoved();
    };
  }, [engine]);

  return { onlineUsers, cursors };
}
