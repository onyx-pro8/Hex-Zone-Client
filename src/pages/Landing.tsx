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
  Smartphone,
} from "lucide-react";

const LANDING = {
  heroMap: "/landing/hero-isometric-map.png",
  zonePrivateArt: "/landing/zone-private-card-art.png",
  zoneExclusiveArt: "/landing/zone-exclusive-card-art.png",
  planPrivateArt: "/landing/plan-private-card-art.png",
  planExclusiveArt: "/landing/plan-exclusive-card-art.png",
  apiLaptop: "/landing/api-laptop-code.png",
  apiBannerCode: "/landing/api-banner-code.png",
  footerBg: "/landing/footer-ready-to-weave.png",
  stepRegister: "/landing/step-register-icon.png",
  stepWeave: "/landing/step-weave-icon.png",
  stepConnect: "/landing/step-connect-icon.png",
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
    border: "border-[#2F80ED]/15",
    labelColor: "text-[#2F80ED]",
    art: LANDING.zonePrivateArt,
  },
  {
    title: "Exclusive Zone",
    label: "Active",
    users: 1,
    devices: 1,
    type: "Geofence",
    accent: "bg-[#FBEFD8] text-[#E0992A]",
    border: "border-[#E0992A]/20",
    labelColor: "text-[#E0992A]",
    art: LANDING.zoneExclusiveArt,
  },
];

const networkTypeCards = [
  {
    title: "Private",
    description: "Team coordination, family tracking, fleet management",
    icon: Users,
    iconWrap: "border border-sky-200 bg-sky-50 text-sky-600",
    checkColor: "text-[#2F80ED]",
    buttonClass: "bg-[#2F80ED] hover:brightness-110",
    buttonLabel: "Create Private Zone",
    border: "border-[#DCE6F2]",
    art: LANDING.planPrivateArt,
    features: [
      "Many users allowed",
      "1 device per user",
      "Same zone type for all",
      "3 acceptable zones per user",
      "QR code invites",
    ],
  },
  {
    title: "Exclusive",
    description: "Solo deployments, individual tracking, personal zones",
    icon: User,
    iconWrap: "border border-[#E0992A]/30 bg-[#FBEFD8] text-[#E0992A]",
    checkColor: "text-[#E0992A]",
    buttonClass: "bg-[#E0992A] hover:brightness-110",
    buttonLabel: "Create Exclusive Zone",
    border: "border-[#E0992A]/40 ring-1 ring-[#E0992A]/15",
    art: LANDING.planExclusiveArt,
    features: [
      "1 user only",
      "1 device per user",
      "Any zone type allowed",
      "3 acceptable zones per user",
      "Full flexibility",
    ],
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

const heroFeatureTags = [
  { label: "H3 Indexing", icon: Hexagon },
  { label: "Mobile REST API", icon: Smartphone },
  { label: "QR Onboarding", icon: QrCode },
] as const;

export default function Landing() {
  return (
    <div className="min-w-0 space-y-12 overflow-x-hidden pb-0 sm:space-y-16">
      {/* Hero — illustration blends into background (no bordered card) */}
      <section className="relative isolate overflow-hidden">
        {/* Desktop / tablet: map anchored right, fades into page bg on the left */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[62%] min-[480px]:block lg:w-[55%]"
        >
          <img
            src={LANDING.heroMap}
            alt=""
            className="h-full w-full object-contain object-right"
          />
          <div className="absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r from-[#f3f7fd] via-[#f3f7fd] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#f3f7fd] to-transparent" />
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#f3f7fd] to-transparent" />
          <div className="absolute inset-y-0 right-0 w-[5%] bg-gradient-to-l from-[#f3f7fd] to-transparent" />
        </div>

        {/* Mobile: subtle map wash behind copy */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 min-[480px]:hidden"
        >
          <img
            src={LANDING.heroMap}
            alt=""
            className="absolute -right-8 top-8 h-[min(70vw,320px)] w-auto max-w-none opacity-[0.22]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-white via-white/92 to-[#F7FAFE]" />
        </div>

        <SectionShell className="relative z-10 py-10 sm:py-14 lg:py-20">
          <div className="max-w-xl lg:max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-4 py-2 text-sm font-medium text-[#2F80ED]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2FA24A] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2FA24A]" />
              </span>
              REST API Ready
            </span>
            <div className="mt-6 space-y-4">
              <h1 className="text-4xl font-semibold text-[#0F2C5C] sm:text-5xl lg:text-6xl">
                Weave Your Spatial Zones
              </h1>
              <p className="text-lg leading-8 text-[#566784]">
                A geospatial platform that bridges web and mobile. Define zones
                using H3 hexagonal indexing, connect devices via REST API, and
                track everything in real time.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-4">
              <Link
                to="/register"
                className="inline-flex items-center justify-center rounded-md bg-[#2F80ED] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
              >
                Create Account
              </Link>
              <Link
                to="/api"
                className="inline-flex items-center justify-center rounded-md border border-[#DCE6F2] bg-white/90 px-6 py-3 text-sm text-[#566784] backdrop-blur-sm transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
              >
                API Docs
              </Link>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {heroFeatureTags.map(({ label, icon: Icon }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-3xl border border-[#DCE6F2] bg-white/90 px-4 py-3 text-sm text-[#566784] shadow-sm backdrop-blur-sm"
                >
                  <Icon
                    className="h-4 w-4 shrink-0 text-[#2F80ED]"
                    aria-hidden
                  />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Zone Network — side-by-side cards + dev banner */}
      <section>
        <SectionShell>
          <div className="rounded-[2rem] border border-[#DCE6F2] bg-white p-6 shadow-glow sm:p-8">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[#0F2C5C] sm:text-xl">
                  Zone Network
                </h2>
                <p className="mt-1 text-sm text-[#566784]">
                  Live status of your current network and API connectivity.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-md bg-[#E3F4E8] px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#2FA24A]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2FA24A] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2FA24A]" />
                </span>
                Live
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              {networkCards.map((card) => (
                <article
                  key={card.title}
                  className={`relative overflow-hidden rounded-3xl border bg-[#F7FAFE] ${card.border}`}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-[58%] sm:w-[52%]"
                  >
                    <img
                      src={card.art}
                      alt=""
                      className="h-full w-full object-contain object-right"
                      loading="lazy"
                    />
                    <div className="absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-[#F7FAFE] via-[#F7FAFE]/85 to-transparent" />
                  </div>
                  <div className="relative p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div
                          className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] ${card.labelColor}`}
                        >
                          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {card.title}
                        </div>
                        <p className="mt-3 text-xl font-semibold text-[#0F2C5C] sm:text-2xl">
                          {card.type}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${card.accent}`}
                      >
                        {card.label}
                      </span>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-[#566784]">
                      <span className="inline-flex items-center gap-2">
                        <User className="h-4 w-4 shrink-0" aria-hidden />
                        {card.users} users
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Radio className="h-4 w-4 shrink-0" aria-hidden />
                        {card.devices} devices
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="relative mt-6 overflow-hidden rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5 sm:p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] sm:block lg:w-[36%]"
              >
                <img
                  src={LANDING.apiBannerCode}
                  alt=""
                  className="h-full w-full object-contain object-right pr-2"
                  loading="lazy"
                />
                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#F7FAFE] via-[#F7FAFE]/90 to-transparent" />
              </div>
              <div className="relative max-w-md sm:max-w-lg">
                <p className="font-medium text-[#0F2C5C]">
                  Developer-friendly REST API
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#566784]">
                  Complete endpoint documentation with live request examples and
                  response previews.
                </p>
              </div>
            </div>
          </div>
        </SectionShell>
      </section>

      {/* How it works */}
      <section>
        <SectionShell>
          <div className="layer-card !p-0">
            <div className="px-6 pb-12 pt-12 sm:px-8 sm:pt-16">
              <h2 className="text-2xl font-semibold text-[#0F2C5C]">
                How Safe Zone Patrol Works
              </h2>
              <p className="mt-3 text-[#566784]">
                From registration to real-time device tracking in three steps.
              </p>
              <div className="mt-12 grid gap-4 sm:grid-cols-3">
                {howItWorksSteps.map((step, index) => (
                  <div key={step.title} className="flex gap-4 p-2 sm:p-4">
                    <img
                      src={step.image}
                      alt=""
                      aria-hidden
                      className="mb-4 h-16 w-16 object-contain sm:h-[4.5rem] sm:w-[4.5rem]"
                      loading="lazy"
                    />
                    <div>
                      <div className="flex items-end gap-2">
                        <p className="text-3xl font-bold text-[#2F80ED]">
                          0{index + 1}
                        </p>
                        <h3 className="text-xl font-semibold text-[#0F2C5C]">
                          {step.title}
                        </h3>
                      </div>
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
      <section>
        <SectionShell>
          <h2 className="text-2xl font-semibold text-[#0F2C5C]">
            Pick Your Network Type
          </h2>
          <p className="mt-3 text-[#566784]">
            Two models, built for different scales
          </p>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {networkTypeCards.map((card) => {
              const Icon = card.icon;
              return (
                <article
                  key={card.title}
                  className={`relative overflow-hidden rounded-3xl border bg-white shadow-glow ${card.border}`}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0"
                  >
                    <img
                      src={card.art}
                      alt=""
                      className="h-full w-full object-contain object-right"
                      loading="lazy"
                    />
                    <div className="absolute inset-y-0 left-0 w-[60%] bg-gradient-to-r from-white via-white/90 to-transparent" />
                  </div>
                  <div className="relative flex min-h-[22rem] flex-col p-6 sm:min-h-[24rem] sm:p-8">
                    <div className="flex max-w-[58%] gap-4 sm:max-w-[52%]">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${card.iconWrap}`}
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-[#0F2C5C]">
                          {card.title}
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-[#566784]">
                          {card.description}
                        </p>
                      </div>
                    </div>
                    <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm text-[#566784] sm:max-w-[52%]">
                      {card.features.map((item) => (
                        <li key={item} className="flex items-start gap-3">
                          <CircleCheck
                            className={`mt-0.5 h-5 w-5 shrink-0 ${card.checkColor}`}
                            strokeWidth={2}
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/register"
                      className={`mt-8 inline-flex w-full items-center justify-center rounded-md px-5 py-3 text-sm font-bold text-white transition sm:max-w-[52%] ${card.buttonClass}`}
                    >
                      {card.buttonLabel}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </SectionShell>
      </section>

      {/* Built for developers */}
      <section>
        <SectionShell>
          <div className="layer-card !p-0">
            <div className="px-6 pb-12 pt-12 sm:px-8 sm:pt-16">
              <h2 className="text-2xl font-semibold text-[#0F2C5C]">
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
      <section>
        <SectionShell>
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-[#0F2C5C]">
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

            <div className="relative">
              <div className="rounded-3xl border border-[#DCE6F2] bg-white p-6 shadow-glow">
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
              {/* <div className="pointer-events-none absolute -bottom-4 -right-2 hidden w-48 overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-glow sm:block lg:-right-16 lg:w-56">
                <img
                  src={LANDING.apiLaptop}
                  alt=""
                  aria-hidden
                  className="h-auto w-full object-cover object-top"
                  loading="lazy"
                />
              </div> */}
            </div>
          </div>
        </SectionShell>
      </section>

      {/* Footer CTA */}
      <section
        className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 overflow-hidden border-t border-[#DCE6F2] bg-[#EDF3FB]"
        aria-labelledby="ready-to-weave-heading"
      >
        <img
          src={LANDING.footerBg}
          alt=""
          aria-hidden
          width={1800}
          height={500}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="relative flex flex-col items-center px-6 py-16 text-center sm:py-20">
          {/* <Hexagon
            className="mb-8 h-14 w-14 text-[#2F80ED]"
            strokeWidth={1.25}
            aria-hidden
          /> */}
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
            className="mt-10 inline-flex items-center justify-center rounded-md bg-[#2F80ED] px-6 py-3 text-base font-bold text-white transition hover:brightness-110"
          >
            Start Building Zones
          </Link>
        </div>
      </section>
    </div>
  );
}
