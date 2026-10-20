"use client";

import { useActionState, useState } from "react";
import { type AuthFormState, signIn, signUp } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next, allowSignup }: { next?: string; allowSignup: boolean }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [signInState, signInAction, signInPending] = useActionState<AuthFormState, FormData>(signIn, {});
  const [signUpState, signUpAction, signUpPending] = useActionState<AuthFormState, FormData>(signUp, {});

  const isSignIn = mode === "sign-in";
  const state = isSignIn ? signInState : signUpState;
  const pending = isSignIn ? signInPending : signUpPending;

  return (
    <form action={isSignIn ? signInAction : signUpAction} className="flex flex-col gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">อีเมล</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          key={`email-${state.email}`}
          aria-invalid={!!state.fieldErrors?.email}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email && (
          <p id="email-error" className="text-xs text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">รหัสผ่าน</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignIn ? "current-password" : "new-password"}
          required
          minLength={8}
          aria-invalid={!!state.fieldErrors?.password}
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
        />
        {state.fieldErrors?.password && (
          <p id="password-error" className="text-xs text-destructive">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[13px] text-success">
          {state.message}
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "กรุณารอสักครู่…" : isSignIn ? "เข้าสู่ระบบ" : "สร้างบัญชี"}
      </Button>

      {allowSignup && (
        <p className="text-center text-[13px] text-muted-foreground">
          {isSignIn ? "ยังไม่มีบัญชี?" : "มีบัญชีแล้ว?"}{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setMode(isSignIn ? "sign-up" : "sign-in")}
          >
            {isSignIn ? "สร้างบัญชี" : "เข้าสู่ระบบ"}
          </button>
        </p>
      )}
    </form>
  );
}
