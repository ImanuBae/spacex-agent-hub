import { useId, type ReactNode } from "react";
import Link from "next/link";
import Brand from "./Brand";
import Planet from "./Planet";
import "./landing.css";
import "./entry.css";

export default function LoginEntry({ heading, accent, description, title, footer, children }: {
  heading: string;
  accent: string;
  description: string;
  title: string;
  footer: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="entry hub-theme">
      <div className="ascend entry-planet" aria-hidden="true">
        <Planet />
      </div>
      <header className="entry-header">
        <Brand />
        <Link href="/" className="entry-back">
          <span aria-hidden="true">←</span>Trang chủ
        </Link>
      </header>
      <main className="entry-main">
        <div className="entry-intro">
          <h1>{heading}<br /><em>{accent}</em></h1>
          <p>{description}</p>
        </div>
        <section className="entry-form-panel" aria-labelledby={titleId}>
          <h2 id={titleId}>{title}</h2>
          {children}
        </section>
      </main>
      <footer className="entry-footer">{footer}</footer>
    </div>
  );
}
