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
      className={`mx-auto w-full min-w-0 max-w-[1280px] px-4 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}

function ZoneNetworkWidget() {
  return (
    <div className="rounded-[2rem] border border-[#DCE6F2] bg-white p-6 shadow-glow sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0F2C5C] sm:text-xl">
            Zone Network
          </h2>
          <p className="mt-1 text-sm text-[#566784]">
            Live status of your current network and API connectivity.
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-[#EDF3FB] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#2F80ED] sm:text-xs">
          Live
        </span>
      </div>

      <div className="space-y-4">
        {networkCards.map((card) => (
          <article
            key={card.title}
            className="overflow-hidden rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE]"
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8694AC] sm:text-xs">
                    {card.title}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[#0F2C5C]">
                    {card.type}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] sm:text-xs ${card.accent}`}
                >
                  {card.label}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-[#566784]">
                <div className="rounded-2xl border border-[#DCE6F2] bg-white p-3">
                  {card.users} users
                </div>
                <div className="rounded-2xl border border-[#DCE6F2] bg-white p-3">
                  {card.devices} devices
                </div>
              </div>
            </div>
            <img
              src={card.image}
              alt={card.imageAlt}
              className="h-28 w-full object-cover object-center sm:h-36"
              loading="lazy"
            />
          </article>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-4 sm:p-5">
        <p className="font-medium text-[#0F2C5C]">
          Developer-friendly REST API
        </p>
        <p className="mt-2 text-sm text-[#566784]">
          Complete endpoint documentation with live request examples and
          response previews.
        </p>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-w-0 overflow-x-hidden pb-0">
      {/* Hero — copy left, Zone Network widget right (matches design mockup) */}
      <section className="py-8 sm:py-12 lg:py-14">
        <SectionShell>
          <div className="grid items-start gap-8 xl:grid-cols-[1.15fr_1fr] xl:gap-10">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-4 py-2 text-sm font-medium text-[#2F80ED]">
                <Hexagon size={16} aria-hidden />
                REST API Ready
              </span>
              <div className="space-y-4">
                <h1 className="text-4xl font-semibold leading-tight text-[#0F2C5C] sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
                  Weave Your Spatial Zones
                </h1>
                <p className="max-w-xl text-base leading-8 text-[#566784] sm:text-lg">
                  A geospatial platform that bridges web and mobile. Define zones
                  using H3 hexagonal indexing, connect devices via REST API, and
                  track everything in real time.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center rounded-md bg-[#2F80ED] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110 sm:min-w-[160px]"
                >
                  Create Account
                </Link>
                <Link
                  to="/api"
                  className="inline-flex items-center justify-center rounded-md border border-[#DCE6F2] bg-white px-6 py-3 text-sm text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED] sm:min-w-[140px]"
                >
                  API Docs
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {["H3 Indexing", "Mobile REST API", "QR Onboarding"].map(
                  (tag) => (
                    <div
                      key={tag}
                      className="rounded-3xl border border-[#DCE6F2] bg-white px-4 py-3 text-center text-sm text-[#566784] sm:text-left"
                    >
                      {tag}
                    </div>
                  ),
                )}
              </div>
            </div>

            <ZoneNetworkWidget />
          </div>
        </SectionShell>
      </section>

      {/* Isometric map visual band */}
      <section className="pb-10 sm:pb-14">
        <SectionShell>
          <div className="overflow-hidden rounded-[2rem] border border-[#DCE6F2] bg-white shadow-glow">
            <img
              src={LANDING.heroMap}
              alt="Isometric city map with hex zones, mobile app, and drone"
              className="h-auto w-full object-cover"
              loading="lazy"
            />
          </div>
        </SectionShell>
      </section>

      {/* How it works */}
      <section className="pb-12 sm:pb-16">
        <SectionShell>
          <div className="layer-card !p-0 sm:!p-0">
            <div className="px-6 pb-12 pt-10 sm:px-8 sm:pt-16">
              <h2 className="text-2xl font-semibold text-[#0F2C5C] sm:text-3xl">
                How Safe Zone Patrol Works
              </h2>
              <p className="mt-3 text-[#566784]">
                From registration to real-time device tracking in three steps.
              </p>
              <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-3 sm:gap-6">
                {howItWorksSteps.map((step, index) => (
                  <div key={step.title} className="flex gap-4 p-2 sm:p-4">
                    <img
                      src={step.image}
                      alt=""
                      aria-hidden
                      className="h-12 w-12 shrink-0 rounded-xl border border-[#DCE6F2] bg-white object-cover sm:h-14 sm:w-14"
                      loading="lazy"
                    />
                    <div>
                      <p className="text-3xl font-bold text-[#2F80ED]">
                        0{index + 1}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold text-[#0F2C5C]">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-[#566784]">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Network type */}
      <section className="pb-12 sm:pb-16">
        <SectionShell>
          <h2 className="text-2xl font-semibold text-[#0F2C5C] sm:text-3xl">
            Pick Your Network Type
          </h2>
          <p className="mt-3 text-[#566784]">
            Two models, built for different scales
          </p>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col overflow-hidden rounded-3xl border border-[#DCE6F2] bg-white shadow-glow">
              <div className="flex flex-1 flex-col p-6 sm:p-8">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50">
                    <Users className="h-5 w-5 text-sky-600" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[#0F2C5C]">
                      Private
                    </h3>
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
                  className="mt-8 inline-flex w-full items-center justify-center rounded-md bg-[#2F80ED] px-5 py-3 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Create Private Zone
                </Link>
              </div>
              <img
                src={LANDING.planPrivate}
                alt="Team collaborating in a private zone network"
                className="h-44 w-full object-cover object-center sm:h-52"
                loading="lazy"
              />
            </div>

            <div className="flex flex-col overflow-hidden rounded-3xl border border-[#E0992A]/40 bg-white shadow-glow ring-1 ring-[#E0992A]/15">
              <div className="flex flex-1 flex-col p-6 sm:p-8">
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E0992A]/30 bg-[#FBEFD8]">
                    <User className="h-5 w-5 text-[#E0992A]" strokeWidth={2} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[#0F2C5C]">
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
                  className="mt-8 inline-flex w-full items-center justify-center rounded-md bg-[#E0992A] px-5 py-3 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Create Exclusive Zone
                </Link>
              </div>
              <img
                src={LANDING.planExclusive}
                alt="Individual user in an exclusive zone"
                className="h-44 w-full object-cover object-center sm:h-52"
                loading="lazy"
              />
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Built for developers */}
      <section className="pb-12 sm:pb-16">
        <SectionShell>
          <div className="layer-card !p-0 sm:!p-0">
            <div className="px-6 pb-12 pt-10 sm:px-8 sm:pt-16">
              <h2 className="text-2xl font-semibold text-[#0F2C5C] sm:text-3xl">
                Built for developers
              </h2>
              <p className="mt-3 max-w-3xl text-[#566784]">
                Everything your mobile app needs to communicate with the zone
                server.
              </p>
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {developerFeatures.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={feature.title}
                      className="rounded-3xl border border-[#DCE6F2] bg-white p-5 shadow-glow"
                    >
                      <div
                        className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${feature.iconWrap}`}
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <h3 className="font-semibold text-[#0F2C5C]">
                        {feature.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-[#566784]">
                        {feature.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* REST API */}
      <section className="pb-12 sm:pb-16">
        <SectionShell>
          <div className="relative grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-12">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-[#0F2C5C] sm:text-3xl">
                REST API Endpoints
              </h2>
              <p className="max-w-xl text-[#566784]">
                Your mobile app integrates with these endpoints. Authentication,
                user management, device settings, and alert handling.
              </p>
              <Link
                to="/api"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2F80ED] transition hover:brightness-110"
              >
                Explore full API <span aria-hidden>→</span>
              </Link>
            </div>

            <div className="relative space-y-5">
              <div className="overflow-hidden rounded-3xl border border-[#DCE6F2] bg-white shadow-glow lg:absolute lg:-top-6 lg:right-0 lg:z-10 lg:w-[min(100%,320px)]">
                <img
                  src={LANDING.apiLaptop}
                  alt="Laptop showing REST API code"
                  className="h-44 w-full object-cover object-top sm:h-48"
                  loading="lazy"
                />
              </div>
              <div className="rounded-3xl border border-[#DCE6F2] bg-white p-6 shadow-glow lg:mt-36">
                <div className="mb-5 flex items-center gap-2">
                  <Radio
                    className="h-4 w-4 shrink-0 text-[#2F80ED]"
                    strokeWidth={2}
                  />
                  <span className="text-sm font-medium text-[#0F2C5C]">
                    API Reference
                  </span>
                </div>
                <ul className="divide-y divide-[#DCE6F2]">
                  {apiEndpointPreview.map((row) => (
                    <li
                      key={`${row.method}-${row.path}`}
                      className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <span
                        className={`inline-flex min-w-[3.25rem] shrink-0 justify-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${methodBadgeClass(row.method)}`}
                      >
                        {row.method}
                      </span>
                      <code className="min-w-0 break-all font-mono text-sm text-[#0F2C5C]">
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
        className="relative w-full overflow-hidden border-t border-[#DCE6F2] bg-[#EDF3FB]"
        aria-labelledby="ready-to-weave-heading"
      >
        <img
          src={LANDING.footerBg}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
        />
        <div className="relative flex flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-20">
          <Hexagon
            className="mb-8 h-14 w-14 text-[#2F80ED]"
            strokeWidth={1.25}
            aria-hidden
          />
          <h2
            id="ready-to-weave-heading"
            className="text-3xl font-bold tracking-tight text-[#0F2C5C] sm:text-4xl"
          >
            Ready to Weave?
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[#566784] sm:text-lg">
            Create your zone network. Connect your devices. Start tracking.
          </p>
          <Link
            to="/register"
            className="mt-10 inline-flex items-center justify-center rounded-md bg-[#2F80ED] px-6 py-3 text-base font-bold text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F80ED]"
          >
            Start Building Zones
          </Link>
        </div>
      </section>
    </div>
  );
}
