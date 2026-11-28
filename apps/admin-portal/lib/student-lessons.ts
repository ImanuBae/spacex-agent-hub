export type Lesson = {
  id: string; title: string; body: string;
  practice: string; resources?: { title: string; href: string }[];
  video?: { title: string; embed: string; source: string };
  example?: string; download?: { name: string; content: string };
};
export type LessonCourse = { lessons: Lesson[] };

const courses: Record<string, LessonCourse> = {
  "DEMO-PYTHON": { lessons: [
    {
      id: "lists", title: "Biến, kiểu dữ liệu và danh sách",
      body: "Danh sách lưu các giá trị theo thứ tự. Chỉ số bắt đầu từ 0, vì vậy registrations[0] là số lượt của ngày đầu tiên. Ví dụ bên dưới tính tổng số lượt đăng ký bằng cách cộng lần lượt giá trị của mỗi ngày.",
      example: "registrations = [3, 5, 2]\ntotal = 0\nfor count in registrations:\n    total += count\nprint(total, total / len(registrations))",
      practice: "Thêm một ngày có 4 lượt đăng ký. Trước khi chạy lại, thử tính tổng và trung bình bằng tay.",
      resources: [{ title: "Tài liệu Python · Kiểu dữ liệu", href: "https://docs.python.org/3/tutorial/introduction.html" },
        { title: "Bài giảng CS50P · Biến và hàm", href: "https://cs50.harvard.edu/python/weeks/0/" }],
      video: { title: "CS50P · Biến và hàm", embed: "https://video.cs50.io/JP7ITIXGpHk", source: "https://cs50.harvard.edu/python/weeks/0/" },
    },
    {
      id: "loops", title: "Điều kiện, vòng lặp và hàm",
      body: "Vòng lặp for xét từng phần tử trong danh sách. Dùng điều kiện if để chọn các ngày đạt ngưỡng. Đưa vòng lặp vào hàm để có thể tái sử dụng cho nhiều danh sách.",
      example: "def count_busy_days(registrations, minimum):\n    total = 0\n    for count in registrations:\n        if count >= minimum:\n            total += 1\n    return total",
      practice: "Chạy hàm với [3, 5, 2, 8] và ngưỡng 5. Thử lại với ngưỡng 8 và với danh sách rỗng.",
      resources: [{ title: "Tài liệu Python · Điều khiển luồng", href: "https://docs.python.org/3/tutorial/controlflow.html" },
        { title: "Bài giảng CS50P · Điều kiện", href: "https://cs50.harvard.edu/python/weeks/1/" },
        { title: "Bài giảng CS50P · Vòng lặp", href: "https://cs50.harvard.edu/python/weeks/2/" }],
      video: { title: "CS50P · Vòng lặp", embed: "https://video.cs50.io/-7xg8pGcP6w", source: "https://cs50.harvard.edu/python/weeks/2/" },
    },
    {
      id: "csv", title: "Đọc tệp CSV và tổng hợp dữ liệu",
      body: "csv.DictReader dùng hàng tiêu đề làm tên cột. Giá trị đọc vào là chuỗi, nên hãy chuyển số lượt sang số nguyên trước khi cộng.",
      example: "import csv\n\nwith open('dang-ky.csv', encoding='utf-8', newline='') as f:\n    rows = csv.DictReader(f)\n    print(sum(int(row['registrations']) for row in rows))",
      practice: "Tải tệp mẫu ở mục Tài nguyên. Sửa một dòng, chạy lại và kiểm tra số tổng thay đổi đúng như dự đoán.",
      resources: [{ title: "Tài liệu Python · CSV", href: "https://docs.python.org/3/library/csv.html" },
        { title: "Bài giảng CS50P · Đọc và ghi tệp", href: "https://cs50.harvard.edu/python/weeks/6/" }],
      video: { title: "CS50P · Đọc và ghi tệp", embed: "https://video.cs50.io/KD-Yoel6EVQ", source: "https://cs50.harvard.edu/python/weeks/6/" },
      download: { name: "dang-ky.csv", content: "day,registrations\n2026-11-01,3\n2026-11-02,5\n2026-11-03,2\n" },
    },
  ] },
  "DEMO-SQL": { lessons: [
    {
      id: "select", title: "Chọn, lọc và sắp xếp dữ liệu",
      body: "SELECT xác định các cột trả về. WHERE giữ những hàng đáp ứng điều kiện. Khi thứ tự kết quả có ý nghĩa, hãy dùng ORDER BY.",
      example: "WITH registrations(course, learner) AS (VALUES ('Python', 'An'), ('SQL', 'Bình'), ('SQL', 'Chi'))\nSELECT learner FROM registrations WHERE course = 'SQL' ORDER BY learner;",
      practice: "Đổi điều kiện thành Python, rồi thêm một lượt đăng ký Python để xem thứ tự thay đổi.",
    },
    {
      id: "join", title: "Nối bảng bằng JOIN",
      body: "JOIN ghép các hàng có khóa khớp nhau. LEFT JOIN giữ lại mọi hàng phía trái, kể cả khi bảng phải chưa có dữ liệu tương ứng.",
      example: "WITH courses(id, title) AS (VALUES (1, 'SQL'), (2, 'Python')),\nregistrations(course_id, learner) AS (VALUES (1, 'An'))\nSELECT title, learner FROM courses LEFT JOIN registrations\nON courses.id = registrations.course_id;",
      practice: "Chạy truy vấn với LEFT JOIN, rồi đổi thành INNER JOIN. Quan sát điều gì xảy ra với lớp Python.",
    },
    {
      id: "aggregate", title: "Đếm lượt đăng ký theo khóa học",
      body: "GROUP BY gom những hàng có cùng giá trị. COUNT(*) đếm số hàng của mỗi nhóm. ORDER BY giúp danh sách khóa học luôn ở cùng một thứ tự.",
      example: "WITH registrations(course) AS (VALUES ('Python'), ('SQL'), ('SQL'))\nSELECT course, COUNT(*) AS total\nFROM registrations GROUP BY course ORDER BY course;",
      practice: "Thêm một lượt Python, rồi đổi truy vấn để sắp xếp theo số lượt từ cao xuống thấp.",
    },
  ] },
};

export function studentLessons(code: string): LessonCourse | undefined {
  return Object.hasOwn(courses, code) ? courses[code] : undefined;
}

const pythonQuiz = [
  { prompt: "Với danh sách counts = [3, 5, 2], counts[0] trả về giá trị nào?", choices: ["0", "3", "5"], answer: 1,
    explanation: "Chỉ số 0 trỏ tới phần tử đầu tiên, có giá trị 3." },
  { prompt: "Điều kiện nào lọc các ngày có ít nhất 5 lượt đăng ký?", choices: ["count == 5", "count > 5", "count >= 5"], answer: 2,
    explanation: "Toán tử >= lấy cả trường hợp bằng 5 và lớn hơn 5." },
  { prompt: "Cần làm gì với cột registrations khi tính tổng các dòng đọc bằng csv.DictReader?", choices: ["Chuyển mỗi giá trị sang số nguyên", "Nối trực tiếp các chuỗi", "Sắp xếp các dòng trước khi cộng"], answer: 0,
    explanation: "CSV trả giá trị ở dạng chuỗi. Dùng int để lấy số trước khi cộng." },
];

export function studentQuiz(code: string) {
  return code === "DEMO-PYTHON" ? pythonQuiz : [];
}
