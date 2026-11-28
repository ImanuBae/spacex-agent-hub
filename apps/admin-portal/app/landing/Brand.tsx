import Link from "next/link";

export default function Brand({ href = "/", onClick }: { href?: string; onClick?: () => void }) {
  return (
    <Link
      href={href}
      className="hub-brand-link"
      aria-label={href === "/" ? "SpaceX Agent Hub — Trang chủ" : "SpaceX Agent Hub — Trang làm việc"}
      onClick={onClick}
    >
      <span className="hub-brand-mark" aria-hidden="true">
        ▲
      </span>
      <span>SpaceX Agent Hub</span>
    </Link>
  );
}
