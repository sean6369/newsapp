"use client";

import { I18nProvider, ToastProvider } from "@heroui/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider locale="en-US">
      {children}
      <ToastProvider />
    </I18nProvider>
  );
}
