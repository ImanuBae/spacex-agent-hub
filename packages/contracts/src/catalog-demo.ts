export const demoOffers = [
    {
        code: "DEMO-PYTHON", name: "Python cơ bản", level: "beginner", deliveryModes: ["online", "onsite"],
        description: "Biến, vòng lặp, hàm và đọc dữ liệu từ tệp CSV.",
        goal: "Viết chương trình Python để tự động hóa một công việc đơn giản.",
        priceVnd: 1800000, packageCode: "DEMO-PYTHON-8", sessions: 8,
    },
    {
        code: "DEMO-SQL", name: "SQL thực hành", level: "beginner", deliveryModes: ["online"],
        description: "Truy vấn PostgreSQL, nối bảng và tổng hợp từ dữ liệu mẫu.",
        goal: "Tự truy vấn và kiểm tra số liệu cho một báo cáo nghiệp vụ.",
        priceVnd: 2100000, packageCode: "DEMO-SQL-10", sessions: 10,
    },
    {
        code: "DEMO-POWER-BI", name: "Phân tích dữ liệu với Power BI", level: "intermediate", deliveryModes: ["onsite", "online"],
        description: "Power Query, mô hình dữ liệu, DAX và báo cáo tương tác.",
        goal: "Tạo báo cáo Power BI có bộ lọc và các chỉ số từ bộ dữ liệu mẫu.",
        priceVnd: 2800000, packageCode: "DEMO-POWER-BI-12", sessions: 12,
    },
    {
        code: "DEMO-FIGMA", name: "UI/UX với Figma", level: "beginner", deliveryModes: ["onsite"],
        description: "Luồng người dùng, wireframe, thành phần Figma và prototype.",
        goal: "Thiết kế và kiểm thử prototype cho một luồng trên điện thoại.",
        priceVnd: 2400000, packageCode: "DEMO-FIGMA-10", sessions: 10,
    },
] as const;
