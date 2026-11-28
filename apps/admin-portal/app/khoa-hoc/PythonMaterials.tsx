import "./python-materials.css";

const lessons = [
  {
    title: "Biến, kiểu dữ liệu và danh sách",
    practice: "Tạo danh sách số lượt đăng ký theo ngày, rồi tính tổng và trung bình.",
    reading: "https://docs.python.org/3/tutorial/introduction.html",
    videos: [{ label: "Video về biến và hàm", url: "https://cs50.harvard.edu/python/weeks/0/" }],
  },
  {
    title: "Điều kiện, vòng lặp và hàm",
    practice: "Viết hàm lọc các ngày có ít nhất 5 lượt đăng ký và in ra số ngày tìm được.",
    reading: "https://docs.python.org/3/tutorial/controlflow.html",
    videos: [
      { label: "Video về điều kiện", url: "https://cs50.harvard.edu/python/weeks/1/" },
      { label: "Video về vòng lặp", url: "https://cs50.harvard.edu/python/weeks/2/" },
    ],
  },
  {
    title: "Đọc tệp CSV và tổng hợp dữ liệu",
    practice: "Xuất dữ liệu mẫu thành tệp CSV, đọc bằng csv.DictReader và cộng số lượt theo từng ngày.",
    reading: "https://docs.python.org/3/library/csv.html",
    videos: [{ label: "Video về đọc và ghi tệp", url: "https://cs50.harvard.edu/python/weeks/6/" }],
  },
];

export default function PythonMaterials({ heading: Heading = "h2" }: { heading?: "h2" | "h3" }) {
  return <section className="python-materials" id="python-materials" aria-labelledby="python-materials-title">
    <Heading id="python-materials-title">Tài liệu và video Python</Heading>
    <p>Đọc tài liệu Python, xem bài giảng CS50P của Harvard và làm bài thực hành theo từng chủ đề. Tài liệu và video dùng tiếng Anh.</p>
    <ol className="python-lessons">
      {lessons.map(lesson => <li key={lesson.title}>
        <strong>{lesson.title}</strong>
        <p>{lesson.practice}</p>
        <div className="python-links">
          <a href={lesson.reading} target="_blank" rel="noopener noreferrer">Đọc tài liệu Python</a>
          {lesson.videos.map(({ label, url }) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{label} · CS50P</a>)}
        </div>
      </li>)}
    </ol>
  </section>;
}
