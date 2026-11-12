// This is data minimization, not a guarantee that arbitrary prose contains no personal information.
export function redact(text: string) {
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    // Preserve structured source literals before matching phone numbers in prose.
    .replace(/(\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b|\b[12]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}| UTC)?)?|\b\d+(?:[.,]\d+)*\s*(?:VND|VNĐ|đồng|đ|₫)(?!\p{L}))|(?:\+?\d[\d .()-]{7,}\d)/giu, (match, structured) => structured ? match : "[phone]")
    .replace(/(?:họ tên|tên tôi|địa chỉ|cccd|cmnd|căn cước|ngày sinh)\s*[:=]\s*[^;\n]+/giu, "[personal information]");
}
