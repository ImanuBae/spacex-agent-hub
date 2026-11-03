"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import HubIcon from "./HubIcon";
import { OperationError } from "../../../lib/services/classes";
export function OperationDialog({
  title,
  children,
  onClose,
  drawer=false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(() => {
    const focus = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      if(focus?.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`ops-dialog ops ${drawer?"ops-drawer":""}`}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="ops-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Đóng hộp thoại">
          <HubIcon name="close"/>
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function OperationTabs({items,value,onChange}:{items:{id:string;label:string;count?:number}[];value:string;onChange:(value:string)=>void}) {
  return <div className="ops-tabs" role="tablist" aria-label="Chọn nội dung" onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const i=items.findIndex(item=>item.id===value),next=e.key==="Home"?0:e.key==="End"?items.length-1:(i+(e.key==="ArrowRight"?1:-1)+items.length)%items.length;onChange(items[next].id);e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();}}>{items.map(item=><button key={item.id} role="tab" aria-selected={value===item.id} tabIndex={value===item.id?0:-1} onClick={()=>onChange(item.id)}>{item.label}{item.count!==undefined&&<span>{item.count}</span>}</button>)}</div>;
}
export function Field({
  name,
  label,
  error,
  children,
}: {
  name: string;
  label: string;
  error?: unknown;
  children: ReactNode;
}) {
  const detail =
    error instanceof OperationError
      ? error.details.find(
          (d) => d.path === name || d.path.startsWith(`${name}.`),
        )
      : undefined;
  return (
    <div className="ops-field">
      <label htmlFor={name}>{label}</label>
      {children}
      {detail && (
        <p id={`${name}-error`} role="alert" className="ops-error">
          {detail.message}
        </p>
      )}
    </div>
  );
}
export function ErrorMessage({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div role="alert" className="ops-error">
      {error instanceof Error ? error.message : "Không thể tải dữ liệu."}
      {retry && (
        <button type="button" onClick={retry}>
          Thử lại
        </button>
      )}
    </div>
  );
}
