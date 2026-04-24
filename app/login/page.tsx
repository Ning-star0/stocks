import { LoginForm } from "@/components/LoginForm";
import { getAdminEmail } from "@/lib/auth";

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center">
      <LoginForm defaultEmail={getAdminEmail()} />
    </div>
  );
}
