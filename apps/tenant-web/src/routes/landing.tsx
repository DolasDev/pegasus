import { Link } from '@tanstack/react-router'
import {
  Brain,
  Truck,
  ClipboardList,
  Route,
  Receipt,
  Zap,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const FEATURES = [
  {
    icon: Brain,
    title: 'AI-Powered Dispatch',
    description:
      'Intelligent crew and vehicle assignment that learns from historical moves to optimise routes, timing, and labour allocation automatically.',
  },
  {
    icon: ClipboardList,
    title: 'End-to-End Quoting',
    description:
      'Generate accurate, professional quotes in minutes. Rate tables, line items, and approval workflows — all in one place.',
  },
  {
    icon: Truck,
    title: 'Real-Time Move Tracking',
    description:
      'Live status updates from crew check-in through final delivery. Keep customers informed without manual calls.',
  },
  {
    icon: Route,
    title: 'Smart Scheduling',
    description:
      'No-overlap crew and vehicle calendars with automated conflict detection. Maximise utilisation across your entire fleet.',
  },
  {
    icon: Receipt,
    title: 'Integrated Billing',
    description:
      'Invoices generated directly from accepted quotes. Track payments, partial settlements, and outstanding balances effortlessly.',
  },
  {
    icon: Zap,
    title: 'Built for Scale',
    description:
      'Multi-tenant cloud architecture on AWS. Whether you run one location or fifty, Pegasus grows with your business.',
  },
] as const

const CHECKLIST = [
  'Replace your legacy desktop software today',
  'No per-seat licensing — flat tenant pricing',
  'Secure, SOC 2-ready cloud infrastructure',
  'Dedicated onboarding and migration support',
] as const

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <span className="text-lg font-bold tracking-tight">Pegasus</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Move Management Platform</span>
            <Separator orientation="vertical" className="h-4" />
            <Link to="/login" className={buttonVariants({ size: 'sm' })}>
              Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-xs font-medium tracking-wide">
            <Brain size={12} />
            The first AI-native moving &amp; storage platform
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Move management,
            <br />
            reimagined with AI
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-primary-foreground/80">
            Pegasus replaces your legacy desktop software with a modern, cloud-native platform that
            handles every step of the move lifecycle — from first quote to final invoice — powered
            by intelligent automation.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/login"
              className={cn(buttonVariants({ size: 'lg', variant: 'secondary' }), 'gap-2')}
            >
              Get started free
              <ArrowRight size={16} />
            </Link>
            <a
              href="#features"
              className={cn(
                buttonVariants({ size: 'lg', variant: 'ghost' }),
                'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground',
              )}
            >
              See what&apos;s included
            </a>
          </div>
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────── */}
      <section className="border-b bg-muted/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-x lg:grid-cols-4">
          {[
            { value: '10×', label: 'faster quoting' },
            { value: '40%', label: 'fewer dispatch errors' },
            { value: '100%', label: 'cloud-native' },
            { value: '24/7', label: 'platform availability' },
          ].map((stat) => (
            <div key={stat.label} className="px-6 py-8 text-center">
              <div className="text-3xl font-bold tracking-tight">{stat.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Everything your team needs</h2>
            <p className="mt-3 text-muted-foreground">
              A complete operational platform designed for modern moving companies.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon size={20} className="text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="border-t bg-muted/40 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                Ready to leave the spreadsheets behind?
              </h2>
              <p className="mt-4 text-muted-foreground">
                Pegasus is purpose-built for moving and storage companies that want to operate at
                the speed of AI. No more juggling whiteboards, phone calls, and disconnected tools.
              </p>
              <ul className="mt-6 space-y-3">
                {CHECKLIST.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" />
                    <span className="text-sm">{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'gap-2')}>
                  Open the platform
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Quotes', desc: 'Survey to signed quote in minutes' },
                { label: 'Dispatch', desc: 'Crew and vehicle scheduling with zero conflicts' },
                { label: 'Inventory', desc: 'Room-by-room item tracking with condition notes' },
                { label: 'Billing', desc: 'Automated invoices tied directly to accepted quotes' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border bg-card p-4">
                  <div className="text-sm font-semibold">{item.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-bold">Pegasus</span>
            <span className="text-xs text-muted-foreground">Move Management Platform</span>
          </div>
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Pegasus. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
