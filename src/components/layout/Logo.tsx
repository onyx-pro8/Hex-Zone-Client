import { Link } from "react-router-dom";

export function Logo({
  to = "/",
  showWordmark = true,
  size = 40,
}: {
  to?: string;
  showWordmark?: boolean;
  size?: number;
}) {
  return (
    <Link to={to} className="flex items-center gap-3">
      <img
        src="/logo-mark.png"
        alt="Safe Zone Patrol"
        width={size}
        height={size}
        className="shrink-0"
        style={{ width: size, height: size }}
      />
      {showWordmark ? (
        <span className="text-base font-extrabold tracking-tight text-[#0F2C5C]">
          Safe <span className="text-[#2FA24A]">Zone</span> Patrol
        </span>
      ) : null}
    </Link>
  );
}
