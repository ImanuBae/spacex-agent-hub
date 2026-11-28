import Link from "next/link";
import type { ReactNode } from "react";
import HubIcon from "../dashboard/components/HubIcon";
import { ErrorMessage } from "../dashboard/components/OperationUI";

export function StudentHeading({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return <header className="sp-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children && <div className="sp-actions">{children}</div>}</header>;
}

export function StudentPanel({ title, href, label = "Xem tất cả", children, className = "" }: {
  title: string; href?: string; label?: string; children: ReactNode; className?: string;
}) {
  return <section className={`sp-panel ${className}`}>
    <header className="sp-panel-head"><h2>{title}</h2>
      {href && <Link className="sp-text-link" href={href}>{label} <HubIcon name="arrow" size={15} /></Link>}
    </header>
    {children}
  </section>;
}

export function StudentEmpty({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return <div className="sp-empty">
    {icon && <HubIcon name={icon} size={22} />}
    <div><strong>{title}</strong>{children && <div>{children}</div>}</div>
  </div>;
}

export function ResourceState({ error, retry, loading, label = "Đang tải…" }: {
  error?: unknown; retry?: () => void; loading?: boolean; label?: string;
}) {
  return error ? <ErrorMessage error={error} retry={retry} /> : loading ? <p className="sp-muted" role="status">{label}</p> : null;
}
