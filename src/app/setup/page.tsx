import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export default function SetupPage() {
  return (
    <Suspense>
      <AuthForm mode="setup" />
    </Suspense>
  );
}
