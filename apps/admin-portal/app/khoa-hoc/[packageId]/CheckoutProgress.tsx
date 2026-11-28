const steps = ["Chọn lớp", "Thông tin", "Kiểm tra", "Thanh toán"];

export default function CheckoutProgress({ step, complete = false }: { step: number; complete?: boolean }) {
  return <ol className="checkout-progress" aria-label="Các bước đăng ký">
    {steps.map((label, index) => {
      const done = index < step || complete;
      return <li key={label} aria-current={index === step && !complete ? "step" : undefined} data-done={done}>
        <span aria-hidden="true">{done ? "✓" : index + 1}</span>{label}{done && <span className="sr-only"> (đã xong)</span>}
      </li>;
    })}
  </ol>;
}
