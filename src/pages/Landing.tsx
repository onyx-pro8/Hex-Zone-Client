import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Hexagon,
  CircleCheck,
  Users,
  User,
  Lock,
  Code2,
  Bell,
  QrCode,
  Radio,
} from "lucide-react";

const LANDING = {
  heroMap: "/landing/hero-isometric-map.png",
  zonePrivate: "/landing/zone-private-network.png",
  zoneExclusive: "/landing/zone-exclusive-network.png",
  planPrivate: "/landing/plan-private-team.png",
  planExclusive: "/landing/plan-exclusive-solo.png",
  apiLaptop: "/landing/api-laptop-code.png",
  footerBg: "/landing/footer-ready-to-weave.png",
  stepRegister: "/landing/step-register.png",
  stepWeave: "/landing/step-weave-zones.png",
  stepConnect: "/landing/step-connect.png",
} as const;

const apiEndpointPreview: { method: "GET" | "POST" | "PUT"; path: string }[] = [
  { method: "GET", path: "/users/login" },
  { method: "POST", path: "/users" },
  { method: "GET", path: "/users/{u}/devices" },
  { method: "PUT", path: "/devices/{id}/setting" },
  { method: "GET", path: "/alerts/devices/{id}" },
  { method: "POST", path: "/alerts/devices/{id}" },
];

function methodBadgeClass(method: "GET" | "POST" | "PUT") {
  switch (method) {
    case "GET":
      return "bg-[#EDF3FB] text-[#2F80ED]";
    case "POST":
      return "bg-[#E3F4E8] text-[#2FA24A]";
    case "PUT":
      return "bg-[#FBEFD8] text-[#E0992A]";
  }
}

const developerFeatures: {
  title: string;
  description: string;
  icon: LucideIcon;
  iconWrap: string;
}[] = [
  {
    title: "H3 Hexagonal Indexing",
    description:
      "Earth's surface divided into hex cells. Each user gets 3 acceptable zones at resolution 13 – precise enough for city blocks.",
    icon: Hexagon,
    iconWrap: "border border-sky-200 bg-sky-50 text-sky-600",
  },
  {
    title: "Private Networks",
    description:
      "Many users, one device each. Everyone shares the same zone type. Perfect for delivery teams, security patrols, or family tracking.",
    icon: User,
    iconWrap: "border border-violet-200 bg-violet-50 text-violet-600",
  },
  {
    title: "Exclusive Access",
    description:
      "Solo deployment. One user, one device, any zone type you need. Full flexibility for individual use cases.",
    icon: Lock,
    iconWrap: "border border-emerald-200 bg-emerald-50 text-emerald-600",
  },
  {
    title: "Developer First API",
    description:
      "REST endpoints for users, devices, alerts, and settings. Your mobile app talks directly to the zone server.",
    icon: Code2,
    iconWrap: "border border-orange-200 bg-orange-50 text-orange-600",
  },
  {
    title: "Real-time Alerts",
    description:
      "Zone entry, exit, geofence breaches, device offline. Store and retrieve alerts per device via API.",
    icon: Bell,
    iconWrap: "border border-rose-200 bg-rose-50 text-rose-600",
  },
  {
    title: "Scan to Join",
    description:
      "QR codes contain network IDs. New users scan, enter their details, and they're automatically linked to your private zone.",
    icon: QrCode,
    iconWrap: "border border-indigo-200 bg-indigo-50 text-indigo-600",
  },
];

const networkCards = [
  {
    title: "Private Zone",
    label: "Active",
    users: 3,
    devices: 3,
    type: "H3 r13",
    accent: "bg-[#EDF3FB] text-[#2F80ED]",
    border: "border-[#2F80ED]/20",
    image: LANDING.zonePrivate,
    imageAlt: "Private zone with team members on a city map",
  },
  {
    title: "Exclusive Zone",
    label: "Active",
    users: 1,
    devices: 1,
    type: "Geofence",
    accent: "bg-[#FBEFD8] text-[#E0992A]",
    border: "border-[#E0992A]/25",
    image: LANDING.zoneExclusive,
    imageAlt: "Exclusive solo zone with geofence on a city map",
  },
];

const howItWorksSteps = [
  {
    title: "Register",
    description:
      "Enter your name, address, and account type. Generate a network ID or join an existing one.",
    image: LANDING.stepRegister,
  },
  {
    title: "Weave Zones",
    description:
      "Address data converts to H3 cells. Build and export zones in H3 or geofence mode.",
    image: LANDING.stepWeave,
  },
  {
    title: "Connect",
    description:
      "Mobile apps hit the REST API to sync devices, alerts, and zone state in real time.",
    image: LANDING.stepConnect,
  },
];

function SectionShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full min-w-0 max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-w-0 space-y-0 overflow-x-hidden pb-0">
      {/* Hero */}
      <section className="border-b border-[#DCE6F2] bg-gradient-to-b from-white to-[#F7FAFE]">
        <SectionShell className="py-10 sm:py-16 lg:py-20">
          <div className="grid items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="order-2 space-y-5 sm:space-y-6 lg:order-1">
              <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#EDF3FB] px-3 py-1.5 text-xs font-medium text-[#2F80ED] sm:px-4 sm:py-2 sm:text-sm">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2FA24A] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2FA24A]" />
                </span>
                REST API Ready
              </span>
              <div className="space-y-3 sm:space-y-4">
                <h1 className="text-3xl font-bold tracking-tight text-[#0F2C5C] sm:text-4xl md:text-5xl lg:text-6xl">
                  Weave Your Spatial Zones
                </h1>
                <p className="max-w-xl text-base leading-7 text-[#566784] sm:text-lg sm:leading-8">
                  A geospatial platform that bridges web and mobile. Define zones
                  using H3 hexagonal indexing, connect devices via REST API, and
                  track everything in real time.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
                <Link
                  to="/register"
                  className="inline-flex w-full items-center justify-center rounded-lg bg-[#2F80ED] px-6 py-3 text-sm font-bold text-white shadow-md shadow-[#2F80ED]/20 transition hover:brightness-110 sm:w-auto"
                >
                  Create Account
                </Link>
                <Link
                  to="/api"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-[#DCE6F2] bg-white px-6 py-3 text-sm font-semibold text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED] sm:w-auto"
                >
                  API Docs
                </Link>
              </div>
              <p className="text-sm text-[#8694AC] sm:hidden">
                Already have an account?{" "}
                <Link to="/login" className="font-semibold text-[#2F80ED] hover:underline">
                  Sign in
                </Link>
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {["H3 Indexing", "Mobile REST API", "QR Onboarding"].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs text-[#566784] shadow-sm sm:px-4 sm:py-2 sm:text-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-[0_24px_60px_-24px_rgba(47,128,237,0.35)] sm:rounded-[1.75rem]">
                <img
                  src={LANDING.heroMap}
                  alt="Isometric city map with hex zones, mobile app, and drone"
                  className="aspect-[16/10] h-auto max-h-[min(52vw,280px)] w-full object-cover sm:max-h-none sm:aspect-auto"
                  loading="eager"
                />
              </div>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Zone Network */}
      <section className="bg-[#F3F7FD] py-10 sm:py-16">
        <SectionShell>
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-[#0F2C5C] sm:text-3xl">
                Zone Network
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-[#566784] sm:text-base">
                Live status of your current network and API connectivity.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#EDF3FB] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#2F80ED] sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.18em]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#2FA24A]" aria-hidden />
              Live
            </span>
          </div>

          <div className="grid gap-4 sm:gap-5 md:grid-cols-2">
            {networkCards.map((card) => (
              <article
                key={card.title}
                className={`min-w-0 overflow-hidden rounded-2xl border bg-white shadow-glow sm:rounded-3xl ${card.border}`}
              >
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC] sm:text-xs sm:tracking-[0.28em]">
                        {card.title}
                      </p>
                      <p className="mt-1.5 text-lg font-bold text-[#0F2C5C] sm:mt-2 sm:text-xl">
                        {card.type}
                      </p>
                    </div>
                    <span
                      className={`w-fit rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] sm:text-xs sm:tracking-[0.12em] ${card.accent}`}
                    >
                      {card.label}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:gap-3">
                    <div className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 font-medium text-[#566784] sm:rounded-2xl sm:px-4 sm:py-3">
                      {card.users} users
                    </div>
                    <div className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 font-medium text-[#566784] sm:rounded-2xl sm:px-4 sm:py-3">
                      {card.devices} devices
                    </div>
                  </div>
                </div>
                <img
                  src={card.image}
                  alt={card.imageAlt}
                  className="h-32 w-full object-cover object-center sm:h-44"
                  loading="lazy"
                />
              </article>
            ))}
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-[#2F80ED]/15 bg-gradient-to-r from-[#EDF3FB] to-white p-4 sm:mt-6 sm:rounded-3xl sm:p-8">
            <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="min-w-0">
                <p className="text-base font-bold text-[#0F2C5C] sm:text-lg">
                  Developer-friendly REST API
                </p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#566784]">
                  Complete endpoint documentation with live request examples and
                  response previews for your mobile integration.
                </p>
              </div>
              <div className="max-w-full overflow-x-auto rounded-xl border border-[#DCE6F2] bg-[#0F2C5C] px-3 py-2.5 font-mono text-[11px] text-[#7DD3FC] shadow-lg sm:rounded-2xl sm:px-4 sm:py-3 sm:text-xs">
                <span className="text-[#2FA24A]">POST</span>{" "}
                <span className="text-white">/zones</span>
                <br />
                <span className="text-[#8694AC]">{`{ "type": "geofence" }`}</span>
              </div>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* How it works */}
      <section className="border-y border-[#DCE6F2] bg-white py-10 sm:py-16">
        <SectionShell>
          <h2 className="text-2xl font-bold text-[#0F2C5C] sm:text-3xl">
            How Safe Zone Patrol Works
          </h2>
          <p className="mt-2 text-sm text-[#566784] sm:mt-3 sm:text-base">
            From registration to real-time device tracking in three steps.
          </p>
          <div className="mt-8 grid gap-4 sm:mt-10 sm:gap-6 md:grid-cols-3">
            {howItWorksSteps.map((step, index) => (
              <div
                key={step.title}
                className="min-w-0 rounded-2xl border border-[#DCE6F2] bg-[#F7FAFE] p-5 sm:rounded-3xl sm:p-6"
              >
                <div className="flex items-center gap-3 sm:items-start sm:gap-4">
                  <img
                    src={step.image}
                    alt=""
                    aria-hidden
                    className="h-12 w-12 shrink-0 rounded-xl border border-[#DCE6F2] bg-white object-cover sm:h-14 sm:w-14 sm:rounded-2xl"
                    loading="lazy"
                  />
                  <p className="text-2xl font-bold leading-none text-[#2F80ED]/30 sm:text-3xl">
                    0{index + 1}
                  </p>
                </div>
                <h3 className="mt-4 text-lg font-bold text-[#0F2C5C] sm:mt-5 sm:text-xl">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#566784]">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </SectionShell>
      </section>

      {/* Network type */}
      <section className="bg-[#F3F7FD] py-10 sm:py-16">
        <SectionShell>
          <h2 className="text-2xl font-bold text-[#0F2C5C] sm:text-3xl">
            Pick Your Network Type
          </h2>
          <p className="mt-2 text-sm text-[#566784] sm:mt-3 sm:text-base">
            Two models, built for different scales
          </p>
          <div className="mt-8 grid gap-5 sm:mt-10 sm:gap-6 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-glow sm:rounded-3xl">
              <div className="flex flex-1 flex-col p-5 sm:p-8">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50">
                    <Users className="h-6 w-6 text-sky-600" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#0F2C5C]">Private</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#566784]">
                      Team coordination, family tracking, fleet management
                    </p>
                  </div>
                </div>
                <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-[#566784]">
                  {[
                    "Many users allowed",
                    "1 device per user",
                    "Same zone type for all",
                    "3 acceptable zones per user",
                    "QR code invites",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CircleCheck
                        className="mt-0.5 h-5 w-5 shrink-0 text-[#2F80ED]"
                        strokeWidth={2}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className="mt-8 inline-flex w-full items-center justify-center rounded-lg bg-[#2F80ED] px-5 py-3 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Create Private Zone
                </Link>
              </div>
              <img
                src={LANDING.planPrivate}
                alt="Team collaborating in a private zone network"
                className="h-36 w-full object-cover object-center sm:h-52"
                loading="lazy"
              />
            </div>

            <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E0992A]/35 bg-white shadow-glow ring-1 ring-[#E0992A]/10 sm:rounded-3xl">
              <div className="flex flex-1 flex-col p-5 sm:p-8">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#E0992A]/30 bg-[#FBEFD8]">
                    <User className="h-6 w-6 text-[#E0992A]" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-[#0F2C5C]">
                      Exclusive
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#566784]">
                      Solo deployments, individual tracking, personal zones
                    </p>
                  </div>
                </div>
                <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-[#566784]">
                  {[
                    "1 user only",
                    "1 device per user",
                    "Any zone type allowed",
                    "3 acceptable zones per user",
                    "Full flexibility",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <CircleCheck
                        className="mt-0.5 h-5 w-5 shrink-0 text-[#E0992A]"
                        strokeWidth={2}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className="mt-8 inline-flex w-full items-center justify-center rounded-lg bg-[#E0992A] px-5 py-3 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Create Exclusive Zone
                </Link>
              </div>
              <img
                src={LANDING.planExclusive}
                alt="Individual user in an exclusive zone"
                className="h-36 w-full object-cover object-center sm:h-52"
                loading="lazy"
              />
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Built for developers */}
      <section className="border-y border-[#DCE6F2] bg-white py-10 sm:py-16">
        <SectionShell>
          <h2 className="text-2xl font-bold text-[#0F2C5C] sm:text-3xl">
            Built for Developers
          </h2>
          <p className="mt-2 text-sm text-[#566784] sm:mt-3 sm:text-base">
            Everything your mobile app needs to communicate with the zone server.
          </p>
          <div className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {developerFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="min-w-0 rounded-2xl border border-[#DCE6F2] bg-[#F7FAFE] p-4 shadow-sm transition hover:border-[#2F80ED]/25 hover:shadow-glow sm:rounded-3xl sm:p-5"
                >
                  <div
                    className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${feature.iconWrap}`}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <h3 className="font-bold text-[#0F2C5C]">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#566784]">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </SectionShell>
      </section>

      {/* REST API */}
      <section className="bg-[#F3F7FD] py-10 sm:py-16">
        <SectionShell>
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-10">
            <div className="min-w-0 space-y-4">
              <h2 className="text-2xl font-bold text-[#0F2C5C] sm:text-3xl">
                REST API Endpoints
              </h2>
              <p className="max-w-xl text-sm text-[#566784] sm:text-base">
                Your mobile app integrates with these endpoints. Authentication,
                user management, device settings, and alert handling.
              </p>
              <Link
                to="/api"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#2F80ED] transition hover:brightness-110"
              >
                Explore full API <span aria-hidden>→</span>
              </Link>
              <div className="overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-glow lg:hidden">
                <img
                  src={LANDING.apiLaptop}
                  alt="Laptop showing REST API code"
                  className="aspect-[16/10] h-auto w-full max-h-52 object-cover object-top sm:max-h-none"
                  loading="lazy"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-4 sm:space-y-5">
              <div className="hidden overflow-hidden rounded-3xl border border-[#DCE6F2] bg-white shadow-glow lg:block">
                <img
                  src={LANDING.apiLaptop}
                  alt="Laptop showing REST API code"
                  className="h-48 w-full object-cover object-top"
                  loading="lazy"
                />
              </div>
              <div className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-glow sm:rounded-3xl sm:p-6">
                <div className="mb-4 flex items-center gap-2 sm:mb-5">
                  <Radio
                    className="h-4 w-4 shrink-0 text-[#2F80ED]"
                    strokeWidth={2}
                  />
                  <span className="text-sm font-bold text-[#0F2C5C]">
                    API Reference
                  </span>
                </div>
                <ul className="divide-y divide-[#DCE6F2]">
                  {apiEndpointPreview.map((row) => (
                    <li
                      key={`${row.method}-${row.path}`}
                      className="flex min-w-0 flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0 sm:gap-3"
                    >
                      <span
                        className={`inline-flex shrink-0 min-w-[3rem] justify-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:min-w-[3.25rem] sm:text-xs ${methodBadgeClass(row.method)}`}
                      >
                        {row.method}
                      </span>
                      <code className="min-w-0 break-all font-mono text-xs text-[#0F2C5C] sm:text-sm">
                        {row.path}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Footer CTA */}
      <section
        className="relative w-full overflow-hidden border-t border-[#DCE6F2]"
        aria-labelledby="ready-to-weave-heading"
      >
        <img
          src={LANDING.footerBg}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#EDF3FB]/80 backdrop-blur-[1px]" />
        <div className="relative flex flex-col items-center px-4 py-14 text-center sm:px-6 sm:py-24">
          <Hexagon
            className="mb-5 h-12 w-12 text-[#2F80ED] sm:mb-6 sm:h-14 sm:w-14"
            strokeWidth={1.25}
            aria-hidden
          />
          <h2
            id="ready-to-weave-heading"
            className="text-2xl font-bold tracking-tight text-[#0F2C5C] sm:text-4xl"
          >
            Ready to Weave?
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-[#566784] sm:mt-4 sm:text-lg">
            Create your zone network. Connect your devices. Start tracking.
          </p>
          <Link
            to="/register"
            className="mt-8 inline-flex w-full max-w-xs items-center justify-center rounded-lg bg-[#2F80ED] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#2F80ED]/25 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F80ED] sm:mt-10 sm:w-auto sm:text-base"
          >
            Start Building Zones
          </Link>
        </div>
      </section>
    </div>
  );
}
