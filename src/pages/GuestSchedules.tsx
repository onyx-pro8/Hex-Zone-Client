import { Navigate } from "react-router-dom";

/** Guest access is Event ID pass only — calendar schedules are not used. */
export default function GuestSchedules() {
  return <Navigate to="/guest-passes" replace />;
}
