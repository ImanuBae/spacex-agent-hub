export const levels: Record<string, string> = { beginner: "Cơ bản", intermediate: "Trung cấp", advanced: "Nâng cao" };
export const modes: Record<string, string> = { online: "Trực tuyến", onsite: "Tại phòng" };

type Roadmap = {
  audience: string;
  outcomes: string[];
  stages: { title: string; description: string }[];
};

const roadmaps: Record<string, Roadmap> = {
  "DEMO-PYTHON": {
    audience: "Người mới lập trình và người làm văn phòng muốn tự động hóa thao tác với bảng tính hoặc tệp dữ liệu.",
    outcomes: [
      "Viết chương trình ngắn để tính toán và xử lý dữ liệu bằng Python.",
      "Dùng điều kiện, vòng lặp và hàm để tự động hóa thao tác lặp lại.",
      "Đọc tệp CSV và tổng hợp dữ liệu thành kết quả có thể kiểm tra.",
    ],
    stages: [
      { title: "Nền tảng Python", description: "Làm quen với biến, kiểu dữ liệu và danh sách. Thực hành biểu diễn dữ liệu đăng ký theo ngày." },
      { title: "Điều kiện, vòng lặp và hàm", description: "Xử lý từng dòng dữ liệu, lọc theo điều kiện và gom thao tác lặp lại thành hàm." },
      { title: "Đọc tệp CSV và tổng hợp dữ liệu", description: "Đưa dữ liệu từ tệp vào chương trình rồi viết một đoạn tự động hóa để tạo bản tổng hợp." },
    ],
  },
  "DEMO-SQL": {
    audience: "Người mới học SQL hoặc cần tự truy vấn và tổng hợp dữ liệu cho báo cáo.",
    outcomes: ["Chọn, lọc và sắp xếp các dòng cần phân tích.", "Kết hợp dữ liệu từ nhiều bảng và tổng hợp số liệu theo nhóm."],
    stages: [
      { title: "Truy vấn một bảng", description: "Xác định cột cần lấy, lọc các dòng phù hợp và sắp xếp kết quả." },
      { title: "Nối bảng", description: "Dùng khóa liên kết để kết hợp dữ liệu và nhận biết những dòng chưa có bản ghi tương ứng." },
      { title: "Tổng hợp cho báo cáo", description: "Gom dữ liệu theo nhóm để đếm lượt hoặc tính các chỉ số cần theo dõi." },
    ],
  },
  "DEMO-POWER-BI": {
    audience: "Người đã làm việc với dữ liệu và muốn xây dựng báo cáo tương tác.",
    outcomes: ["Chuẩn bị dữ liệu bằng Power Query.", "Tạo mô hình, chỉ số DAX và báo cáo có bộ lọc."],
    stages: [
      { title: "Chuẩn bị dữ liệu", description: "Nhập, làm sạch và định dạng nguồn dữ liệu trong Power Query." },
      { title: "Mô hình và chỉ số", description: "Thiết lập quan hệ giữa các bảng và tạo các phép tính phục vụ báo cáo." },
      { title: "Báo cáo tương tác", description: "Trình bày chỉ số bằng biểu đồ và bộ lọc để người xem tự khám phá số liệu." },
    ],
  },
  "DEMO-FIGMA": {
    audience: "Người mới thiết kế giao diện muốn học cách xây dựng nguyên mẫu cho điện thoại.",
    outcomes: ["Phác thảo luồng và bố cục màn hình.", "Dùng thành phần Figma để thiết kế và thử một nguyên mẫu có tương tác."],
    stages: [
      { title: "Luồng và wireframe", description: "Xác định các bước người dùng cần đi qua và phác thảo bố cục màn hình." },
      { title: "Thành phần giao diện", description: "Tạo và sử dụng lại các thành phần để giữ giao diện nhất quán." },
      { title: "Nguyên mẫu có tương tác", description: "Nối các màn hình và thử nghiệm luồng trên điện thoại." },
    ],
  },
};

export function courseRoadmap(code: string) {
  return Object.hasOwn(roadmaps, code) ? roadmaps[code] : undefined;
}
