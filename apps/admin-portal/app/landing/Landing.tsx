import type { CSSProperties } from "react";
import Link from "next/link";
import { inter } from "../ui/fonts";
import Motion from "./Motion";
import Planet from "./Planet";
import "./landing.css";

const delay = (ms: number) => ({ "--rd": `${ms}ms` }) as CSSProperties;
const features = [
  [
    "Khóa học & gói học",
    "Tra cứu khóa học, gói học và giá VND; quản lý chính sách có phiên bản.",
  ],
  [
    "Lớp học & lịch học",
    "Theo dõi lớp, buổi học, giảng viên và phòng học trong cùng một luồng vận hành.",
  ],
  [
    "Tổ chức & đội ngũ",
    "Quản lý đơn vị, chi nhánh và hồ sơ nhân sự phục vụ phối hợp tuyển sinh.",
  ],
  [
    "Giữ chỗ kỹ thuật",
    "Thử nghiệm giữ chỗ, thời hạn và hủy chỗ bằng dữ liệu demo có nhãn; chưa phải đăng ký học hay thanh toán.",
  ],
  [
    "Quyền theo vai trò",
    "Đăng nhập bằng phiên thật; quyền truy cập được kiểm tra theo vai trò và phạm vi chi nhánh.",
  ],
  [
    "AI trong lộ trình",
    "Dự kiến hỗ trợ tư vấn và chuyển tiếp cho nhân viên sau khi hoàn thiện dữ liệu, công cụ và kiểm chứng nghiệp vụ.",
  ],
];
function Icon({ index = 6 }: { index?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={index === 6 ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {index === 0 && (
        <>
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="15" y="15" width="6" height="6" rx="1.5" />
          <path d="M6 9v3a3 3 0 0 0 3 3h3" />
        </>
      )}
      {index === 1 && <path d="M4 19V5M4 19h16M8 16v-4M13 16V8M18 16v-7" />}
      {index === 2 && (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          <circle cx="9" cy="7" r="4" />
        </>
      )}
      {index === 3 && <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />}
      {index === 4 && (
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4" />
      )}
      {index === 5 && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" />
        </>
      )}
      {index === 6 && <path d="M5 12h14m-7-7 7 7-7 7" />}
    </svg>
  );
}
function Brand() {
  return (
    <a href="#top" className="brand">
      <span className="brand-mark" aria-hidden="true">
        ▲
      </span>
      SpaceX Agent Hub
    </a>
  );
}
function Login({
  children = "Đăng nhập hệ thống",
}: {
  children?: React.ReactNode;
}) {
  return (
    <Link className="btn btn-primary" href="/login">
      {children}
      <Icon />
    </Link>
  );
}
const footerColumns = [
  {
    title: "Nghiệp vụ",
    links: [
      ["Khóa & gói học", "#features"],
      ["Lớp & lịch", "#solutions"],
      ["Giữ chỗ demo", "#features"],
    ],
  },
  {
    title: "Lộ trình",
    links: [
      ["AI hỗ trợ", "#roadmap"],
      ["Hội thoại & CRM", "#roadmap"],
      ["Đăng ký & thanh toán", "#roadmap"],
    ],
  },
  {
    title: "Truy cập",
    links: [
      ["Đăng nhập", "/login"],
      ["Tính năng", "#features"],
      ["Về đầu trang", "#top"],
    ],
  },
];

export default async function Landing() {
  "use cache";
  return (
    <div className={`ascend ${inter.className}`} id="top">
      <Planet />
      <Motion />
      <a className="skip-link" href="#features">
        Đến nội dung chính
      </a>
      <div className="page">
        <header className="hero">
          <nav className="nav" aria-label="Điều hướng chính">
            <Brand />
            <div className="nav-links">
              <a href="#features">Tính năng</a>
              <a href="#solutions">Vận hành</a>
              <a href="#roadmap">Lộ trình</a>
              <a href="#cta">Truy cập</a>
            </div>
            <Link href="/login" className="btn btn-ghost">
              Đăng nhập
            </Link>
          </nav>
          <div className="hero-inner">
            <h1 className="hero-title" data-reveal style={delay(60)}>
              Tuyển sinh liền mạch,
              <br />
              Vận hành <em>rõ ràng</em>
            </h1>
            <p className="hero-sub" data-reveal style={delay(180)}>
              Tra cứu khóa học, lịch lớp và chỗ giữ trong một không gian làm
              việc dành cho đội ngũ SpaceX Việt Nam.
            </p>
            <div className="hero-actions" data-reveal style={delay(300)}>
              <Login />
              <a className="btn btn-outline" href="#features">
                Khám phá tính năng
              </a>
            </div>
          </div>
          <div className="logos" data-reveal style={delay(420)}>
            <p className="logos-label">Phạm vi tổ chức dự kiến</p>
            <div className="logos-row">
              {[
                "Trung tâm TP.HCM",
                "Quận 1",
                "Thủ Đức",
                "Tân Bình",
                "Bình Thạnh",
                "Quận 7",
              ].map((name) => (
                <span className="logo" key={name}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </header>
        <main>
          <section
            className="section features"
            id="features"
            aria-labelledby="features-title"
          >
            <div className="section-head">
              <span className="eyebrow" data-reveal>
                Mọi nghiệp vụ trong tầm nhìn
              </span>
              <h2 id="features-title" data-reveal style={delay(80)}>
                Một không gian cho đội ngũ tuyển sinh
              </h2>
              <p data-reveal style={delay(160)}>
                Từ khóa học đến lịch lớp, thông tin được tổ chức rõ ràng theo
                vai trò và chi nhánh để đội ngũ phối hợp mỗi ngày.
              </p>
            </div>
            <div className="feature-grid">
              {features.map(([title, description], index) => (
                <article
                  className="card"
                  key={title}
                  data-reveal
                  style={delay(index * 90)}
                >
                  <div className="card-icon">
                    <Icon index={index} />
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
          <section
            className="section showcase"
            id="solutions"
            aria-labelledby="solutions-title"
          >
            <div className="showcase-grid">
              <div className="showcase-copy">
                <span className="eyebrow" data-reveal>
                  Rõ lớp, rõ lịch, rõ chỗ
                </span>
                <h2 id="solutions-title" data-reveal style={delay(90)}>
                  Nắm lịch lớp trước mỗi lượt tư vấn
                </h2>
                <p data-reveal style={delay(180)}>
                  Tra cứu lớp theo khóa học, chi nhánh và khung giờ. Kiểm tra
                  điều kiện mở bán và chỗ còn trước khi thực hiện giữ chỗ kỹ
                  thuật trong môi trường demo.
                </p>
                <div data-reveal style={delay(270)}>
                  <Login>Truy cập Portal</Login>
                </div>
              </div>
              <figure
                className="dashboard"
                data-ui="illustrative-preview"
                data-reveal
                style={delay(160)}
              >
                <div className="dash-top">
                  <strong>Lịch lớp · Minh họa</strong>
                  <span className="dash-live">
                    <i />
                    DEMO
                  </span>
                </div>
                <div className="dash-bars" aria-hidden="true">
                  {[62, 88, 47, 95, 71, 80, 58].map((height, i) => (
                    <div
                      key={i}
                      className="dash-bar"
                      style={{
                        height: `${height}%`,
                        animationDelay: `${i * 90}ms`,
                      }}
                    />
                  ))}
                </div>
                <div className="dash-rows" aria-hidden="true">
                  {[90, 72, 48, 34].map((width, i) => (
                    <div className="dash-row" key={i}>
                      <span>Lớp minh họa {"ABCD"[i]}</span>
                      <div className="dash-track">
                        <div
                          className="dash-fill"
                          style={{ "--w": `${width}%` } as CSSProperties}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <figcaption>
                  Dữ liệu minh họa giao diện, không phản ánh số liệu vận hành.
                </figcaption>
              </figure>
            </div>
            <div className="stats">
              {[
                "Khóa & gói học",
                "Lớp & lịch học",
                "Giữ chỗ demo",
                "Vai trò & phạm vi",
              ].map((label, i) => (
                <div
                  className="stat"
                  data-reveal
                  style={delay(i * 80)}
                  key={label}
                >
                  <div className="stat-value">0{i + 1}</div>
                  <p className="stat-label">{label}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="section cta" id="cta" aria-labelledby="cta-title">
            <div className="cta-card">
              <span className="eyebrow" data-reveal style={delay(60)}>
                Sẵn sàng vào ca làm việc
              </span>
              <h2 id="cta-title" data-reveal style={delay(140)}>
                Bắt đầu từ một góc nhìn rõ ràng
              </h2>
              <p data-reveal style={delay(220)}>
                Đăng nhập bằng tài khoản được cấp để truy cập nghiệp vụ trong
                phạm vi của bạn. AI, hội thoại và thanh toán đang nằm trong lộ
                trình phát triển.
              </p>
              <div className="hero-actions" data-reveal style={delay(300)}>
                <Login />
                <a className="btn btn-outline" href="#roadmap">
                  Xem lộ trình
                </a>
              </div>
            </div>
            <aside id="roadmap" className="roadmap" data-reveal>
              <h3>Lộ trình phát triển</h3>
              <p>
                AI hỗ trợ, hộp thư chung, CRM, đăng ký, QR/thanh toán và cổng
                học viên đang được phát triển theo từng giai đoạn.
              </p>
            </aside>
            <footer className="footer">
              <div className="footer-brand">
                <Brand />
                <p>Không gian điều phối tuyển sinh cho SpaceX Việt Nam.</p>
              </div>
              <div className="footer-cols">
                {footerColumns.map(({ title, links }) => (
                  <div key={title}>
                    <h3>{title}</h3>
                    {links.map(([label, href]) => (
                      <Link key={label} href={href}>
                        {label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </footer>
            <p className="copyright">
              © {new Date().getFullYear()} SpaceX Agent Hub · Dự án mô phỏng
              trung tâm tin học SpaceX Việt Nam.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
