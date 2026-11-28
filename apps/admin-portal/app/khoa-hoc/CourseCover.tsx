const art = new Set(["DEMO-PYTHON", "DEMO-SQL", "DEMO-POWER-BI", "DEMO-FIGMA"]);

export default function CourseCover({ code }: { code: string }) {
  return <div className="course-cover" data-cover={art.has(code) ? code : undefined} aria-hidden="true" />;
}
