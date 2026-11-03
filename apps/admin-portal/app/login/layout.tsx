import { AuthProvider } from "../../src/context/AuthContext";
import { inter } from "../ui/fonts";
import "../ui/theme.css";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={inter.className}>
      <AuthProvider>{children}</AuthProvider>
    </div>
  );
}
