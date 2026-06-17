"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

import { ExclamationIcon, InfoIcon, SparklesIcon, XIcon } from "@/app/components/icons";

type Tone = "success" | "error" | "info";

export function AlertBanner({
  tone,
  title,
  children,
  action,
}: {
  tone: Tone;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    success: "border-pine/25 bg-pine/8 text-cornsilk",
    error: "border-rose-500/25 bg-rose-500/10 text-rose-100",
    info: "border-azure/20 bg-azure/8 text-cornsilk",
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
          <span
            aria-hidden="true"
            className="self-center text-lg text-cornsilk/45 transition group-hover/stat:text-gold"
          >
            ›
          </span>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        className="ui-card group/stat p-3 text-left sm:p-4"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return <div className="ui-card p-3 sm:p-4">{content}</div>;
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
        <h2 className="text-xl font-black tracking-tight text-cornsilk" id={titleId}>
          {title}
        </h2>
      </div>
      <IconButton aria-label={closeLabel} onClick={onClose}>
        <XIcon className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

export function DrawerHeader({
  eyebrow,
  title,
  titleId,
  onClose,
  closeLabel,
  children,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  onClose: () => void;
  closeLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 pb-4 pt-5">
      <div>
        <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-cornsilk/70">{eyebrow}</p>
        <h2 className="text-xl font-black tracking-tight text-cornsilk" id={titleId}>
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <IconButton aria-label={closeLabel} onClick={onClose}>
          <XIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  className = "",
  isLoading,
  disabled,
  ...rest
}: ButtonProps) {
  const base = "ui-btn";
  const variants: Record<ButtonVariant, string> = {
    primary: "ui-btn-primary",
    secondary: "ui-btn-secondary",
    danger: "ui-btn-danger",
    ghost: "ui-btn-ghost",
  };
  const sizes = {
    sm: "ui-btn-sm",
    md: "",
    lg: "ui-btn-lg",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || isLoading}
      type="button"
      {...rest}
    >
      {isLoading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function IconButton({ children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`ui-icon-btn ${className}`} type="button" {...rest}>
      {children}
    </button>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`} {...rest} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={`ui-select ${className}`} {...rest}>
        {children}
      </select>
    </div>
  );
}

type BadgeTone = "green" | "gold" | "red" | "blue" | "slate";

export function Badge({
  children,
  tone = "slate",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return <span className={`ui-badge ui-badge-${tone} ${className}`}>{children}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-icon">{icon}</div>
      <h3 className="text-base font-extrabold text-cornsilk">{title}</h3>
      {description && <p className="mt-1 max-w-xs text-xs leading-relaxed text-cornsilk/65">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
