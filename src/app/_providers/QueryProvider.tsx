"use client";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/shared/config/query.config";

interface IQueryProviderProps {
  children: React.ReactNode;
}

// React-Query provider с отдельным client per-mount.
export function QueryProvider({ children }: IQueryProviderProps) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
