"use client";

import type { FormEvent } from "react";

import { LockIcon } from "@/app/components/icons";

const inputCls =
  "h-11 rounded-[var(--radius-control)] border border-white/10 bg-black/20 px-4 text-sm text-cornsilk placeholder-cornsilk/40 transition focus:border-pine/60 focus:outline-none focus:ring-2 focus:ring-pine/25";

const primaryBtnCls =
  "rounded-[var(--radius-control)] bg-pine text-ink font-bold transition hover:bg-pine/90 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-pine/35 disabled:cursor-not-allowed disabled:opacity-50";

const brandIconCls =
  "flex items-center justify-center rounded-2xl bg-pine text-ink shadow-lg shadow-pine/10";

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-cornsilk/60">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-cornsilk/20 border-t-cornsilk" />
        <p className="text-sm font-semibold">Loading…</p>
      </div>
    </div>
  );
}

export function PasswordSetupScreen({
  passwordInput,
  confirmPasswordInput,
  loginError,
  isSettingPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: {
  passwordInput: string;
  confirmPasswordInput: string;
  loginError: string | null;
  isSettingPassword: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="glass-card w-full max-w-md rounded-[var(--radius-card)] p-7 sm:p-8 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={`${brandIconCls} h-12 w-12`}>
            <LockIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-cornsilk">Set admin password</h1>
            <p className="mt-2 text-sm leading-relaxed text-cornsilk/65">
              Create a password to protect this instance. It will be stored in your data volume.
            </p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-cornsilk" htmlFor="setup-admin-password">
              Password
            </label>
            <input
              autoComplete="new-password"
              autoFocus
              className={`${inputCls} w-full`}
              id="setup-admin-password"
              placeholder="Minimum 8 characters"
              type="password"
              value={passwordInput}
              onChange={(e) => onPasswordChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-cornsilk" htmlFor="setup-admin-confirm">
              Confirm password
            </label>
            <input
              autoComplete="new-password"
              className={`${inputCls} w-full`}
              id="setup-admin-confirm"
              placeholder="Re-enter password"
              type="password"
              value={confirmPasswordInput}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
            />
          </div>
          {loginError && (
            <div className="rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
              {loginError}
            </div>
          )}
          <button
            className={`${primaryBtnCls} h-11 w-full text-sm`}
            disabled={
              isSettingPassword ||
              passwordInput.length < 8 ||
              passwordInput !== confirmPasswordInput
            }
            type="submit"
          >
            {isSettingPassword ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function LoginScreen({
  passwordInput,
  loginError,
  isLoggingIn,
  onPasswordChange,
  onSubmit,
}: {
  passwordInput: string;
  loginError: string | null;
  isLoggingIn: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="glass-card w-full max-w-md rounded-[var(--radius-card)] p-7 sm:p-8 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={`${brandIconCls} h-12 w-12`}>
            <LockIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-cornsilk">Sign in</h1>
            <p className="mt-2 text-sm text-cornsilk/65">This instance is password protected.</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-cornsilk" htmlFor="login-password">
              Password
            </label>
            <input
              autoComplete="current-password"
              autoFocus
              className={`${inputCls} w-full`}
              id="login-password"
              placeholder="Enter password"
              type="password"
              value={passwordInput}
              onChange={(e) => onPasswordChange(e.target.value)}
            />
          </div>
          {loginError && (
            <div className="rounded-[var(--radius-control)] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">
              {loginError}
            </div>
          )}
          <button
            className={`${primaryBtnCls} h-11 w-full text-sm`}
            disabled={isLoggingIn || !passwordInput}
            type="submit"
          >
            {isLoggingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
