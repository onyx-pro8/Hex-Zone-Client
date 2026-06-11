import { Link } from "react-router-dom";

export const Footer = () => (
  <footer className="flex flex-col gap-4 border-t border-[#DCE6F2] bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
    <div className="flex items-center justify-center gap-2 sm:justify-start">
      <img src="/logo-mark.png" alt="" aria-hidden className="h-6 w-6" />
      <span className="text-sm font-extrabold tracking-tight text-[#0F2C5C]">
        Safe <span className="text-[#2FA24A]">Zone</span> Patrol
      </span>
    </div>
    <p className="text-center text-xs text-[#8694AC] sm:flex-1">
      Neighbourhood safety alerts + REST API
    </p>
    <div className="flex items-center justify-center gap-6 sm:justify-end">
      <Link
        to="/api"
        className="text-xs text-[#8694AC] transition hover:text-[#2F80ED]"
      >
        API
      </Link>
    </div>
  </footer>
);
