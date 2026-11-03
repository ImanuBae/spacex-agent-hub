import type { CSSProperties } from "react";
const paths:Record<string,string>={
  overview:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  mailbox:"M3 5h18v14H3z M3 6l9 7 9-7",leads:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6",
  courses:"M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3z M4 17h16 M8 7h8 M8 11h6",
  schedule:"M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M7 14h3 M14 14h3 M7 17h3",classes:"M4 4h16v13H4z M8 21l4-4 4 4 M8 8h8 M8 12h5",
  organization:"M9 3h6v6H9z M3 15h6v6H3z M15 15h6v6h-6z M12 9v3 M6 15v-3h12v3",
  finance:"M3 5h18v15H3z M3 9h18 M7 15h3",audit:"M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
  profile:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 8 0 0 1 16 0v2",
  search:"M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M17 17l4 4",refresh:"M20 7a9 9 0 1 0 1 8 M20 3v5h-5",
  plus:"M12 5v14 M5 12h14",close:"M6 6l12 12 M18 6L6 18",menu:"M4 6h16 M4 12h16 M4 18h16",arrow:"M5 12h14 M14 7l5 5-5 5",filter:"M4 6h16 M7 12h10 M10 18h4",logout:"M9 3H4v18h5 M9 12h12 M16 7l5 5-5 5",chevron:"M9 5l7 7-7 7",help:"M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 18h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20",
};
export default function HubIcon({name,size=18,style}:{name:string;size?:number;style?:CSSProperties}) {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]??paths.classes}/></svg>;
}
