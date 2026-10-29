import type { ButtonHTMLAttributes, ReactNode } from "react";

/* Small shared pieces. They emit the plain-JS app's class names, so
 * styles.css draws them unchanged. */

type BtnKind = "primary" | "secondary" | "danger" | undefined;
export function Button({ kind, wide, grow, className, type = "button", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; wide?: boolean; grow?: boolean }) {
  const cls = ["btn", kind, wide && "wide", grow && "grow", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}

export function LinkButton({ className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={"linkbtn" + (className ? " " + className : "")} {...rest} />;
}

export function Chip({ pressed, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return <button type={type} className={"chip" + (className ? " " + className : "")} aria-pressed={pressed} {...rest} />;
}

/* pwa/app.js row(name, sub, right). */
export function Row({ name, sub, right, className, onClick, children }:
  { name: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string; onClick?: () => void; children?: ReactNode }) {
  return (
    <div className={"row" + (className ? " " + className : "")} onClick={onClick}>
      {children}
      <div className="grow"><span className="name">{name}</span>{sub ? <span className="sub">{sub}</span> : null}</div>
      <div className="money">{right || ""}</div>
    </div>
  );
}

/* A grouped list (white rounded group with hairline rows). */
export function Group({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  return <div className={"group" + (className ? " " + className : "")} aria-label={label}>{children}</div>;
}

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <>
      {action ? <div className="sectrow"><h3 className="sect">{title}</h3>{action}</div> : <h3 className="sect">{title}</h3>}
      {children}
    </>
  );
}

export function LargeTitle({ children }: { children: ReactNode }) {
  return <h2 className="largetitle">{children}</h2>;
}

/* pwa/app.js empty(text). */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
