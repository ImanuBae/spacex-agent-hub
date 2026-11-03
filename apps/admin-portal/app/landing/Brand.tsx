import Link from "next/link";

export default function Brand() {
  return (
    <Link
      href="/"
      className="hub-brand-link"
      aria-label="SpaceX Agent Hub — Trang chủ"
    >
      <span className="hub-brand-mark" aria-hidden="true">
        ▲
      </span>
      <span>SpaceX Agent Hub</span>
    </Link>
  );
}
