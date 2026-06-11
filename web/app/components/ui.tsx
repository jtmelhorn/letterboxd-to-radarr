"use client";

import type { ReactNode } from "react";

import { ExclamationIcon, InfoIcon, SparklesIcon, XIcon } from "@/app/components/icons";

export function AlertBanner({
  tone,
  title,
  children,
  action,
}: {
  tone: "success" | "error" | "info";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    success: "border-pine/30 bg-pine/10 text-cornsilk",
    error: "border-rose-500/25 bg-rose-500/10 text-rose-100",
    info: "border-azure/20 bg-azure/10 text-cornsilk",
  }[tone];
  const icon =
    tone === "success" ? (
      <SparklesIcon className="h-4 w-4 text-pine" />
    ) : tone === "error" ? (
      <ExclamationIcon className="h-4 w-4 text-rose-300" />
    ) : (
      <InfoIcon className="h-4 w-4 text-azure" />
    );

  return (
    <div
      className={`animate-fade-in flex flex-col gap-3 rounded-[var(--radius-card)] border px-4 py-3 sm:flex-row sm:items-center ${styles}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black/20">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-extrabold">{title}</p>
          <div className="mt-0.5 text-xs leading-relaxed text-cornsilk/70">{children}</div>
        </div>
      </div>
      {action && <div className="flex flex-shrink-0 items-center gap-2 sm:justify-end">{action}</div>}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  detail,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-black/25 text-gold">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-cornsilk/70">{label}</p>
          <div className="mt-1 truncate text-lg font-black leading-tight text-cornsilk">{value}</div>
          <p className="mt-1 text-xs text-cornsilk/62">{detail}</p>
        </div>
        {onClick && (
          <span aria-hidden="true" className="self-center text-lg text-cornsilk/45 transition group-hover/stat:text-gold">
            ›
          </span>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        className="glass-card group/stat rounded-[var(--radius-card)] p-3 text-left transition hover:border-gold/25 hover:bg-white/[0.055] hover:ring-1 hover:ring-gold/20 sm:p-4"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="glass-card rounded-[var(--radius-card)] p-3 sm:p-4">
      {content}
    </div>
  );
}

export function ModalHeader({
  eyebrow,
  title,
  titleId,
  onClose,
  closeLabel,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
      <div>
        <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-cornsilk/70">{eyebrow}</p>
        <h2 className="text-xl font-black tracking-tight text-cornsilk" id={titleId}>{title}</h2>
      </div>
      <button
        aria-label={closeLabel}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-cornsilk/65 transition hover:bg-white/[0.08] hover:text-cornsilk"
        onClick={onClose}
        type="button"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
