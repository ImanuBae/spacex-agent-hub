// apps/admin-portal/lib/services/courses.ts

export interface Course {
  id: number;
  title: string;
  category: string;
  instructor: string;
  price: string;
  status: "Đang mở" | "Sắp khai giảng" | "Đã kết thúc";
  image: string;
}

const STORAGE_KEY = "admin_portal_courses_data";

function getStoredCourses(): Course[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    return [];
  }
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveStoredCourses(courses: Course[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
  }
}

export const courseService = {
  // Lấy danh sách khóa học
  getAllCourses: async (): Promise<Course[]> => {
    return getStoredCourses();
  },

  // Lấy chi tiết một khóa học
  getCourseById: async (id: string): Promise<Course> => {
    const courses = getStoredCourses();
    const course = courses.find((c) => c.id.toString() === id);
    if (!course) throw new Error("Không tìm thấy khóa học");
    return course;
  },

  // Tạo mới khóa học
  createCourse: async (data: Partial<Course>): Promise<Course> => {
    const courses = getStoredCourses();
    const newId =
      courses.length > 0 ? Math.max(...courses.map((c) => c.id)) + 1 : 1;
    const newCourse: Course = {
      id: newId,
      title: data.title || "",
      category: data.category || "",
      instructor: data.instructor || "",
      price: data.price || "",
      status: data.status || "Đang mở",
      image: data.image || "",
    };
    courses.unshift(newCourse);
    saveStoredCourses(courses);
    return newCourse;
  },

  // Cập nhật khóa học
  updateCourse: async (id: string, data: Partial<Course>): Promise<Course> => {
    const courses = getStoredCourses();
    const index = courses.findIndex((c) => c.id.toString() === id);
    if (index === -1) throw new Error("Không tìm thấy khóa học để cập nhật");

    courses[index] = {
      ...courses[index],
      ...data,
    };
    saveStoredCourses(courses);
    return courses[index];
  },

  // Xóa khóa học
  deleteCourse: async (id: string): Promise<{ success: boolean }> => {
    let courses = getStoredCourses();
    courses = courses.filter((c) => c.id.toString() !== id);
    saveStoredCourses(courses);
    return { success: true };
  },
};
