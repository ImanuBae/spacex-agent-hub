"use client";

import { useState } from "react";
import Link from "next/link";
import { contactBranches } from "./branches";

export default function BranchConsultation() {
  const [branch, setBranch] = useState("");
  return <div className="contact-branch">
    <label htmlFor="contact-branch">Chi nhánh quan tâm</label>
    <select id="contact-branch" value={branch} onChange={event => setBranch(event.target.value)}>
      <option value="">Chưa chọn chi nhánh</option>
      {contactBranches.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
    </select>
    <p>Chi nhánh bạn chọn sẽ được điền vào tin nhắn để bạn xem lại trước khi gửi.</p>
    <Link className="btn btn-primary" href={branch ? { pathname: "/chat", query: { branch } } : "/chat"}>Mở chat tư vấn <span aria-hidden="true">↗</span></Link>
  </div>;
}
