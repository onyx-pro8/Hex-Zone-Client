import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Optional extra classes for the inner card surface. */
  className?: string;
};

/**
 * Shared content surface for member-shell pages. Gives every admin/member page a
 * consistent max-width, rounded card, border and padding so content no longer
 * floats flush against the page background. Dashboard (full-bleed map) opts out.
 */
export function PageCard({ children, className = "" }: Props) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div
        className={[
          "rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-sm sm:p-6",
          className,
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
