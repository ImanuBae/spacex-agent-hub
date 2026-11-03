"use client";
import { useId, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";

const spring = {
  type: "spring",
  stiffness: 420,
  damping: 42,
  mass: 1,
} as const;

function CountDigit({ value, reduced }: { value: number; reduced: boolean }) {
  const present = useIsPresent();
  return (
    <motion.strong
      data-current-count={present ? true : undefined}
      aria-hidden={!present || undefined}
      initial={{ y: reduced ? 0 : "65%", opacity: reduced ? 1 : 0.4 }}
      animate={{ y: "0%", opacity: 1 }}
      exit={{ y: reduced ? 0 : "-65%", opacity: 0 }}
      transition={reduced ? { duration: 0 } : spring}
    >
      {value}
    </motion.strong>
  );
}

const classes = [
  {
    id: "excel",
    name: "Excel ứng dụng",
    code: "EX-TD-01",
    days: "Thứ 3 · Thứ 5",
    time: "18:30–20:30",
    room: "A.02",
    capacity: 20,
    enrolled: 16,
    held: 1,
  },
  {
    id: "office",
    name: "Tin học văn phòng",
    code: "TH-TD-02",
    days: "Thứ 2 · Thứ 4",
    time: "18:30–20:30",
    room: "A.01",
    capacity: 24,
    enrolled: 18,
    held: 2,
  },
  {
    id: "python",
    name: "Python cơ bản",
    code: "PY-TD-03",
    days: "Thứ 7 · Chủ nhật",
    time: "08:30–10:30",
    room: "B.01",
    capacity: 20,
    enrolled: 12,
    held: 0,
  },
] as const;

export default function ScheduleDemo() {
  const scope = useId();
  const panelId = `${scope}-class-details`;
  const titleId = `${scope}-class-title`;
  const reduced = Boolean(useReducedMotion());
  const transition = reduced ? { duration: 0 } : spring;
  const [selected, setSelected] = useState<string>("excel");
  const [holds, setHolds] = useState<string[]>([]);
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState(
    "Bản minh họa. Thao tác không tạo đăng ký thật.",
  );
  const current = classes.find((item) => item.id === selected)!;
  const hasHold = holds.includes(selected);
  const held = current.held + Number(hasHold);
  const available = current.capacity - current.enrolled - held;
  const visible = classes.filter(
    (item) =>
      filter === "all" ||
      (filter === "weekend" ? item.id === "python" : item.id !== "python"),
  );

  function selectClass(id: string) {
    setSelected(id);
    const item = classes.find((item) => item.id === id)!;
    const isHeld = holds.includes(id);
    const remaining = item.capacity - item.enrolled - item.held - Number(isHeld);
    setMessage(
      `${item.name}: còn ${remaining} chỗ trống. ${isHeld ? "Bạn đang giữ 1 chỗ minh họa tại lớp này." : "Thử giữ 1 chỗ minh họa, không tạo đăng ký thật."}`,
    );
  }
  function changeFilter(value: string) {
    setFilter(value);
    if (value === "weekend") selectClass("python");
    if (value === "evening" && selected === "python") selectClass("excel");
  }
  function toggleHold() {
    setHolds((previous) =>
      hasHold
        ? previous.filter((id) => id !== selected)
        : [...previous, selected],
    );
    setMessage(
      hasHold
        ? `Đã hủy giữ chỗ minh họa cho ${current.name}.`
        : `Đã giữ 1 chỗ minh họa cho ${current.name}. Bạn có thể hủy ngay bên dưới.`,
    );
  }

  return (
    <LayoutGroup id={scope}>
      <div
        className="lp-demo"
        data-ui="schedule-demo"
        role="region"
        aria-label="Bản minh họa lịch lớp"
        id="trai-nghiem"
      >
        <div className="lp-demo-bar">
          <span className="lp-demo-product">
            <span>Agent Hub</span>
            <span className="lp-demo-divider">/</span>
            <span>Lịch lớp</span>
          </span>
          <span className="lp-sample">Dữ liệu mẫu</span>
        </div>
        <div className="lp-demo-body">
          <div className="lp-class-list">
            <div className="lp-branch">
              <span className="lp-branch-mark" aria-hidden="true">
                TĐ
              </span>
              <div>
                <strong>Thủ Đức</strong>
                <span>Chi nhánh đang xem</span>
              </div>
            </div>
            <div className="lp-filters" role="group" aria-label="Lọc lịch học">
              {[
                ["all", "Tất cả"],
                ["evening", "Buổi tối"],
                ["weekend", "Cuối tuần"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  aria-controls={panelId}
                  onClick={() => changeFilter(value)}
                >
                  {filter === value && (
                    <motion.span
                      className="lp-filter-highlight"
                      aria-hidden="true"
                      layoutId={reduced ? undefined : "filter"}
                      initial={false}
                      transition={transition}
                    />
                  )}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <label className="lp-mobile-class" htmlFor="lp-class-select">
              Chọn lớp
              <select
                id="lp-class-select"
                value={selected}
                aria-controls={panelId}
                onChange={(e) => selectClass(e.target.value)}
              >
                {visible.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="lp-class-options"
              role="group"
              aria-label="Chọn lớp minh họa"
            >
              {visible.map((item) => (
                <motion.button
                  key={item.id}
                  layout={reduced ? false : "position"}
                  transition={transition}
                  type="button"
                  className="lp-class"
                  aria-pressed={selected === item.id}
                  aria-controls={panelId}
                  onClick={() => selectClass(item.id)}
                >
                  {selected === item.id && (
                    <motion.span
                      className="lp-class-highlight"
                      aria-hidden="true"
                      layoutId={reduced ? undefined : "class"}
                      initial={false}
                      transition={transition}
                    />
                  )}
                  <span className="lp-class-heading">
                    <strong>{item.name}</strong>
                    <span aria-hidden="true">↗</span>
                  </span>
                  <span>{item.days}</span>
                  <span className="lp-class-bottom">
                    <span>{item.time}</span>
                    <span>
                      {item.capacity -
                        item.enrolled -
                        item.held -
                        Number(holds.includes(item.id))}{" "}
                      chỗ trống
                    </span>
                  </span>
                </motion.button>
              ))}
            </div>
            <p className="lp-demo-context">
              Thông tin lớp và sức chứa nằm trong cùng một lượt tra cứu.
            </p>
          </div>
          <div
            className="lp-seat-panel"
            id={panelId}
            role="region"
            aria-labelledby={titleId}
          >
            <div className="lp-seat-top">
              <span>
                {current.code} · Phòng {current.room}
              </span>
              <span className="lp-open">Đang mở</span>
            </div>
            <p className="lp-seat-title" id={titleId}>{current.name}</p>
            <p className="lp-seat-schedule">
              {current.days} · {current.time}
            </p>
            <div className="lp-seat-summary">
              <p className="lp-seat-count">
                <span className="lp-number-window">
                  <AnimatePresence initial={false}>
                    <CountDigit
                      key={available}
                      value={available}
                      reduced={reduced}
                    />
                  </AnimatePresence>
                </span>
                <span>chỗ còn trống</span>
              </p>
              <dl>
                <div>
                  <dt>Sức chứa</dt>
                  <dd>{current.capacity}</dd>
                </div>
                <div>
                  <dt>Đã đăng ký</dt>
                  <dd>{current.enrolled}</dd>
                </div>
                <div>
                  <dt>Đang giữ</dt>
                  <dd>{held}</dd>
                </div>
              </dl>
            </div>
            <div className="lp-seats" aria-hidden="true">
              {Array.from({ length: current.capacity }, (_, i) => (
                <motion.span
                  key={`${current.id}-${i}`}
                  initial={false}
                  animate={{
                    y:
                      !reduced &&
                      i >= current.enrolled &&
                      i < current.enrolled + held
                        ? -2
                        : 0,
                    scale:
                      !reduced &&
                      i >= current.enrolled &&
                      i < current.enrolled + held
                        ? 0.95
                        : 1,
                  }}
                  transition={transition}
                  className={
                    i < current.enrolled
                      ? "is-enrolled"
                      : i < current.enrolled + held
                        ? "is-held"
                        : "is-free"
                  }
                />
              ))}
            </div>
            <div className="lp-seat-legend">
              <span>
                <i className="is-enrolled" />
                Đã đăng ký
              </span>
              <span>
                <i className="is-held" />
                Đang giữ
              </span>
              <span>
                <i className="is-free" />
                Còn trống
              </span>
            </div>
            <motion.button
              className={`lp-button lp-hold ${hasHold ? "lp-button-cancel" : ""}`}
              type="button"
              aria-pressed={hasHold}
              onClick={toggleHold}
              whileTap={reduced ? undefined : { scale: 0.98 }}
              transition={transition}
            >
              {hasHold ? "Hủy giữ chỗ minh họa" : "Thử giữ 1 chỗ"}
              <span aria-hidden="true">{hasHold ? "−" : "+"}</span>
            </motion.button>
            <p className="lp-demo-status" role="status" aria-live="polite" aria-atomic="true">
              {message}
            </p>
          </div>
        </div>
        <noscript>
          <p className="lp-noscript">
            Bạn đang xem lịch mẫu. Bật JavaScript để thử thao tác giữ và hủy
            chỗ.
          </p>
        </noscript>
      </div>
    </LayoutGroup>
  );
}
