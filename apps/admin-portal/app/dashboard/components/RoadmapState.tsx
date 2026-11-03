import Link from "next/link";
import HubIcon from "./HubIcon";

export default function RoadmapState({
  description,
  href,
  label,
}: {
  description: string;
  href: string;
  label: string;
}) {
  return (
    <section className="hub-roadmap-state">
      <HubIcon name="schedule" size={28} />
      <h2>Chưa mở trong phiên bản hiện tại</h2>
      <p>{description}</p>
      <Link href={href}>
        {label}
        <HubIcon name="arrow" size={16} />
      </Link>
    </section>
  );
}
