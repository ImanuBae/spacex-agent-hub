export const levels: Record<string, string> = { beginner: "Cơ bản", intermediate: "Trung cấp", advanced: "Nâng cao" };
export const modes: Record<string, string> = { online: "Trực tuyến", onsite: "Tại phòng" };

const previews = new Map([
  ["DEMO-PYTHON", {
    audience: "Người mới lập trình muốn tự động hóa các thao tác với bảng tính và tệp dữ liệu.",
    syllabus: ["Biến, kiểu dữ liệu và danh sách", "Điều kiện, vòng lặp và hàm", "Đọc tệp CSV và tổng hợp dữ liệu"],
    title: "Tính tổng số lượt đăng ký",
    lesson: "Mỗi phần tử trong danh sách là số lượt đăng ký của một ngày. Vòng lặp cộng lần lượt từng giá trị vào biến tổng.",
    code: "registrations = [3, 5, 2]\ntotal = 0\nfor count in registrations:\n    total += count\nprint(total)",
    result: "Kết quả là 10. Thử thêm một ngày có 4 lượt vào danh sách và tính lại.",
  }],
  ["DEMO-SQL", {
    audience: "Người mới học SQL hoặc cần tự kiểm tra và tổng hợp dữ liệu cho báo cáo.",
    syllabus: ["Chọn, lọc và sắp xếp các dòng", "Nối bảng bằng JOIN", "Tổng hợp và kiểm tra số liệu với GROUP BY"],
    title: "Đếm lượt đăng ký theo khóa học",
    lesson: "GROUP BY gom các dòng có cùng tên khóa học. COUNT(*) đếm số dòng trong mỗi nhóm.",
    code: "WITH registrations(course) AS (\n  VALUES ('Python'),\n         ('SQL'), ('SQL')\n)\nSELECT course, COUNT(*) AS total\nFROM registrations\nGROUP BY course\nORDER BY course;",
    result: "Truy vấn trả về Python với 1 lượt và SQL với 2 lượt. Thử thêm một lượt Python rồi chạy lại.",
  }],
]);

export function coursePreview(code: string) {
  return previews.get(code);
}
